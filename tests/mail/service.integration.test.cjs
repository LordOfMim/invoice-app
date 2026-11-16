'use strict';
/*
 * The built-in mailbox against a real IMAP/SMTP server (GreenMail standalone, started here on its own free ports).
 * Skipped unless GREENMAIL_JAR points to the jar and a Java runtime is available:
 *   GREENMAIL_JAR=/path/greenmail-standalone-2.1.3.jar node --test tests/mail/service.integration.test.cjs
 */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const { MailService } = require(path.join(root, 'electron/mail-service.cjs'));

const jar = process.env.GREENMAIL_JAR || '';
const java = process.env.JAVA_BIN || path.join(root, 'electron/einvoice-runtime/jre/bin/java');
const skip = !jar ? 'GREENMAIL_JAR is not set'
  : !fs.existsSync(jar) ? `GREENMAIL_JAR does not exist: ${jar}`
  : !fs.existsSync(java) ? `Java runtime not found: ${java}`
  : false;

const HOST = '127.0.0.1';
// Most accounts here use the name, as real accounts do; one test connects by the bare IP address.
const NAME = 'localhost';
const SECRET = 'geheim';
const codec = { available: () => true, encrypt: t => Buffer.from('enc:' + t), decrypt: b => b.toString().slice(4) };
const noCodec = { available: () => false, encrypt() { throw new Error('no key store'); }, decrypt() { throw new Error('no key store'); } };

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, HOST, () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}
function accepts(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: HOST, port });
    const done = ok => { socket.destroy(); resolve(ok); };
    socket.setTimeout(500, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function allFiles(dir) {
  const out = [];
  for (const entry of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await allFiles(full)); else out.push(full);
  }
  return out;
}
async function assertNotOnDisk(dir, secret) {
  for (const file of await allFiles(dir)) assert.equal((await fsp.readFile(file)).includes(secret), false, `${path.basename(file)} must not contain the password`);
}
const mode = async file => (await fsp.stat(file)).mode & 0o777;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

describe('MailService against a real mail server', { skip, timeout: 120_000 }, () => {
  let greenmail = null; let log = ''; let exited = null; let smtpPort = 0; let imapPort = 0; let tmp = '';
  let meister; let kunde; let meisterDir; let kundeDir;
  const state = {};

  const service = (dir, useCodec = codec) => new MailService({ dir, codec: useCodec, tls: { rejectUnauthorized: false }, anyPort: true, timeouts: { connect: 8000, socket: 20000 } });
  const meisterAccount = (overrides = {}) => ({ email: 'meister@handwerk.test', name: 'Meister Müller', user: 'meister', password: SECRET,
    imap: { host: NAME, port: imapPort, secure: true }, smtp: { host: NAME, port: smtpPort, secure: true }, ...overrides });
  const kundeAccount = () => ({ email: 'kunde@kunde.test', name: 'Karl Kunde', user: 'kunde', password: 'pw',
    imap: { host: NAME, port: imapPort, secure: true }, smtp: { host: NAME, port: smtpPort, secure: true } });
  /** Syncs until a message with this subject is in the folder (delivery is immediate; the retry only absorbs jitter). */
  async function arrived(box, subject, folder = 'inbox') {
    for (let attempt = 0; attempt < 20; attempt++) {
      const list = await box.sync();
      assert.equal(list.error, '', `sync failed: ${list.error}`);
      const found = list[folder].find(item => item.subject === subject);
      if (found) return found;
      await sleep(150);
    }
    assert.fail(`"${subject}" never arrived in ${folder}`);
  }
  async function stopServer() {
    if (!greenmail || greenmail.exitCode !== null || greenmail.signalCode !== null) return;
    greenmail.kill('SIGTERM');
    const timer = setTimeout(() => greenmail.kill('SIGKILL'), 5000);
    await exited; clearTimeout(timer);
  }

  before(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'helferlein-mail-'));
    meisterDir = path.join(tmp, 'meister', 'mail'); kundeDir = path.join(tmp, 'kunde', 'mail');
    smtpPort = await freePort(); imapPort = await freePort();
    while (imapPort === smtpPort) imapPort = await freePort();
    greenmail = spawn(java, [
      `-Dgreenmail.smtps.hostname=${HOST}`, `-Dgreenmail.smtps.port=${smtpPort}`,
      `-Dgreenmail.imaps.hostname=${HOST}`, `-Dgreenmail.imaps.port=${imapPort}`,
      `-Dgreenmail.users=meister:${SECRET}@handwerk.test,kunde:pw@kunde.test`,
      '-Dgreenmail.startup.timeout=15000', `-Djava.io.tmpdir=${tmp}`, '-jar', jar,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    const keep = chunk => { log = (log + chunk).slice(-8000); };
    greenmail.stdout.on('data', keep); greenmail.stderr.on('data', keep);
    exited = new Promise(resolve => greenmail.once('exit', resolve));
    greenmail.once('error', error => keep(`spawn failed: ${error.message}`));
    const deadline = Date.now() + 30_000;
    for (;;) {
      if (greenmail.exitCode !== null) throw new Error(`GreenMail exited during startup:\n${log}`);
      if (await accepts(smtpPort) && await accepts(imapPort)) break;
      if (Date.now() > deadline) throw new Error(`GreenMail did not open ports ${smtpPort}/${imapPort} in time:\n${log}`);
      await sleep(150);
    }
    meister = service(meisterDir); kunde = service(kundeDir);
  });

  after(async () => {
    await stopServer();
    if (tmp) await fsp.rm(tmp, { recursive: true, force: true });
  });

  test('a wrong password is rejected in German and nothing is stored', async () => {
    await assert.rejects(meister.saveAccount(meisterAccount({ password: 'falsch' })), error => {
      assert.match(error.userMessage, /Anmeldung abgelehnt/);
      assert.match(error.userMessage, /Posteingang \(IMAP\)/);
      return true;
    });
    assert.deepEqual(await allFiles(path.dirname(meisterDir)), []);
    const status = await meister.status();
    assert.equal(status.configured, false);
    assert.equal(status.account, null);
    assert.equal((await meister.list()).configured, false);
    await assert.rejects(meister.saveAccount(meisterAccount({ password: '' })), error => error.field === 'password' && /Passwort/.test(error.userMessage));
    await assert.rejects(meister.send({ to: 'kunde@kunde.test', subject: 'x', text: 'y' }), /noch kein E-Mail-Postfach/);
    assert.deepEqual(await allFiles(path.dirname(meisterDir)), []);
  });

  test('a correct account is stored privately and without the plaintext password', async () => {
    assert.deepEqual(await meister.saveAccount(meisterAccount()), { ok: true, passwordStored: true });
    assert.deepEqual(await kunde.saveAccount(kundeAccount()), { ok: true, passwordStored: true });
    const file = path.join(meisterDir, 'account.json');
    assert.equal(await mode(file), 0o600);
    assert.equal(await mode(path.join(meisterDir, 'cache.json')), 0o600);
    assert.equal(await mode(meisterDir), 0o700);
    await assertNotOnDisk(meisterDir, SECRET);
    const stored = JSON.parse(await fsp.readFile(file, 'utf8'));
    assert.equal(stored.email, 'meister@handwerk.test');
    assert.equal(stored.name, 'Meister Müller');
    assert.equal(codec.decrypt(Buffer.from(stored.password, 'base64')), SECRET);
    assert.equal((await fsp.readdir(meisterDir)).some(name => name.endsWith('.tmp')), false, 'no temporary file is left behind');
    const status = await meister.status();
    assert.equal(status.configured, true);
    assert.equal(status.needsPassword, false);
    assert.equal(status.canStorePassword, true);
    assert.deepEqual(status.account.imap, { host: NAME, port: imapPort, secure: true });
    assert.equal(JSON.stringify(status).includes(SECRET), false, 'the window never gets the password');
    assert.equal(JSON.stringify(status).includes(stored.password), false, 'nor its encrypted form');
    const list = await meister.sync();
    assert.equal(list.error, '');
    assert.deepEqual(list.inbox, []);
    assert.ok(list.lastSync);
  });

  test('send with umlauts and a binary attachment arrives intact', async () => {
    const bytes = Buffer.from(Array.from({ length: 4096 }, (_, index) => (index * 31 + 7) % 256));
    const text = 'Sehr geehrter Herr Kunde,\n\nanbei das Aufmaß für die Küche: 12,5 m² à 48,00 € – „größer“ als geplant.\n\nMit freundlichen Grüßen\nJörg Müller\n\n-- \nÄÖÜ äöü ß';
    const subject = 'Aufmaß Küche – Größe geändert (ÄÖÜß €)';
    const sent = await meister.send({ to: 'Karl Kunde <kunde@kunde.test>', subject, text }, [{ filename: 'Aufmaß Küche größer.pdf', contentType: 'application/pdf', bytes }]);
    assert.deepEqual(sent, { ok: true, warning: '' });

    const message = await arrived(kunde, subject);
    assert.equal(message.folder, 'inbox');
    assert.equal(message.id, `inbox:${message.uid}`);
    assert.deepEqual(message.from, { name: 'Meister Müller', address: 'meister@handwerk.test' });
    assert.deepEqual(message.to.map(item => item.address), ['kunde@kunde.test']);
    assert.equal(message.seen, false);
    assert.equal(message.answered, false);
    assert.equal(message.hasAttachments, true);
    assert.match(message.messageId, /^<[0-9a-f-]{36}@handwerk\.test>$/);
    assert.ok(Math.abs(Date.parse(message.date) - Date.now()) < 5 * 60_000);

    const body = await kunde.body(message.id);
    assert.equal(body.text, text);
    assert.equal(body.truncated, false);
    assert.equal(body.htmlOnly, false);
    assert.deepEqual(body.attachments, [{ index: 0, filename: 'Aufmaß Küche größer.pdf', contentType: 'application/pdf', size: bytes.length }]);
    const attachment = await kunde.attachment(message.id, 0);
    assert.equal(attachment.filename, 'Aufmaß Küche größer.pdf');
    assert.equal(attachment.contentType, 'application/pdf');
    assert.ok(Buffer.isBuffer(attachment.bytes));
    assert.equal(Buffer.compare(attachment.bytes, bytes), 0, 'attachment must be byte-equal');
    await assert.rejects(kunde.attachment(message.id, 1), /Anhang wurde nicht gefunden/);
    await assert.rejects(kunde.attachment(message.id, -1), /Anhang wurde nicht gefunden/);
    await assert.rejects(kunde.body('inbox:999999'), /nicht mehr in der Liste/);

    // Reading does not mark the message as read behind the user's back.
    assert.equal((await kunde.sync()).inbox.find(item => item.id === message.id).seen, false);
    // The text is cached privately so it also opens offline.
    const bodies = await fsp.readdir(path.join(kundeDir, 'bodies'));
    assert.equal(bodies.length, 1);
    assert.equal(await mode(path.join(kundeDir, 'bodies', bodies[0])), 0o600);
    Object.assign(state, { first: message, firstSubject: subject, firstText: text });
  });

  test('a copy appears in the sender\'s sent list', async () => {
    const list = await meister.list();
    assert.equal(list.hasSentFolder, true);
    assert.equal(list.sent.length, 1);
    const copy = list.sent[0];
    assert.equal(copy.subject, state.firstSubject);
    assert.equal(copy.folder, 'sent');
    assert.equal(copy.messageId, state.first.messageId, 'the copy is the very message that was delivered');
    assert.equal(copy.seen, true);
    assert.equal(copy.hasAttachments, true);
    assert.deepEqual(copy.to.map(item => item.address), ['kunde@kunde.test']);
    assert.equal((await meister.body(copy.id)).text, state.firstText);
    // The server really holds it: a sync from scratch finds it again.
    const fresh = await (service(meisterDir)).sync();
    assert.equal(fresh.error, '');
    assert.deepEqual(fresh.sent.map(item => item.messageId), [state.first.messageId]);
    assert.deepEqual(fresh.inbox, []);
  });

  test('setSeen marks a message read and unread on the server', async () => {
    const id = state.first.id;
    let list = await kunde.setSeen(id, true);
    assert.equal(list.inbox.find(item => item.id === id).seen, true);
    assert.equal((await kunde.sync()).inbox.find(item => item.id === id).seen, true, 'the server kept the flag');
    list = await kunde.setSeen(id, false);
    assert.equal(list.inbox.find(item => item.id === id).seen, false);
    assert.equal((await kunde.sync()).inbox.find(item => item.id === id).seen, false);
    await kunde.setSeen(id, true);
    assert.equal((await kunde.setSeen('inbox:999999', true)).inbox.length, 1, 'an unknown id changes nothing');
    // A second device (fresh instance on the same folder) sees the same state after syncing.
    assert.equal((await service(kundeDir).sync()).inbox.find(item => item.id === id).seen, true);
  });

  test('a reply carries the threading headers and marks the original as answered', async () => {
    const original = state.first;
    const subject = `AW: ${state.firstSubject}`;
    const sent = await kunde.send({ to: 'meister@handwerk.test', subject, text: 'Passt so, bitte ausführen.\n\nGruß Karl', replyToId: original.id });
    assert.deepEqual(sent, { ok: true, warning: '' });
    assert.equal((await kunde.list()).inbox.find(item => item.id === original.id).answered, true);
    assert.equal((await kunde.sync()).inbox.find(item => item.id === original.id).answered, true, 'the server kept the flag');

    const reply = await arrived(meister, subject);
    assert.equal(reply.inReplyTo, original.messageId);
    assert.deepEqual(reply.references, [original.messageId]);
    assert.equal(reply.from.address, 'kunde@kunde.test');
    assert.notEqual(reply.messageId, original.messageId);
    assert.equal(reply.answered, false);

    // The answer to the answer continues the chain.
    const subject2 = `AW: ${subject}`;
    await meister.send({ to: 'kunde@kunde.test', subject: subject2, text: 'Danke, Termin folgt.', replyToId: reply.id });
    const second = await arrived(kunde, subject2);
    assert.equal(second.inReplyTo, reply.messageId);
    assert.deepEqual(second.references, [original.messageId, reply.messageId]);
    assert.equal((await meister.list()).inbox.find(item => item.id === reply.id).answered, true);
    assert.equal((await meister.list()).sent.length, 2);
    assert.equal((await meister.list()).sent[0].inReplyTo, reply.messageId, 'newest first, with its headers');
    Object.assign(state, { reply, second });
  });

  test('a second MailService on the same folder sees account and cached list without the network', async () => {
    const current = await kunde.list();
    const offline = new MailService({ dir: kundeDir, codec, tls: { rejectUnauthorized: false }, anyPort: true });
    // Any attempt to connect would have to go through these.
    offline.withImap = () => assert.fail('list() must not open an IMAP connection');
    offline.transport = () => assert.fail('list() must not open an SMTP connection');
    const status = await offline.status();
    assert.equal(status.configured, true);
    assert.equal(status.account.email, 'kunde@kunde.test');
    assert.equal(status.needsPassword, false);
    const list = await offline.list();
    assert.deepEqual(list.inbox, current.inbox);
    assert.deepEqual(list.sent, current.sent);
    assert.equal(list.lastSync, current.lastSync);
    assert.equal(list.error, '');
    assert.equal(list.syncing, false);
    assert.equal(list.inbox.length, 2);
    assert.equal((await offline.body(state.first.id)).text, state.firstText, 'an opened message is readable offline');
  });

  test('remove deletes a message from the list and from the server', async () => {
    const subject = 'Zum Löschen';
    await meister.send({ to: 'kunde@kunde.test', subject, text: 'weg damit' });
    const message = await arrived(kunde, subject);
    await kunde.body(message.id);
    const bodiesBefore = (await fsp.readdir(path.join(kundeDir, 'bodies'))).length;
    const list = await kunde.remove(message.id);
    assert.equal(list.inbox.some(item => item.id === message.id), false);
    assert.equal(list.inbox.length, 2);
    assert.equal((await fsp.readdir(path.join(kundeDir, 'bodies'))).length, bodiesBefore - 1, 'the cached text goes too');
    const fresh = await service(kundeDir).sync();
    assert.equal(fresh.error, '');
    assert.equal(fresh.inbox.some(item => item.subject === subject), false, 'gone on the server');
    assert.deepEqual(fresh.inbox.map(item => item.subject).sort(), [state.firstSubject, state.second.subject].sort(), 'the other messages are untouched');
    assert.equal((await kunde.remove(message.id)).inbox.length, 2, 'removing twice is harmless');
    await assert.rejects(kunde.body(message.id), /nicht mehr in der Liste/);
  });

  test('without a key store the password stays in memory only and a fresh start asks for it again', async () => {
    const dir = path.join(tmp, 'ohne-schluessel', 'mail');
    const session = service(dir, noCodec);
    assert.equal((await session.status()).canStorePassword, false);
    assert.deepEqual(await session.saveAccount(meisterAccount()), { ok: true, passwordStored: false });
    assert.equal(JSON.parse(await fsp.readFile(path.join(dir, 'account.json'), 'utf8')).password, '');
    await assertNotOnDisk(dir, SECRET);
    assert.equal((await session.status()).needsPassword, false);

    // It works for the rest of the session.
    const list = await session.sync();
    assert.equal(list.error, '');
    assert.equal(list.needsPassword, false);
    assert.ok(list.inbox.some(item => item.id === state.reply.id));
    assert.deepEqual(await session.send({ to: 'kunde@kunde.test', subject: 'Ohne Schlüsselbund', text: 'geht trotzdem' }), { ok: true, warning: '' });
    await arrived(kunde, 'Ohne Schlüsselbund');
    await assertNotOnDisk(dir, SECRET);

    // After a restart the list is still there, the password is not.
    const restarted = service(dir, noCodec);
    const status = await restarted.status();
    assert.equal(status.configured, true);
    assert.equal(status.needsPassword, true);
    const cached = await restarted.list();
    assert.equal(cached.needsPassword, true);
    assert.deepEqual(cached.inbox, list.inbox);
    const failed = await restarted.sync();
    assert.match(failed.error, /Passwort des Postfachs fehlt/);
    assert.deepEqual(failed.inbox, list.inbox);
    await assert.rejects(restarted.send({ to: 'kunde@kunde.test', subject: 'x', text: 'y' }), /Passwort des Postfachs fehlt/);
    // Entering it once more restores access without touching the disk copy.
    assert.deepEqual(await restarted.saveAccount(meisterAccount()), { ok: true, passwordStored: false });
    assert.equal((await restarted.sync()).error, '');
    assert.deepEqual((await restarted.list()).inbox.map(item => item.id), list.inbox.map(item => item.id), 'the cached list survives re-entering the password');
    await assertNotOnDisk(dir, SECRET);
  });

  test('a key store that appeared later cannot read the old entry: the stored password of another codec is not used', async () => {
    const dir = path.join(tmp, 'anderer-schluessel', 'mail');
    await service(dir).saveAccount(meisterAccount());
    const broken = service(dir, { available: () => true, encrypt: codec.encrypt, decrypt() { throw new Error('key changed'); } });
    assert.equal((await broken.status()).needsPassword, true);
    const result = await broken.sync();
    assert.match(result.error, /Passwort des Postfachs fehlt/);
  });

  test('concurrent sync, send and body calls all succeed', async () => {
    await meister.send({ to: 'kunde@kunde.test', subject: 'Noch ungelesen', text: 'Text der ungelesenen Nachricht' });
    const unread = await arrived(kunde, 'Noch ungelesen');
    const [syncA, sent, body, syncB, sentBack, cachedBody, seen] = await Promise.all([
      kunde.sync(),
      meister.send({ to: 'kunde@kunde.test', subject: 'Gleichzeitig 1', text: 'eins' }),
      kunde.body(unread.id),
      meister.sync(),
      kunde.send({ to: 'meister@handwerk.test', subject: 'Gleichzeitig 2', text: 'zwei' }),
      kunde.body(state.first.id),
      kunde.setSeen(unread.id, true),
    ]);
    assert.equal(syncA.error, '');
    assert.equal(syncB.error, '');
    assert.deepEqual(sent, { ok: true, warning: '' });
    assert.deepEqual(sentBack, { ok: true, warning: '' });
    assert.equal(body.text, 'Text der ungelesenen Nachricht');
    assert.equal(cachedBody.text, state.firstText);
    assert.equal(seen.inbox.find(item => item.id === unread.id).seen, true);
    await arrived(kunde, 'Gleichzeitig 1');
    await arrived(meister, 'Gleichzeitig 2');
    const list = await kunde.list();
    assert.equal(list.syncing, false);
    assert.equal(new Set(list.inbox.map(item => item.uid)).size, list.inbox.length, 'no duplicates in the list');
    assert.deepEqual(list.inbox.map(item => item.uid), [...list.inbox.map(item => item.uid)].sort((a, b) => b - a), 'newest first');
    assert.equal(list.sent.filter(item => item.subject === 'Gleichzeitig 2').length, 1);
    // What the two instances wrote concurrently is a readable cache.
    assert.deepEqual((await service(kundeDir).list()).inbox, list.inbox);
  });

  test('a 2 MB attachment survives the round trip', async () => {
    const bytes = crypto.randomBytes(2 * 1024 * 1024);
    const small = Buffer.from('Zeile 1\r\nZeile 2 äöü\r\n', 'utf8');
    assert.deepEqual(await meister.send({ to: 'kunde@kunde.test', subject: 'Großer Anhang', text: 'Fotos der Baustelle' }, [
      { filename: 'baustelle.zip', contentType: 'application/zip', bytes },
      { filename: 'Notiz für Büro.txt', contentType: 'text/plain', bytes: small },
    ]), { ok: true, warning: '' });
    const message = await arrived(kunde, 'Großer Anhang');
    assert.ok(message.size > bytes.length);
    const body = await kunde.body(message.id);
    assert.equal(body.text, 'Fotos der Baustelle');
    assert.deepEqual(body.attachments.map(item => [item.index, item.filename, item.size]), [[0, 'baustelle.zip', bytes.length], [1, 'Notiz für Büro.txt', small.length]]);
    const big = await kunde.attachment(message.id, 0);
    assert.equal(big.bytes.length, bytes.length);
    assert.equal(sha(big.bytes), sha(bytes));
    assert.equal(Buffer.compare((await kunde.attachment(message.id, 1)).bytes, small), 0);
    // The sender's copy is complete as well.
    const copy = (await meister.list()).sent.find(item => item.subject === 'Großer Anhang');
    assert.equal(sha((await meister.attachment(copy.id, 0)).bytes), sha(bytes));
    // Attachments are not kept on this computer.
    for (const file of await allFiles(kundeDir)) assert.ok((await fsp.stat(file)).size < 200_000, `${path.basename(file)} is too large to be only text`);
  });

  test('HTML mails are shown as text only: no markup, script or remote image reaches the caller', async () => {
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport({ host: HOST, port: smtpPort, secure: true, auth: { user: 'meister', pass: SECRET }, tls: { rejectUnauthorized: false } });
    try {
      await transport.sendMail({ from: 'Lieferant Groß <meister@handwerk.test>', to: 'kunde@kunde.test', subject: 'Nur HTML',
        html: '<html><body><h1>Angebot für Fenster</h1><p>Guten Tag Herr Müller,</p><p>der Preis beträgt <b>1.250,00 €</b> zzgl. MwSt.</p><p>Viele Grüße</p></body></html>' });
      await transport.sendMail({ from: 'meister@handwerk.test', to: 'kunde@kunde.test', subject: 'Aktive Inhalte',
        html: '<html><head><style>p{color:red}</style><script>window.stolen = document.cookie;</script></head><body><p onclick="evil()">Sichtbarer Text</p>'
          + '<script src="https://tracker.example/x.js"></script><img src="https://tracker.example/pixel.gif?u=42" width="1" height="1">'
          + '<iframe src="https://tracker.example/frame"></iframe><p>Zweite Zeile</p></body></html>' });
      await transport.sendMail({ from: 'meister@handwerk.test', to: 'kunde@kunde.test', subject: 'Beides', text: 'Der Klartext zählt.', html: '<p>Die <i>HTML</i>-Fassung</p>' });
    } finally { transport.close(); }

    const plainHtml = await kunde.body((await arrived(kunde, 'Nur HTML')).id);
    for (const part of ['Angebot für Fenster', 'Guten Tag Herr Müller,', '1.250,00 €', 'Viele Grüße']) assert.ok(plainHtml.text.toLowerCase().includes(part.toLowerCase()), `readable text must contain "${part}"`);
    assert.doesNotMatch(plainHtml.text, /<\/?[a-z][^>]*>/i, 'no markup in the text');
    // The window is told that this text was derived from HTML, so it can say that the layout is missing.
    assert.equal(plainHtml.htmlOnly, true);

    const active = await kunde.body((await arrived(kunde, 'Aktive Inhalte')).id);
    assert.match(active.text, /Sichtbarer Text/);
    assert.match(active.text, /Zweite Zeile/);
    assert.equal(active.htmlOnly, true);
    const both = await kunde.body((await arrived(kunde, 'Beides')).id);
    assert.equal(both.text, 'Der Klartext zählt.');
    assert.equal(both.htmlOnly, false, 'a message with a text part is shown as its author wrote it');
    // The flag is part of the cached text, so it is the same when the message is opened again (also offline).
    assert.equal((await kunde.body((await arrived(kunde, 'Nur HTML')).id)).htmlOnly, true);
    assert.equal((await kunde.body((await arrived(kunde, 'Beides')).id)).htmlOnly, false);
    assert.equal((await service(kundeDir).body((await arrived(kunde, 'Nur HTML')).id)).htmlOnly, true);
    // A message written in Helferlein itself is plain text.
    await meister.send({ to: 'kunde@kunde.test', subject: 'Nur Text', text: 'Ohne <b>HTML</b>, nur Zeichen.' });
    const plainText = await kunde.body((await arrived(kunde, 'Nur Text')).id);
    assert.deepEqual([plainText.text, plainText.htmlOnly], ['Ohne <b>HTML</b>, nur Zeichen.', false]);

    for (const body of [plainHtml, active, both]) {
      assert.deepEqual(Object.keys(body).sort(), ['attachments', 'htmlOnly', 'text', 'truncated', 'unreadable'], 'the caller gets text and an attachment list, never HTML');
      assert.equal(body.unreadable, false);
      const everything = JSON.stringify(body);
      assert.doesNotMatch(everything, /<script|<img|<iframe|<style|<\/|onclick|document\.cookie|x\.js|tracker\.example\/frame|color:red/i);
      assert.deepEqual(body.attachments, []);
    }
    // Nor is any of it written to the local cache.
    for (const file of await allFiles(path.join(kundeDir, 'bodies'))) assert.doesNotMatch(await fsp.readFile(file, 'utf8'), /<script|<img|<iframe|document\.cookie/i);
    assert.doesNotMatch(await fsp.readFile(path.join(kundeDir, 'cache.json'), 'utf8'), /<script|tracker\.example/i);
  });

  test('a designed mail with an attachment reads the same way as one without: links, tables, no pictures, attachments listed', async () => {
    const nodemailer = require('nodemailer');
    const pdf = Buffer.from(Array.from({ length: 3000 }, (_, index) => (index * 17 + 3) % 256));
    const markup = '<html><head><title>Angebot</title><style>td{padding:4px}</style></head><body>'
      + '<h1>Ihr Angebot</h1><p>Guten Tag Herr Kunde,</p>'
      + '<p>bitte <a href="https://lieferant.example/angebot/4711">hier klicken</a> oder <a href="https://lieferant.example">https://lieferant.example</a> öffnen. Fragen an <a href="mailto:buero@lieferant.example">buero@lieferant.example</a>.</p>'
      + '<img src="https://tracker.example/pixel.gif?u=42" alt="Logo der Firma" width="1" height="1">'
      + '<table><tr><th>Pos</th><th>Preis</th></tr><tr><td>Fliesen</td><td>120 €</td></tr><tr><td>Kleber</td><td>35 €</td></tr></table>'
      + '<p>Viele Grüße</p></body></html>';
    const expected = ['Ihr Angebot', '', 'Guten Tag Herr Kunde,', '',
      'bitte hier klicken [https://lieferant.example/angebot/4711] oder https://lieferant.example öffnen. Fragen an buero@lieferant.example.', '',
      'Pos | Preis', 'Fliesen | 120 €', 'Kleber | 35 €', '', 'Viele Grüße'].join('\n');
    const transport = nodemailer.createTransport({ host: HOST, port: smtpPort, secure: true, auth: { user: 'meister', pass: SECRET }, tls: { rejectUnauthorized: false } });
    try {
      await transport.sendMail({ from: 'Lieferant Groß <meister@handwerk.test>', to: 'kunde@kunde.test', subject: 'Gestaltet mit Anhang', html: markup,
        attachments: [{ filename: 'Angebot 4711.pdf', content: pdf, contentType: 'application/pdf' }] });
      await transport.sendMail({ from: 'Lieferant Groß <meister@handwerk.test>', to: 'kunde@kunde.test', subject: 'Gestaltet ohne Anhang', html: markup });
    } finally { transport.close(); }

    // A program of its own that counts conversions, so the shared one stays as it is.
    const dir = path.join(tmp, 'html-reader', 'mail');
    let conversions = 0;
    const worker = require(path.join(root, 'electron/mail-html-worker.cjs'));
    const reader = new MailService({ dir, codec, tls: { rejectUnauthorized: false }, anyPort: true, timeouts: { connect: 8000, socket: 20000 }, convertHtml: html => { conversions += 1; return worker.convertHtml(html); } });
    assert.equal((await reader.saveAccount(kundeAccount())).ok, true);
    const withFile = await arrived(reader, 'Gestaltet mit Anhang');
    const without = await arrived(reader, 'Gestaltet ohne Anhang');
    assert.equal(withFile.hasAttachments, true);

    const body = await reader.body(withFile.id);
    assert.equal(body.text, expected);
    assert.deepEqual([body.htmlOnly, body.unreadable, body.truncated], [true, false, false]);
    assert.deepEqual(body.attachments, [{ index: 0, filename: 'Angebot 4711.pdf', contentType: 'application/pdf', size: pdf.length }]);
    assert.doesNotMatch(JSON.stringify(body), /tracker\.example|pixel|Logo der Firma|mailto:|<\/?[a-z][^>]*>|padding/i);
    // One conversion path: the same mail without the attachment gives exactly the same text.
    const plain = await reader.body(without.id);
    assert.equal(plain.text, expected);
    assert.deepEqual([plain.htmlOnly, plain.unreadable, plain.attachments.length], [true, false, 0]);
    assert.equal(conversions, 2);

    // Saving the attachment fetches the mail again but converts nothing; opening it again reads the stored text.
    const saved = await reader.attachment(withFile.id, 0);
    assert.equal(Buffer.compare(saved.bytes, pdf), 0);
    assert.deepEqual(await reader.body(withFile.id), body);
    assert.equal(conversions, 2, 'neither "Anhang speichern" nor a second opening converts HTML');
  });

  test('HTML that is too large, nested absurdly deep or too slow to convert never blocks: the mail is marked as not showable, attachments stay reachable', async () => {
    const nodemailer = require('nodemailer');
    const note = Buffer.from('Lieferschein');
    const transport = nodemailer.createTransport({ host: HOST, port: smtpPort, secure: true, auth: { user: 'meister', pass: SECRET }, tls: { rejectUnauthorized: false } });
    try {
      // Both are what mailparser's own converter refuses, which used to send them into an unguarded fallback.
      await transport.sendMail({ from: 'meister@handwerk.test', to: 'kunde@kunde.test', subject: 'Zu tief', html: '<b>'.repeat(300_000), attachments: [{ filename: 'lieferschein.txt', content: note }] });
      await transport.sendMail({ from: 'meister@handwerk.test', to: 'kunde@kunde.test', subject: 'Zu groß', html: `<p>${'Text '.repeat(400_000)}</p>` });
      await transport.sendMail({ from: 'meister@handwerk.test', to: 'kunde@kunde.test', subject: 'Zu langsam', html: '<p>Kommt beim zweiten Versuch.</p>' });
    } finally { transport.close(); }
    const dir = path.join(tmp, 'html-guard', 'mail');
    let slow = true;
    const worker = require(path.join(root, 'electron/mail-html-worker.cjs'));
    const reader = new MailService({ dir, codec, tls: { rejectUnauthorized: false }, anyPort: true, timeouts: { connect: 8000, socket: 20000 },
      convertHtml: html => (slow && /zweiten Versuch/.test(html) ? worker.convertHtml('<p>x</p>'.repeat(150_000), { timeoutMs: 10 }) : worker.convertHtml(html)) });
    assert.equal((await reader.saveAccount(kundeAccount())).ok, true);
    const deep = await arrived(reader, 'Zu tief'); const large = await arrived(reader, 'Zu groß'); const late = await arrived(reader, 'Zu langsam');

    // The event loop of this process (the main process in the app) keeps turning while the mails are opened.
    let longestGap = 0; let last = Date.now();
    const heart = setInterval(() => { const now = Date.now(); longestGap = Math.max(longestGap, now - last); last = now; }, 10);
    const deepBody = await reader.body(deep.id);
    const largeBody = await reader.body(large.id);
    const saved = await reader.attachment(deep.id, 0);
    clearInterval(heart);
    assert.ok(longestGap < 1500, `the process was blocked for ${longestGap} ms`);
    assert.deepEqual([deepBody.text, deepBody.unreadable, deepBody.htmlOnly], ['', true, true]);
    assert.deepEqual(deepBody.attachments, [{ index: 0, filename: 'lieferschein.txt', contentType: 'text/plain', size: note.length }]);
    assert.equal(Buffer.compare(saved.bytes, note), 0);
    assert.deepEqual([largeBody.text, largeBody.unreadable, largeBody.htmlOnly], ['', true, true]);
    // What can never be converted is remembered, so it is not downloaded again each time (also true offline).
    const stored = (await fsp.readdir(path.join(dir, 'bodies'))).length;
    assert.equal(stored, 2);
    assert.deepEqual(await reader.body(deep.id), deepBody);

    // A conversion that ran out of time is reported the same way but not remembered: the next opening tries again.
    const first = await reader.body(late.id);
    assert.deepEqual([first.text, first.unreadable], ['', true]);
    assert.equal((await fsp.readdir(path.join(dir, 'bodies'))).length, stored);
    slow = false;
    const second = await reader.body(late.id);
    assert.deepEqual([second.text, second.unreadable, second.htmlOnly], ['Kommt beim zweiten Versuch.', false, true]);
    assert.equal((await fsp.readdir(path.join(dir, 'bodies'))).length, stored + 1);

    // A text stored by the version before this one (no `unreadable`) opens as it is.
    const file = reader.bodyFile('inbox', late.uid);
    await fsp.writeFile(file, JSON.stringify({ text: 'Alter Text', truncated: false, htmlOnly: true, attachments: [] }));
    assert.deepEqual(await reader.body(late.id), { text: 'Alter Text', truncated: false, htmlOnly: true, unreadable: false, attachments: [] });
  });

  test('an account whose server is given as an IP address connects, syncs and sends', async () => {
    const dir = path.join(tmp, 'by-ip', 'mail');
    const byIp = service(dir);
    const saved = await byIp.saveAccount(meisterAccount({ imap: { host: HOST, port: imapPort, secure: true }, smtp: { host: HOST, port: smtpPort, secure: true } }));
    assert.deepEqual(saved, { ok: true, passwordStored: true });
    const status = await byIp.status();
    assert.deepEqual([status.configured, status.account.imap.host, status.account.smtp.host], [true, HOST, HOST]);

    // IMAP: no English "servername" error, the mailbox of the same user is listed.
    const list = await byIp.sync();
    assert.equal(list.error, '');
    assert.doesNotMatch(JSON.stringify(list), /servername/i);
    assert.ok(list.lastSync);
    assert.deepEqual(list.inbox.map(item => item.id).sort(), (await meister.sync()).inbox.map(item => item.id).sort());

    // SMTP: a message sent through the IP address arrives.
    assert.deepEqual(await byIp.send({ to: 'kunde@kunde.test', subject: 'Über die IP-Adresse', text: 'Kommt an.' }), { ok: true, warning: '' });
    const message = await arrived(kunde, 'Über die IP-Adresse');
    assert.equal(message.from.address, 'meister@handwerk.test');
    assert.equal((await kunde.body(message.id)).text, 'Kommt an.');
    // A wrong password on such an account is still an ordinary login error.
    await assert.rejects(service(path.join(tmp, 'by-ip-wrong', 'mail')).saveAccount(meisterAccount({ password: 'falsch', imap: { host: HOST, port: imapPort, secure: true }, smtp: { host: HOST, port: smtpPort, secure: true } })), error => /Anmeldung abgelehnt/.test(error.userMessage));
    await assertNotOnDisk(dir, SECRET);
  });

  // ── Review fixes ───────────────────────────────────────────────────────────────────────────────────────────────

  /** A second program on the meister mailbox with its own folder, so the shared instances stay as they are. */
  async function meisterBox(name) {
    const dir = path.join(tmp, name, 'mail');
    const box = service(dir);
    assert.deepEqual(await box.saveAccount(meisterAccount()), { ok: true, passwordStored: true });
    return { box, dir };
  }
  /** Makes the server "refuse" one command the way imapflow reports it: the call resolves with false. */
  function refusing(box, method, replaced = {}) {
    const original = box.withImap.bind(box);
    box.withImap = (task, ...rest) => original(client => { Object.assign(client, replaced); client[method] = async () => false; return task(client); }, ...rest);
    return () => { delete box.withImap; };
  }

  test('a flag change the server refuses is an error and the list keeps the old state', async () => {
    const { box } = await meisterBox('review-flags');
    await kunde.send({ to: 'meister@handwerk.test', subject: 'Flagge bleibt', text: 'x' });
    const message = await arrived(box, 'Flagge bleibt');
    assert.equal(message.seen, false);

    let restore = refusing(box, 'messageFlagsAdd');
    await assert.rejects(box.setSeen(message.id, true), error => /nicht als gelesen markiert/.test(error.userMessage) && !/false|undefined/.test(error.userMessage));
    restore();
    assert.equal((await box.list()).inbox.find(item => item.id === message.id).seen, false, 'not shown as read');
    assert.equal((await box.sync()).inbox.find(item => item.id === message.id).seen, false);

    await box.setSeen(message.id, true);
    restore = refusing(box, 'messageFlagsRemove');
    await assert.rejects(box.setSeen(message.id, false), error => /nicht als ungelesen markiert/.test(error.userMessage));
    restore();
    assert.equal((await box.list()).inbox.find(item => item.id === message.id).seen, true);
    assert.equal((await box.list()).authFailed, false, 'a refused command is not a refused login');
    state.flagged = message;
  });

  test('a move to the trash or a delete the server refuses is an error, the mail stays and the trash folder is looked up again', async () => {
    const { box, dir } = await meisterBox('review-remove');
    const message = (await box.sync()).inbox.find(item => item.id === state.flagged.id);
    assert.ok(message);
    await box.body(message.id);

    // The remembered trash folder no longer exists on the server: the server answers NO.
    box.cache.paths.trash = 'Gibt-es-nicht-mehr';
    await box.persistCache();
    assert.equal((await box.list()).hasTrashFolder, true);
    await assert.rejects(box.remove(message.id), error => /nicht in den Papierkorb verschoben/.test(error.userMessage) && /noch im Postfach/.test(error.userMessage));
    let list = await box.list();
    assert.ok(list.inbox.some(item => item.id === message.id), 'still in the list');
    assert.equal(list.hasTrashFolder, false, 'the stale path is forgotten');
    assert.equal(JSON.parse(await fsp.readFile(path.join(dir, 'cache.json'), 'utf8')).paths.trash, '', 'also on disk');
    assert.equal((await box.body(message.id)).text, 'x', 'the cached text stays');
    assert.ok((await service(dir).sync()).inbox.some(item => item.id === message.id), 'and it is still on the server');

    // A delete (mailbox without trash) that the server refuses. Whatever folders this server has: the mailbox is
    // shown to the service without a trash folder, so the delete branch is the one that runs, every time.
    let deletes = 0; let moves = 0;
    const restore = refusing(box, 'messageDelete', { list: async () => [{ path: 'INBOX', name: 'INBOX', delimiter: '/', flags: new Set() }], messageMove: async () => { moves += 1; return true; } });
    const realRefusal = box.withImap;
    box.withImap = (task, ...rest) => realRefusal(client => { client.messageDelete = async () => { deletes += 1; return false; }; return task(client); }, ...rest);
    assert.equal(box.cache.paths.trash, '', 'no trash folder is remembered');
    await assert.rejects(box.remove(message.id), error => /^Der Anbieter hat die E-Mail nicht gelöscht\. Sie ist noch im Postfach\./.test(error.userMessage) && !/false|undefined/.test(error.userMessage));
    assert.deepEqual([deletes, moves], [1, 0], 'the delete was tried once and refused; nothing was moved');
    list = await box.list();
    assert.ok(list.inbox.some(item => item.id === message.id), 'still in the list');
    assert.equal(list.hasTrashFolder, false);
    assert.equal((await box.body(message.id)).text, 'x', 'the cached text stays');
    restore();
    assert.ok((await service(dir).sync()).inbox.some(item => item.id === message.id), 'and it is still on the server');

    // With a trash folder on the server the next fetch finds it again and the mail moves there.
    const folders = await box.enqueue(() => box.withImap(client => client.list()));
    if (!require(path.join(root, 'electron/mail-core.cjs')).findSpecialFolder(folders, 'trash')) await box.enqueue(() => box.withImap(client => client.mailboxCreate('Papierkorb')));
    list = await box.sync();
    assert.equal(list.error, '');
    assert.equal(list.hasTrashFolder, true, 'found again by the fetch');
    const trash = box.cache.paths.trash;
    const count = () => box.enqueue(() => box.withImap(async client => (await client.status(trash, { messages: true })).messages));
    const inTrash = await count();
    list = await box.remove(message.id);
    assert.equal(list.inbox.some(item => item.id === message.id), false);
    assert.equal(await count(), inTrash + 1, 'the mail is in the trash, not gone');
    assert.equal((await service(dir).sync()).inbox.some(item => item.id === message.id), false);
  });

  test('a stale trash path never turns a failed move into a permanent delete: the folder is looked up first', async () => {
    const { box } = await meisterBox('review-remove-lookup');
    await kunde.send({ to: 'meister@handwerk.test', subject: 'Soll in den Papierkorb', text: 'x' });
    const message = await arrived(box, 'Soll in den Papierkorb');
    const trash = box.cache.paths.trash;
    assert.ok(trash, 'the previous test left a trash folder');
    const count = () => box.enqueue(() => box.withImap(async client => (await client.status(trash, { messages: true })).messages));
    const inTrash = await count();
    box.cache.paths.trash = ''; // as after a failed move, before any fetch
    await box.remove(message.id);
    assert.equal(await count(), inTrash + 1);
    assert.equal(box.cache.paths.trash, trash);
  });

  test('Reply-To is stored, and lists stored without it gain it at the next fetch', async () => {
    const { box, dir } = await meisterBox('review-replyto');
    const transport = box.transport(box.account, SECRET);
    try {
      await transport.sendMail({ from: 'Kontaktformular <noreply@portal.test>', to: 'meister@handwerk.test', replyTo: 'Anna Kundin <Anna@Kunde.test>', subject: 'Neue Anfrage (Anna)', text: 'Bitte um Rückruf.' });
    } finally { transport.close(); }
    const viaForm = await arrived(box, 'Neue Anfrage (Anna)');
    assert.deepEqual(viaForm.from, { name: 'Kontaktformular', address: 'noreply@portal.test' });
    assert.deepEqual(viaForm.replyTo, [{ name: 'Anna Kundin', address: 'anna@kunde.test' }]);
    const list = await box.list();
    const plain = list.inbox.find(item => item.id !== viaForm.id);
    // Without the header an IMAP server reports the sender as Reply-To (RFC 3501); never somebody else.
    assert.ok(Array.isArray(plain.replyTo) && plain.replyTo.every(person => person.address === plain.from.address));

    // The list as an older version stored it.
    const file = path.join(dir, 'cache.json');
    const old = JSON.parse(await fsp.readFile(file, 'utf8'));
    for (const folder of ['inbox', 'sent']) for (const item of old.folders[folder].messages) delete item.replyTo;
    await fsp.writeFile(file, JSON.stringify(old));
    const upgraded = service(dir);
    const before = await upgraded.list();
    assert.equal(before.inbox.length, list.inbox.length, 'the old list still loads');
    assert.equal(before.inbox.some(item => 'replyTo' in item), false);
    const after = await upgraded.sync();
    assert.equal(after.error, '');
    assert.deepEqual(after.inbox, list.inbox, 'every entry is complete again');
    assert.deepEqual(after.sent, list.sent);
  });

  test('a refused login is reported as authFailed until the account works again; an unreachable server is not', async () => {
    const { box, dir } = await meisterBox('review-auth');
    const good = await box.sync();
    assert.deepEqual([good.error, good.authFailed, (await box.status()).authFailed], ['', false, false]);

    // The password was changed at the provider: what is stored here no longer works.
    const file = path.join(dir, 'account.json');
    const stored = JSON.parse(await fsp.readFile(file, 'utf8'));
    await fsp.writeFile(file, JSON.stringify({ ...stored, password: codec.encrypt('altes-passwort').toString('base64') }));
    const locked = service(dir);
    assert.equal((await locked.list()).authFailed, false, 'nothing is known before the first attempt');
    const failed = await locked.sync();
    assert.match(failed.error, /Anmeldung abgelehnt/);
    assert.equal(failed.authFailed, true);
    assert.deepEqual(failed.inbox, good.inbox, 'the list stays');
    assert.equal((await locked.status()).authFailed, true);
    assert.equal((await locked.list()).authFailed, true);
    await assert.rejects(locked.setSeen(good.inbox[0].id, !good.inbox[0].seen));
    assert.equal((await locked.list()).authFailed, true);
    // Sending with the outdated password: the error is marked as a login problem, so the window can lead to the
    // account page, and the list says that this mailbox cannot send right now.
    assert.equal((await locked.list()).sendRefused, false);
    await assert.rejects(locked.send({ to: 'kunde@kunde.test', subject: 'Geht nicht raus', text: 'x' }), error => error.field === 'auth' && /^Postausgang \(SMTP\): Anmeldung abgelehnt/.test(error.userMessage));
    assert.equal((await locked.list()).sendRefused, true);
    // Checking other details does not clear the state of the stored account.
    await assert.rejects(locked.saveAccount(meisterAccount({ password: 'auch-falsch' })), error => /Anmeldung abgelehnt/.test(error.userMessage));
    assert.equal((await locked.list()).authFailed, true);
    // Saving the account with the right password does.
    assert.deepEqual(await locked.saveAccount(meisterAccount()), { ok: true, passwordStored: true });
    assert.deepEqual([(await locked.list()).authFailed, (await locked.status()).authFailed, (await locked.list()).error, (await locked.list()).sendRefused], [false, false, '', false]);
    // A login refused only when sending is told apart from a refused fetch, and a mail that goes out clears it.
    locked.sendRefused = true;
    assert.deepEqual([(await locked.list()).authFailed, (await locked.status()).authFailed], [false, true], 'the account page asks for the password either way');
    assert.equal((await locked.sync()).sendRefused, true, 'fetching says nothing about sending');
    assert.deepEqual(await locked.send({ to: 'kunde@kunde.test', subject: 'Geht wieder raus', text: 'x' }), { ok: true, warning: '' });
    assert.equal((await locked.list()).sendRefused, false);
    assert.equal((await locked.sync()).authFailed, false);

    // A fetch that gets through clears it as well (the user fixed it at the provider and pressed "Abrufen").
    locked.authFailed = true;
    assert.equal((await locked.sync()).authFailed, false);

    // A server that does not answer is a different problem and keeps the automatic fetch going.
    const closedPort = await freePort();
    await fsp.writeFile(file, JSON.stringify({ ...JSON.parse(await fsp.readFile(file, 'utf8')), imap: { host: NAME, port: closedPort, secure: true } }));
    const offline = await service(dir).sync();
    assert.notEqual(offline.error, '');
    assert.equal(offline.authFailed, false);
    await assertNotOnDisk(dir, SECRET);
  });

  test('the stored password is only reused for unchanged servers; any other server, port or user needs it typed again', async () => {
    const { box, dir } = await meisterBox('review-password');
    const file = path.join(dir, 'account.json');
    const without = overrides => meisterAccount({ password: '', ...overrides });
    // Name and signature may change without the password.
    assert.deepEqual(await box.saveAccount(without({ name: 'Müller & Sohn', signature: 'Gruß' })), { ok: true, passwordStored: true });
    assert.equal((await box.status()).account.name, 'Müller & Sohn');
    const stored = await fsp.readFile(file, 'utf8');

    // Any connection to a changed server would carry the password: count them.
    let connections = 0;
    const trap = net.createServer(socket => { connections += 1; socket.destroy(); });
    await new Promise(resolve => trap.listen(0, HOST, resolve));
    const trapPort = trap.address().port;
    try {
      const changes = {
        'SMTP host': { smtp: { host: HOST, port: smtpPort, secure: true } },
        'SMTP port': { smtp: { host: NAME, port: trapPort, secure: true } },
        'SMTP security': { smtp: { host: NAME, port: smtpPort, secure: false } },
        'IMAP host': { imap: { host: HOST, port: imapPort, secure: true } },
        'IMAP port': { imap: { host: NAME, port: trapPort, secure: true } },
        'IMAP security': { imap: { host: NAME, port: imapPort, secure: false } },
        'user': { user: 'kunde' },
        'address': { email: 'anders@handwerk.test' },
      };
      for (const [what, change] of Object.entries(changes)) {
        await assert.rejects(box.saveAccount(without(change)), error => error.field === 'password' && /noch einmal/.test(error.userMessage), what);
        assert.equal(await fsp.readFile(file, 'utf8'), stored, `${what}: the stored account is untouched`);
      }
      assert.equal(connections, 0, 'nothing was sent anywhere');
    } finally { await new Promise(resolve => trap.close(resolve)); }

    // Typed again, the change goes through; afterwards the new servers are the known ones.
    const moved = { smtp: { host: HOST, port: smtpPort, secure: true } };
    assert.deepEqual(await box.saveAccount(meisterAccount({ ...moved })), { ok: true, passwordStored: true });
    assert.deepEqual(await box.saveAccount(without(moved)), { ok: true, passwordStored: true });
    await assert.rejects(box.saveAccount(without({})), error => error.field === 'password', 'going back is a change too');
    await assertNotOnDisk(dir, SECRET);
  });

  test('account and list are read once: calls that start together share one state', async () => {
    const { box, dir } = await meisterBox('review-load');
    const synced = await box.sync();
    assert.ok(synced.inbox.length > 0);

    const fresh = service(dir);
    const first = fresh.load();
    assert.equal(fresh.load(), first, 'the same read');
    await first;
    const cache = fresh.cache; const account = fresh.account;
    await Promise.all([fresh.load(), fresh.list(), fresh.status()]);
    assert.equal(fresh.cache, cache);
    assert.equal(fresh.account, account);

    // A fetch and a read that start at the same moment on a new instance: what was fetched is not lost.
    await fsp.rm(path.join(dir, 'cache.json'));
    const racing = service(dir);
    const [fetched, listed, status] = await Promise.all([racing.sync(), racing.list(), racing.status()]);
    assert.equal(fetched.error, '');
    assert.deepEqual(listed.inbox, [], 'the read saw the empty list');
    assert.equal(status.configured, true);
    assert.deepEqual((await racing.list()).inbox, synced.inbox);
    assert.deepEqual(JSON.parse(await fsp.readFile(path.join(dir, 'cache.json'), 'utf8')).folders.inbox.messages, synced.inbox);
  });

  test('a damaged cache.json or text file is replaced by a fresh fetch instead of failing every call', async () => {
    const { box, dir } = await meisterBox('review-damaged');
    const synced = await box.sync();
    assert.ok(synced.inbox.length > 0);
    const file = path.join(dir, 'cache.json');
    const good = await fsp.readFile(file, 'utf8');
    const parsed = JSON.parse(good);
    const damaged = {
      'cut off': good.slice(0, Math.floor(good.length / 2)),
      'null': 'null',
      'a list': '[]',
      'folders without messages': JSON.stringify({ ...parsed, folders: { inbox: {}, sent: {} } }),
      'messages not a list': JSON.stringify({ ...parsed, folders: { ...parsed.folders, inbox: { ...parsed.folders.inbox, messages: { 0: 'x' } } } }),
      'no paths': JSON.stringify({ ...parsed, paths: undefined }),
      'nonsense entries': JSON.stringify({ ...parsed, folders: { ...parsed.folders, inbox: { ...parsed.folders.inbox, messages: [null, 5, { uid: 'x' }, {}, ...parsed.folders.inbox.messages.slice(0, 1).map(item => ({ uid: item.uid }))] } } }),
    };
    for (const [what, text] of Object.entries(damaged)) {
      await fsp.writeFile(file, text);
      const repaired = service(dir);
      const listed = await repaired.list();
      assert.equal(listed.configured, true, what);
      assert.ok(Array.isArray(listed.inbox) && Array.isArray(listed.sent), what);
      await repaired.setSeen('inbox:1', true).catch(error => assert.ok(error.userMessage, `${what}: only a German error may come out`));
      const again = await repaired.sync();
      assert.equal(again.error, '', what);
      assert.deepEqual(again.inbox.map(item => item.id), synced.inbox.map(item => item.id), what);
      assert.deepEqual(again.inbox.map(item => [item.subject, item.from.address, item.replyTo]), synced.inbox.map(item => [item.subject, item.from.address, item.replyTo]), what);
      assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, 'utf8')), what);
    }

    // A text file that lost its attachment list is fetched again instead of crashing the view.
    const message = synced.inbox[0];
    const body = await box.body(message.id);
    const bodyFile = (await allFiles(path.join(dir, 'bodies')))[0];
    await fsp.writeFile(bodyFile, JSON.stringify({ text: 'nur Text' }));
    assert.deepEqual(await service(dir).body(message.id), body);
    await fsp.writeFile(bodyFile, '{"text":');
    assert.deepEqual(await service(dir).body(message.id), body);
  });

  test('server down: sync resolves with a German error and the previous list stays intact', async () => {
    const unopened = await arrivedOffline();
    const before = await kunde.list();
    assert.ok(before.inbox.length >= 5);
    await stopServer();
    assert.equal(await accepts(imapPort), false);

    const result = await kunde.sync();
    assert.match(result.error, /^Posteingang \(IMAP\): /);
    assert.match(result.error, /Server|Verbindung/);
    assert.equal(result.syncing, false);
    assert.deepEqual(result.inbox, before.inbox);
    assert.deepEqual(result.sent, before.sent);
    assert.equal(result.lastSync, before.lastSync);
    assert.equal((await kunde.list()).error, result.error, 'the error stays visible until a sync works');

    // What was opened before still opens; everything else fails with a sentence for the user, not a crash.
    assert.equal((await kunde.body(state.first.id)).text, state.firstText);
    await assert.rejects(kunde.body(unopened.id), error => /^Posteingang \(IMAP\): /.test(error.userMessage));
    await assert.rejects(kunde.attachment(state.first.id, 0), error => /^Posteingang \(IMAP\): /.test(error.userMessage));
    await assert.rejects(kunde.send({ to: 'meister@handwerk.test', subject: 'offline', text: 'x' }), error => /^Postausgang \(SMTP\): /.test(error.userMessage));
    await assert.rejects(kunde.setSeen(unopened.id, true), error => /^Posteingang \(IMAP\): /.test(error.userMessage));
    await assert.rejects(kunde.remove(unopened.id), error => /^Posteingang \(IMAP\): /.test(error.userMessage));
    const after = await kunde.list();
    assert.deepEqual(after.inbox, before.inbox, 'failed changes leave the list as it was');
    assert.equal(after.sent.some(item => item.subject === 'offline'), false);

    // The cache on disk is still the good one: a restart while offline shows the same list.
    const restarted = await service(kundeDir).list();
    assert.deepEqual(restarted.inbox, before.inbox);
    assert.deepEqual(restarted.sent, before.sent);
    // Saving the account again while offline fails and keeps the stored account.
    const stored = await fsp.readFile(path.join(kundeDir, 'account.json'), 'utf8');
    await assert.rejects(kunde.saveAccount(kundeAccount()), error => /^Posteingang \(IMAP\): /.test(error.userMessage));
    assert.equal(await fsp.readFile(path.join(kundeDir, 'account.json'), 'utf8'), stored);

    /** A message that is listed but whose text was never opened. */
    async function arrivedOffline() {
      await meister.send({ to: 'kunde@kunde.test', subject: 'Nie geöffnet', text: 'bleibt zu' });
      return arrived(kunde, 'Nie geöffnet');
    }
  });

  test('removeAccount deletes the account file, the cache and the cached texts', async () => {
    assert.ok((await allFiles(kundeDir)).length >= 3);
    assert.deepEqual(await kunde.removeAccount(), { ok: true });
    assert.deepEqual(await allFiles(kundeDir), []);
    assert.equal(fs.existsSync(path.join(kundeDir, 'bodies')), false);
    const status = await kunde.status();
    assert.equal(status.configured, false);
    assert.equal(status.account, null);
    assert.equal(status.needsPassword, false);
    const list = await kunde.list();
    assert.deepEqual([list.configured, list.email, list.inbox, list.sent, list.error, list.lastSync], [false, '', [], [], '', '']);
    assert.equal((await kunde.sync()).configured, false, 'sync without an account is a no-op, not an error');
    assert.equal((await service(kundeDir).status()).configured, false);
    assert.deepEqual(await kunde.removeAccount(), { ok: true }, 'removing twice is harmless');
  });
});
