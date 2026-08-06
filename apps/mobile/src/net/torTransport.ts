import {
  getStatus,
  isTorAvailable,
  newCircuit,
  startTor,
  stopTor,
  torRequest,
  TorUnavailableError,
  type TorStatus,
} from "expo-tor";

import type { Transport } from "./transport";

/**
 * Real onion routing: HTTP performed by the platform stack through a loopback
 * SOCKS5 proxy backed by an in-process Arti client.
 *
 * ## Why the request leaves JS
 *
 * React Native's `fetch` cannot be told to use a proxy for one request, and
 * setting a process-wide proxy would silently route the app's *other* traffic
 * — Metro in development, crash reporting, anything a dependency does — through
 * Tor as well, which is both slow and a good way to fingerprint the app. So the
 * native module performs the HTTP and hands back status, headers, and a base64
 * body, which this class reassembles into a standard `Response`.
 *
 * ## Why there is no fallback
 *
 * Every method here fails rather than degrading to a direct connection. That is
 * a deliberate and slightly user-hostile choice: a transport that quietly falls
 * back is worse than no transport at all, because the user has been told they
 * are protected and has made decisions on that basis. Failing loudly is
 * recoverable; leaking silently is not.
 */
export class TorTransport implements Transport {
  readonly name = "tor";
  readonly anonymised = true;

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    const response = await torRequest(url, {
      method: (init?.method as string) ?? "GET",
      headers: normalizeHeaders(init?.headers),
      body: typeof init?.body === "string" ? init.body : null,
    });

    // Hand `Response` a standalone ArrayBuffer rather than the view.
    //
    // Same trap as hashing `.buffer` instead of the bytes: a view carries an
    // offset and a length into a buffer that may be larger, so passing the
    // backing store risks a body with extra bytes on either end. Copying is
    // cheap next to the seconds a Tor round trip already took, and it makes the
    // body exactly what came back.
    const bytes = base64ToBytes(response.bodyBase64);
    const body = new Uint8Array(bytes).buffer;

    return new Response(body, {
      status: response.status,
      headers: response.headers,
    });
  }
}

/**
 * Normalize the several shapes `RequestInit.headers` can take.
 *
 * The native side takes a plain record; a `Headers` instance or an entry array
 * would arrive as `{}` and the request would go out without its
 * `Content-Type` or `Authorization`, which fails in confusing ways.
 */
function normalizeHeaders(headers: RequestInit["headers"]): Record<string, string> {
  if (!headers) return {};

  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((value: string, key: string) => {
      out[key] = value;
    });
    return out;
  }

  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...(headers as Record<string, string>) };
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = globalThis.atob
    ? globalThis.atob(b64)
    : Buffer.from(b64, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export type TorAvailability =
  /** This build has the native module and can run Tor. */
  | "available"
  /** Expo Go or web: no native module, and no amount of retrying will help. */
  | "unsupported";

export function torAvailability(): TorAvailability {
  return isTorAvailable() ? "available" : "unsupported";
}

export function torStatus(): TorStatus {
  return getStatus();
}

/**
 * Bootstrap Tor.
 *
 * Slow — 10 to 60 seconds is ordinary, longer where Tor is censored. The caller
 * must show progress; a spinner with no explanation reads as a hang and people
 * turn the protection off.
 */
export async function ensureTorRunning(): Promise<TorStatus> {
  const status = getStatus();
  if (status.state === "running") return status;

  await startTor();
  return getStatus();
}

export async function shutdownTor(): Promise<void> {
  await stopTor();
}

/**
 * Move subsequent requests onto fresh circuits.
 *
 * Returns whether isolation was actually obtained — false when Tor is off or
 * unavailable. Callers must not treat false as success: the point is to let a
 * submission know it is sharing a circuit with the previous one.
 */
export async function rotateCircuit(): Promise<boolean> {
  if (!isTorAvailable()) return false;
  if (getStatus().state !== "running") return false;
  return newCircuit();
}

export { TorUnavailableError };
