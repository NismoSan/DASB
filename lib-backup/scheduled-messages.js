"use strict";

// ── Scheduled Messages Engine ──────────────────────────────────────
var messageUtils = require('./message-utils');
var db = null;
var io = null;
var Packet = null;
var getPrimaryBot = null;
var botsMap = null;
var loadConfig = null;
var scheduledTimers = new Map();
var cachedSchedules = [];
var SCHEDULED_SAY_MAX = 64;
var SCHEDULED_WHISPER_MAX = 64;
function getSchedules() {
  return cachedSchedules;
}
function getSchedulesWithNextFire(schedList) {
  var list = schedList || getSchedules();
  return list.map(function (s) {
    var entry = scheduledTimers.get(s.id);
    var copy = Object.assign({}, s);
    if (entry && entry.nextFireAt) {
      copy.nextFireAt = entry.nextFireAt;
    }
    return copy;
  });
}
function sendScheduledMessage(sched) {
  var bot = null;
  if (sched.botId && sched.botId !== 'primary') {
    bot = botsMap.get(sched.botId);
  }
  if (!bot) bot = getPrimaryBot();
  var now = Date.now();
  var success = !!(bot && bot.client && bot.state.status === 'logged_in');
  if (success) {
    if (sched.messageType === 'whisper' && sched.whisperTarget) {
      var chunks = messageUtils.splitMessage(sched.message, SCHEDULED_WHISPER_MAX);
      chunks.forEach(function (chunk, i) {
        setTimeout(function () {
          var p = new Packet(0x19);
          p.writeString8(sched.whisperTarget);
          p.writeString8(chunk);
          bot.client.send(p);
        }, i * 500);
      });
    } else {
      var chunks = messageUtils.splitMessage(sched.message, SCHEDULED_SAY_MAX);
      chunks.forEach(function (chunk, i) {
        setTimeout(function () {
          var p = new Packet(0x0E);
          p.writeByte(0x00);
          p.writeString8(chunk);
          bot.client.send(p);
        }, i * 800);
      });
    }
  }
  sched.lastFired = now;
  sched.lastSuccess = success;
  db.updateScheduleFired(sched.id, now, success);
  io.emit('scheduled:fired', {
    id: sched.id,
    name: sched.name,
    timestamp: now,
    success: success
  });
  db.loadScheduledMessages().then(function (dbScheds) {
    io.emit('scheduled:list', getSchedulesWithNextFire(dbScheds));
  });
}
function clearScheduleTimer(id) {
  var entry = scheduledTimers.get(id);
  if (entry && entry.timer) {
    clearInterval(entry.timer);
    clearTimeout(entry.timer);
  }
  scheduledTimers["delete"](id);
}
function startScheduleTimer(sched) {
  clearScheduleTimer(sched.id);
  if (!sched.enabled) return;
  if (sched.type === 'interval') {
    var ms = (sched.interval || 30) * 60 * 1000;
    var nextFireAt = Date.now() + ms;
    var timer = setInterval(function () {
      sendScheduledMessage(sched);
      var entry = scheduledTimers.get(sched.id);
      if (entry) entry.nextFireAt = Date.now() + ms;
    }, ms);
    scheduledTimers.set(sched.id, {
      timer: timer,
      nextFireAt: nextFireAt
    });
  } else if (sched.type === 'daily') {
    var scheduleNextDaily = function scheduleNextDaily() {
      var config = loadConfig();
      var tz = config.timezone || 'America/Chicago';
      var parts = (sched.dailyTime || '08:00').split(':');
      var targetH = parseInt(parts[0]) || 0;
      var targetM = parseInt(parts[1]) || 0;
      var now = new Date();
      var nowInTz = new Date(now.toLocaleString('en-US', {
        timeZone: tz
      }));
      var targetInTz = new Date(nowInTz);
      targetInTz.setHours(targetH, targetM, 0, 0);
      var delay = targetInTz - nowInTz;
      if (delay <= 0) delay += 24 * 60 * 60 * 1000;
      var nextFireAt = Date.now() + delay;
      var t = setTimeout(function () {
        sendScheduledMessage(sched);
        scheduledTimers["delete"](sched.id);
        startScheduleTimer(sched);
      }, delay);
      scheduledTimers.set(sched.id, {
        timer: t,
        nextFireAt: nextFireAt
      });
    };
    scheduleNextDaily();
  } else if (sched.type === 'onetime') {
    var config = loadConfig();
    var tz = config.timezone || 'America/Chicago';
    var localParts = (sched.onetimeAt || '').match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    var delay;
    if (localParts) {
      var now = new Date();
      var nowInTz = new Date(now.toLocaleString('en-US', {
        timeZone: tz
      }));
      var targetInTz = new Date(nowInTz);
      targetInTz.setFullYear(parseInt(localParts[1]), parseInt(localParts[2]) - 1, parseInt(localParts[3]));
      targetInTz.setHours(parseInt(localParts[4]), parseInt(localParts[5]), 0, 0);
      delay = targetInTz - nowInTz;
    } else {
      var target = new Date(sched.onetimeAt);
      delay = target - Date.now();
    }
    if (delay <= 0) return;
    var nextFireAt = Date.now() + delay;
    var t = setTimeout(function () {
      sendScheduledMessage(sched);
      sched.enabled = false;
      db.saveScheduledMessage(sched);
      db.loadScheduledMessages().then(function (dbScheds) {
        cachedSchedules = dbScheds;
        io.emit('scheduled:list', getSchedulesWithNextFire(dbScheds));
      });
    }, delay);
    scheduledTimers.set(sched.id, {
      timer: t,
      nextFireAt: nextFireAt
    });
  }
}
function startAllSchedules() {
  var scheds = getSchedules();
  scheds.forEach(function (sched) {
    startScheduleTimer(sched);
  });
  if (scheds.length > 0) {
    console.log('[Scheduled] Started ' + scheds.length + ' schedule(s)');
  }
}
function stopAllSchedules() {
  scheduledTimers.forEach(function (entry, id) {
    clearScheduleTimer(id);
  });
}
function setCachedSchedules(scheds) {
  cachedSchedules = scheds;
}
function init(deps) {
  db = deps.db;
  io = deps.io;
  Packet = deps.Packet;
  getPrimaryBot = deps.getPrimaryBot;
  botsMap = deps.bots;
  loadConfig = deps.loadConfig;
}
module.exports = {
  init: init,
  getSchedules: getSchedules,
  getSchedulesWithNextFire: getSchedulesWithNextFire,
  clearScheduleTimer: clearScheduleTimer,
  startScheduleTimer: startScheduleTimer,
  startAllSchedules: startAllSchedules,
  stopAllSchedules: stopAllSchedules,
  setCachedSchedules: setCachedSchedules,
  sendScheduledMessage: sendScheduledMessage
};