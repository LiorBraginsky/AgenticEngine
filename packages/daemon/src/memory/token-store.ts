/**
 * TokenStore — MF-05 T2.1b.
 *
 * Read-or-mint a per-install secret token stored at <dataDir>/auth-token.
 * File mode 0o600 (owner-only read/write) is enforced on creation.
 *
 * Security hardening (spec §3.8, ADR-0013 Option B):
 *   - Mint: 32 random bytes as lowercase hex via crypto.getRandomValues.
 *   - Compare: constant-time via crypto.timingSafeEqual (one private sink).
 *   - Seam: verify(authHeader) for HTTP Bearer path; verifyToken(raw) for WS
 *     subprotocol path — both route through the private safeEqual() core.
 *     "One comparison sink" (spec §2).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { timingSafeEqual } from "node:crypto";

const TOKEN_FILENAME = "auth-token";

export class TokenStore {
  private readonly secret: string;

  constructor(dataDir: string) {
    const tokenPath = join(dataDir, TOKEN_FILENAME);
    if (existsSync(tokenPath)) {
      this.secret = readFileSync(tokenPath, "utf8").trim();
    } else {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      writeFileSync(tokenPath, hex, { mode: 0o600 });
      this.secret = hex;
    }
  }

  /** The minted/read secret token. */
  token(): string {
    return this.secret;
  }

  /**
   * Constant-time comparison of `candidate` against the stored secret.
   *
   * Length-mismatch guard does NOT reveal information about the secret value:
   * the token is a fixed 64-hex public-length format; guarding on byte-length
   * only avoids a Buffer.from throw, not a timing leak on the secret itself.
   * This is the standard accepted pattern (spec §3.8, Approach D1).
   *
   * NEVER log or expose `candidate` at the call site (DoD #7).
   */
  private safeEqual(candidate: string): boolean {
    const a = Buffer.from(candidate);
    const b = Buffer.from(this.secret);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /**
   * Returns true iff the `Authorization` header value starts with `"Bearer "`
   * and the remainder equals the secret (constant-time compare).
   *
   * Accepts `string | undefined | null` so callers can pass
   * `req.headers.get("authorization")` directly.
   */
  verify(authHeader: string | undefined | null): boolean {
    if (!authHeader) return false;
    const PREFIX = "Bearer ";
    if (!authHeader.startsWith(PREFIX)) return false;
    return this.safeEqual(authHeader.slice(PREFIX.length));
  }

  /**
   * Returns true iff `raw` equals the secret (constant-time compare).
   * Used by the WS-upgrade path where the token arrives as the bare
   * `Sec-WebSocket-Protocol` value — no `"Bearer "` prefix.
   *
   * Accepts `string | undefined | null` so callers can pass
   * `req.headers.get("sec-websocket-protocol")` directly.
   *
   * NEVER log or expose `raw` at the call site (DoD #7).
   */
  verifyToken(raw: string | undefined | null): boolean {
    if (!raw) return false;
    return this.safeEqual(raw);
  }
}
