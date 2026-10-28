'use strict';

const own = (object, key) => Object.hasOwn(object, key);
function put(object, key, value) {
  Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true });
}
function applyDataPatches(root, patches) {
  if (!Array.isArray(patches) || patches.length > 50000) throw new Error('Ungültiges Änderungspaket.');
  const owned = new WeakSet();
  const copy = value => {
    if (!value || typeof value !== 'object') throw new Error('Ungültiges Änderungsziel.');
    if (owned.has(value)) return value;
    const result = Array.isArray(value) ? value.slice() : { ...value };
    owned.add(result);
    return result;
  };
  root = copy(root);
  for (const patch of patches) {
    if (!patch || !Array.isArray(patch.path) || patch.path.length > 128) throw new Error('Ungültiger Änderungspfad.');
    for (const key of patch.path) if (typeof key !== 'string' && !(Number.isSafeInteger(key) && key >= 0)) throw new Error('Ungültiger Änderungsschlüssel.');
    if (patch.path.length === 0) {
      if (patch.op !== 'set' || !patch.value || typeof patch.value !== 'object') throw new Error('Ungültiger Datenersatz.');
      root = patch.value;
      continue;
    }
    let target = root;
    const count = patch.op === 'splice' ? patch.path.length : patch.path.length - 1;
    for (let i = 0; i < count; i++) {
      const key = patch.path[i];
      if (!target || typeof target !== 'object') throw new Error('Änderungspfad fehlt im gespeicherten Bestand.');
      const child = copy(own(target, key) ? target[key] : (typeof patch.path[i + 1] === 'number' ? [] : {}));
      put(target, key, child);
      target = child;
    }
    if (!target || typeof target !== 'object') throw new Error('Ungültiges Änderungsziel.');
    const key = patch.path.at(-1);
    if (patch.op === 'set') put(target, key, patch.value);
    else if (patch.op === 'remove') delete target[key];
    else if (patch.op === 'splice') {
      if (!Array.isArray(target) || !Number.isSafeInteger(patch.start) || patch.start < 0 || patch.start > target.length || !Number.isSafeInteger(patch.deleteCount) || patch.deleteCount < 0 || !Array.isArray(patch.items)) throw new Error('Ungültige Listenänderung.');
      // Avoid argument-count limits when importing a large collection.
      const tail = target.slice(patch.start + patch.deleteCount);
      target.length = patch.start;
      for (const item of patch.items) target.push(item);
      for (const item of tail) target.push(item);
    } else throw new Error('Unbekannte Datenänderung.');
  }
  return root;
}
module.exports = { applyDataPatches };
