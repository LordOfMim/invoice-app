export type DataPatch =
  | { op: "set"; path: (string | number)[]; value: unknown }
  | { op: "remove"; path: (string | number)[] }
  | { op: "splice"; path: (string | number)[]; start: number; deleteCount: number; items: unknown[] };

/** Diff immutable state by shared references, never serialize the history on a keystroke. */
export function createDataPatches(previous: unknown, next: unknown): DataPatch[] {
  const patches: DataPatch[] = [];
  function visit(a: unknown, b: unknown, path: (string | number)[]) {
    if (Object.is(a, b)) return;
    if (b === undefined) { patches.push({ op: "remove", path }); return; }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        let start = 0;
        while (start < a.length && start < b.length && Object.is(a[start], b[start])) start++;
        let endA = a.length, endB = b.length;
        while (endA > start && endB > start && Object.is(a[endA - 1], b[endB - 1])) { endA--; endB--; }
        patches.push({ op: "splice", path, start, deleteCount: endA - start, items: b.slice(start, endB) });
      } else {
        for (let index = 0; index < b.length; index++) visit(a[index], b[index], [...path, index]);
      }
      return;
    }
    if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
      const old = a as Record<string, unknown>, current = b as Record<string, unknown>;
      for (const key of Object.keys(old)) if (!Object.hasOwn(current, key)) patches.push({ op: "remove", path: [...path, key] });
      for (const key of Object.keys(current)) visit(Object.hasOwn(old, key) ? old[key] : undefined, current[key], [...path, key]);
      return;
    }
    patches.push({ op: "set", path, value: b });
  }
  visit(previous, next, []);
  return patches;
}
