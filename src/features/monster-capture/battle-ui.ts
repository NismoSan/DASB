import Packet from '../../core/packet';
import type ProxyServer from '../../proxy/proxy-server';
import type ProxySession from '../../proxy/proxy-session';
import type NpcInjector from '../../proxy/augmentation/npc-injector';
import type DialogHandler from '../../proxy/augmentation/dialog-handler';
import type ChatInjector from '../../proxy/augmentation/chat-injector';
import type PlayerRegistry from '../../proxy/player-registry';
import {
    createPvpBattle,
    createTrainerBattle,
    createWildBattle,
    finishBattle,
    getBattle,
    isInBattle,
    submitMove,
    type RoundResult,
    type TurnResult,
} from './battle-engine';
import { getActiveMonster } from './monster-db';
import { getMove, getSpeciesByName } from './species-data';
import { clearEncounter, getActiveEncounter, isEncounterNearby } from './encounter';
import { getCompanion, refreshCompanion } from './companion';
import { monsterDanger, monsterNotice, monsterSuccess } from './message-style';
import type {
    BattleAction,
    BattleChallenge,
    BattleEndReason,
    BattleMetadata,
    BattlePromptState,
    BattleSide,
    BattleState,
    CapturedMonster,
    MonsterCaptureConfig,
} from './types';
import { getSessionWorldView, getWorldDistance } from './world-view';

const BATTLE_VIEW_RANGE = 15;
const MENU_ACTIONS_PER_ROUND = 5;
const MAX_ROUND_PURSUIT_BUCKETS = 50;

let _proxy: ProxyServer;
let _npcInjector: NpcInjector;
let _dialogHandler: DialogHandler;
let _chat: ChatInjector;
let _registry: PlayerRegistry;
let _config: MonsterCaptureConfig;

const challenges = new Map<string, BattleChallenge>();
const promptStates = new Map<string, BattlePromptState>();
const battleEnds = new Map<string, Promise<void>>();

export function initBattleUI(
    proxy: ProxyServer,
    npcInjector: NpcInjector,
    dialogHandler: DialogHandler,
    chat: ChatInjector,
    registry: PlayerRegistry,
    config: MonsterCaptureConfig,
): void {
    _proxy = proxy;
    _npcInjector = npcInjector;
    _dialogHandler = dialogHandler;
    _chat = chat;
    _registry = registry;
    _config = config;
}

export async function challengePlayer(session: ProxySession, targetName: string): Promise<void> {
    if (isInBattle(session.id)) {
        _chat.systemMessage(session, monsterDanger('You are already in a battle!'));
        return;
    }

    const myMonster = await getActiveMonster(session.characterName);
    if (!isBattleReadyMonster(myMonster)) {
        _chat.systemMessage(session, monsterDanger('You need a conscious active monster to battle! Use /active <slot> first.'));
        return;
    }

    const targetPlayer = _registry.getAllPlayers().find(
        player => player.characterName.toLowerCase() === targetName.toLowerCase(),
    );
    if (!targetPlayer) {
        _chat.systemMessage(session, monsterDanger(`Player "${targetName}" not found on proxy.`));
        return;
    }

    if (targetPlayer.sessionId === session.id) {
        _chat.systemMessage(session, monsterDanger('You cannot challenge yourself.'));
        return;
    }

    const targetSession = _proxy.sessions.get(targetPlayer.sessionId);
    if (!targetSession || targetSession.destroyed) {
        _chat.systemMessage(session, monsterDanger(`Player "${targetName}" session not found.`));
        return;
    }

    if (isInBattle(targetSession.id)) {
        _chat.systemMessage(session, monsterDanger(`${targetSession.characterName} is already in a battle!`));
        return;
    }

    const targetMonster = await getActiveMonster(targetSession.characterName);
    if (!isBattleReadyMonster(targetMonster)) {
        _chat.systemMessage(session, monsterDanger(`${targetSession.characterName} does not have a conscious active monster.`));
        return;
    }

    const locationIssue = getBattleLocationIssue(session, targetSession);
    if (locationIssue) {
        _chat.systemMessage(session, monsterDanger(locationIssue));
        return;
    }

    const league = getLeagueModule();
    const rankedMetadata = league?.getLeaguePvpMetadata
        ? await league.getLeaguePvpMetadata(session, targetSession)
        : null;

    challenges.set(targetSession.id, {
        challengerSessionId: session.id,
        challengerName: session.characterName,
        targetSessionId: targetSession.id,
        targetName: targetSession.characterName,
        timestamp: Date.now(),
    });

    _chat.systemMessage(session, monsterSuccess(`Challenge sent to ${targetSession.characterName}!`));
    _chat.systemMessage(
        targetSession,
        monsterNotice(`${session.characterName} challenges you to a monster battle! Type /accept or /decline`),
    );

    setTimeout(() => {
        const pending = challenges.get(targetSession.id);
        if (!pending || pending.challengerSessionId !== session.id) {
            return;
        }

        challenges.delete(targetSession.id);
        if (!session.destroyed) {
            _chat.systemMessage(session, monsterDanger(`Challenge to ${targetSession.characterName} expired.`));
        }
        if (!targetSession.destroyed) {
            _chat.systemMessage(targetSession, monsterDanger(`${session.characterName}'s monster battle challenge expired.`));
        }
    }, 60_000);
}

export async function acceptChallenge(session: ProxySession): Promise<void> {
    const challenge = challenges.get(session.id);
    if (!challenge) {
        _chat.systemMessage(session, monsterDanger('No pending battle challenge.'));
        return;
    }

    challenges.delete(session.id);

    if (isInBattle(session.id)) {
        _chat.systemMessage(session, monsterDanger('You are already in a battle!'));
        return;
    }

    const myMonster = await getActiveMonster(session.characterName);
    if (!isBattleReadyMonster(myMonster)) {
        _chat.systemMessage(session, monsterDanger('You need a conscious active monster! Use /active <slot> first.'));
        return;
    }

    const challengerSession = _proxy.sessions.get(challenge.challengerSessionId);
    if (!challengerSession || challengerSession.destroyed) {
        _chat.systemMessage(session, monsterDanger('Challenger is no longer connected.'));
        return;
    }

    if (isInBattle(challenge.challengerSessionId)) {
        _chat.systemMessage(session, monsterDanger('Challenger is already in another battle.'));
        return;
    }

    const challengerMonster = await getActiveMonster(challengerSession.characterName);
    if (!isBattleReadyMonster(challengerMonster)) {
        _chat.systemMessage(session, monsterDanger('Challenger no longer has a conscious active monster.'));
        _chat.systemMessage(challengerSession, monsterDanger('Your monster battle challenge could not start because your active monster is not ready.'));
        return;
    }

    const locationIssue = getBattleLocationIssue(challengerSession, session);
    if (locationIssue) {
        _chat.systemMessage(session, monsterDanger('The battle challenge is no longer valid because you are not on the same map and nearby.'));
        _chat.systemMessage(challengerSession, monsterDanger(`${session.characterName} is no longer on the same map and nearby. Challenge canceled.`));
        return;
    }

    const playerAEntity = spawnOrReuseBattleMonster(challengerSession, challenge.challengerSessionId, challengerMonster, 1);
    const playerBEntity = spawnOrReuseBattleMonster(session, session.id, myMonster, 3);
    const league = getLeagueModule();
    const rankedMetadata = league?.getLeaguePvpMetadata
        ? await league.getLeaguePvpMetadata(challengerSession, session)
        : null;
    const battle = createPvpBattle(
        challenge.challengerSessionId,
        challengerMonster,
        playerAEntity.serial,
        playerAEntity.x,
        playerAEntity.y,
        session.id,
        myMonster,
        playerBEntity.serial,
        playerBEntity.x,
        playerBEntity.y,
        rankedMetadata || undefined,
    );

    const aHpPercent = getHpPercent(challengerMonster.hp, challengerMonster.maxHp);
    const bHpPercent = getHpPercent(myMonster.hp, myMonster.maxHp);
    sendHealthBar(challengerSession, playerAEntity.serial, aHpPercent);
    sendHealthBar(challengerSession, playerBEntity.serial, bHpPercent);
    sendHealthBar(session, playerAEntity.serial, aHpPercent);
    sendHealthBar(session, playerBEntity.serial, bHpPercent);

    _chat.systemMessage(challengerSession, monsterNotice(`Battle started! ${challengerMonster.nickname} vs ${myMonster.nickname}`));
    _chat.systemMessage(session, monsterNotice(`Battle started! ${myMonster.nickname} vs ${challengerMonster.nickname}`));

    promptMoveSelection(challengerSession, battle, 'a');
    promptMoveSelection(session, battle, 'b');
}

export function declineChallenge(session: ProxySession): void {
    const challenge = challenges.get(session.id);
    if (!challenge) {
        _chat.systemMessage(session, monsterDanger('No pending battle challenge.'));
        return;
    }

    challenges.delete(session.id);
    _chat.systemMessage(session, monsterNotice('Challenge declined.'));

    const challengerSession = _proxy.sessions.get(challenge.challengerSessionId);
    if (challengerSession && !challengerSession.destroyed) {
        _chat.systemMessage(challengerSession, monsterDanger(`${session.characterName} declined your challenge.`));
    }
}

export async function startWildBattle(session: ProxySession): Promise<void> {
    if (isInBattle(session.id)) {
        _chat.systemMessage(session, monsterDanger('You are already in a battle!'));
        return;
    }

    const encounter = getActiveEncounter(session.id);
    if (!encounter) {
        _chat.systemMessage(session, monsterDanger('No wild monster nearby to fight!'));
        return;
    }

    if (!isEncounterNearby(session, encounter)) {
        clearEncounter(session.id, _npcInjector);
        _chat.systemMessage(session, monsterDanger('No wild monster nearby to fight!'));
        return;
    }

    if (encounter.hp <= 0) {
        clearEncounter(session.id, _npcInjector);
        _chat.systemMessage(session, monsterDanger(`The wild ${encounter.species.name} has already fainted.`));
        return;
    }

    const myMonster = await getActiveMonster(session.characterName);
    if (!isBattleReadyMonster(myMonster)) {
        _chat.systemMessage(session, monsterDanger('You need a conscious active monster! Use /active <slot> first.'));
        return;
    }

    const playerEntity = spawnOrReuseBattleMonster(session, session.id, myMonster, 1, { xOffset: -1, yOffset: 0 });
    const battle = createWildBattle(
        session.id,
        myMonster,
        playerEntity.serial,
        playerEntity.x,
        playerEntity.y,
        encounter,
    );

    sendHealthBar(session, playerEntity.serial, getHpPercent(myMonster.hp, myMonster.maxHp));
    sendHealthBar(session, encounter.serial, getHpPercent(encounter.hp, encounter.maxHp));
    _chat.systemMessage(session, monsterNotice(`Go, ${myMonster.nickname}! Battle against wild ${encounter.species.name}!`));

    promptMoveSelection(session, battle, 'a');
}

export async function startTrainerBattle(
    session: ProxySession,
    trainerName: string,
    trainerMonster: CapturedMonster,
    metadata?: BattleMetadata,
): Promise<BattleState | null> {
    if (isInBattle(session.id)) {
        _chat.systemMessage(session, monsterDanger('You are already in a battle!'));
        return null;
    }

    const myMonster = await getActiveMonster(session.characterName);
    if (!isBattleReadyMonster(myMonster)) {
        _chat.systemMessage(session, monsterDanger('You need a conscious active monster! Use /active <slot> first.'));
        return null;
    }

    const playerEntity = spawnOrReuseBattleMonster(session, session.id, myMonster, 1, { xOffset: -1, yOffset: 0 });
    const trainerEntity = spawnTrainerBattleMonster(session, trainerName, trainerMonster, 3, { xOffset: 2, yOffset: 0 });
    const battle = createTrainerBattle(
        session.id,
        myMonster,
        playerEntity.serial,
        playerEntity.x,
        playerEntity.y,
        trainerName,
        trainerMonster,
        trainerEntity.serial,
        trainerEntity.x,
        trainerEntity.y,
        metadata,
    );

    sendHealthBar(session, playerEntity.serial, getHpPercent(myMonster.hp, myMonster.maxHp));
    sendHealthBar(session, trainerEntity.serial, getHpPercent(trainerMonster.hp, trainerMonster.maxHp));
    _chat.systemMessage(session, monsterNotice(`Battle started! ${myMonster.nickname} vs ${trainerName}'s ${trainerMonster.nickname}`));
    promptMoveSelection(session, battle, 'a');
    return battle;
}

export async function handleForfeit(session: ProxySession): Promise<void> {
    const handled = await endBattleForSession(session.id, 'forfeit', session);
    if (!handled) {
        _chat.systemMessage(session, monsterDanger('You are not in a battle.'));
    }
}

export async function onPlayerMapChange(session: ProxySession): Promise<void> {
    clearChallengesForSession(session.id, `${session.characterName} moved away and the challenge was canceled.`);
    await endBattleForSession(session.id, 'mapChange', session, false);
}

export async function onPlayerTeleport(session: ProxySession): Promise<void> {
    clearChallengesForSession(session.id, `${session.characterName} moved away and the challenge was canceled.`);
    await endBattleForSession(session.id, 'teleport', session, false);
}

export async function onSessionEnd(sessionId: string): Promise<void> {
    clearChallengesForSession(sessionId);
    await endBattleForSession(sessionId, 'disconnect', undefined, false);
    promptStates.delete(sessionId);
}

function promptMoveSelection(session: ProxySession, battle: BattleState, side: BattleSide): void {
    if (battle.ending || battle.ended || battle.winner) {
        return;
    }

    const monster = side === 'a' ? battle.monA.monster : battle.monB!.monster;
    const entityId = side === 'a' ? battle.monA.serial : battle.monB!.serial;
    const currentHp = side === 'a' ? battle.monA.currentHp : battle.monB!.currentHp;
    const availableMoves = getAvailableMoves(monster);
    const roundToken = battle.roundToken;
    const menuActions: BattleAction[] = [];
    const menuPursuitIds: number[] = [];

    const menuOptions = availableMoves.map((entry, displayIndex) => {
        const move = getMove(entry.moveName);
        const pursuitId = encodeBattlePursuitId(roundToken, displayIndex + 1);
        menuActions.push({
            kind: 'move',
            moveIndex: entry.moveIndex,
            moveName: entry.moveName,
        });
        menuPursuitIds.push(pursuitId);
        return {
            text: `${entry.moveName} [${move?.type || '?'}] PWR:${move?.power || 0}`,
            pursuitId,
        };
    });
    const forfeitPursuitId = encodeBattlePursuitId(roundToken, MENU_ACTIONS_PER_ROUND);
    menuActions.push({ kind: 'forfeit' });
    menuPursuitIds.push(forfeitPursuitId);
    menuOptions.push({ text: 'Forfeit', pursuitId: forfeitPursuitId });

    promptStates.set(session.id, {
        sessionId: session.id,
        battleId: battle.id,
        side,
        entityId,
        roundToken,
        promptType: 'move',
        menuActions,
        menuPursuitIds,
        submitted: false,
        chosenAction: null,
    });

    const npc = _npcInjector.getNPC(entityId);
    const sprite = npc?.sprite || getLiveSprite(monster);
    _dialogHandler.sendDialogMenu(session, {
        menuType: 0,
        entityId,
        sprite,
        name: monster.nickname,
        text: `${monster.nickname} (HP: ${currentHp}/${monster.maxHp}) - Choose your move:`,
        menuOptions,
    });

    if (!npc) {
        return;
    }

    npc.onInteract = (interactingSession, event) => {
        if (interactingSession.id !== session.id) {
            return;
        }

        if (event.type === 'menuChoice') {
            void handleBattleMenuChoice(interactingSession, battle, side, entityId, event.pursuitId, event.slot);
            return;
        }

        if (event.type === 'dialogChoice') {
            void handleBattleMenuClose(interactingSession, battle, side, entityId);
        }
    };
}

async function handleBattleMenuChoice(
    session: ProxySession,
    battle: BattleState,
    side: BattleSide,
    entityId: number,
    pursuitId: number,
    slot: number,
): Promise<void> {
    const prompt = getActivePrompt(session.id, battle, side, entityId);
    if (!prompt) {
        return;
    }

    const action = decodeBattleAction(prompt, pursuitId, slot);
    if (!action) {
        return;
    }

    prompt.submitted = true;
    prompt.chosenAction = action;
    promptStates.delete(session.id);
    closeBattlePrompt(session, entityId);

    if (action.kind === 'forfeit') {
        await endBattleForSession(session.id, 'forfeit', session, false);
        return;
    }

    const result = submitMove(battle.id, side, action.moveName);
    if (!result) {
        _chat.systemMessage(session, monsterNotice('Waiting for opponent...'));
        return;
    }

    await renderRound(battle, result);
}

async function handleBattleMenuClose(
    session: ProxySession,
    battle: BattleState,
    side: BattleSide,
    entityId: number,
): Promise<void> {
    const prompt = getActivePrompt(session.id, battle, side, entityId);
    if (!prompt) {
        return;
    }

    prompt.submitted = true;
    prompt.chosenAction = { kind: 'forfeit' };
    promptStates.delete(session.id);
    await endBattleForSession(session.id, 'forfeit', session, false);
}

async function renderRound(battle: BattleState, result: RoundResult): Promise<void> {
    const sessionA = _proxy.sessions.get(battle.trainerA);
    const sessionB = battle.trainerB ? _proxy.sessions.get(battle.trainerB) : null;
    const sessions = [sessionA, sessionB].filter(Boolean) as ProxySession[];

    for (const turn of result.turnResults) {
        if (battle.ending && battle.endReason && battle.endReason !== 'knockout') {
            return;
        }

        const message = formatTurnMessage(turn);
        const meta = resolveBattleMove(turn.moveName);
        const bodyMs = meta.move.category === 'status' ? 350 : 400;
        const effectMs = turn.effectiveness === 'miss' ? 0 : 300;

        for (const liveSession of sessions) {
            if (liveSession.destroyed) {
                continue;
            }

            _chat.systemMessage(liveSession, message);

            if (turn.effectiveness === 'miss') {
                sendBodyAnimation(liveSession, turn.attackerSerial, meta.bodyAnim, 280);
                sendHealthBar(liveSession, turn.defenderSerial, turn.defenderHpPercent, 0xFF);
                continue;
            }

            if (turn.healed) {
                sendBodyAnimation(liveSession, turn.attackerSerial, meta.bodyAnim, bodyMs);
                setTimeout(() => {
                    sendEffect(liveSession, turn.attackerSerial, turn.attackerSerial, meta.targetAnim, meta.sourceAnim, 360);
                }, 200);
                sendHealthBar(liveSession, turn.attackerSerial, turn.defenderHpPercent, 0xFF);
                continue;
            }

            if (turn.damage === 0 && turn.effectiveness === 'immune') {
                sendBodyAnimation(liveSession, turn.attackerSerial, meta.bodyAnim, bodyMs);
                setTimeout(() => {
                    sendEffect(liveSession, turn.defenderSerial, turn.attackerSerial, 6, meta.sourceAnim, 220);
                }, 200);
                sendHealthBar(liveSession, turn.defenderSerial, turn.defenderHpPercent, 0xFF);
                continue;
            }

            if (turn.damage === 0 && meta.move.category === 'status') {
                sendBodyAnimation(liveSession, turn.attackerSerial, meta.bodyAnim, bodyMs);
                const effectTarget = meta.move.targetsSelf ? turn.attackerSerial : turn.defenderSerial;
                setTimeout(() => {
                    sendEffect(liveSession, effectTarget, turn.attackerSerial, meta.targetAnim, meta.sourceAnim, 320);
                }, 200);
                sendHealthBar(liveSession, turn.defenderSerial, turn.defenderHpPercent, 0xFF);
                continue;
            }

            sendBodyAnimation(liveSession, turn.attackerSerial, meta.bodyAnim, bodyMs);
            if (effectMs > 0) {
                setTimeout(() => {
                    sendEffect(liveSession, turn.defenderSerial, turn.attackerSerial, meta.targetAnim, meta.sourceAnim, effectMs);
                }, 200);
            }
            sendHealthBar(liveSession, turn.defenderSerial, turn.defenderHpPercent, turn.damage > 0 ? 1 : 0xFF);
        }

        await delay(800);
    }

    if (result.battleOver && result.winner) {
        await finalizeBattle(battle, result.winner, 'knockout');
        return;
    }

    if (battle.ending || battle.ended || battle.winner) {
        return;
    }

    if (sessionA && !sessionA.destroyed) {
        promptMoveSelection(sessionA, battle, 'a');
    }
    if (sessionB && !sessionB.destroyed) {
        promptMoveSelection(sessionB, battle, 'b');
    }
}

async function endBattleForSession(
    sessionId: string,
    reason: BattleEndReason,
    session?: ProxySession,
    notifyIfMissing = false,
): Promise<boolean> {
    const battle = getBattle(sessionId);
    if (!battle || battle.ended || battle.winner) {
        return false;
    }

    if (battle.ending) {
        const pending = battleEnds.get(battle.id);
        if (pending) {
            await pending;
            return true;
        }
        return false;
    }

    const winner: BattleSide = battle.trainerA === sessionId ? 'b' : 'a';
    await finalizeBattle(battle, winner, reason, session?.id || sessionId);
    return true;
}

function finalizeBattle(
    battle: BattleState,
    winner: BattleSide,
    reason: BattleEndReason,
    sourceSessionId?: string,
): Promise<void> {
    const existing = battleEnds.get(battle.id);
    if (existing) {
        return existing;
    }

    const endPromise = (async () => {
        battle.ending = true;
        battle.active = false;
        battle.endReason = reason;
        battle.winner = winner;

        closeBattlePromptBySession(battle.trainerA);
        if (battle.trainerB) {
            closeBattlePromptBySession(battle.trainerB);
        }

        clearBattleNpcHandlers(battle);

        const sessionA = _proxy.sessions.get(battle.trainerA);
        const sessionB = battle.trainerB ? _proxy.sessions.get(battle.trainerB) : null;
        const loserSessionId = winner === 'a' ? battle.trainerB : battle.trainerA;
        const loserSession = loserSessionId ? _proxy.sessions.get(loserSessionId) : null;

        const { winnerName, loserName } = await finishBattle(battle.id, winner);
        battle.ended = true;

        const league = getLeagueModule();
        if (league?.onBattleFinalized) {
            await league.onBattleFinalized(battle, winner, reason, {
                sessionA,
                sessionB,
                winnerName,
                loserName,
            });
        }

        if (reason === 'knockout' && battle.type === 'wild' && winner === 'a') {
            clearEncounter(battle.trainerA, _npcInjector);
        }

        const participantSessions = [sessionA, sessionB].filter(Boolean) as ProxySession[];
        const endMessage = getBattleEndMessage(battle, winnerName, loserName, reason, loserSession);
        for (const liveSession of participantSessions) {
            if (!liveSession.destroyed) {
                _chat.systemMessage(liveSession, endMessage);
            }
        }

        if (battle.type === 'pvp') {
            const ownerA = sessionA?.characterName || '?';
            const ownerB = sessionB?.characterName || '?';
            const winnerOwner = winner === 'a' ? ownerA : ownerB;
            _chat.broadcast({
                channel: 'world',
                sender: 'DA Monsters',
                message: monsterSuccess(`${winnerOwner}'s ${winnerName} defeated ${loserName} in a monster battle!`),
            });
        }

        cleanupBattleEntities(battle);

        await Promise.all([
            maybeRefreshCompanion(sessionA, sourceSessionId, reason).catch(() => undefined),
            maybeRefreshCompanion(sessionB, sourceSessionId, reason).catch(() => undefined),
        ]);
    })().finally(() => {
        battleEnds.delete(battle.id);
    });

    battleEnds.set(battle.id, endPromise);
    return endPromise;
}

function cleanupBattleEntities(battle: BattleState): void {
    const companionA = getCompanion(battle.trainerA);
    if (!companionA || companionA.serial !== battle.monA.serial) {
        _npcInjector.removeNPC(battle.monA.serial);
    }

    if (battle.monB) {
        const companionB = battle.trainerB ? getCompanion(battle.trainerB) : null;
        if (!companionB || companionB.serial !== battle.monB.serial) {
            _npcInjector.removeNPC(battle.monB.serial);
        }
    }
}

async function maybeRefreshCompanion(
    session: ProxySession | null | undefined,
    sourceSessionId: string | undefined,
    reason: BattleEndReason,
): Promise<void> {
    if (!session || session.destroyed) {
        return;
    }

    if ((reason === 'mapChange' || reason === 'teleport' || reason === 'disconnect') && session.id === sourceSessionId) {
        return;
    }

    await refreshCompanion(session);
}

function closeBattlePromptBySession(sessionId: string): void {
    const prompt = promptStates.get(sessionId);
    if (!prompt) {
        return;
    }

    const session = _proxy.sessions.get(sessionId);
    if (session && !session.destroyed) {
        closeBattlePrompt(session, prompt.entityId);
    }
    promptStates.delete(sessionId);
}

function closeBattlePrompt(session: ProxySession, entityId: number): void {
    const npc = _npcInjector.getNPC(entityId);
    if (npc) {
        _dialogHandler.sendCloseDialog(session, npc);
    }
}

function clearBattleNpcHandlers(battle: BattleState): void {
    const npcA = _npcInjector.getNPC(battle.monA.serial);
    if (npcA) {
        npcA.onInteract = undefined;
    }

    if (battle.monB) {
        const npcB = _npcInjector.getNPC(battle.monB.serial);
        if (npcB) {
            npcB.onInteract = undefined;
        }
    }
}

function getActivePrompt(
    sessionId: string,
    battle: BattleState,
    side: BattleSide,
    entityId: number,
): BattlePromptState | null {
    const prompt = promptStates.get(sessionId);
    if (!prompt) {
        return null;
    }

    if (
        prompt.battleId !== battle.id
        || prompt.side !== side
        || prompt.entityId !== entityId
        || prompt.roundToken !== battle.roundToken
        || prompt.submitted
        || !battle.active
        || battle.ending
        || battle.ended
        || battle.winner
    ) {
        return null;
    }

    return prompt;
}

function decodeBattleAction(
    prompt: BattlePromptState,
    pursuitId: number,
    slot: number,
): BattleAction | null {
    const exactPromptIndex = prompt.menuPursuitIds.indexOf(pursuitId);
    if (exactPromptIndex >= 0) {
        return prompt.menuActions[exactPromptIndex] || null;
    }

    const encodedAction = decodeBattlePursuitId(prompt.roundToken, pursuitId);
    if (encodedAction !== null) {
        return prompt.menuActions[encodedAction - 1] || null;
    }

    if (pursuitId === 99) {
        return { kind: 'forfeit' };
    }

    if (pursuitId >= 1 && pursuitId <= prompt.menuActions.length) {
        return prompt.menuActions[pursuitId - 1] || null;
    }

    if (slot >= 0 && slot < prompt.menuActions.length) {
        return prompt.menuActions[slot] || null;
    }

    return null;
}

function getAvailableMoves(monster: CapturedMonster): Array<{ moveIndex: number; moveName: string }> {
    const moves: Array<{ moveIndex: number; moveName: string }> = [];
    for (let i = 0; i < monster.moves.length; i++) {
        const moveName = monster.moves[i];
        if (moveName) {
            moves.push({ moveIndex: i, moveName });
        }
    }
    return moves;
}

function encodeBattlePursuitId(roundToken: number, actionCode: number): number {
    const bucket = ((roundToken - 1) % MAX_ROUND_PURSUIT_BUCKETS) * MENU_ACTIONS_PER_ROUND;
    return bucket + actionCode;
}

function decodeBattlePursuitId(roundToken: number, pursuitId: number): number | null {
    const bucket = ((roundToken - 1) % MAX_ROUND_PURSUIT_BUCKETS) * MENU_ACTIONS_PER_ROUND;
    const actionCode = pursuitId - bucket;
    if (actionCode >= 1 && actionCode <= MENU_ACTIONS_PER_ROUND) {
        return actionCode;
    }
    return null;
}

function spawnOrReuseBattleMonster(
    session: ProxySession,
    sessionId: string,
    monster: CapturedMonster,
    direction: number,
    fallbackOffset = { xOffset: 2, yOffset: 0 },
): { serial: number; x: number; y: number } {
    const companion = getCompanion(sessionId);
    if (companion) {
        return { serial: companion.serial, x: companion.x, y: companion.y };
    }

    const view = getSessionWorldView(session);
    const x = view.x + fallbackOffset.xOffset;
    const y = view.y + fallbackOffset.yOffset;
    const serial = _npcInjector.placeNPC({
        name: `${monster.nickname} Lv.${monster.level}`,
        sprite: getLiveSprite(monster),
        x,
        y,
        mapNumber: view.mapNumber,
        direction,
        creatureType: 0,
        persistent: false,
        worldScope: view.worldScope,
    });

    return { serial, x, y };
}

function spawnTrainerBattleMonster(
    session: ProxySession,
    trainerName: string,
    monster: CapturedMonster,
    direction: number,
    fallbackOffset = { xOffset: 2, yOffset: 0 },
): { serial: number; x: number; y: number } {
    const view = getSessionWorldView(session);
    const x = view.x + fallbackOffset.xOffset;
    const y = view.y + fallbackOffset.yOffset;
    const serial = _npcInjector.placeNPC({
        name: `${trainerName}'s ${monster.nickname} Lv.${monster.level}`,
        sprite: getLiveSprite(monster),
        x,
        y,
        mapNumber: view.mapNumber,
        direction,
        creatureType: 0,
        persistent: false,
        worldScope: view.worldScope,
    });

    return { serial, x, y };
}

function getLiveSprite(monster: CapturedMonster): number {
    const species = getSpeciesByName(monster.speciesName);
    return species ? species.sprite : monster.sprite;
}

function isBattleReadyMonster(monster: CapturedMonster | null): monster is CapturedMonster {
    return !!monster && monster.hp > 0;
}

function getBattleLocationIssue(challenger: ProxySession, target: ProxySession): string | null {
    const distance = getWorldDistance(challenger, target);
    if (!distance.sameMap) {
        return 'You can only battle players who are on the same map and nearby.';
    }

    if (distance.dx >= BATTLE_VIEW_RANGE || distance.dy >= BATTLE_VIEW_RANGE) {
        return 'You can only battle players who are on the same map and nearby.';
    }

    return null;
}

function getLeagueModule(): {
    getLeaguePvpMetadata?: (challenger: ProxySession, target: ProxySession) => Promise<BattleMetadata | null>;
    onBattleFinalized?: (
        battle: BattleState,
        winner: BattleSide,
        reason: BattleEndReason,
        result: {
            sessionA: ProxySession | null | undefined;
            sessionB: ProxySession | null | undefined;
            winnerName: string;
            loserName: string;
        },
    ) => Promise<void>;
} | null {
    try {
        return require('./league') as typeof import('./league');
    } catch (_err) {
        return null;
    }
}

function clearChallengesForSession(sessionId: string, otherMessage?: string): void {
    for (const [targetSessionId, challenge] of Array.from(challenges.entries())) {
        if (targetSessionId !== sessionId && challenge.challengerSessionId !== sessionId) {
            continue;
        }

        challenges.delete(targetSessionId);

        const otherSessionId = targetSessionId === sessionId ? challenge.challengerSessionId : targetSessionId;
        const otherSession = _proxy.sessions.get(otherSessionId);
        if (otherSession && !otherSession.destroyed && otherMessage) {
            _chat.systemMessage(otherSession, monsterDanger(otherMessage));
        }
    }
}

function resolveBattleMove(moveName: string): {
    move: NonNullable<ReturnType<typeof getMove>>;
    targetAnim: number;
    sourceAnim: number;
    bodyAnim: number;
} {
    const move = getMove(moveName) || getMove('Tackle');
    if (!move) {
        throw new Error('Battle move metadata is missing for Tackle fallback.');
    }

    const targetAnim = move.animationId != null ? move.animationId : 1;
    const sourceAnim = move.sourceAnimationId != null ? move.sourceAnimationId : 0;

    let bodyAnim = 1;
    if (move.bodyAnimationId != null && move.bodyAnimationId >= 0) {
        bodyAnim = move.bodyAnimationId & 0xFF;
    } else if (move.soundId != null && move.soundId > 0) {
        bodyAnim = move.soundId & 0xFF;
    } else if (move.category === 'special') {
        bodyAnim = 136;
    } else if (move.category === 'status') {
        bodyAnim = 6;
    }

    return { move, targetAnim, sourceAnim, bodyAnim };
}

function formatTurnMessage(turn: TurnResult): string {
    if (turn.healed) {
        return monsterSuccess(`${turn.attackerName} used ${turn.moveName}! Healed ${turn.healed} HP!`);
    }

    if (turn.effectiveness === 'miss') {
        return monsterDanger(`${turn.attackerName} used ${turn.moveName}... but it missed!`);
    }

    if (turn.effectiveness === 'immune') {
        return monsterDanger(`${turn.attackerName} used ${turn.moveName}... but it had no effect!`);
    }

    if (turn.damage === 0) {
        return monsterNotice(`${turn.attackerName} used ${turn.moveName}!`);
    }

    let message = `${turn.attackerName} used ${turn.moveName}! ${turn.damage} damage!`;
    if (turn.effectiveness === 'super effective') {
        message += " It's super effective!";
    }
    if (turn.effectiveness === 'not very effective') {
        message += " It's not very effective...";
    }
    if (turn.defenderFainted) {
        message += ` ${turn.defenderName} fainted!`;
    }
    if (turn.defenderFainted) {
        return monsterDanger(message);
    }
    if (turn.effectiveness === 'super effective') {
        return monsterSuccess(message);
    }
    return monsterNotice(message);
}

function getBattleEndMessage(
    battle: BattleState,
    winnerName: string,
    loserName: string,
    reason: BattleEndReason,
    loserSession: ProxySession | null | undefined,
): string {
    if (reason === 'forfeit') {
        const loserLabel = loserSession?.characterName ? `${loserSession.characterName} forfeited.` : `${loserName} forfeited.`;
        return monsterDanger(`Battle over! ${loserLabel} ${winnerName} wins!`);
    }

    if (reason === 'disconnect') {
        return monsterDanger(`Battle over! ${winnerName} wins because the opponent disconnected.`);
    }

    if (reason === 'mapChange' || reason === 'teleport') {
        return monsterDanger(`Battle over! ${winnerName} wins because the opponent left the battle area.`);
    }

    if (battle.type === 'wild' && battle.winner === 'b') {
        return monsterDanger(`Battle over! The wild monster defeated ${loserName}.`);
    }

    return monsterSuccess(`Battle over! ${winnerName} wins!`);
}

function getHpPercent(currentHp: number, maxHp: number): number {
    if (maxHp <= 0) {
        return 0;
    }

    return Math.round((currentHp / maxHp) * 100);
}

function sendHealthBar(session: ProxySession, entitySerial: number, hpPercent: number, sound = 0xFF): void {
    const pkt = new Packet(0x13);
    pkt.writeUInt32(entitySerial);
    pkt.writeByte(0x00);
    pkt.writeByte(Math.max(0, Math.min(100, hpPercent)));
    pkt.writeByte(sound);
    _proxy.sendToClient(session, pkt);
}

function sendBodyAnimation(session: ProxySession, entitySerial: number, animation: number, durationMs: number): void {
    const pkt = new Packet(0x1A);
    pkt.writeUInt32(entitySerial);
    pkt.writeByte(animation);
    pkt.writeUInt16(durationMs);
    pkt.writeByte(0xFF);
    _proxy.sendToClient(session, pkt);
}

function sendEffect(
    session: ProxySession,
    targetSerial: number,
    sourceSerial: number,
    targetAnim: number,
    sourceAnim: number,
    durationMs: number,
): void {
    const pkt = new Packet(0x29);
    pkt.writeUInt32(targetSerial);
    pkt.writeUInt32(sourceSerial);
    pkt.writeUInt16(targetAnim);
    pkt.writeUInt16(sourceAnim);
    pkt.writeUInt16(durationMs);
    _proxy.sendToClient(session, pkt);
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
