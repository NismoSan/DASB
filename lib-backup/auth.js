"use strict";

// ── Authentication Module ──────────────────────────────────────────
var crypto = require('crypto');
var PANEL_USERNAME = process.env.PANEL_USERNAME || 'admin';
var PANEL_PASSWORD = process.env.PANEL_PASSWORD || 'changeme';
var activeSessions = new Map();
var SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}
function isValidSession(token) {
  if (!token) return false;
  var session = activeSessions.get(token);
  if (!session) return false;
  if (Date.now() - session.createdAt > SESSION_MAX_AGE) {
    activeSessions["delete"](token);
    return false;
  }
  return true;
}
function parseCookies(cookieHeader) {
  var cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(function (c) {
    var parts = c.trim().split('=');
    if (parts.length >= 2) {
      cookies[parts[0].trim()] = parts.slice(1).join('=').trim();
    }
  });
  return cookies;
}
function login(username, password) {
  if (username && username.toLowerCase() === PANEL_USERNAME.toLowerCase() && password === PANEL_PASSWORD) {
    var token = generateSessionToken();
    activeSessions.set(token, {
      createdAt: Date.now()
    });
    return {
      success: true,
      token: token
    };
  }
  return {
    success: false
  };
}
function logout(token) {
  if (token) activeSessions["delete"](token);
}

// Clean expired sessions every hour
var sessionCleanupInterval = setInterval(function () {
  var now = Date.now();
  activeSessions.forEach(function (session, token) {
    if (now - session.createdAt > SESSION_MAX_AGE) {
      activeSessions["delete"](token);
    }
  });
}, 60 * 60 * 1000);
function cleanup() {
  clearInterval(sessionCleanupInterval);
}
module.exports = {
  isValidSession: isValidSession,
  parseCookies: parseCookies,
  login: login,
  logout: logout,
  cleanup: cleanup,
  SESSION_MAX_AGE: SESSION_MAX_AGE
};