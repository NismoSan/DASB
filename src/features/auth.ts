// ── Authentication Module ──────────────────────────────────────────
import crypto from 'crypto';

const PANEL_USERNAME: string = process.env.PANEL_USERNAME || '';
const PANEL_PASSWORD: string = process.env.PANEL_PASSWORD || '';
const activeSessions: Map<string, { createdAt: number }> = new Map();
export const SESSION_MAX_AGE: number = 24 * 60 * 60 * 1000; // 24 hours

function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function isValidSession(token: string | undefined): boolean {
  if (!token) return false;
  const session = activeSessions.get(token);
  if (!session) return false;
  if (Date.now() - session.createdAt > SESSION_MAX_AGE) {
    activeSessions.delete(token);
    return false;
  }
  return true;
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(function (c: string) {
    const parts = c.trim().split('=');
    if (parts.length >= 2) {
      cookies[parts[0].trim()] = parts.slice(1).join('=').trim();
    }
  });
  return cookies;
}

export function login(username: string, password: string): { success: true; token: string } | { success: false } {
  if (!PANEL_USERNAME || !PANEL_PASSWORD) return { success: false };
  if (!username || !password) return { success: false };

  if (username.toLowerCase() === PANEL_USERNAME.toLowerCase()) {
    const passBuffer = Buffer.from(password);
    const expectedBuffer = Buffer.from(PANEL_PASSWORD);
    if (passBuffer.length === expectedBuffer.length &&
        crypto.timingSafeEqual(passBuffer, expectedBuffer)) {
      const token = generateSessionToken();
      activeSessions.set(token, { createdAt: Date.now() });
      return { success: true, token: token };
    }
  }
  return { success: false };
}

export function logout(token: string | undefined): void {
  if (token) activeSessions.delete(token);
}

// Clean expired sessions every hour
const sessionCleanupInterval = setInterval(function () {
  const now = Date.now();
  activeSessions.forEach(function (session: { createdAt: number }, token: string) {
    if (now - session.createdAt > SESSION_MAX_AGE) {
      activeSessions.delete(token);
    }
  });
}, 60 * 60 * 1000);

export function cleanup(): void {
  clearInterval(sessionCleanupInterval);
}
