// Replaces `holder[key]` with a wrapper and returns a restore function. The
// wrapper receives the bound original as `inner`. Restore only undoes this patch:
// if someone patched again after us, we leave their wrapper in place.
export function patchMethod<K extends string>(
  holder: Partial<Record<K, unknown>>,
  key: K,
  wrap: (inner: (...args: any[]) => unknown, ...args: any[]) => unknown,
): () => void {
  const original = holder[key];
  if (typeof original !== "function") return () => undefined;
  const hadOwn = Object.prototype.hasOwnProperty.call(holder, key);
  const bound = (original as (...args: any[]) => unknown).bind(holder);
  const patched = (...args: any[]) => wrap(bound, ...args);
  holder[key] = patched as Partial<Record<K, unknown>>[K];
  return () => {
    if (holder[key] !== patched) return;
    if (hadOwn) {
      holder[key] = original as Partial<Record<K, unknown>>[K];
    } else {
      delete holder[key];
    }
  };
}

export type GetHolder = { get?: (id: unknown) => unknown };

// Thin wrapper over patchMethod for `get(id)` services (sessions, agents).
export function patchGet(
  holder: GetHolder,
  wrap: (original: (id: unknown) => unknown, id: unknown) => unknown,
): () => void {
  return patchMethod(holder, "get", (inner, id: unknown) => wrap(inner as (id: unknown) => unknown, id));
}
