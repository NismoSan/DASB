import Packet from '../../core/packet';
import type ProxyServer from '../../proxy/proxy-server';
import type ProxySession from '../../proxy/proxy-session';
import type ChatInjector from '../../proxy/augmentation/chat-injector';
import { getActiveMonster, updateMonster } from './monster-db';
import { getCompanion, refreshCompanion } from './companion';
import { calculateXpToNext } from './species-data';
import { monsterDanger, monsterNotice, monsterSuccess } from './message-style';

interface TrainingSession {
    session: ProxySession;
    xpIntervalId: ReturnType<typeof setInterval>;
    animIntervalId: ReturnType<typeof setInterval>;
    startedAt: number;
    totalXpGained: number;
    monsterId: number;
}

const trainingSessions = new Map<string, TrainingSession>();

let _proxy: ProxyServer;
let _chat: ChatInjector;

export function initTraining(proxy: ProxyServer, chat: ChatInjector): void {
    _proxy = proxy;
    _chat = chat;
}

export async function toggleTraining(session: ProxySession): Promise<void> {
    if (trainingSessions.has(session.id)) {
        stopTraining(session.id, 'manual');
        return;
    }

    const monster = await getActiveMonster(session.characterName);
    if (!monster) {
        _chat.systemMessage(session, monsterDanger('No active monster to train.'));
        return;
    }

    const companion = getCompanion(session.id);
    if (!companion) {
        _chat.systemMessage(session, monsterDanger('Summon your companion first with /companion.'));
        return;
    }

    const { isInBattle } = require('./battle-engine') as typeof import('./battle-engine');
    if (isInBattle(session.id)) {
        _chat.systemMessage(session, monsterDanger("Can't train during a battle."));
        return;
    }

    const xpIntervalId = setInterval(() => {
        trainingTick(session).catch(() => undefined);
    }, 10_000);

    const animIntervalId = setInterval(() => {
        const comp = getCompanion(session.id);
        if (comp) sendTrainingAnimation(session, comp.serial);
    }, 2_000);

    trainingSessions.set(session.id, {
        session,
        xpIntervalId,
        animIntervalId,
        startedAt: Date.now(),
        totalXpGained: 0,
        monsterId: monster.id,
    });

    _chat.systemMessage(session, monsterSuccess(`${monster.nickname} is now training! Type /train to stop.`));
    sendTrainingAnimation(session, companion.serial);
}

export function stopTraining(sessionId: string, reason: string = 'manual'): void {
    const ts = trainingSessions.get(sessionId);
    if (!ts) return;

    clearInterval(ts.xpIntervalId);
    clearInterval(ts.animIntervalId);
    trainingSessions.delete(sessionId);

    if (reason !== 'disconnect' && !ts.session.destroyed) {
        const elapsed = Math.floor((Date.now() - ts.startedAt) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        _chat.systemMessage(
            ts.session,
            monsterNotice(`Training stopped. ${ts.totalXpGained} XP gained over ${minutes}m ${seconds}s.`),
        );
    }
}

export function onTrainingSessionEnd(sessionId: string): void {
    stopTraining(sessionId, 'disconnect');
}

export function isTraining(sessionId: string): boolean {
    return trainingSessions.has(sessionId);
}

async function trainingTick(session: ProxySession): Promise<void> {
    const ts = trainingSessions.get(session.id);
    if (!ts) return;

    const companion = getCompanion(session.id);
    if (!companion) {
        stopTraining(session.id, 'companion_gone');
        return;
    }

    const { isInBattle } = require('./battle-engine') as typeof import('./battle-engine');
    if (isInBattle(session.id)) {
        stopTraining(session.id, 'battle');
        return;
    }

    const monster = await getActiveMonster(session.characterName);
    if (!monster || monster.id !== ts.monsterId) {
        stopTraining(session.id, 'monster_changed');
        return;
    }

    const xpGain = 3 + Math.floor(Math.random() * 3);
    monster.xp += xpGain;
    ts.totalXpGained += xpGain;

    let leveled = false;
    while (monster.xp >= monster.xpToNext) {
        monster.xp -= monster.xpToNext;
        monster.level += 1;
        monster.xpToNext = calculateXpToNext(monster.level);
        leveled = true;
    }

    await updateMonster(monster);

    _chat.systemMessage(session, monsterSuccess(`${monster.nickname} trains! +${xpGain} XP (${monster.xp}/${monster.xpToNext})`));

    if (leveled) {
        _chat.systemMessage(session, monsterSuccess(`${monster.nickname} grew to level ${monster.level}!`));
        await refreshCompanion(session);
    }
}

function sendTrainingAnimation(session: ProxySession, targetSerial: number): void {
    const pkt = new Packet(0x29);
    pkt.writeUInt32(targetSerial);
    pkt.writeUInt32(targetSerial);
    pkt.writeUInt16(50);
    pkt.writeUInt16(0);
    pkt.writeUInt16(150);
    _proxy.sendToClient(session, pkt);
}
