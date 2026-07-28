/**
 * Tolerant JSON parsing for anything that came from outside this device.
 *
 * The content layer is explicitly untrusted — a hostile gateway, a truncated
 * download, or a corrupted cache entry can all hand back garbage. Throwing on
 * that would let anyone who can serve a bad response crash the app for the
 * reader, which is a cheap denial-of-service against exactly the reports
 * someone wants suppressed. Returning null instead lets callers degrade to
 * "content unavailable", which is both honest and safe.
 */
export function safeJsonParse<T>(raw: string | null | undefined): T | null {
  if (raw === null || raw === undefined || raw === "" || raw === "undefined") return null;
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed ?? null;
  } catch {
    return null;
  }
}
