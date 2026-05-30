/**
 * v0 interim CSWSH mitigation (ADR-0003 Amendment 2026-05-30). The per-install
 * token (ADR-0003 p.5) is DEFERRED to before any non-dev/public release.
 *
 * ⚠️ known-gotcha #31: the Origin header is spoofable by NON-browser clients,
 * so this allowlist only stops casual cross-site BROWSER tabs. It does NOT
 * replace the connection-level token; close that gap before release.
 */
export const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  "tauri://localhost",      // Tauri v2 prod webview — macOS / Linux
  "http://tauri.localhost", // Tauri v2 prod webview — Windows / Android
  "http://localhost:1420",  // `tauri dev` (Vite default) during skeleton work
]);

export function isOriginAllowed(origin: string | null): boolean {
  return origin !== null && ALLOWED_ORIGINS.has(origin);
}
