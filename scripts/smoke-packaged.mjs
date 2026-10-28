#!/usr/bin/env node
// Exercise the built application's own Electron/Node, dependencies and resources.
// No system Java/Node is used in child processes; all input is a public fixture.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { fork, spawn, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const value = flag => { const i = argv.indexOf(flag); return i < 0 ? undefined : argv[i + 1]; };
const product = require(path.join(root, 'package.json')).build.productName;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const children = new Set();
const exists = async file => { try { await fs.access(file); return true; } catch { return false; } };
const childEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' };
// External NODE_OPTIONS/NODE_PATH must not mask missing packaged dependencies.
delete childEnv.NODE_OPTIONS; delete childEnv.NODE_PATH;
async function stop(child) {
  children.delete(child);
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise(resolve => execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, () => resolve()));
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(1500)]);
    if (child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
  }
}
async function cleanup() { await Promise.all([...children].map(stop)); }
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { cleanup().finally(() => process.exit(1)); });

async function inspectApp(candidate) {
  let executable, resources;
  if (process.platform === 'darwin') { executable = path.join(candidate, 'Contents', 'MacOS', product); resources = path.join(candidate, 'Contents', 'Resources'); }
  else {
    resources = path.join(candidate, 'resources');
    const names = process.platform === 'win32' ? [`${product}.exe`] : [product.toLowerCase(), 'invoice-app', product];
    for (const name of names) if (await exists(path.join(candidate, name))) { executable = path.join(candidate, name); break; }
  }
  if (!executable || !await exists(executable)) return null;
  const runtimeDir = path.join(resources, 'einvoice-runtime'), assetsDir = path.join(resources, 'einvoice-assets');
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(path.join(runtimeDir, 'manifest.json'), 'utf8')); } catch { return null; }
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) return null;
  const appDir = path.join(resources, 'app');
  for (const file of [path.join(appDir, 'electron/einvoice-worker.cjs'), path.join(appDir, 'node_modules/pdfkit/package.json'), path.join(runtimeDir, 'mustang.jar'), path.join(assetsDir, 'NotoSans-Regular.ttf'), path.join(assetsDir, 'NotoSans-Bold.ttf')]) {
    if (!await exists(file)) throw new Error(`Packaged resource missing: ${file}`);
  }
  return { executable, resources, runtimeDir, assetsDir, appDir };
}
async function findApp() {
  if (value('--app')) {
    const candidate = await inspectApp(path.resolve(value('--app')));
    if (!candidate) throw new Error('--app is incomplete or does not match this host architecture.');
    return candidate;
  }
  const dist = path.resolve(value('--dist') || path.join(root, 'dist-electron'));
  const folders = (await fs.readdir(dist, { withFileTypes: true })).filter(e => e.isDirectory());
  const candidates = [];
  if (process.platform === 'darwin') {
    for (const dir of folders.filter(e => e.name.startsWith('mac'))) {
      for (const app of await fs.readdir(path.join(dist, dir.name), { withFileTypes: true })) if (app.isDirectory() && app.name.endsWith('.app')) candidates.push(path.join(dist, dir.name, app.name));
    }
  } else {
    const prefix = process.platform === 'win32' ? 'win' : 'linux';
    for (const dir of folders.filter(e => e.name.startsWith(prefix) && e.name.includes('unpacked'))) candidates.push(path.join(dist, dir.name));
  }
  const matches = [];
  for (const candidate of candidates) { const app = await inspectApp(candidate); if (app) matches.push(app); }
  if (matches.length !== 1) throw new Error(`Expected one complete ${process.platform}/${process.arch} unpacked app, found ${matches.length}. Use --app to select one explicitly.`);
  return matches[0];
}
async function exportFixture(app, format) {
  const fixture = require(path.join(root, 'tests/einvoice/fixture.cjs'))();
  const worker = fork(path.join(app.appDir, 'electron/einvoice-worker.cjs'), [], {
    execPath: app.executable, execArgv: [], env: childEnv, cwd: app.appDir,
    // The orchestrator's Node and Electron's Node can use different V8 wire
    // versions. JSON keeps this packaging check portable across build hosts.
    serialization: 'json', detached: process.platform !== 'win32', windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  children.add(worker);
  let logs = '';
  for (const stream of [worker.stdout, worker.stderr]) stream.on('data', chunk => { logs = (logs + chunk.toString()).slice(-5000); });
  try {
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Packaged ${format} export timed out.`)), 120000);
      const settle = (error, message) => { clearTimeout(timer); error ? reject(error) : resolve(message); };
      worker.once('message', message => settle(message?.ok ? null : new Error(message?.error || 'Invalid worker response.'), message));
      worker.once('error', error => settle(error));
      worker.once('exit', (code, signal) => settle(new Error(`Packaged worker exited (${code ?? signal}) before a result. ${logs}`)));
      worker.send({ format, document: fixture, runtimeDir: app.runtimeDir, assetsDir: app.assetsDir }, error => { if (error) settle(error); });
    });
    const bytes = Buffer.from(result.bytes || []);
    if (bytes.length < 1000) throw new Error(`Packaged ${format} produced an empty/truncated file.`);
    if (format === 'zugferd' && (result.extension !== 'pdf' || !bytes.subarray(0, 8).toString().startsWith('%PDF-1.7'))) throw new Error('Packaged ZUGFeRD output is not the expected PDF.');
    if (format === 'xrechnung' && (result.extension !== 'xml' || !bytes.toString('utf8').includes('urn:xeinkauf.de:kosit:xrechnung_3.0') || !bytes.toString('utf8').includes(fixture.number))) throw new Error('Packaged XRechnung output is not the expected standalone invoice XML.');
    // The packaged helper returns bytes only after its actual XML/veraPDF gate.
    console.log(`PASS packaged ${format}: ${bytes.length} bytes; bundled Electron + Java + validator.`);
  } finally { await stop(worker); }
}
async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
async function checkWeb(app) {
  const standalone = path.join(app.appDir, '.next', 'standalone');
  const serverPath = path.join(standalone, 'server.js');
  if (!await exists(serverPath)) throw new Error(`Packaged Next server missing: ${serverPath}`);
  const port = await unusedPort(), origin = `http://127.0.0.1:${port}`;
  const child = spawn(app.executable, [serverPath], { cwd: standalone, env: { ...childEnv, PORT: String(port), HOSTNAME: '127.0.0.1' }, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  let logs = '', spawnError;
  child.once('error', error => { spawnError = error; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { logs = (logs + chunk.toString()).slice(-5000); });
  try {
    const deadline = Date.now() + 40000;
    let html;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Packaged Next server exited early. ${logs}`);
      try {
        const response = await fetch(`${origin}/invoices`, { signal: AbortSignal.timeout(2000) });
        if (response.ok) { html = await response.text(); break; }
      } catch { /* bounded startup retry */ }
      await pause(200);
    }
    if (!html) throw new Error(`Packaged /invoices did not become ready. ${logs}`);
    const cssPath = [...html.matchAll(/(?:href|src)=["']([^"']+)["']/g)].map(m => m[1].replace(/&amp;/g, '&')).find(url => url.startsWith('/_next/static/') && /\.css(?:\?|$)/.test(url));
    if (!cssPath) throw new Error('Packaged /invoices contains no Next static CSS link.');
    const css = await fetch(new URL(cssPath, origin), { signal: AbortSignal.timeout(5000) });
    const content = await css.text();
    if (!css.ok || !css.headers.get('content-type')?.includes('text/css') || content.length < 100 || !content.includes('{')) throw new Error(`Packaged CSS is missing or invalid: ${css.status} ${cssPath}`);
    console.log(`PASS packaged /invoices and CSS (${content.length} characters).`);
  } finally { await stop(child); }
}
async function checkStorage(app) {
  await new Promise((resolve, reject) => {
    execFile(app.executable, [path.join(root, 'tests/native/packaged-storage.cjs'), app.appDir], { env: childEnv, cwd: app.appDir, timeout: 60000, windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(`Packaged storage failed: ${stdout}\n${stderr}\n${error.message}`));
      else { console.log(stdout.trim()); resolve(); }
    });
  });
}
try {
  const app = await findApp();
  console.log(`Packaged smoke: ${app.executable}`);
  await checkStorage(app);
  await exportFixture(app, 'zugferd');
  await exportFixture(app, 'xrechnung');
  if (!argv.includes('--skip-web')) await checkWeb(app);
  console.log('Packaged offline export and application smoke checks passed.');
} catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
finally { await cleanup(); }
