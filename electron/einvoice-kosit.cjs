'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const run = promisify(require('node:child_process').execFile);
const pins = Object.freeze({
  validatorVersion: '1.6.3', configurationVersion: '2026-08-31', schematronVersion: '2.6.0',
  jar: { url: 'https://github.com/itplr-kosit/validator/releases/download/v1.6.3/validator-1.6.3-standalone.jar', sha256: '799e64befca97d4080e03608c80b85dd5a5ecc5f4ae4f35d1116ec2855b9a7c9' },
  configuration: { url: 'https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/v2026-08-31/xrechnung-3.0.2-validator-configuration-2026-08-31.zip', sha256: '2530cd107c414511c5d0462ec10f886910395abfca820db82e83d70bf01221a8', treeSha256: 'bee80026032a6ba589bd6de9799db5f7071dc8a59a48779dfce8985fe5dbe0b6' },
});
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function configurationInventory(directory) {
  const entries = [];
  async function visit(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) entries.push([path.relative(directory, full).split(path.sep).join('/'), sha256(await fs.readFile(full))]);
      else throw new Error('Unzulässiger Dateityp im lokalen KoSIT-Regelpaket.');
    }
  }
  await visit(directory);
  return Object.fromEntries(entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}
async function verifyKosit(runtimeDir) {
  const directory = path.join(runtimeDir, 'kosit');
  if (sha256(await fs.readFile(path.join(directory, 'validator.jar'))) !== pins.jar.sha256) throw new Error('Prüfsumme des KoSIT-Validators stimmt nicht.');
  const files = await configurationInventory(path.join(directory, 'configuration'));
  if (sha256(JSON.stringify(files)) !== pins.configuration.treeSha256) throw new Error('Prüfsumme der KoSIT-Konfiguration stimmt nicht.');
  return directory;
}
function parseKositReport(report) {
  // KoSIT VARL acceptance is authoritative; never infer success from a
  // process exit code or from the invoice's serialized input in the report.
  const root = report.match(/<rep:report\b([^>]*)>/)?.[1] ?? '';
  if (!/xmlns:rep="http:\/\/www\.xoev\.de\/de\/validator\/varl\/1"/.test(root) || !/\bvalid="true"/.test(root)) return false;
  const assessment = report.match(/<rep:assessment>\s*<rep:accept>[\s\S]*?<\/rep:accept>\s*<\/rep:assessment>\s*<\/rep:report>\s*$/);
  return Boolean(assessment) && !/<rep:reject\b/.test(report);
}
async function validateXRechnung(bytes, runtimeDir) {
  const directory = await verifyKosit(runtimeDir);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'helferlein-kosit-'));
  try {
    const source = path.join(temporary, 'invoice.xml');
    await fs.writeFile(source, bytes, { mode: 0o600 });
    const java = path.join(runtimeDir, 'jre', process.platform === 'darwin' ? 'Contents/Home/bin/java' : process.platform === 'win32' ? 'bin/java.exe' : 'bin/java');
    let processError;
    try {
      await run(java, ['-Djava.awt.headless=true', '-Xmx512m', '-jar', path.join(directory, 'validator.jar'), '-s', path.join(directory, 'configuration/scenarios.xml'), '-r', path.join(directory, 'configuration'), '-o', temporary, source], { cwd: temporary, timeout: 90000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    } catch (error) { processError = error; }
    const report = await fs.readFile(path.join(temporary, 'invoice-report.xml'), 'utf8');
    if (processError || !parseKositReport(report)) throw new Error('Die aktuelle KoSIT-Prüfung hat die XRechnung nicht freigegeben (Konfiguration 2026-08-31).');
    return { valid: true, validator: 'KoSIT 1.6.3', configuration: pins.configurationVersion, schematron: pins.schematronVersion, artifactSha256: sha256(bytes) };
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
module.exports = { pins, sha256, configurationInventory, verifyKosit, parseKositReport, validateXRechnung };
