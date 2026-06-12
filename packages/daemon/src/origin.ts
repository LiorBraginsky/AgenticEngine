/**
 * Origin allowlist — layer 2 of the WS upgrade gate (spec §3.3, ADR-0003 p.5
 * un-deferred per Amendment 2026-05-30 + security-hardening spec §3.2).
 *
 * The per-install token (Sec-WebSocket-Protocol, ADR-0003 p.5) is now layer 1
 * and fires BEFORE this check. This allowlist catches cross-site browser tabs
 * that somehow obtain the token; it does NOT replace the token gate.
 *
 * ⚠️ known-gotcha #31: closed by the token gate (layer 1). Origin is still
 * spoofable by non-browser clients, but such clients need the token too.
 */
export const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  "tauri://localhost",      // Tauri v2 prod webview — macOS / Linux
  "http://tauri.localhost", // Tauri v2 prod webview — Windows / Android
  "http://localhost:1420",  // `tauri dev` (Vite default) during skeleton work
]);

export function isOriginAllowed(origin: string | null): boolean {
  return origin !== null && ALLOWED_ORIGINS.has(origin);
}
