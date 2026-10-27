#!/usr/bin/env node
/** Build-time only. Downloads are pinned and SHA-256 checked; exports never use the network. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const args = process.argv.slice(2);
const arg = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
const platform = arg('--platform', process.platform), arch = arg('--arch', process.arch);
const out = path.resolve(arg('--out', 'electron/einvoice-runtime'));
const assets = path.resolve(arg('--assets', 'electron/einvoice-assets'));
const sha = b => createHash('sha256').update(b).digest('hex');
const jres = {
  'darwin-arm64': ['aarch64_mac', '225bab0a09491ef06835488cd942f5d2befa9a0410a2484f0c8bbcf7506ec09a'],
  'darwin-x64': ['x64_mac', 'c909674b1c10c261b9a3fb7e9c0efebd303e33f88a4fe84be7135b5e2d711f89'],
  'linux-x64': ['x64_linux', 'a535a1df9c6284d9618872984e026ae0352d1f7e9e0605425c0e6114f47351dd'],
  'win32-x64': ['x64_windows', 'd35f31e712f0fcf6ac5a093edc90204fbff22f720ba3950bd09d331d5e621636'],
};
const target = jres[`${platform}-${arch}`];
const javaVersion = platform === 'win32' ? '21.0.12.1+1' : '21.0.13+9';
if (!target) throw new Error(`E-Rechnungs-Laufzeit für ${platform}/${arch} ist nicht freigegeben; Build abgebrochen.`);
const jar = { url: 'https://github.com/ZUGFeRD/mustangproject/releases/download/core-2.26.0/Mustang-CLI-2.26.0.jar', sha256: '42d7868cb68264874a7b8cab4c3587b03b23ccc7cd72373da917f66758bb9736' };
const fontBase = 'https://raw.githubusercontent.com/notofonts/noto-fonts/ffebf8c1ee449e544955a7e813c54f9b73848eac';
const fonts = [
  ['NotoSans-Regular.ttf', `${fontBase}/hinted/ttf/NotoSans/NotoSans-Regular.ttf`, 'b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5'],
  ['NotoSans-Bold.ttf', `${fontBase}/hinted/ttf/NotoSans/NotoSans-Bold.ttf`, 'c976e4b1b99edc88775377fcc21692ca4bfa46b6d6ca6522bfda505b28ff9d6a'],
  ['OFL.txt', `${fontBase}/LICENSE`, '0dab92d0544f7b233403f14b84a663bdbfa746982eda629e7f4f9ffe1b036feb'],
];
async function verify() {
  const manifest = JSON.parse(await fs.readFile(path.join(out, 'manifest.json'), 'utf8'));
  if (manifest.platform !== platform || manifest.arch !== arch || manifest.mustangVersion !== '2.26.0' || manifest.javaVersion !== javaVersion) throw new Error('E-Rechnungs-Laufzeit stimmt nicht mit der Build-Architektur überein.');
  for (const [relative, expected] of Object.entries(manifest.files)) {
    if (relative.includes('..') || path.isAbsolute(relative)) throw new Error('Ungültiges Runtime-Manifest.');
    if (sha(await fs.readFile(path.join(out, relative))) !== expected) throw new Error(`Runtime-Prüfsumme ungültig: ${relative}`);
  }
  if (sha(await fs.readFile(path.join(out, 'mustang.jar'))) !== jar.sha256) throw new Error('Mustang-Prüfsumme ungültig.');
  for (const [name, , expected] of fonts) if (sha(await fs.readFile(path.join(assets, name))) !== expected) throw new Error(`Font-Prüfsumme ungültig: ${name}`);
  const java = path.join(out, 'jre', platform === 'darwin' ? 'Contents/Home/bin/java' : platform === 'win32' ? 'bin/java.exe' : 'bin/java');
  await fs.access(java);
  console.log(`E-Rechnung: ${platform}/${arch}, Mustang 2.26.0, Temurin ${javaVersion} und Fonts geprüft.`);
}
if (args.includes('--check')) { await verify(); process.exit(0); }
// Reuse an intact pinned runtime, but never silently use one for another architecture.
try { await verify(); process.exit(0); } catch { /* prepare a fresh bundle */ }
async function download(url, expected, file) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Download fehlgeschlagen (${response.status}): ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha(bytes) !== expected) throw new Error(`Download-Prüfsumme ungültig: ${url}`);
  await fs.writeFile(file, bytes);
}
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'helferlein-einvoice-prepare-'));
try {
  const stage = path.join(temp, 'runtime'); await fs.mkdir(stage);
  const archive = path.join(temp, platform === 'win32' ? 'jre.zip' : 'jre.tar.gz');
  const jreUrl = platform === 'win32' ? 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jre_x64_windows_hotspot_21.0.12.1_1.zip' : `https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jre_${target[0]}_hotspot_21.0.13_9.tar.gz`;
  await download(jreUrl, target[1], archive);
  const entries = platform === 'win32' && process.platform !== 'win32' ? (await run('unzip', ['-Z1', archive], { maxBuffer: 4 * 1024 * 1024 })).stdout.split('\n').filter(Boolean) : (await run('tar', ['-tf', archive], { maxBuffer: 4 * 1024 * 1024 })).stdout.split('\n').filter(Boolean);
  if (entries.some(e => e.startsWith('/') || e.split('/').includes('..'))) throw new Error('Unsicherer Pfad im Java-Archiv.');
  await fs.mkdir(path.join(stage, 'jre'));
  if (platform === 'win32' && process.platform !== 'win32') {
    const extracted = path.join(temp, 'extracted'); await fs.mkdir(extracted); await run('unzip', ['-q', archive, '-d', extracted]);
    const [root] = await fs.readdir(extracted); await fs.cp(path.join(extracted, root), path.join(stage, 'jre'), { recursive: true });
  } else await run('tar', ['-xf', archive, '-C', path.join(stage, 'jre'), '--strip-components=1']);
  await download(jar.url, jar.sha256, path.join(stage, 'mustang.jar'));
  const files = {};
  async function inventory(dir) { for (const entry of await fs.readdir(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) await inventory(full); else if (entry.isFile()) files[path.relative(stage, full)] = sha(await fs.readFile(full)); } }
  await inventory(stage);
  await fs.writeFile(path.join(stage, 'manifest.json'), JSON.stringify({ platform, arch, mustangVersion: '2.26.0', javaVersion, sources: { jar: jar.url, java: jreUrl }, files }, null, 2));
  await fs.writeFile(path.join(stage, 'THIRD-PARTY-NOTICES.txt'), 'Mustangproject 2.26.0: Apache-2.0, https://github.com/ZUGFeRD/mustangproject\nEclipse Temurin: GPL-2.0 with Classpath Exception. See jre/legal and jre/NOTICE.\nNoto Sans: SIL Open Font License, see ../einvoice-assets/OFL.txt.\nThe shaded Mustang JAR includes additional upstream components and notices. Use java -jar mustang.jar --action license to inspect its license information.\n');
  await fs.mkdir(assets, { recursive: true });
  for (const [name, url, expected] of fonts) await download(url, expected, path.join(assets, name));
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.rm(out, { recursive: true, force: true }); await fs.cp(stage, out, { recursive: true });
  await verify();
} finally { await fs.rm(temp, { recursive: true, force: true }); }
