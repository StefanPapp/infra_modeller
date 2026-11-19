import { createHash, timingSafeEqual } from "node:crypto";

export interface AuthConfig {
  username: string;
  password: string | undefined;
}

export type AuthDecision = "ok" | "challenge" | "unconfigured";

/** Constant-time string comparison (hashing first equalises the lengths). */
function safeEqual(a: string, b: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}

/**
 * Decides whether a request with the given Authorization header may pass.
 * Without a configured password the app is open in development and refuses
 * every request in production, so a forgotten env var never exposes it.
 */
export function authorize(
  authorizationHeader: string | null,
  config: AuthConfig,
  isProduction: boolean
): AuthDecision {
  if (!config.password) return isProduction ? "unconfigured" : "ok";

  const match = /^Basic\s+(\S+)$/i.exec(authorizationHeader ?? "");
  if (!match) return "challenge";

  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator < 0) return "challenge";

  const userOk = safeEqual(decoded.slice(0, separator), config.username);
  const passwordOk = safeEqual(decoded.slice(separator + 1), config.password);
  return userOk && passwordOk ? "ok" : "challenge";
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF guard. Browsers attach cached Basic credentials to cross-site
 * requests, so state-changing requests must come from our own origin.
 * Clients that send neither Sec-Fetch-Site nor Origin are not browsers and
 * cannot be driven by a third-party page, so they are let through.
 */
export function isCrossSiteWrite(request: {
  method: string;
  host: string | null;
  origin: string | null;
  secFetchSite: string | null;
}): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return false;

  if (request.secFetchSite !== null) {
    return request.secFetchSite !== "same-origin";
  }
  if (request.origin !== null) {
    try {
      return new URL(request.origin).host !== request.host;
    } catch {
      return true;
    }
  }
  return false;
}
