"use strict";

// ── Configuration Manager ──────────────────────────────────────────

var db = null;
var DEFAULT_CONFIG = {
  bots: [],
  server: {
    address: '52.88.55.94',
    port: 2610
  },
  webPort: 3000,
  features: {
    autoReconnect: true,
    logChat: true,
    logPackets: true
  },
  reconnectStrategy: {
    sequential: true,
    delayBetweenBots: 5000
  },
  timezone: 'America/Chicago',
  walkPaths: [],
  aeIngest: {
    enabled: false,
    apiUrl: '',
    apiKey: ''
  },
  chatGames: {
    enabled: false,
    openaiModel: 'gpt-4o-mini',
    commandPrefix: '!',
    publicChatEnabled: true,
    whisperEnabled: true,
    cooldownSeconds: 10,
    games: {
      trivia: true,
      riddle: true,
      eightball: true,
      scramble: true,
      numberguess: true,
      fortune: true,
      rps: true,
      blackjack: true
    }
  }
};
var cachedConfig = null;
function mergeWithDefaults(config) {
  // Migrate old single-bot config to multi-bot format
  if (config.username && !config.bots) {
    config.bots = [{
      id: 'bot_1',
      username: config.username,
      password: config.password,
      enabled: true,
      role: 'primary'
    }];
    delete config.username;
    delete config.password;
  }

  // Ensure all bots have IDs
  if (config.bots) {
    config.bots.forEach(function (bot, i) {
      if (!bot.id) bot.id = 'bot_' + (i + 1);
      if (!bot.role) bot.role = i === 0 ? 'primary' : 'secondary';
    });
  }
  return Object.assign({}, DEFAULT_CONFIG, config, {
    bots: config.bots || [],
    server: Object.assign({}, DEFAULT_CONFIG.server, config.server),
    features: Object.assign({}, DEFAULT_CONFIG.features, config.features),
    reconnectStrategy: Object.assign({}, DEFAULT_CONFIG.reconnectStrategy, config.reconnectStrategy),
    aeIngest: Object.assign({}, DEFAULT_CONFIG.aeIngest, config.aeIngest),
    chatGames: Object.assign({}, DEFAULT_CONFIG.chatGames, config.chatGames, {
      games: Object.assign({}, DEFAULT_CONFIG.chatGames.games, config.chatGames ? config.chatGames.games : {})
    })
  });
}
function loadConfig() {
  if (cachedConfig) return cachedConfig;
  cachedConfig = Object.assign({}, DEFAULT_CONFIG);
  return cachedConfig;
}
function saveConfig(config) {
  cachedConfig = config;
  if (db) db.saveConfig(config);
}
function setFromDB(dbConfig) {
  if (dbConfig) {
    cachedConfig = mergeWithDefaults(dbConfig);
  } else {
    cachedConfig = Object.assign({}, DEFAULT_CONFIG);
    if (db) db.saveConfig(cachedConfig);
  }
  return cachedConfig;
}
function init(database) {
  db = database;
}
module.exports = {
  init: init,
  loadConfig: loadConfig,
  saveConfig: saveConfig,
  setFromDB: setFromDB,
  mergeWithDefaults: mergeWithDefaults,
  DEFAULT_CONFIG: DEFAULT_CONFIG
};