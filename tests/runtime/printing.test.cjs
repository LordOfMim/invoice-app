'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = ts.transpileModule(
  fs.readFileSync(path.resolve(__dirname, '../../src/lib/printing.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settleMicrotasks = () => new Promise(resolve => setImmediate(resolve));

/** Every invocation gets its own VM, DOM, RAF queue and tracked timers. */
function browser({ images = [], fonts = Promise.resolve(), preview = true } = {}) {
  let nextFrame = 1;
  const frames = new Map(), canceled = [], timers = new Set(), queries = [];
  const module = { exports: {} };
  const context = {
    module, exports: module.exports,
    document: {
      fonts: { ready: fonts },
      getElementById(id) {
        queries.push(id);
        return preview ? { querySelectorAll(selector) { assert.equal(selector, 'img'); return images; } } : null;
      },
    },
    requestAnimationFrame(callback) { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { canceled.push(id); frames.delete(id); },
    setTimeout(callback, ms) {
      const timer = setTimeout(() => { timers.delete(timer); callback(); }, ms);
      timers.add(timer); return timer;
    },
    clearTimeout(timer) { timers.delete(timer); clearTimeout(timer); },
  };
  vm.runInNewContext(source, context, { filename: 'printing.ts' });
  return {
    ready: module.exports.waitForInvoicePrintReady, frames, canceled, timers, queries,
    async frame() {
      assert.equal(frames.size, 1, 'exactly one repaint must be pending');
      const [id, callback] = frames.entries().next().value;
      frames.delete(id); callback();
      await settleMicrotasks();
    },
    dispose() { for (const timer of timers) clearTimeout(timer); timers.clear(); frames.clear(); },
  };
}

test('print readiness waits for both repaints, fonts and every invoice logo decode', async () => {
  const fonts = deferred(), first = deferred(), second = deferred();
  const calls = [];
  const b = browser({ fonts: fonts.promise, images: [
    { complete: true, naturalWidth: 120, decode() { calls.push('first'); return first.promise; } },
    { complete: true, naturalWidth: 240, decode() { calls.push('second'); return second.promise; } },
  ] });
  try {
    let finished = false;
    const ready = b.ready(1000).then(() => { finished = true; });
    assert.equal(finished, false); assert.deepEqual(b.queries, []);
    await b.frame(); assert.deepEqual(b.queries, []);
    await b.frame(); assert.deepEqual(calls, []); assert.equal(finished, false);
    fonts.resolve(); await settleMicrotasks();
    assert.deepEqual(b.queries, ['invoice-preview']); assert.deepEqual(calls, ['first', 'second']);
    first.resolve(); await settleMicrotasks(); assert.equal(finished, false, 'the second logo still blocks printing');
    second.resolve(); await ready;
    assert.equal(finished, true); assert.equal(b.timers.size, 0); assert.equal(b.frames.size, 0);
  } finally { b.dispose(); }
});

test('a rejected image decode refuses to print with an actionable image error', async () => {
  const b = browser({ images: [{ complete: false, naturalWidth: 0, decode: () => Promise.reject(new Error('corrupt file')) }] });
  try {
    const rejected = assert.rejects(b.ready(1000), /Bilddatei prüfen.*keine PDF erstellt/);
    await b.frame(); await b.frame(); await rejected;
    assert.equal(b.timers.size, 0);
  } finally { b.dispose(); }
});

for (const [label, complete, naturalWidth] of [['incomplete image', false, 80], ['zero-width broken image', true, 0]]) {
  test(`${label} refuses printing even if decode resolves`, async () => {
    const b = browser({ images: [{ complete, naturalWidth, decode: () => Promise.resolve() }] });
    try {
      const rejected = assert.rejects(b.ready(1000), /Logo oder Bild.*keine PDF erstellt/);
      await b.frame(); await b.frame(); await rejected;
      assert.equal(b.timers.size, 0);
    } finally { b.dispose(); }
  });
}

test('a missing single invoice preview refuses printing', async () => {
  const b = browser({ preview: false });
  try {
    const rejected = assert.rejects(b.ready(1000), /Rechnungsvorschau ist noch nicht verfügbar/);
    await b.frame(); await b.frame(); await rejected;
    assert.deepEqual(b.queries, ['invoice-preview']); assert.equal(b.timers.size, 0);
  } finally { b.dispose(); }
});

test('a hanging logo decode times out and leaves no active timer or repaint', async () => {
  let decoding = false;
  const b = browser({ images: [{ complete: false, naturalWidth: 0, decode() { decoding = true; return new Promise(() => {}); } }] });
  try {
    const rejected = assert.rejects(b.ready(150), /nicht rechtzeitig geladen.*keine PDF erstellt/);
    await b.frame(); await b.frame();
    assert.equal(decoding, true);
    await rejected;
    assert.equal(b.timers.size, 0); assert.equal(b.frames.size, 0);
  } finally { b.dispose(); }
});

test('timeout cancels a still-pending animation frame before accessing the document', async () => {
  const b = browser();
  try {
    const rejected = assert.rejects(b.ready(15), /nicht rechtzeitig geladen/);
    assert.equal(b.frames.size, 1);
    await rejected;
    assert.equal(b.canceled.length, 1); assert.equal(b.frames.size, 0); assert.equal(b.timers.size, 0);
    assert.deepEqual(b.queries, []);
  } finally { b.dispose(); }
});
