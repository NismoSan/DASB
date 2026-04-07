"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordSighting = recordSighting;
exports.updatePlayerAppearance = updatePlayerAppearance;
exports.updatePlayerRecord = updatePlayerRecord;
exports.getPlayerDetail = getPlayerDetail;
exports.getAllPlayers = getAllPlayers;
exports.parseUserList = parseUserList;
exports.parseOtherProfile = parseOtherProfile;
exports.canRequestProfile = canRequestProfile;
exports.markProfileFailed = markProfileFailed;
exports.wipeAll = wipeAll;
exports.clearAppearances = clearAppearances;
exports.getOnlineUsers = getOnlineUsers;
exports.getLastUserListPulse = getLastUserListPulse;
exports.getPlayerDB = getPlayerDB;
exports.loadFromDB = loadFromDB;
exports.init = init;
// ── Player Tracking Module ──────────────────────────────────────────
const iconv_lite_1 = __importDefault(require("iconv-lite"));
const opcodes_1 = require("../core/opcodes");
let db = null;
let io = null;
// In-memory player database
let playerDB = {};
let onlineUsers = [];
let onlineUserCount = 0;
let lastUserListPulse = null;
let previousOnlineSet = {};
// Legend marks
const PROFILE_REQUEST_COOLDOWN = 24 * 60 * 60 * 1000;
let profileFailedAttempts = {};
const DA_CLASS_SET = {};
['Peasant', 'Warrior', 'Wizard', 'Priest', 'Monk', 'Rogue', 'Master', 'Gladiator', 'Summoner', 'Bard', 'Druid', 'Archer'].forEach(function (c) {
    DA_CLASS_SET[c] = true;
});
// Debounced live push
let playerListPushTimer = null;
function pushPlayerListLive() {
    if (playerListPushTimer)
        return;
    playerListPushTimer = setTimeout(function () {
        playerListPushTimer = null;
        if (io)
            io.emit('players:list', getAllPlayers());
    }, 3000);
}
function recordSighting(name, source) {
    if (!name)
        return;
    db.addSighting(name, source || 'sighting');
    updatePlayerRecord(name, { lastSeen: new Date().toISOString(), source: source || 'sighting' });
}
function updatePlayerAppearance(name, spriteData) {
    if (!name || !spriteData)
        return;
    const key = name.toLowerCase();
    const record = playerDB[key];
    if (!record)
        return;
    record.appearance = spriteData;
    record.lastAppearanceUpdate = new Date().toISOString();
    db.upsertPlayerAppearance(name, spriteData);
    // Emit immediate per-player appearance update so panel can refresh sprite
    if (io)
        io.emit('player:appearanceUpdate', { name: name, appearance: spriteData, lastAppearanceUpdate: record.lastAppearanceUpdate });
    pushPlayerListLive();
}
function updatePlayerRecord(name, data) {
    if (!name)
        return;
    const key = name.toLowerCase();
    const now = new Date().toISOString();
    let record = playerDB[key];
    if (!record) {
        record = {
            name: name,
            className: '',
            classId: -1,
            title: '',
            isMaster: false,
            firstSeen: now,
            lastSeen: now,
            userListSightings: []
        };
        playerDB[key] = record;
    }
    record.name = name;
    record.lastSeen = data.lastSeen || now;
    if (data.className)
        record.className = data.className;
    if (data.classId !== undefined && data.classId >= 0)
        record.classId = data.classId;
    if (data.title !== undefined)
        record.title = data.title;
    if (data.isMaster !== undefined)
        record.isMaster = data.isMaster;
    if (data.source === 'userlist') {
        record.userListSightings.push(now);
        if (record.userListSightings.length > 500) {
            record.userListSightings = record.userListSightings.slice(-500);
        }
    }
    if (data.source === 'legend' && data.legends) {
        if (data.legendClassName)
            record.legendClassName = data.legendClassName;
        if (data.groupName)
            record.groupName = data.groupName;
        const newLegendsJson = JSON.stringify(data.legends);
        const oldLegendsJson = record.legends ? JSON.stringify(record.legends) : '';
        if (newLegendsJson !== oldLegendsJson) {
            if (record.legends && record.legends.length > 0) {
                if (!record.legendHistory)
                    record.legendHistory = [];
                record.legendHistory.push({
                    timestamp: record.lastLegendUpdate || now,
                    legends: record.legends
                });
                if (record.legendHistory.length > 20) {
                    record.legendHistory = record.legendHistory.slice(-20);
                }
                db.addLegendSnapshot(name, record.legends);
            }
            record.legends = data.legends;
            record.lastLegendUpdate = now;
            db.setPlayerLegends(name, data.legends);
            console.log('[Legend] Updated legends for ' + name + ' (' + data.legends.length + ' marks)');
        }
    }
    db.upsertPlayer(name, record);
    pushPlayerListLive();
}
function getPlayerDetail(name, callback) {
    const key = name.toLowerCase();
    const record = playerDB[key] || null;
    db.getChatLogsForPlayer(name, 200).then(function (chatLogs) {
        const result = buildPlayerResult(record, name, chatLogs);
        if (callback)
            callback(result);
    }).catch(function (err) {
        console.error('[PlayerDetail] DB error:', err.message);
        const result = buildPlayerResult(record, name, []);
        if (callback)
            callback(result);
    });
}
function buildPlayerResult(record, name, chatLogs) {
    return {
        name: record ? record.name : name,
        className: record ? record.className : '',
        classId: record ? record.classId : -1,
        title: record ? record.title : '',
        isMaster: record ? record.isMaster : false,
        firstSeen: record ? record.firstSeen : null,
        lastSeen: record ? record.lastSeen : null,
        sessions: record ? (record.sessions || []) : [],
        userListSightings: record ? record.userListSightings : [],
        chatLogs: chatLogs,
        legends: record ? (record.legends || []) : [],
        legendHistory: record ? (record.legendHistory || []) : [],
        lastLegendUpdate: record ? (record.lastLegendUpdate || null) : null,
        legendClassName: record ? (record.legendClassName || '') : '',
        groupName: record ? (record.groupName || '') : '',
        appearance: record ? (record.appearance || null) : null
    };
}
function getAllPlayers() {
    const list = [];
    const keys = Object.keys(playerDB);
    for (let i = 0; i < keys.length; i++) {
        const p = playerDB[keys[i]];
        list.push({
            name: p.name,
            className: p.className,
            title: p.title,
            isMaster: p.isMaster,
            firstSeen: p.firstSeen,
            lastSeen: p.lastSeen,
            sessions: p.sessions || [],
            appearance: p.appearance || null,
            lastAppearanceUpdate: p.lastAppearanceUpdate || null
        });
    }
    list.sort(function (a, b) {
        return new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime();
    });
    return list;
}
function parseUserList(packet) {
    const saved = packet.position;
    const users = [];
    try {
        const totalCount = packet.readUInt16();
        packet.readUInt16();
        for (let i = 0; i < totalCount; i++) {
            if (packet.remainder() < 6)
                break;
            const classByte = packet.readByte();
            const iconByte = packet.readByte();
            const socialStatus = packet.readByte();
            const titleLen = packet.readByte();
            let title = '';
            if (titleLen > 0) {
                if (packet.remainder() < titleLen)
                    break;
                const titleBuf = packet.read(titleLen);
                title = iconv_lite_1.default.decode(Buffer.from(titleBuf), 'win1252').trim();
            }
            const isMaster = packet.readByte();
            const name = packet.readString8();
            if (!name)
                break;
            const classId = classByte & 0x0F;
            let className = opcodes_1.CLASS_NAMES[classId] || 'Unknown';
            if (isMaster && classId > 0)
                className = 'Master ' + className;
            users.push({
                name: name,
                className: className,
                classId: classId,
                title: title || '',
                isMaster: isMaster === 1,
                socialStatus: socialStatus,
                iconByte: iconByte
            });
        }
        onlineUsers = users;
        onlineUserCount = users.length;
        lastUserListPulse = Date.now();
        const currentOnlineSet = {};
        for (let j = 0; j < users.length; j++) {
            currentOnlineSet[users[j].name.toLowerCase()] = true;
        }
        const now = new Date().toISOString();
        for (let j = 0; j < users.length; j++) {
            const u = users[j];
            const key = u.name.toLowerCase();
            recordSighting(u.name, 'userlist');
            updatePlayerRecord(u.name, {
                className: u.className,
                classId: u.classId,
                title: u.title,
                isMaster: u.isMaster,
                source: 'userlist'
            });
            if (!previousOnlineSet[key]) {
                const rec = playerDB[key];
                if (rec) {
                    if (!rec.sessions)
                        rec.sessions = [];
                    rec.sessions.push({ appeared: now, disappeared: null });
                    if (rec.sessions.length > 200) {
                        rec.sessions = rec.sessions.slice(-200);
                    }
                    db.addPlayerSession(u.name, now);
                }
            }
        }
        const prevKeys = Object.keys(previousOnlineSet);
        for (let k = 0; k < prevKeys.length; k++) {
            const pkey = prevKeys[k];
            if (!currentOnlineSet[pkey]) {
                const rec = playerDB[pkey];
                if (rec && rec.sessions && rec.sessions.length > 0) {
                    const lastSession = rec.sessions[rec.sessions.length - 1];
                    if (!lastSession.disappeared) {
                        lastSession.disappeared = now;
                    }
                }
                db.endPlayerSession(rec ? rec.name : pkey, now);
                db.upsertPlayer(pkey, playerDB[pkey]);
            }
        }
        previousOnlineSet = currentOnlineSet;
    }
    catch (e) {
        console.error('[UserList] Parse error:', e.message);
    }
    packet.position = saved;
    return users;
}
// Legend profile parsing
function findClassInBody(body, startPos, maxScan) {
    for (let off = 0; off < maxScan; off++) {
        const lenPos = startPos + off;
        if (lenPos + 1 >= body.length)
            return null;
        const len = body[lenPos];
        if (len < 4 || len > 9)
            continue;
        if (lenPos + 1 + len > body.length)
            continue;
        const buf = body.slice(lenPos + 1, lenPos + 1 + len);
        const str = iconv_lite_1.default.decode(Buffer.from(buf), 'win1252');
        if (DA_CLASS_SET[str]) {
            return { absPos: lenPos, className: str };
        }
    }
    return null;
}
function parseOtherProfile(packet, knownName) {
    const saved = packet.position;
    try {
        if (packet.remainder() < 20) {
            packet.position = saved;
            return null;
        }
        const serial = packet.readUInt32();
        const nameBytes = knownName ? Array.from(iconv_lite_1.default.encode(knownName, 'win1252')) : null;
        let classAbsPos = -1;
        let nameAbsPos = -1;
        const scanLimit = Math.min(packet.remainder(), 120);
        if (nameBytes && nameBytes.length > 0) {
            for (let scan = 0; scan < scanLimit; scan++) {
                const pos = packet.position + scan;
                if (pos + 1 + nameBytes.length > packet.body.length)
                    break;
                if (packet.body[pos] === nameBytes.length) {
                    let match = true;
                    for (let ch = 0; ch < nameBytes.length; ch++) {
                        if (packet.body[pos + 1 + ch] !== nameBytes[ch]) {
                            match = false;
                            break;
                        }
                    }
                    if (match) {
                        const nameEndPos = pos + 1 + nameBytes.length;
                        const classResult = findClassInBody(packet.body, nameEndPos, 40);
                        if (classResult) {
                            nameAbsPos = pos;
                            classAbsPos = classResult.absPos;
                            break;
                        }
                    }
                }
            }
        }
        if (nameAbsPos < 0) {
            packet.position = saved;
            return null;
        }
        packet.position = nameAbsPos;
        const name = packet.readString8();
        if (!name) {
            packet.position = saved;
            return null;
        }
        packet.position = classAbsPos;
        const className = packet.readString8();
        const groupName = packet.readString8();
        if (packet.remainder() < 1) {
            packet.position = saved;
            return null;
        }
        const legendCount = packet.readByte();
        const legends = [];
        for (let i = 0; i < legendCount; i++) {
            if (packet.remainder() < 4)
                break;
            const icon = packet.readByte();
            const color = packet.readByte();
            const key = packet.readString8();
            const text = packet.readString8();
            if (key || text) {
                legends.push({ icon: icon, color: color, key: key, text: text });
            }
        }
        packet.position = saved;
        return { serial: serial, name: name, className: className, groupName: groupName, legends: legends };
    }
    catch (e) {
        packet.position = saved;
        return null;
    }
}
function canRequestProfile(playerName) {
    if (!playerName)
        return false;
    const key = playerName.toLowerCase();
    const now = Date.now();
    const record = playerDB[key];
    if (record && record.lastLegendUpdate) {
        const lastUpdate = new Date(record.lastLegendUpdate).getTime();
        if (!isNaN(lastUpdate) && (now - lastUpdate) < PROFILE_REQUEST_COOLDOWN)
            return false;
    }
    const lastFail = profileFailedAttempts[key];
    if (lastFail && (now - lastFail) < 3600000)
        return false;
    return true;
}
function markProfileFailed(playerName) {
    if (playerName)
        profileFailedAttempts[playerName.toLowerCase()] = Date.now();
}
function wipeAll() {
    playerDB = {};
    previousOnlineSet = {};
    profileFailedAttempts = {};
    return db.clearAllPlayerData().then(function () {
        console.log('[Wipe] All player data wiped');
    });
}
function clearAppearances() {
    const keys = Object.keys(playerDB);
    for (let i = 0; i < keys.length; i++) {
        if (playerDB[keys[i]]) {
            playerDB[keys[i]].appearance = null;
        }
    }
    return db.clearAllAppearances();
}
function getOnlineUsers() { return onlineUsers; }
function getLastUserListPulse() { return lastUserListPulse; }
function getPlayerDB() { return playerDB; }
function loadFromDB() {
    return db.getAllPlayers().then(function (rows) {
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            playerDB[r.name_lower] = {
                name: r.name,
                className: r.class_name || '',
                classId: r.class_id !== undefined ? r.class_id : -1,
                title: r.title || '',
                isMaster: r.is_master || false,
                firstSeen: r.first_seen ? r.first_seen.toISOString() : null,
                lastSeen: r.last_seen ? r.last_seen.toISOString() : null,
                userListSightings: [],
                sessions: [],
                legendClassName: r.legend_class_name || '',
                groupName: r.group_name || '',
                lastLegendUpdate: r.last_legend_update ? r.last_legend_update.toISOString() : null
            };
        }
        console.log('[DB] Loaded ' + rows.length + ' players');
    }).then(function () {
        return db.getAllPlayerSessions().then(function (sessionsByPlayer) {
            const keys = Object.keys(sessionsByPlayer);
            for (let i = 0; i < keys.length; i++) {
                if (playerDB[keys[i]])
                    playerDB[keys[i]].sessions = sessionsByPlayer[keys[i]];
            }
            console.log('[DB] Loaded sessions for ' + keys.length + ' players');
        });
    }).then(function () {
        return db.getAllUserListSightings().then(function (sightingsByPlayer) {
            const keys = Object.keys(sightingsByPlayer);
            for (let i = 0; i < keys.length; i++) {
                if (playerDB[keys[i]]) {
                    let sightings = sightingsByPlayer[keys[i]].reverse();
                    if (sightings.length > 500)
                        sightings = sightings.slice(-500);
                    playerDB[keys[i]].userListSightings = sightings;
                }
            }
            console.log('[DB] Loaded userlist sightings for ' + keys.length + ' players');
        });
    }).then(function () {
        return db.getAllPlayerLegends().then(function (legendsByPlayer) {
            const keys = Object.keys(legendsByPlayer);
            for (let i = 0; i < keys.length; i++) {
                if (playerDB[keys[i]])
                    playerDB[keys[i]].legends = legendsByPlayer[keys[i]];
            }
            console.log('[DB] Loaded legends for ' + keys.length + ' players');
        });
    }).then(function () {
        return db.getAllLegendHistory().then(function (historyByPlayer) {
            const keys = Object.keys(historyByPlayer);
            for (let i = 0; i < keys.length; i++) {
                if (playerDB[keys[i]])
                    playerDB[keys[i]].legendHistory = historyByPlayer[keys[i]];
            }
            console.log('[DB] Loaded legend history for ' + keys.length + ' players');
        });
    }).then(function () {
        return db.getAllPlayerAppearances().then(function (appearancesByPlayer) {
            const keys = Object.keys(appearancesByPlayer);
            for (let i = 0; i < keys.length; i++) {
                if (playerDB[keys[i]])
                    playerDB[keys[i]].appearance = appearancesByPlayer[keys[i]];
            }
            console.log('[DB] Loaded appearances for ' + keys.length + ' players');
        });
    });
}
function init(deps) {
    db = deps.db;
    io = deps.io;
}
//# sourceMappingURL=player-tracker.js.map