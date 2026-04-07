"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SESSION_MAX_AGE = void 0;
exports.isValidSession = isValidSession;
exports.parseCookies = parseCookies;
exports.login = login;
exports.logout = logout;
exports.cleanup = cleanup;
// ── Authentication Module ──────────────────────────────────────────
const crypto_1 = __importDefault(require("crypto"));
const PANEL_USERNAME = process.env.PANEL_USERNAME || 'admin';
const PANEL_PASSWORD = process.env.PANEL_PASSWORD || 'changeme';
const activeSessions = new Map();
exports.SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
function generateSessionToken() {
    return crypto_1.default.randomBytes(32).toString('hex');
}
function isValidSession(token) {
    if (!token)
        return false;
    const session = activeSessions.get(token);
    if (!session)
        return false;
    if (Date.now() - session.createdAt > exports.SESSION_MAX_AGE) {
        activeSessions.delete(token);
        return false;
    }
    return true;
}
function parseCookies(cookieHeader) {
    const cookies = {};
    if (!cookieHeader)
        return cookies;
    cookieHeader.split(';').forEach(function (c) {
        const parts = c.trim().split('=');
        if (parts.length >= 2) {
            cookies[parts[0].trim()] = parts.slice(1).join('=').trim();
        }
    });
    return cookies;
}
function login(username, password) {
    if (username && username.toLowerCase() === PANEL_USERNAME.toLowerCase() && password === PANEL_PASSWORD) {
        const token = generateSessionToken();
        activeSessions.set(token, { createdAt: Date.now() });
        return { success: true, token: token };
    }
    return { success: false };
}
function logout(token) {
    if (token)
        activeSessions.delete(token);
}
// Clean expired sessions every hour
const sessionCleanupInterval = setInterval(function () {
    const now = Date.now();
    activeSessions.forEach(function (session, token) {
        if (now - session.createdAt > exports.SESSION_MAX_AGE) {
            activeSessions.delete(token);
        }
    });
}, 60 * 60 * 1000);
function cleanup() {
    clearInterval(sessionCleanupInterval);
}
//# sourceMappingURL=auth.js.map