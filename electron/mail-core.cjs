'use strict';
/*
 * Pure helpers of the built-in mailbox: provider presets, validation of what the window sends, and the shape of
 * the local message list. No network and no file access here, so everything is testable on its own.
 */

const MAX_MESSAGES_PER_FOLDER = 500;
/** All attachments of one message together, and therefore also the largest single file. */
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENTS = 20;
const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;
const MAX_BODY_CHARS = 400_000;
const MAX_RECIPIENTS = 50;
const MAX_HEADER_BYTES = 64 * 1024;
// What the desktop app holds for drafts at most: one full draft plus what an abandoned one may have left behind.
const MAX_STAGED_ATTACHMENTS = 2 * MAX_ATTACHMENTS;
const MAX_STAGED_BYTES = 3 * MAX_ATTACHMENT_BYTES;
/** How often abandoned files are looked for, and after how many looks in a row without a claim a file goes. */
const STAGED_SWEEP_MS = 5 * 60 * 1000;
const STAGED_IDLE_TICKS = 6;

const imap = (host, port = 993) => ({ host, port, secure: port === 993 });
const smtp = (host, port = 465) => ({ host, port, secure: port === 465 });

/** Servers of the providers German tradespeople commonly use. `note` is shown next to the password field. */
const PROVIDERS = [
  { id: 'gmx', name: 'GMX', domains: ['gmx.de', 'gmx.net', 'gmx.at', 'gmx.ch', 'gmx.com'], imap: imap('imap.gmx.net'), smtp: smtp('mail.gmx.net', 587), note: 'Bei GMX muss der Abruf über IMAP einmalig in den Einstellungen des Postfachs (E-Mail → Einstellungen → POP3/IMAP Abruf) erlaubt werden.' },
  { id: 'webde', name: 'WEB.DE', domains: ['web.de'], imap: imap('imap.web.de'), smtp: smtp('smtp.web.de', 587), note: 'Bei WEB.DE muss der Abruf über IMAP einmalig in den Einstellungen des Postfachs (E-Mail → Einstellungen → POP3/IMAP Abruf) erlaubt werden.' },
  { id: 'tonline', name: 'Telekom (T-Online)', domains: ['t-online.de', 'magenta.de'], imap: imap('secureimap.t-online.de'), smtp: smtp('securesmtp.t-online.de'), note: 'Die Telekom verlangt ein eigenes „Passwort für E-Mail-Programme“. Es wird im Kundencenter unter Passwörter eingerichtet.' },
  { id: 'gmail', name: 'Gmail', domains: ['gmail.com', 'googlemail.com'], imap: imap('imap.gmail.com'), smtp: smtp('smtp.gmail.com'), savesSentItself: true, note: 'Google verlangt ein „App-Passwort“ (Google-Konto → Sicherheit → Bestätigung in zwei Schritten → App-Passwörter). Das normale Passwort funktioniert nicht.' },
  { id: 'icloud', name: 'iCloud Mail', domains: ['icloud.com', 'me.com', 'mac.com'], imap: imap('imap.mail.me.com'), smtp: smtp('smtp.mail.me.com', 587), note: 'Apple verlangt ein „anwendungsspezifisches Passwort“ (account.apple.com → Anmeldung und Sicherheit). Das normale Passwort funktioniert nicht.' },
  { id: 'ionos', name: 'IONOS (1&1)', domains: ['online.de', 'onlinehome.de'], imap: imap('imap.ionos.de'), smtp: smtp('smtp.ionos.de') },
  { id: 'strato', name: 'STRATO', domains: [], imap: imap('imap.strato.de'), smtp: smtp('smtp.strato.de') },
  { id: 'freenet', name: 'freenet', domains: ['freenet.de'], imap: imap('mx.freenet.de'), smtp: smtp('mx.freenet.de', 587) },
  { id: 'vodafone', name: 'Vodafone / Arcor', domains: ['vodafone.de', 'vodafonemail.de', 'arcor.de'], imap: imap('imap.vodafonemail.de'), smtp: smtp('smtp.vodafonemail.de', 587) },
  { id: 'yahoo', name: 'Yahoo', domains: ['yahoo.de', 'yahoo.com'], imap: imap('imap.mail.yahoo.com'), smtp: smtp('smtp.mail.yahoo.com'), note: 'Yahoo verlangt ein „App-Passwort“ (Kontosicherheit → App-Passwort erstellen).' },
  { id: 'posteo', name: 'Posteo', domains: ['posteo.de', 'posteo.net'], imap: imap('posteo.de'), smtp: smtp('posteo.de') },
  { id: 'mailboxorg', name: 'mailbox.org', domains: ['mailbox.org'], imap: imap('imap.mailbox.org'), smtp: smtp('smtp.mailbox.org') },
  { id: 'microsoft', name: 'Outlook.com / Hotmail', domains: ['outlook.com', 'outlook.de', 'hotmail.com', 'hotmail.de', 'live.com', 'live.de', 'msn.com'], unsupported: true, note: 'Microsoft erlaubt für Outlook.com, Hotmail und Live keine Anmeldung mit Passwort mehr. Diese Postfächer lassen sich derzeit nicht direkt anbinden; Rechnungen können weiterhin als Entwurf an das E-Mail-Programm übergeben werden.' },
];

const ADDRESS = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/;
const isAddress = value => typeof value === 'string' && value.length <= 254 && ADDRESS.test(value);
const clean = (value, max = 998) => String(value ?? '').replace(/[\r\n\0]+/g, ' ').trim().slice(0, max);

/** The preset for an address, or a guess from its domain that the user can correct. */
function suggestServers(email) {
  const address = clean(email).toLowerCase();
  if (!isAddress(address)) return null;
  const domain = address.slice(address.lastIndexOf('@') + 1);
  const provider = PROVIDERS.find(item => item.domains.includes(domain));
  if (provider) return { provider: provider.id, name: provider.name, known: true, unsupported: !!provider.unsupported, note: provider.note || '', imap: provider.imap || null, smtp: provider.smtp || null };
  return { provider: '', name: '', known: false, unsupported: false, note: '', imap: imap(`imap.${domain}`), smtp: smtp(`smtp.${domain}`) };
}

function providerOf(account) {
  return PROVIDERS.find(item => item.imap && item.imap.host === account?.imap?.host) || null;
}

const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
function server(value, label, allowedPorts, anyPort) {
  const host = clean(value?.host, 300).toLowerCase();
  const port = Number(value?.port);
  // Test servers listen on other ports; the app itself never passes `anyPort`.
  if (anyPort && HOST.test(host) && Number.isInteger(port) && port > 0 && port < 65536) return { host, port, secure: value.secure !== false };
  if (!HOST.test(host)) throw fieldError(`${label}: Servername ist ungültig.`, label === 'Posteingang' ? 'imapHost' : 'smtpHost');
  if (!Number.isInteger(port) || !allowedPorts.includes(port)) throw fieldError(`${label}: Port ${allowedPorts.join(' oder ')} verwenden. Unverschlüsselte Verbindungen werden nicht unterstützt.`, label === 'Posteingang' ? 'imapPort' : 'smtpPort');
  // Implicit TLS on the dedicated ports, STARTTLS (enforced) on the others. There is no plaintext mode.
  return { host, port, secure: port === 993 || port === 465 };
}
function fieldError(message, field) { const error = new Error(message); error.field = field; error.userMessage = message; return error; }

/** Everything of an account except the password, normalised; throws a German message naming the field. */
function normalizeAccount(input, { anyPort = false } = {}) {
  const email = clean(input?.email, 254).toLowerCase();
  if (!isAddress(email)) throw fieldError('Bitte eine gültige E-Mail-Adresse eingeben.', 'email');
  const user = clean(input?.user, 254) || email;
  return {
    email,
    name: clean(input?.name, 120),
    user,
    imap: server(input?.imap, 'Posteingang', [993, 143], anyPort),
    smtp: server(input?.smtp, 'Postausgang', [465, 587, 25], anyPort),
    signature: String(input?.signature ?? '').replace(/\0/g, '').slice(0, 2000),
  };
}

function normalizeAddressList(value, label) {
  // Commas inside a quoted name ("Müller, Hans" <h@x.de>) do not separate recipients.
  const split = text => text.match(/(?:"[^"]*"|[^,;\n"])+/g) || [];
  const parts = (Array.isArray(value) ? value : split(String(value ?? ''))).map(item => clean(item, 320)).filter(Boolean);
  const result = [];
  for (const part of parts) {
    const match = /<([^<>]+)>\s*$/.exec(part);
    const address = (match ? match[1] : part).trim().toLowerCase();
    if (!isAddress(address)) throw fieldError(`${label}: „${part}“ ist keine gültige E-Mail-Adresse.`, label === 'An' ? 'to' : 'cc');
    if (!result.includes(address)) result.push(address);
  }
  return result;
}

const megabytes = bytes => `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
const LIMIT_TEXT = `${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB`;
const isStagedId = id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);

/**
 * Checks files that are to join a draft against what one e-mail may carry: `held` are the sizes of the files the
 * draft already has, `added` the new ones. Throws a German message; nothing is ever left out silently.
 * @param {number[]} held
 * @param {{ name: string, size: number }[]} added
 */
function checkAttachmentBudget(held, added) {
  if (held.length + added.length > MAX_ATTACHMENTS) {
    const detail = held.length
      ? ` ${held.length === 1 ? 'Eine Datei ist' : `${held.length} Dateien sind`} schon angehängt, ${added.length === 1 ? 'eine weitere wurde' : `${added.length} weitere wurden`} gewählt.`
      : ` Gewählt wurden ${added.length}.`;
    throw fieldError(`Es lassen sich höchstens ${MAX_ATTACHMENTS} Dateien anhängen.${detail}${added.length > 1 ? ' Es wurde keine davon hinzugefügt.' : ''}`, 'attachments');
  }
  const tooLarge = added.find(file => file.size > MAX_ATTACHMENT_BYTES);
  if (tooLarge) throw fieldError(`„${clean(tooLarge.name, 160)}“ ist größer als ${LIMIT_TEXT} (${megabytes(tooLarge.size)}) und lässt sich nicht per E-Mail senden.`, 'attachments');
  const total = [...held, ...added.map(file => file.size)].reduce((sum, size) => sum + size, 0);
  if (total > MAX_ATTACHMENT_BYTES) {
    throw fieldError(`Zusammen wären die Anhänge ${megabytes(total)} groß. Eine E-Mail darf höchstens ${LIMIT_TEXT} Anhang haben, mehr nehmen die meisten Anbieter nicht an.${added.length > 1 ? ' Es wurde keine der gewählten Dateien hinzugefügt.' : ' Die Datei wurde nicht hinzugefügt.'}`, 'attachments');
  }
}

/** A message to send as the window describes it, checked before anything touches the network. */
function normalizeOutgoing(input) {
  const to = normalizeAddressList(input?.to, 'An');
  const cc = normalizeAddressList(input?.cc, 'Kopie').filter(address => !to.includes(address));
  if (!to.length) throw fieldError('Bitte mindestens einen Empfänger eintragen.', 'to');
  if (to.length + cc.length > MAX_RECIPIENTS) throw fieldError(`Höchstens ${MAX_RECIPIENTS} Empfänger je E-Mail.`, 'to');
  const subject = clean(input?.subject, 300);
  const text = String(input?.text ?? '').replace(/\0/g, '').replace(/\r\n?/g, '\n');
  if (text.length > MAX_BODY_CHARS) throw fieldError('Der Text ist zu lang.', 'text');
  if (!subject && !text.trim()) throw fieldError('Bitte einen Betreff oder Text eingeben.', 'subject');
  // Never shortened or filtered silently: a mail that goes out without one of its attachments is worse than an error.
  const wanted = input?.attachmentIds ?? [];
  if (!Array.isArray(wanted) || wanted.some(id => !isStagedId(id))) throw fieldError('Ein Anhang ist nicht mehr vorhanden. Bitte den Anhang erneut hinzufügen.', 'attachments');
  const attachmentIds = [...new Set(wanted)];
  if (attachmentIds.length > MAX_ATTACHMENTS) throw fieldError(`Es lassen sich höchstens ${MAX_ATTACHMENTS} Dateien anhängen.`, 'attachments');
  const replyToId = typeof input?.replyToId === 'string' && /^(inbox|sent):\d{1,12}$/.test(input.replyToId) ? input.replyToId : '';
  return { to, cc, subject, text, attachmentIds, replyToId };
}

const person = value => ({ name: clean(value?.name, 200), address: clean(value?.address, 254).toLowerCase() });
const people = list => (Array.isArray(list) ? list : []).map(person).filter(item => item.address || item.name).slice(0, 100);
const messageIds = value => [...new Set((String(value ?? '').match(/<[^<>\s]+>/g) || []))].slice(-30);

function hasAttachment(structure, depth = 0) {
  if (!structure || depth > 12) return false;
  if (structure.disposition === 'attachment') return true;
  if (structure.disposition !== 'inline' && structure.type && !/^(text|multipart)\//i.test(structure.type) && !structure.id) return true;
  return Array.isArray(structure.childNodes) && structure.childNodes.some(child => hasAttachment(child, depth + 1));
}

/** The list entry stored for a fetched message. `headers` is the raw header block holding References. */
function summarize(folder, message) {
  const envelope = message.envelope || {};
  // Only two headers are asked for; a server or sender that returns far more is cut off before any text work.
  const raw = Buffer.isBuffer(message.headers) ? message.headers.subarray(0, MAX_HEADER_BYTES).toString('latin1') : String(message.headers || '').slice(0, MAX_HEADER_BYTES);
  const lines = raw.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/);
  const header = name => { const line = lines.find(item => item.slice(0, name.length + 1).toLowerCase() === `${name}:`); return line ? line.slice(name.length + 1) : ''; };
  const flags = message.flags instanceof Set ? message.flags : new Set(message.flags || []);
  const date = envelope.date instanceof Date && !Number.isNaN(envelope.date.getTime()) ? envelope.date : message.internalDate instanceof Date && !Number.isNaN(message.internalDate.getTime()) ? message.internalDate : null;
  return {
    id: `${folder}:${message.uid}`,
    folder,
    uid: message.uid,
    messageId: clean(envelope.messageId, 500),
    inReplyTo: messageIds(envelope.inReplyTo)[0] || messageIds(header('in-reply-to'))[0] || '',
    references: messageIds(header('references')),
    subject: clean(envelope.subject, 500),
    from: people(envelope.from)[0] || { name: '', address: '' },
    to: people(envelope.to),
    cc: people(envelope.cc),
    // Contact forms and portals send from their own address and name the customer here.
    replyTo: people(envelope.replyTo).filter(item => isAddress(item.address)).slice(0, 5),
    date: date ? date.toISOString() : '',
    seen: flags.has('\\Seen'),
    answered: flags.has('\\Answered'),
    hasAttachments: hasAttachment(message.bodyStructure),
    size: Number.isFinite(message.size) ? message.size : 0,
  };
}

/**
 * The new cached list of a folder: `fetched` are full entries of new messages, `flags` the current flags of every
 * message in the window the server still has. Messages missing from `flags` were deleted or moved elsewhere.
 */
function mergeFolder(previous, fetched, flags) {
  const known = new Map((previous || []).map(item => [item.uid, item]));
  for (const item of fetched) known.set(item.uid, item);
  const result = [];
  for (const [uid, state] of flags) {
    const item = known.get(uid);
    if (item) result.push(item.seen === state.seen && item.answered === state.answered ? item : { ...item, ...state });
  }
  return result.sort((a, b) => b.uid - a.uid).slice(0, MAX_MESSAGES_PER_FOLDER);
}

const SENT_NAMES = /^(sent|sent items|sent messages|sent mail|gesendet|gesendete objekte|gesendete elemente|gesendete nachrichten)$/i;
const TRASH_NAMES = /^(trash|deleted|deleted items|deleted messages|papierkorb|gelöscht|gelöschte objekte|gelöschte elemente)$/i;
/** Path of the Sent or Trash mailbox: the server's own marking first, well-known names second. */
function findSpecialFolder(mailboxes, kind) {
  const use = kind === 'sent' ? '\\Sent' : '\\Trash';
  const names = kind === 'sent' ? SENT_NAMES : TRASH_NAMES;
  const usable = (mailboxes || []).filter(box => box && typeof box.path === 'string' && !(box.flags instanceof Set && box.flags.has('\\Noselect')));
  return (usable.find(box => box.specialUse === use) || usable.find(box => names.test(box.name || '')) || usable.find(box => names.test(box.path.split(box.delimiter || '/').pop() || '')))?.path || '';
}

// nodemailer reports socket trouble as ESOCKET and keeps the cause in `originalCode`.
const errorCode = error => String((error?.code === 'ESOCKET' && error?.originalCode) || error?.code || '');
const errorText = error => `${error?.message || ''} ${error?.response || ''} ${error?.responseText || ''}`;
/** True when the server refused the login itself (wrong password, IMAP not enabled), not the connection. */
function isAuthError(error) {
  return !!(error?.authenticationFailed || errorCode(error) === 'EAUTH' || error?.responseCode === 535 || /AUTHENTICATIONFAILED|authentication failed|invalid credentials|(^|[^\d.:])535(?![\d.])(?!\s*(ms|s|sec)\b)|Invalid login/i.test(errorText(error)));
}

/** A German sentence for what went wrong, without leaking server chatter that only confuses. */
function describeError(error, stage) {
  if (error?.userMessage) return error.userMessage;
  const where = stage === 'smtp' ? 'Postausgang (SMTP)' : stage === 'imap' ? 'Posteingang (IMAP)' : 'E-Mail';
  const code = errorCode(error);
  const text = errorText(error);
  if (isAuthError(error)) return `${where}: Anmeldung abgelehnt. Bitte Benutzername und Passwort prüfen. Viele Anbieter verlangen ein eigenes App-Passwort oder das Freischalten von IMAP.`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EDNS') return `${where}: Der Server wurde nicht gefunden. Bitte Servernamen und Internetverbindung prüfen.`;
  if (code === 'ECONNREFUSED') return `${where}: Der Server nimmt auf diesem Port keine Verbindung an. Bitte Port prüfen.`;
  if (/certificate|self.signed|CERT_|ERR_TLS|\bSSL\b|wrong version number|STARTTLS|servername/i.test(`${code} ${text}`)) return `${where}: Die verschlüsselte Verbindung kam nicht zustande (Zertifikat oder Port passen nicht).`;
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'ECONNRESET' || code === 'ETIMEOUT' || code === 'ECONNECTION' || /timeout|timed out/i.test(text)) return `${where}: Keine Antwort vom Server. Bitte Internetverbindung, Servernamen und Port prüfen.`;
  if (error?.responseCode === 552 || /quota|mailbox full|(^|[^\d.:])552(?![\d.])(?!\s*(ms|s|sec)\b)|5\.2\.2|too large|5\.3\.4/i.test(text)) return `${where}: Die E-Mail ist zu groß oder das Postfach ist voll.`;
  if (code === 'EENVELOPE' || /recipient|5\.1\.\d/i.test(text)) return `${where}: Der Server hat einen Empfänger abgelehnt. Bitte die Adressen prüfen.`;
  return `${where}: ${clean(error?.responseText || error?.message || 'Unbekannter Fehler', 300)}`;
}

/**
 * True when a stored password may be used for `next` without asking again: only when it would go to exactly the
 * servers, ports and encryption it was checked with, under the same login. Anything else needs the password typed.
 */
function keepsStoredPassword(previous, next) {
  if (!previous || !next) return false;
  const same = (a, b) => !!a && !!b && a.host === b.host && a.port === b.port && a.secure === b.secure;
  return previous.email === next.email && previous.user === next.user && same(previous.imap, next.imap) && same(previous.smtp, next.smtp);
}

const emptyCache = email => ({ version: 1, email, lastSync: '', paths: { sent: '', trash: '' }, folders: { inbox: { path: 'INBOX', uidValidity: '', messages: [] }, sent: { path: '', uidValidity: '', messages: [] } } });

/**
 * The stored message list as far as it can be trusted, or null when it is not this mailbox's list at all. A file
 * damaged by a crash or edited by hand must not make every later call fail: entries that are not sound are left
 * out (the next fetch loads them again), fields of the wrong kind fall back to their empty value.
 */
function sanitizeCache(cache, email) {
  const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
  if (!isObject(cache) || cache.version !== 1 || cache.email !== email || !isObject(cache.folders)) return null;
  const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
  const result = emptyCache(email);
  result.lastSync = Number.isFinite(Date.parse(text(cache.lastSync, 40))) ? cache.lastSync : '';
  if (isObject(cache.paths)) result.paths = { sent: text(cache.paths.sent, 1000), trash: text(cache.paths.trash, 1000) };
  for (const folder of ['inbox', 'sent']) {
    const stored = cache.folders[folder];
    if (!isObject(stored) || !Array.isArray(stored.messages)) return null;
    const seen = new Set();
    const messages = [];
    for (const item of stored.messages) {
      if (!isObject(item) || !Number.isSafeInteger(item.uid) || item.uid <= 0 || seen.has(item.uid)) continue;
      seen.add(item.uid);
      const date = text(item.date, 40);
      messages.push({
        id: `${folder}:${item.uid}`, folder, uid: item.uid,
        messageId: text(item.messageId, 500), inReplyTo: text(item.inReplyTo, 500),
        references: (Array.isArray(item.references) ? item.references : []).filter(value => typeof value === 'string').slice(-30),
        subject: text(item.subject, 500), from: person(item.from), to: people(item.to), cc: people(item.cc),
        // Lists stored before Reply-To was kept have no such field; the next fetch adds it.
        ...(Array.isArray(item.replyTo) ? { replyTo: people(item.replyTo).slice(0, 5) } : {}),
        date: Number.isFinite(Date.parse(date)) ? date : '',
        seen: item.seen === true, answered: item.answered === true, hasAttachments: item.hasAttachments === true,
        size: Number.isFinite(item.size) && item.size > 0 ? item.size : 0,
      });
    }
    result.folders[folder] = { path: folder === 'inbox' ? 'INBOX' : text(stored.path, 1000), uidValidity: text(stored.uidValidity, 40), messages: messages.sort((a, b) => b.uid - a.uid).slice(0, MAX_MESSAGES_PER_FOLDER) };
  }
  return result;
}

/**
 * Files waiting to be sent with a draft, held in memory under a random id.
 *
 * A file stays as long as a draft claims it: the open compose dialog does so every couple of minutes. Abandoned
 * files (a window that went away without saying so) are found by counting, not by the clock: `tick()` is called
 * at a fixed interval, and a file goes after `idleTicks` ticks in a row without a claim. A computer that slept for
 * hours has missed its ticks instead of piling them up, so the draft that was open before is still complete.
 *
 * The caps on number and size never push out a file that a draft may still need: room is made only from files no
 * draft has claimed since the last tick, and when that is not enough the new file is refused with a message.
 */
function createAttachmentStage({ maxCount = MAX_STAGED_ATTACHMENTS, maxBytes = MAX_STAGED_BYTES, idleTicks = STAGED_IDLE_TICKS, newId } = {}) {
  const items = new Map();
  let total = 0;
  const drop = id => { const item = items.get(id); if (!item) return false; total -= item.bytes.length; return items.delete(id); };
  const claim = ids => { for (const id of ids || []) { const item = items.get(id); if (item) { item.claimed = true; item.idle = 0; } } };
  return {
    /** @param {{ filename: string, contentType: string, bytes: Buffer }} entry @param {{ keep?: string[] }} [options] files of the draft this one joins */
    add(entry, { keep = [] } = {}) {
      claim(keep);
      const size = entry.bytes.length;
      const fits = () => items.size + 1 <= maxCount && total + size <= maxBytes;
      for (const [id, item] of items) {
        if (fits()) break;
        if (!item.claimed && item.idle >= 1) drop(id);
      }
      if (!fits()) throw fieldError('Helferlein hält gerade zu viele Anhänge für E-Mails bereit. Bitte entfernen Sie Anhänge, die Sie nicht brauchen, oder versuchen Sie es in einigen Minuten noch einmal. Die Datei wurde nicht hinzugefügt.', 'attachments');
      const id = newId();
      items.set(id, { ...entry, claimed: true, idle: 0 });
      total += size;
      return id;
    },
    get(id) { return items.get(id); },
    /** An open draft says that it still needs these files. */
    claim,
    /** One look for abandoned files; returns how many went. */
    tick() {
      let dropped = 0;
      for (const [id, item] of items) {
        if (item.claimed) { item.claimed = false; item.idle = 0; continue; }
        item.idle += 1;
        if (item.idle >= idleTicks && drop(id)) dropped += 1;
      }
      return dropped;
    },
    delete: drop,
    clear() { items.clear(); total = 0; },
    get size() { return items.size; },
    get bytes() { return total; },
  };
}

/**
 * How a file saved from a mail gets the operating system's "came from the internet" mark, so that Windows
 * SmartScreen and macOS Gatekeeper check it before it runs. Null where there is no such mark (Linux).
 */
function downloadMark(platform, filePath, date = new Date()) {
  if (platform === 'win32') return { kind: 'stream', path: `${filePath}:Zone.Identifier`, content: '[ZoneTransfer]\r\nZoneId=3\r\n' };
  // flags;time of download in hex seconds;program;event id (none)
  if (platform === 'darwin') return { kind: 'xattr', command: '/usr/bin/xattr', args: ['-w', 'com.apple.quarantine', `0081;${Math.floor(date.getTime() / 1000).toString(16).padStart(8, '0')};Helferlein;`, filePath] };
  return null;
}

module.exports = {
  PROVIDERS, MAX_MESSAGES_PER_FOLDER, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, MAX_MESSAGE_BYTES, MAX_BODY_CHARS,
  MAX_STAGED_ATTACHMENTS, MAX_STAGED_BYTES, STAGED_SWEEP_MS, STAGED_IDLE_TICKS, checkAttachmentBudget, isStagedId,
  suggestServers, providerOf, normalizeAccount, normalizeOutgoing, normalizeAddressList, summarize, mergeFolder,
  findSpecialFolder, describeError, isAuthError, isAddress, clean, messageIds, fieldError,
  keepsStoredPassword, emptyCache, sanitizeCache, createAttachmentStage, downloadMark,
};
