'use strict';
/*
 * The built-in mailbox: one IMAP/SMTP account, a local list of the newest messages of inbox and sent folder, and
 * sending. Runs in the main process; the window only sees plain data through IPC.
 *
 * Deliberate limits that keep this dependable:
 *  - every connection is encrypted (TLS, or STARTTLS that must succeed) and verified against the system's
 *    certificate authorities;
 *  - the password never enters the app's data file or its backups; it is stored encrypted by the operating
 *    system's key store, or kept in memory only when no key store is available;
 *  - messages are shown as text. HTML, scripts and remote images of a mail are never rendered;
 *  - one short-lived connection per task instead of a long-lived one that silently goes stale after standby.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const core = require('./mail-core.cjs');

// A certificate is checked against the server's name; an IP address has none to send along.
const serverName = host => (net.isIP(host) ? undefined : host);

const FOLDERS = ['inbox', 'sent'];
const { emptyCache } = core;

async function writePrivate(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, text, { mode: 0o600 });
    await fs.rename(temporary, file);
  } catch (error) { await fs.rm(temporary, { force: true }); throw error; }
}
async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}
async function readStream(stream, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) { stream.destroy?.(); throw core.fieldError('Diese E-Mail ist zu groß, um sie in Helferlein anzuzeigen. Bitte im Webmail des Anbieters öffnen.'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** True when the message carries a plain-text body part (a .txt attachment is not one). */
function hasPlainBody(node, depth = 0) {
  if (!node || depth > 12) return false;
  if (Array.isArray(node.childNodes) && node.childNodes.length) return node.childNodes.some(child => hasPlainBody(child, depth + 1));
  return String(node.type || '').toLowerCase() === 'text/plain' && String(node.disposition || '').toLowerCase() !== 'attachment';
}

class MailService {
  /**
   * @param {{ dir: string, codec: { available(): boolean, encrypt(text: string): Buffer, decrypt(bytes: Buffer): string },
   *   tls?: object, anyPort?: boolean, timeouts?: { connect?: number, socket?: number },
   *   convertHtml?: (html: string) => Promise<{ text: string, skipped: string }> }} options
   */
  constructor({ dir, codec, tls = {}, anyPort = false, timeouts = {}, convertHtml }) {
    this.dir = dir; this.codec = codec; this.tls = tls; this.anyPort = anyPort;
    // HTML is converted in a worker thread with a time limit, never in this process (mail-html-worker.cjs).
    this.convertHtml = convertHtml || (html => require('./mail-html-worker.cjs').convertHtml(html));
    this.timeouts = { connect: timeouts.connect ?? 20_000, socket: timeouts.socket ?? 90_000 };
    this.accountFile = path.join(dir, 'account.json');
    this.cacheFile = path.join(dir, 'cache.json');
    this.bodyDir = path.join(dir, 'bodies');
    this.account = undefined; // undefined: not loaded yet, null: none
    this.cache = null;
    this.sessionPassword = '';
    this.lastError = '';
    // The provider refused the login at the last attempt. The window stops fetching by itself until this clears.
    this.authFailed = false;
    // The provider refused the login when sending. Cleared by a mail that goes out or by saving the account again.
    this.sendRefused = false;
    this.syncing = false;
    this.queue = Promise.resolve();
    this.loading = null;
  }

  /** Network tasks run one after another: two logins at once make several providers lock the account briefly. */
  enqueue(task) {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  /** Reads account and message list once. Calls that arrive while it runs wait for the same read. */
  load() {
    if (!this.loading) {
      this.loading = this.readStored().catch(error => { this.loading = null; throw error; });
    }
    return this.loading;
  }

  async readStored() {
    const stored = await readJson(this.accountFile);
    let account = null;
    try { account = stored ? { ...core.normalizeAccount(stored, { anyPort: this.anyPort }), password: typeof stored.password === 'string' ? stored.password : '', savesSentItself: !!stored.savesSentItself } : null; }
    catch { account = null; }
    let cache = null;
    if (account) {
      // The list is only a copy of what the server has: an unreadable or damaged one is fetched again.
      try { cache = core.sanitizeCache(await readJson(this.cacheFile), account.email); } catch { cache = null; }
      cache ||= emptyCache(account.email);
    }
    this.account = account; this.cache = cache;
  }

  password() {
    if (this.sessionPassword) return this.sessionPassword;
    if (!this.account?.password || !this.codec.available()) return '';
    try { return this.codec.decrypt(Buffer.from(this.account.password, 'base64')); } catch { return ''; }
  }

  async status() {
    await this.load();
    const account = this.account;
    return {
      configured: !!account,
      account: account ? { email: account.email, name: account.name, user: account.user, imap: account.imap, smtp: account.smtp, signature: account.signature } : null,
      canStorePassword: this.codec.available(),
      // Without a readable password the user has to enter it once more (new computer, key store reset).
      needsPassword: !!account && !this.password(),
      // For the account page both mean the same: the password has to be checked.
      authFailed: this.authFailed || this.sendRefused,
    };
  }

  imapOptions(account, password) {
    return {
      host: account.imap.host, port: account.imap.port, secure: account.imap.secure, doSTARTTLS: account.imap.secure ? undefined : true,
      auth: { user: account.user, pass: password }, logger: false, disableAutoIdle: true,
      tls: { minVersion: 'TLSv1.2', servername: serverName(account.imap.host), ...this.tls },
      connectionTimeout: this.timeouts.connect, greetingTimeout: this.timeouts.connect, socketTimeout: this.timeouts.socket,
      clientInfo: { name: 'Helferlein' },
    };
  }

  async withImap(task, account = this.account, password = this.password()) {
    if (!account) throw core.fieldError('Es ist noch kein E-Mail-Postfach eingerichtet.');
    if (!password) throw core.fieldError('Das Passwort des Postfachs fehlt. Bitte unter „Postfach einrichten“ erneut eingeben.');
    const { ImapFlow } = require('imapflow');
    const client = new ImapFlow(this.imapOptions(account, password));
    client.on('error', () => {}); // surfaced through the failing command; an unhandled event would end the app
    // Only logins of the stored account count; details that are still being checked are not the mailbox yet.
    const stored = account === this.account;
    try {
      await client.connect();
      if (stored) this.authFailed = false;
      return await task(client);
    } catch (error) {
      if (stored && core.isAuthError(error)) this.authFailed = true;
      if (!error.userMessage) error.userMessage = core.describeError(error, 'imap');
      throw error;
    } finally {
      try { if (client.usable) await client.logout(); else client.close(); } catch { try { client.close(); } catch { /* already gone */ } }
    }
  }

  transport(account, password) {
    const nodemailer = require('nodemailer');
    return nodemailer.createTransport({
      host: account.smtp.host, port: account.smtp.port, secure: account.smtp.secure, requireTLS: !account.smtp.secure,
      auth: { user: account.user, pass: password }, tls: { minVersion: 'TLSv1.2', servername: serverName(account.smtp.host), ...this.tls },
      connectionTimeout: this.timeouts.connect, greetingTimeout: this.timeouts.connect, socketTimeout: this.timeouts.socket,
      disableFileAccess: true, disableUrlAccess: true,
    });
  }

  /** Checks both servers with the given details and only then stores them. */
  async saveAccount(input) {
    await this.load();
    const account = core.normalizeAccount(input, { anyPort: this.anyPort });
    const suggestion = core.suggestServers(account.email);
    if (suggestion?.unsupported && !this.anyPort) throw core.fieldError(suggestion.note, 'email');
    const typed = typeof input?.password === 'string' ? input.password : '';
    // The stored password only ever goes to the servers it was checked with. A changed server, port or user name
    // could be someone else's machine, so the password has to be typed again for it.
    const reusable = core.keepsStoredPassword(this.account, account);
    const password = typed || (reusable ? this.password() : '');
    if (!password) {
      throw core.fieldError(this.account && !reusable && this.password()
        ? 'Sie haben die Adresse, den Benutzernamen oder einen Server geändert. Bitte geben Sie deshalb das Passwort des Postfachs noch einmal ein.'
        : 'Bitte das Passwort des Postfachs eingeben.', 'password');
    }
    if (password.length > 1024 || /[\r\n\0]/.test(password)) throw core.fieldError('Das Passwort enthält ungültige Zeichen.', 'password');

    return this.enqueue(async () => {
      const paths = await this.withImap(async client => {
        const boxes = await client.list();
        return { sent: core.findSpecialFolder(boxes, 'sent'), trash: core.findSpecialFolder(boxes, 'trash') };
      }, account, password);
      const transport = this.transport(account, password);
      try { await transport.verify(); }
      catch (error) { throw core.fieldError(core.describeError(error, 'smtp'), 'smtpHost'); }
      finally { transport.close(); }

      const canStore = this.codec.available();
      const stored = { ...account, password: canStore ? this.codec.encrypt(password).toString('base64') : '', savesSentItself: !!core.providerOf(account)?.savesSentItself };
      const changedMailbox = !this.account || this.account.email !== account.email || this.account.imap.host !== account.imap.host;
      await writePrivate(this.accountFile, JSON.stringify(stored, null, 2));
      this.account = stored;
      this.sessionPassword = canStore ? '' : password;
      if (changedMailbox || !this.cache) { await this.clearCache(); this.cache = emptyCache(account.email); }
      this.cache.paths = paths;
      this.lastError = ''; this.authFailed = false; this.sendRefused = false;
      await this.persistCache();
      return { ok: true, passwordStored: canStore };
    });
  }

  async clearCache() {
    await fs.rm(this.cacheFile, { force: true });
    await fs.rm(this.bodyDir, { recursive: true, force: true });
  }

  async removeAccount() {
    await this.load();
    return this.enqueue(async () => {
      await fs.rm(this.accountFile, { force: true });
      await this.clearCache();
      this.account = null; this.cache = null; this.sessionPassword = ''; this.lastError = ''; this.authFailed = false; this.sendRefused = false;
      return { ok: true };
    });
  }

  async persistCache() { if (this.cache) await writePrivate(this.cacheFile, JSON.stringify(this.cache)); }

  async list() {
    await this.load();
    return {
      configured: !!this.account,
      email: this.account?.email || '',
      inbox: this.cache?.folders.inbox.messages || [],
      sent: this.cache?.folders.sent.messages || [],
      hasSentFolder: !!this.cache?.paths.sent,
      hasTrashFolder: !!this.cache?.paths.trash,
      lastSync: this.cache?.lastSync || '',
      syncing: this.syncing,
      error: this.lastError,
      needsPassword: !!this.account && !this.password(),
      authFailed: this.authFailed,
      sendRefused: this.sendRefused,
    };
  }

  async syncFolder(client, folder, mailboxPath) {
    const lock = await client.getMailboxLock(mailboxPath, { readOnly: true });
    try {
      const uidValidity = String(client.mailbox.uidValidity ?? '');
      const cached = this.cache.folders[folder];
      const previous = cached.path === mailboxPath && cached.uidValidity === uidValidity ? cached.messages : [];
      const exists = client.mailbox.exists || 0;
      let messages = [];
      if (exists > 0) {
        const first = Math.max(1, exists - core.MAX_MESSAGES_PER_FOLDER + 1);
        const flags = new Map();
        for await (const message of client.fetch(`${first}:*`, { uid: true, flags: true })) flags.set(message.uid, { seen: message.flags.has('\\Seen'), answered: message.flags.has('\\Answered') });
        // Entries stored before Reply-To was kept are loaded once more, so that they gain it.
        const known = new Set(previous.filter(item => Array.isArray(item.replyTo)).map(item => item.uid));
        const missing = [...flags.keys()].filter(uid => !known.has(uid));
        const fetched = [];
        for (let start = 0; start < missing.length; start += 100) {
          const range = missing.slice(start, start + 100).join(',');
          for await (const message of client.fetch(range, { uid: true, envelope: true, flags: true, bodyStructure: true, size: true, internalDate: true, headers: ['references', 'in-reply-to'] }, { uid: true })) fetched.push(core.summarize(folder, message));
        }
        messages = core.mergeFolder(previous, fetched, flags);
      }
      this.cache.folders[folder] = { path: mailboxPath, uidValidity, messages };
    } finally { lock.release(); }
  }

  /** Fetches what is new on the server. Failing leaves the previous list untouched and reports why. */
  async sync() {
    await this.load();
    if (!this.account) return this.list();
    this.syncing = true;
    try {
      await this.enqueue(() => this.withImap(async client => {
        if (!this.cache.paths.sent || !this.cache.paths.trash) {
          const boxes = await client.list();
          this.cache.paths = { sent: core.findSpecialFolder(boxes, 'sent'), trash: core.findSpecialFolder(boxes, 'trash') };
        }
        await this.syncFolder(client, 'inbox', 'INBOX');
        if (this.cache.paths.sent) {
          try { await this.syncFolder(client, 'sent', this.cache.paths.sent); }
          catch (error) { if (error.mailboxMissing || /NONEXISTENT|TRYCREATE/i.test(`${error.serverResponseCode || ''} ${error.message || ''}`)) this.cache.paths.sent = ''; else throw error; }
        }
        this.cache.lastSync = new Date().toISOString();
      }));
      this.lastError = '';
      await this.persistCache();
      await this.pruneBodies();
    } catch (error) {
      this.lastError = error.userMessage || core.describeError(error, 'imap');
    } finally { this.syncing = false; }
    return this.list();
  }

  bodyFile(folder, uid) { return path.join(this.bodyDir, `${folder}-${this.cache.folders[folder].uidValidity || '0'}-${uid}.json`); }

  async pruneBodies() {
    let names;
    try { names = await fs.readdir(this.bodyDir); } catch { return; }
    const keep = new Set(FOLDERS.flatMap(folder => this.cache.folders[folder].messages.map(item => path.basename(this.bodyFile(folder, item.uid)))));
    await Promise.all(names.filter(name => !keep.has(name)).map(name => fs.rm(path.join(this.bodyDir, name), { force: true })));
  }

  find(id) {
    const [folder, uid] = String(id).split(':');
    if (!FOLDERS.includes(folder) || !this.cache) return null;
    const summary = this.cache.folders[folder].messages.find(item => item.uid === Number(uid));
    return summary ? { folder, summary, mailboxPath: this.cache.folders[folder].path } : null;
  }

  /**
   * The message as mailparser reads it: plain-text part, raw HTML part and attachments. HTML is deliberately not
   * turned into text here (`skipHtmlToText`): that is synchronous work on a stranger's markup.
   */
  async fetchParsed(found) {
    if (found.summary.size > core.MAX_MESSAGE_BYTES) throw core.fieldError('Diese E-Mail ist zu groß, um sie in Helferlein anzuzeigen. Bitte im Webmail des Anbieters öffnen.');
    const { source, hasPlainText } = await this.enqueue(() => this.withImap(async client => {
      const lock = await client.getMailboxLock(found.mailboxPath, { readOnly: true });
      try {
        // The server's own map of the message says whether a plain-text body exists (attachments do not count).
        const meta = await client.fetchOne(String(found.summary.uid), { bodyStructure: true }, { uid: true }).catch(() => null);
        const download = await client.download(String(found.summary.uid), undefined, { uid: true, maxBytes: core.MAX_MESSAGE_BYTES + 1 });
        if (!download?.content) throw core.fieldError('Diese E-Mail gibt es auf dem Server nicht mehr. Bitte „Abrufen“ wählen.');
        return { source: await readStream(download.content, core.MAX_MESSAGE_BYTES), hasPlainText: hasPlainBody(meta?.bodyStructure) };
      } finally { lock.release(); }
    }));
    const { simpleParser } = require('mailparser');
    // mailparser refuses messages built to exhaust it (endless headers, thousands of nested parts).
    const parsed = await simpleParser(source, { skipHtmlToText: true, skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true })
      .catch(() => { throw core.fieldError('Diese E-Mail ist ungewöhnlich aufgebaut und lässt sich in Helferlein nicht lesen. Bitte im Webmail des Anbieters öffnen.'); });
    parsed.htmlOnly = !!parsed.html && !hasPlainText;
    return parsed;
  }

  /** Text and attachment list of one message; cached after the first read so it also opens offline. */
  async body(id) {
    await this.load();
    const found = this.find(id);
    if (!found) throw core.fieldError('Diese E-Mail ist nicht mehr in der Liste. Bitte „Abrufen“ wählen.');
    const file = this.bodyFile(found.folder, found.summary.uid);
    const cached = await readJson(file).catch(() => null);
    // Texts stored by earlier versions have no `unreadable`; they are complete as they are.
    if (cached && typeof cached.text === 'string' && Array.isArray(cached.attachments)) return { ...cached, text: cached.text, truncated: cached.truncated === true, htmlOnly: cached.htmlOnly === true, unreadable: cached.unreadable === true, attachments: cached.attachments };
    const parsed = await this.fetchParsed(found);
    // Mails are shown as text only. Without a usable text part the HTML part is converted, in one place for every
    // kind of message. `skipped` names why that gave nothing (too large, nested too deep, took too long).
    let source = String(parsed.text || '');
    let skipped = '';
    if (!source.trim() && typeof parsed.html === 'string' && parsed.html.trim()) {
      const converted = await this.convertHtml(parsed.html).catch(() => ({ text: '', skipped: 'error' }));
      // Layout cells leave blanks at line ends; a text part is shown exactly as written (its "-- " line included).
      source = converted.skipped ? '' : String(converted.text || '').replace(/[ \t\u00a0]+\n/g, '\n');
      skipped = String(converted.skipped || '');
    }
    // Direction overrides and invisible characters can make a line read differently from what it says.
    const text = source.replace(/[\u202a-\u202e\u2066-\u2069\u200b\u200e\u200f\ufeff]/g, '').replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
    const body = {
      text: text.slice(0, core.MAX_BODY_CHARS),
      truncated: text.length > core.MAX_BODY_CHARS,
      htmlOnly: !!parsed.htmlOnly,
      // The reader says that this mail cannot be shown as text instead of showing it as empty.
      unreadable: !!skipped,
      attachments: (parsed.attachments || []).filter(item => !(item.related && /^image\//i.test(item.contentType || '') && !item.filename)).slice(0, 50).map((item, index) => ({ index, filename: core.clean(item.filename, 200) || `Anhang-${index + 1}`, contentType: core.clean(item.contentType, 120) || 'application/octet-stream', size: item.size || item.content?.length || 0 })),
    };
    // A conversion that ran out of time may work on the next try; everything else is the same every time.
    if (skipped !== 'timeout' && skipped !== 'error') await writePrivate(file, JSON.stringify(body));
    return body;
  }

  /** Bytes of one attachment, fetched again from the server (attachments are not kept on this computer). No HTML is converted. */
  async attachment(id, index) {
    await this.load();
    const found = this.find(id);
    if (!found) throw core.fieldError('Diese E-Mail ist nicht mehr in der Liste. Bitte „Abrufen“ wählen.');
    const parsed = await this.fetchParsed(found);
    const listed = (parsed.attachments || []).filter(item => !(item.related && /^image\//i.test(item.contentType || '') && !item.filename)).slice(0, 50);
    const item = listed[Number(index)];
    if (!item || !Buffer.isBuffer(item.content)) throw core.fieldError('Dieser Anhang wurde nicht gefunden.');
    return { filename: core.clean(item.filename, 200) || `Anhang-${Number(index) + 1}`, contentType: core.clean(item.contentType, 120) || 'application/octet-stream', bytes: item.content };
  }

  async setSeen(id, seen) {
    await this.load();
    const found = this.find(id);
    if (!found || found.summary.seen === !!seen) return this.list();
    await this.enqueue(() => this.withImap(async client => {
      const lock = await client.getMailboxLock(found.mailboxPath);
      try {
        // imapflow answers a refusal of the server with `false` instead of throwing.
        const stored = await client[seen ? 'messageFlagsAdd' : 'messageFlagsRemove'](String(found.summary.uid), ['\\Seen'], { uid: true });
        if (!stored) throw core.fieldError(`Der Anbieter hat die E-Mail nicht als ${seen ? 'gelesen' : 'ungelesen'} markiert. Bitte „Abrufen“ wählen und es noch einmal versuchen.`);
      } finally { lock.release(); }
    }));
    this.patch(found, { seen: !!seen });
    await this.persistCache();
    return this.list();
  }

  patch(found, change) {
    const folder = this.cache.folders[found.folder];
    folder.messages = folder.messages.map(item => (item.uid === found.summary.uid ? { ...item, ...change } : item));
  }

  /** Moves a message to the provider's trash, where it stays recoverable; deletes only if there is no trash. */
  async remove(id) {
    await this.load();
    const found = this.find(id);
    if (!found) return this.list();
    await this.enqueue(() => this.withImap(async client => {
      // Deleting for good is only right when the mailbox really has no trash: look again before assuming so.
      if (!this.cache.paths.trash) this.cache.paths.trash = core.findSpecialFolder(await client.list(), 'trash');
      const trash = this.cache.paths.trash;
      const lock = await client.getMailboxLock(found.mailboxPath);
      try {
        // imapflow answers a refusal of the server with `false` instead of throwing.
        if (trash && trash !== found.mailboxPath) {
          if (!await client.messageMove(String(found.summary.uid), trash, { uid: true })) {
            // The remembered trash folder may have been renamed or removed; the next fetch looks for it again.
            this.cache.paths.trash = '';
            await this.persistCache().catch(() => {});
            throw core.fieldError('Die E-Mail konnte nicht in den Papierkorb verschoben werden und ist noch im Postfach. Bitte „Abrufen“ wählen und es noch einmal versuchen.');
          }
        } else if (!await client.messageDelete(String(found.summary.uid), { uid: true })) {
          throw core.fieldError('Der Anbieter hat die E-Mail nicht gelöscht. Sie ist noch im Postfach. Bitte „Abrufen“ wählen und es noch einmal versuchen.');
        }
      } finally { lock.release(); }
    }));
    const folder = this.cache.folders[found.folder];
    folder.messages = folder.messages.filter(item => item.uid !== found.summary.uid);
    await this.persistCache();
    await fs.rm(this.bodyFile(found.folder, found.summary.uid), { force: true });
    return this.list();
  }

  /**
   * Sends one message. It counts as sent once the provider's server accepted it; filing a copy in the sent folder
   * afterwards may fail without making the send fail (reported as `warning`).
   * @param {{ filename: string, contentType: string, bytes: Buffer }[]} attachments
   */
  async send(input, attachments = []) {
    await this.load();
    const account = this.account; const password = this.password();
    if (!account) throw core.fieldError('Es ist noch kein E-Mail-Postfach eingerichtet.');
    if (!password) throw core.fieldError('Das Passwort des Postfachs fehlt. Bitte unter „Postfach einrichten“ erneut eingeben.');
    const outgoing = core.normalizeOutgoing(input);
    const total = attachments.reduce((sum, item) => sum + item.bytes.length, 0);
    // The same limits the compose dialog and the staging of files apply; checked again where the mail is built.
    if (attachments.length !== outgoing.attachmentIds.length && outgoing.attachmentIds.length) throw core.fieldError('Ein Anhang ist nicht mehr vorhanden. Bitte den Anhang erneut hinzufügen.', 'attachments');
    if (attachments.length > core.MAX_ATTACHMENTS) throw core.fieldError(`Es lassen sich höchstens ${core.MAX_ATTACHMENTS} Dateien anhängen.`, 'attachments');
    if (total > core.MAX_ATTACHMENT_BYTES) throw core.fieldError(`Die Anhänge sind zusammen größer als ${core.MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB. Die meisten Anbieter nehmen so große E-Mails nicht an. Bitte entfernen Sie Anhänge oder verteilen Sie sie auf mehrere E-Mails.`, 'attachments');
    const original = outgoing.replyToId ? this.find(outgoing.replyToId) : null;
    const MailComposer = require('nodemailer/lib/mail-composer');
    const raw = await new MailComposer({
      from: { name: account.name, address: account.email }, to: outgoing.to, cc: outgoing.cc, subject: outgoing.subject, text: outgoing.text,
      date: new Date(), messageId: `<${crypto.randomUUID()}@${account.email.split('@')[1]}>`,
      ...(original?.summary.messageId ? { inReplyTo: original.summary.messageId, references: [...original.summary.references, original.summary.messageId].slice(-20) } : {}),
      attachments: attachments.map(item => ({ filename: item.filename, content: item.bytes, contentType: item.contentType })),
      disableFileAccess: true, disableUrlAccess: true,
    }).compile().build();

    return this.enqueue(async () => {
      const transport = this.transport(account, password);
      try {
        await transport.sendMail({ envelope: { from: account.email, to: [...outgoing.to, ...outgoing.cc] }, raw });
        if (account === this.account) this.sendRefused = false;
      } catch (error) {
        // A login the provider refuses (password changed there) concerns the whole mailbox, not this one mail:
        // the window then offers the way to the account page and the hand-over to the computer's mail program.
        const refused = core.isAuthError(error);
        if (refused && account === this.account) this.sendRefused = true;
        throw core.fieldError(core.describeError(error, 'smtp'), refused ? 'auth' : '');
      }
      finally { transport.close(); }

      let warning = '';
      try {
        await this.withImap(async client => {
          if (!account.savesSentItself) {
            if (!this.cache.paths.sent) this.cache.paths.sent = core.findSpecialFolder(await client.list(), 'sent');
            if (!this.cache.paths.sent) {
              // A mailbox without any sent folder (rare, e.g. a brand-new one): create the conventional one.
              try { const created = await client.mailboxCreate('Sent'); this.cache.paths.sent = created?.path || 'Sent'; } catch { /* reported below */ }
            }
            if (this.cache.paths.sent) await client.append(this.cache.paths.sent, raw, ['\\Seen']);
            else warning = 'Die E-Mail wurde gesendet. Bei Ihrem Anbieter gibt es keinen Ordner für gesendete E-Mails, deshalb erscheint sie nicht unter „Ausgang“.';
          }
          if (original) {
            const lock = await client.getMailboxLock(original.mailboxPath);
            try { if (await client.messageFlagsAdd(String(original.summary.uid), ['\\Answered'], { uid: true })) this.patch(original, { answered: true }); }
            finally { lock.release(); }
          }
          if (this.cache.paths.sent) await this.syncFolder(client, 'sent', this.cache.paths.sent);
        });
        await this.persistCache();
      } catch {
        warning = 'Die E-Mail wurde gesendet. Die Kopie im Ordner für gesendete E-Mails Ihres Anbieters konnte gerade nicht abgelegt oder geladen werden. Unter „Ausgang“ erscheint sie deshalb vielleicht nicht.';
      }
      return { ok: true, warning };
    });
  }
}

module.exports = { MailService };
