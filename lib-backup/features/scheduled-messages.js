"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSchedules = getSchedules;
exports.getSchedulesWithNextFire = getSchedulesWithNextFire;
exports.sendScheduledMessage = sendScheduledMessage;
exports.clearScheduleTimer = clearScheduleTimer;
exports.startScheduleTimer = startScheduleTimer;
exports.startAllSchedules = startAllSchedules;
exports.stopAllSchedules = stopAllSchedules;
exports.setCachedSchedules = setCachedSchedules;
exports.init = init;
// ── Scheduled Messages Engine ──────────────────────────────────────
const message_utils_1 = require("./message-utils");
let db = null;
let io = null;
let Packet = null;
let getPrimaryBot = null;
let botsMap = null;
let loadConfig = null;
const scheduledTimers = new Map();
let cachedSchedules = [];
const SCHEDULED_SAY_MAX = 64;
const SCHEDULED_WHISPER_MAX = 64;
function getSchedules() {
    return cachedSchedules;
}
function getSchedulesWithNextFire(schedList) {
    const list = schedList || getSchedules();
    return list.map(function (s) {
        const entry = scheduledTimers.get(s.id);
        const copy = Object.assign({}, s);
        if (entry && entry.nextFireAt) {
            copy.nextFireAt = entry.nextFireAt;
        }
        return copy;
    });
}
function sendScheduledMessage(sched) {
    let bot = null;
    if (sched.botId && sched.botId !== 'primary') {
        bot = botsMap.get(sched.botId);
    }
    if (!bot)
        bot = getPrimaryBot();
    const now = Date.now();
    const success = !!(bot && bot.client && bot.state.status === 'logged_in');
    if (success) {
        if (sched.messageType === 'whisper' && sched.whisperTarget) {
            const chunks = (0, message_utils_1.splitMessage)(sched.message, SCHEDULED_WHISPER_MAX);
            chunks.forEach(function (chunk, i) {
                setTimeout(function () {
                    const p = new Packet(0x19);
                    p.writeString8(sched.whisperTarget);
                    p.writeString8(chunk);
                    bot.client.send(p);
                }, i * 500);
            });
        }
        else {
            const chunks = (0, message_utils_1.splitMessage)(sched.message, SCHEDULED_SAY_MAX);
            chunks.forEach(function (chunk, i) {
                setTimeout(function () {
                    const p = new Packet(0x0E);
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
    io.emit('scheduled:fired', { id: sched.id, name: sched.name, timestamp: now, success: success });
    db.loadScheduledMessages().then(function (dbScheds) {
        io.emit('scheduled:list', getSchedulesWithNextFire(dbScheds));
    });
}
function clearScheduleTimer(id) {
    const entry = scheduledTimers.get(id);
    if (entry && entry.timer) {
        clearInterval(entry.timer);
        clearTimeout(entry.timer);
    }
    scheduledTimers.delete(id);
}
function startScheduleTimer(sched) {
    clearScheduleTimer(sched.id);
    if (!sched.enabled)
        return;
    if (sched.type === 'interval') {
        const ms = (sched.interval || 30) * 60 * 1000;
        const nextFireAt = Date.now() + ms;
        const timer = setInterval(function () {
            sendScheduledMessage(sched);
            const entry = scheduledTimers.get(sched.id);
            if (entry)
                entry.nextFireAt = Date.now() + ms;
        }, ms);
        scheduledTimers.set(sched.id, { timer: timer, nextFireAt: nextFireAt });
    }
    else if (sched.type === 'daily') {
        function scheduleNextDaily() {
            const config = loadConfig();
            const tz = config.timezone || 'America/Chicago';
            const parts = (sched.dailyTime || '08:00').split(':');
            const targetH = parseInt(parts[0]) || 0;
            const targetM = parseInt(parts[1]) || 0;
            const now = new Date();
            const nowInTz = new Date(now.toLocaleString('en-US', { timeZone: tz }));
            const targetInTz = new Date(nowInTz);
            targetInTz.setHours(targetH, targetM, 0, 0);
            let delay = targetInTz.getTime() - nowInTz.getTime();
            if (delay <= 0)
                delay += 24 * 60 * 60 * 1000;
            const nextFireAt = Date.now() + delay;
            const t = setTimeout(function () {
                sendScheduledMessage(sched);
                scheduledTimers.delete(sched.id);
                startScheduleTimer(sched);
            }, delay);
            scheduledTimers.set(sched.id, { timer: t, nextFireAt: nextFireAt });
        }
        scheduleNextDaily();
    }
    else if (sched.type === 'onetime') {
        const config = loadConfig();
        const tz = config.timezone || 'America/Chicago';
        const localParts = (sched.onetimeAt || '').match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
        let delay;
        if (localParts) {
            const now = new Date();
            const nowInTz = new Date(now.toLocaleString('en-US', { timeZone: tz }));
            const targetInTz = new Date(nowInTz);
            targetInTz.setFullYear(parseInt(localParts[1]), parseInt(localParts[2]) - 1, parseInt(localParts[3]));
            targetInTz.setHours(parseInt(localParts[4]), parseInt(localParts[5]), 0, 0);
            delay = targetInTz.getTime() - nowInTz.getTime();
        }
        else {
            const target = new Date(sched.onetimeAt);
            delay = target.getTime() - Date.now();
        }
        if (delay <= 0)
            return;
        const nextFireAt = Date.now() + delay;
        const t = setTimeout(function () {
            sendScheduledMessage(sched);
            sched.enabled = false;
            db.saveScheduledMessage(sched);
            db.loadScheduledMessages().then(function (dbScheds) {
                cachedSchedules = dbScheds;
                io.emit('scheduled:list', getSchedulesWithNextFire(dbScheds));
            });
        }, delay);
        scheduledTimers.set(sched.id, { timer: t, nextFireAt: nextFireAt });
    }
}
function startAllSchedules() {
    const scheds = getSchedules();
    scheds.forEach(function (sched) {
        startScheduleTimer(sched);
    });
    if (scheds.length > 0) {
        console.log('[Scheduled] Started ' + scheds.length + ' schedule(s)');
    }
}
function stopAllSchedules() {
    scheduledTimers.forEach(function (_entry, id) {
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
//# sourceMappingURL=scheduled-messages.js.map