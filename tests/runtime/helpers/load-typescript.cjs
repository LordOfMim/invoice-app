'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
function createLoader() {
  const cache = new Map();
  function load(relative) {
    const filename = path.resolve(relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = new Module(filename, module);
    mod.filename = filename;
    mod.paths = Module._nodeModulePaths(path.dirname(filename));
    cache.set(filename, mod);
    mod.require = request => {
      if (request.startsWith('@/')) return load(`src/${request.slice(2)}.ts`);
      // Relative TypeScript modules ("./derived", "../calc") load the same way; everything else is plain Node.
      if (request.startsWith('.') && fs.existsSync(path.resolve(path.dirname(filename), `${request}.ts`))) return load(path.resolve(path.dirname(filename), `${request}.ts`));
      return Module.prototype.require.call(mod, request);
    };
    mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
    return mod.exports;
  }
  return load;
}
module.exports = { createLoader };
