'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { sha256 } = require('../../electron/einvoice-kosit.cjs');
const source = fs.readFileSync(path.resolve(__dirname, '../../electron/main.js'), 'utf8');

function verifiedReply(format = 'xrechnung') {
  const bytes = Buffer.from(format === 'xrechnung' ? '<?xml version="1.0"?><DEMO/>' : '%PDF-1.7\nDEMO');
  const hash = sha256(bytes);
  return { ok: true, bytes, extension: format === 'xrechnung' ? 'xml' : 'pdf', mimeType: format === 'xrechnung' ? 'application/xml' : 'application/pdf', sha256: hash, validation: { valid: true, artifactSha256: hash, kosit: { valid: true, configuration: '2026-08-31', artifactSha256: hash } } };
}
function runtime(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'helferlein-einvoice-ipc-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const handlers = new Map(), workers = [], opened = [], scripts = [];
  let saves = 0, prints = 0;
  const frame = { url: 'http://127.0.0.1:3456/invoices/demo' };
  const contents = { mainFrame: frame, getURL: () => frame.url, printToPDF: async () => { prints++; return Buffer.from('%PDF-1.7 ordinary DEMO'); } };
  const win = { webContents: contents, isDestroyed: () => false };
  const fakeProcess = Object.create(process);
  Object.defineProperty(fakeProcess, 'platform', { value: options.platform ?? 'linux' });
  const context = {
    require: name => {
      if (name === 'electron') return {
        app: { isPackaged: false, on() {}, requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }), getPath: () => directory },
        BrowserWindow: { fromWebContents: () => win },
        ipcMain: { handle: (name, callback) => handlers.set(name, callback), on() {} },
        shell: { openPath: async file => { opened.push(file); return options.openError ?? ''; } },
        dialog: { showSaveDialog: async () => { saves++; return options.save ?? { canceled: true }; } },
      };
      if (name === 'child_process') return {
        spawn() { assert.fail('must not start server'); },
        execFile: (command, args, callback) => { scripts.push({ command, args }); callback(options.composeError ? new Error(options.composeError) : null); },
        fork: () => {
          const worker = new EventEmitter(); workers.push(worker);
          worker.send = payload => { worker.payload = payload; };
          return worker;
        },
      };
      return require(name);
    },
    process: fakeProcess, console, URL, Buffer, setTimeout, clearTimeout,
    __dirname: path.resolve(__dirname, '../../electron'),
  };
  vm.runInNewContext(source + '\nglobalThis.installTestWindow = (win) => { mainWindow = win; appOrigin = "http://127.0.0.1:3456"; }; globalThis.buildTestEml = buildEmlWithAttachment;', context);
  context.installTestWindow(win);
  const event = { sender: contents, senderFrame: frame };
  return { handlers, workers, opened, scripts, directory, event, buildEml: context.buildTestEml, get saves() { return saves; }, get prints() { return prints; } };
}
const payload = { format: 'xrechnung', document: { number: 'DEMO' } };

test('e-invoice IPC rejects untrusted sender and invalid format/delivery before spawning', async t => {
  const r = runtime(t), handler = r.handlers.get('export-einvoice');
  await assert.rejects(handler({ sender: {}, senderFrame: {} }, payload), /untrusted/);
  assert.equal((await handler(r.event, { ...payload, format: 'pdf' })).ok, false);
  assert.equal((await handler(r.event, { ...payload, delivery: 'send-now' })).ok, false);
  assert.equal(r.workers.length, 0);
});
test('e-invoice IPC keeps one global operation and releases the lock after validator failure', async t => {
  const r = runtime(t), handler = r.handlers.get('export-einvoice');
  const first = handler(r.event, payload);
  assert.equal((await handler(r.event, payload)).ok, false);
  assert.equal(r.workers.length, 1);
  r.workers[0].emit('message', { ok: false, error: 'DEMO validation rejected' });
  assert.match((await first).error, /validation rejected/);
  const next = handler(r.event, payload);
  assert.equal(r.workers.length, 2);
  r.workers[1].emit('message', verifiedReply());
  assert.equal((await next).canceled, true);
});
test('worker paths are main-owned; verified artifact download preserves cancellation and errors', async t => {
  const r = runtime(t), handler = r.handlers.get('export-einvoice');
  const pending = handler(r.event, { ...payload, runtimeDir: '/untrusted', assetsDir: '/untrusted' });
  assert.equal(r.workers[0].payload.format, 'xrechnung');
  assert.notEqual(r.workers[0].payload.runtimeDir, '/untrusted');
  r.workers[0].emit('message', verifiedReply());
  const result = await pending;
  assert.equal(result.ok, false); assert.equal(result.canceled, true); assert.equal(r.saves, 1);
});
test('wrong format or altered worker bytes cannot reach save dialog', async t => {
  for (const reply of [verifiedReply('zugferd'), { ...verifiedReply(), bytes: Buffer.from('mutated') }]) {
    const r = runtime(t), pending = r.handlers.get('export-einvoice')(r.event, payload);
    r.workers[0].emit('message', reply);
    assert.equal((await pending).ok, false); assert.equal(r.saves, 0);
  }
});
test('E-invoice IPC prepares exact XML attachment, never reprints, and reports mail opening failure', async t => {
  const r = runtime(t), artifact = verifiedReply();
  const pending = r.handlers.get('export-einvoice')(r.event, { ...payload, delivery: 'email', email: { to: 'demo@example.invalid', subject: 'DEMO', body: 'DEMO' } });
  r.workers[0].emit('message', artifact);
  const result = await pending;
  assert.equal(result.ok, true); assert.equal(result.prepared, true); assert.equal(r.saves, 0);
  const eml = fs.readFileSync(r.opened[0], 'utf8');
  assert.ok(eml.includes('application/xml'));
  const encoded = eml.split('Content-Disposition: attachment;')[1].split('\r\n\r\n')[1].split('\r\n--')[0];
  assert.equal(sha256(Buffer.from(encoded.replace(/\s/g, ''), 'base64')), artifact.sha256);
  const failing = runtime(t, { openError: 'No composer' });
  const failed = failing.handlers.get('export-einvoice')(failing.event, { ...payload, delivery: 'email' });
  failing.workers[0].emit('message', artifact);
  assert.equal((await failed).ok, false);
});
test('ordinary PDF email reports only draft preparation, Apple Mail failure and openPath errors', async t => {
  const message = { to: 'demo@example.invalid', subject: 'DEMO', body: 'DEMO', filename: 'demo.pdf' };
  const linux = runtime(t, { openError: 'No composer' });
  assert.equal((await linux.handlers.get('email-invoice-with-pdf')(linux.event, message)).ok, false);
  const mac = runtime(t, { platform: 'darwin' });
  const prepared = await mac.handlers.get('email-invoice-with-pdf')(mac.event, message);
  assert.equal(prepared.ok, true); assert.equal(prepared.prepared, true);
  assert.ok(mac.scripts[0].args.join(' ').includes('set visible to true'));
  assert.ok(!/\bsend\s+newMessage/.test(mac.scripts[0].args.join(' ')));
  const failed = runtime(t, { platform: 'darwin', composeError: 'Mail denied' });
  assert.equal((await failed.handlers.get('email-invoice-with-pdf')(failed.event, message)).ok, false);
});


test('ordinary email rejects injected recipient headers before print or composer on every platform', async t => {
  for (const platform of ['linux', 'darwin']) {
    const r = runtime(t, { platform });
    const result = await r.handlers.get('email-invoice-with-pdf')(r.event, {
      to: 'demo@example.invalid\r\nBcc: injected@example.invalid', subject: 'DEMO', body: 'DEMO', filename: 'demo.pdf',
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /Zeilenumbrüche/);
    assert.equal(r.prints, 0);
    assert.equal(r.scripts.length, 0);
    assert.equal(r.opened.length, 0);
    assert.deepEqual(fs.readdirSync(r.directory), []);
  }
});
test('ordinary MIME builder rejects recipient/MIME injection and protects filename and subject headers', t => {
  const r = runtime(t);
  const attachment = { to: 'demo@example.invalid', subject: 'DEMO\r\nX-Injected: yes', body: 'DEMO', attachmentFilename: 'demo.pdf"\r\nX-File: yes', attachmentMime: 'application/pdf', attachmentBase64: Buffer.from('%PDF-DEMO').toString('base64') };
  assert.throws(() => r.buildEml({ ...attachment, to: 'demo@example.invalid\nBcc: other@example.invalid' }), /Zeilenumbrüche/);
  assert.throws(() => r.buildEml({ ...attachment, attachmentMime: 'application/pdf\r\nX-Mime: yes' }), /Anlagentyp/);
  const eml = r.buildEml(attachment);
  assert.ok(!eml.includes('\r\nX-Injected:'));
  assert.ok(!eml.includes('\r\nX-File:'));
  assert.equal(eml.split('\r\n').filter(line => line.startsWith('To:')).length, 1);
});
test('E-invoice IPC prevents recipient/subject/filename headers from introducing MIME parts', async t => {
  for (const format of ['xrechnung', 'zugferd']) {
    const r = runtime(t), artifact = verifiedReply(format);
    const pending = r.handlers.get('export-einvoice')(r.event, {
      format, document: { number: 'DEMO\r\nX-File: yes' }, delivery: 'email',
      email: { to: 'demo@example.invalid\r\nBcc: injected@example.invalid', subject: 'DEMO\r\nX-Injected: yes', body: 'DEMO' },
    });
    r.workers[0].emit('message', artifact);
    const result = await pending;
    assert.equal(result.ok, true); assert.equal(result.prepared, true);
    const eml = fs.readFileSync(r.opened[0], 'utf8');
    for (const header of ['Bcc:', 'X-Injected:', 'X-File:']) assert.ok(!eml.includes(`\r\n${header}`));
    assert.equal(eml.split('\r\n').filter(line => line.startsWith('To:')).length, 1);
    assert.ok(eml.includes(`Content-Type: ${artifact.mimeType}\r\n`));
    const encoded = eml.split('Content-Disposition: attachment;')[1].split('\r\n\r\n')[1].split('\r\n--')[0];
    assert.equal(sha256(Buffer.from(encoded.replace(/\s/g, ''), 'base64')), artifact.sha256);
    assert.equal(r.prints, 0, 'validated E-invoice is never reprinted');
  }
});
