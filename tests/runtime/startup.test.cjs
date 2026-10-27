const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(http) {
  const windows = [];
  const app = {
    isPackaged: true, on() {}, requestSingleInstanceLock: () => true,
    whenReady: () => ({ then() {} }), getPath: () => '/unused',
  };
  class Window extends EventEmitter {
    constructor() {
      super(); this.destroyed = false; this.files = []; this.urls = []; this.shows = 0;
      this.webContents = new EventEmitter();
      this.webContents.send = () => {};
      this.webContents.setWindowOpenHandler = () => {};
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    getBounds() { return { width: 1400, height: 900 }; }
    loadFile(file) { this.files.push(file); return Promise.resolve(); }
    loadURL(url) { this.urls.push(url); return this.urlResult ?? Promise.resolve(); }
    show() { this.shows++; }
    closeNow() { this.destroyed = true; this.emit('closed'); }
  }
  const context = {
    require: name => {
      if (name === 'electron') return { app, BrowserWindow: Window, ipcMain: { handle() {}, on() {} } };
      if (name === 'http' && http) return http;
      if (name === 'fs') return { ...fs, appendFileSync() {} };
      return require(name);
    },
    process, console: { log() {} }, URL, AbortController, setTimeout, clearTimeout,
    __dirname: path.resolve('electron'),
  };
  vm.runInNewContext(fs.readFileSync('electron/main.js', 'utf8') + `
    globalThis.runtime = { waitForServer, createWindow,
      setStore(value) { store = value; },
      setStart(value) { startNextServer = value; },
      getWindow() { return mainWindow; }
    };`, context);
  context.runtime.setStore({ get: () => undefined, set() {} });
  return { ...context.runtime, windows };
}
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const tick = () => new Promise(resolve => setImmediate(resolve));
function mockHttp() {
  const requests = [];
  return { requests, get(_url, onResponse) {
    const request = new EventEmitter();
    request.destroyed = false;
    request.setTimeout = (ms, callback) => { request.timer = setTimeout(callback, ms); };
    request.destroy = error => {
      if (request.destroyed) return;
      request.destroyed = true; clearTimeout(request.timer);
      if (error) request.emit('error', error);
      request.emit('close');
    };
    request.respond = statusCode => onResponse({ statusCode, on() {}, resume() {}, destroy() {} });
    requests.push(request);
    return request;
  } };
}

test('a server accepting connections without responding cannot outlive the overall deadline', async () => {
  const http = mockHttp(); const runtime = fixture(http);
  await assert.rejects(runtime.waitForServer('http://local', 45, { requestTimeout: 10, retryDelay: 2 }), /Timeout waiting for server/);
  assert.ok(http.requests.length >= 2, 'per-request timeout should permit retries');
  assert.ok(http.requests.every(request => request.destroyed));
  const count = http.requests.length;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(http.requests.length, count, 'deadline must stop all retries');
});

test('successful readiness destroys the request and cancels its timers', async () => {
  const http = mockHttp(); const runtime = fixture(http);
  const ready = runtime.waitForServer('http://local', 100, { requestTimeout: 10, retryDelay: 1 });
  http.requests[0].respond(200);
  await ready;
  assert.equal(http.requests[0].destroyed, true);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(http.requests.length, 1);
});

test('closing startup cancels an active probe and leaves no retries', async () => {
  const http = mockHttp(); const runtime = fixture(http); const controller = new AbortController();
  const ready = runtime.waitForServer('http://local', 100, { signal: controller.signal });
  controller.abort();
  await assert.rejects(ready, /canceled/);
  assert.equal(http.requests[0].destroyed, true);
});

test('closing an older loading window cannot clear or load a replacement window', async () => {
  const runtime = fixture(); const starts = [];
  runtime.setStart(() => { const start = deferred(); starts.push(start); return start.promise; });
  await runtime.createWindow(); const first = runtime.windows[0];
  await runtime.createWindow(); const second = runtime.windows[1];
  first.closeNow();
  assert.equal(runtime.getWindow(), second);
  first.emit('ready-to-show');
  first.webContents.emit('did-fail-load', {}, -105, 'failed', 'http://local');
  starts[0].resolve(); await tick();
  assert.deepEqual(first.urls, []);
  assert.deepEqual(second.urls, []);
  assert.equal(first.files.length, 1);
  assert.equal(first.shows, 0);
  starts[1].resolve(); await tick();
  assert.equal(second.urls.length, 1);
  second.closeNow();
});

test('late navigation failure after close does not load an error page', async () => {
  const runtime = fixture(); const startup = deferred(); const navigation = deferred();
  runtime.setStart(() => startup.promise);
  await runtime.createWindow(); const win = runtime.windows[0]; win.urlResult = navigation.promise;
  startup.resolve(); await tick();
  assert.equal(win.urls.length, 1);
  win.closeNow(); navigation.reject(new Error('navigation canceled')); await tick();
  assert.equal(win.files.length, 1);
});

test('failure to persist optional window geometry cannot interrupt closing data flush', async () => {
  const runtime = fixture(); runtime.setStart(() => Promise.resolve());
  runtime.setStore({ get: () => undefined, set() { throw new Error('disk full'); } });
  await runtime.createWindow(); const win = runtime.windows[0];
  assert.doesNotThrow(() => win.emit('close'));
  win.closeNow(); await tick();
});
