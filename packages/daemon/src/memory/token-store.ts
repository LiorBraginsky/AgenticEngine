/**
 * TokenStore — MF-05 T2.1b.
 *
 * Read-or-mint a per-install secret token stored at <dataDir>/auth-token.
 * File mode 0o600 (owner-only read/write) is enforced on creation.
 *
 * ADR-0013 Option B interim mechanics:
 *   - Mint: 32 random bytes as lowercase hex via crypto.getRandomValues.
 *   - Compare: direct `===` (timing-attack resistance is the hardening pass).
 *   - Seam: the verify(authHeader) method is the sole comparison point so the
 *     hardening pass can swap the impl without touching route handlers.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
   * Returns true iff the `Authorization` header value starts with `"Bearer "`
   * and the remainder exactly equals the secret.
   *
   * Accepts `string | undefined | null` so callers can pass
   * `req.headers.get("authorization")` directly.
   */
  verify(authHeader: string | undefined | null): boolean {
    if (!authHeader) return false;
    const PREFIX = "Bearer ";
    if (!authHeader.startsWith(PREFIX)) return false;
    return authHeader.slice(PREFIX.length) === this.secret;
  }
}
