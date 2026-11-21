import type { Request, Response } from 'express';
import { AppConfig } from '../config';
import { forbidden } from '../common/errors';

/**
 * The refresh token lives only in an HttpOnly cookie, so page scripts (and any XSS)
 * cannot read it. It is sent only to /api/auth, and SameSite=Strict keeps other sites'
 * requests from carrying it.
 */
export const REFRESH_COOKIE = 'sds_refresh';
const COOKIE_PATH = '/api/auth';

/** Custom header every /auth request must carry. A cross-site form or <img> cannot set it,
 *  and a cross-site fetch() that sets it needs a CORS preflight, which the API refuses. */
export const CSRF_HEADER = 'x-sds-csrf';

export function setRefreshCookie(res: Response, token: string, config: AppConfig) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'strict',
    path: COOKIE_PATH,
    maxAge: config.refreshTokenTtlDays * 86400000,
  });
}

export function clearRefreshCookie(res: Response, config: AppConfig) {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: config.isProduction, sameSite: 'strict', path: COOKIE_PATH });
}

export function readRefreshCookie(req: Request): string | undefined {
  for (const part of (req.headers.cookie || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === REFRESH_COOKIE) {
      try { return decodeURIComponent(part.slice(eq + 1).trim()); } catch { return undefined; }
    }
  }
  return undefined;
}

/** CSRF check for the cookie-based auth routes: the custom header must be present, and a
 *  browser-sent Origin must be this site (or one listed in CORS_ORIGINS). */
export function assertSameSite(req: Request, config: AppConfig) {
  if (req.headers[CSRF_HEADER] !== '1') throw forbidden('Missing CSRF header.', 'CSRF');
  const origin = req.headers.origin;
  if (!origin) return;
  let host: string;
  try { host = new URL(origin).host; } catch { throw forbidden('Cross-site request refused.', 'CSRF'); }
  if (host !== req.headers.host && !config.corsOrigins.includes(origin)) throw forbidden('Cross-site request refused.', 'CSRF');
}
