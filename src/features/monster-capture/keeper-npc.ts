import type ProxyServer from '../../proxy/proxy-server';
import type ProxySession from '../../proxy/proxy-session';
import type NpcInjector from '../../proxy/augmentation/npc-injector';
import type { DialogEvent, VirtualNPC } from '../../proxy/augmentation/npc-injector';
import DialogHandler, { DialogType } from '../../proxy/augmentation/dialog-handler';
import type ChatInjector from '../../proxy/augmentation/chat-injector';
import type { MonsterCaptureConfig, CapturedMonster } from './types';
import {
    deleteMonster,
    getLeaderboard,
    getMonstersByOwner,
    healMonstersByOwner,
    renameMonster,
    setActiveMonster,
} from './monster-db';
import { getMove, NATURE_MODIFIERS } from './species-data';
import { refreshCompanion } from './companion';
import { isInBattle } from './battle-engine';
import { monsterDanger, monsterSuccess } from './message-style';

interface KeeperDialogState {
    flow: 'main' | 'view' | 'set_active' | 'rename' | 'release_pick' | 'release_confirm' | 'moves';
    monsters: CapturedMonster[];
    selectedIndex: number;
    entityId: number;
}

const dialogStates = new Map<string, KeeperDialogState>();

let _proxy: ProxyServer;
let _npcInjector: NpcInjector;
let _dialogHandler: DialogHandler;
let _chat: ChatInjector;
let _keeperSerial = 0;

export function getKeeperSerial(): number {
    return _keeperSerial;
}

export function isKeeperNpc(serial: number): boolean {
    return !!serial && serial === _keeperSerial;
}

function getKeeperNpc(entityId?: number): VirtualNPC | undefined {
    if (entityId) {
        const clickedNpc = _npcInjector.getNPC(entityId);
        if (clickedNpc) {
            return clickedNpc;
        }
    }
    return _npcInjector.getNPC(_keeperSerial);
}

function getDialogTarget(entityId?: number): { entityId: number; sprite: number; name: string } {
    const npc = getKeeperNpc(entityId);
    return {
        entityId: npc ? npc.serial : (entityId || _keeperSerial),
        sprite: npc ? npc.sprite : 1,
        name: npc ? npc.name : 'Monster Keeper',
    };
}

export function assignKeeperToNpc(npc: VirtualNPC | undefined): number {
    if (!npc || !_npcInjector || !_dialogHandler || !_chat) {
        return 0;
    }

    const previousNpc = _npcInjector.getNPC(_keeperSerial);
    if (previousNpc && previousNpc.serial !== npc.serial) {
        previousNpc.onInteract = undefined;
    }

    npc.onInteract = (session, event) => {
        void handleInteract(session, event);
    };
    _keeperSerial = npc.serial;
    return _keeperSerial;
}

export function clearKeeperAssignment(): boolean {
    if (!_npcInjector || !_keeperSerial) {
        _keeperSerial = 0;
        dialogStates.clear();
        return false;
    }

    const serial = _keeperSerial;
    const npc = _npcInjector.getNPC(serial);
    dialogStates.clear();
    _keeperSerial = 0;
    if (!npc) {
        return false;
    }

    npc.onInteract = undefined;
    return true;
}

export function removeKeeper(): boolean {
    if (!_npcInjector || !_keeperSerial) {
        _keeperSerial = 0;
        dialogStates.clear();
        return false;
    }

    const serial = _keeperSerial;
    const npc = _npcInjector.getNPC(serial);
    clearKeeperAssignment();
    if (!npc) {
        return false;
    }

    _npcInjector.removeNPC(serial);
    return true;
}

export function initKeeper(
    proxy: ProxyServer,
    npcInjector: NpcInjector,
    dialogHandler: DialogHandler,
    chat: ChatInjector,
    config: MonsterCaptureConfig,
): number {
    _proxy = proxy;
    _npcInjector = npcInjector;
    _dialogHandler = dialogHandler;
    _chat = chat;

    const keeperConfig = config.keeperNpc;
    const keeperSerial = npcInjector.placeNPC({
        name: keeperConfig.name,
        sprite: keeperConfig.sprite,
        x: keeperConfig.x,
        y: keeperConfig.y,
        mapNumber: keeperConfig.mapNumber,
        direction: keeperConfig.direction,
        creatureType: 2,
        persistent: false,
        ambientSpeech: keeperConfig.ambientSpeech,
    });

    const npc = npcInjector.getNPC(keeperSerial);
    assignKeeperToNpc(npc);

    console.log(
        `[Monster] Keeper NPC placed on map ${keeperConfig.mapNumber} `
        + `(${keeperConfig.x},${keeperConfig.y}) serial=0x${_keeperSerial.toString(16)}`,
    );

    return _keeperSerial;
}

export function onSessionEnd(sessionId: string): void {
    dialogStates.delete(sessionId);
}

async function handleInteract(session: ProxySession, event: DialogEvent): Promise<void> {
    if (event.type === 'click') {
        const monsters = await getMonstersByOwner(session.characterName);
        dialogStates.set(session.id, { flow: 'main', monsters, selectedIndex: 0, entityId: event.entityId });
        showMainMenu(session, monsters, event.entityId);
        return;
    }

    const state = dialogStates.get(session.id);
    if (!state) {
        return;
    }

    state.entityId = event.entityId || state.entityId;

    if (event.type === 'menuChoice') {
        await handleMenuChoice(session, state, event.slot, event.pursuitId);
        return;
    }

    if (event.type === 'textInput') {
        await handleTextInput(session, state, event.text);
        return;
    }

    if (event.type === 'dialogChoice') {
        dialogStates.delete(session.id);
    }
}

function showMainMenu(session: ProxySession, monsters: CapturedMonster[], entityId?: number): void {
    const target = getDialogTarget(entityId);
    const count = monsters.length;
    const greeting = count === 0
        ? 'Welcome, trainer! You have no monsters yet. Walk through the grass on the monster field to find wild monsters!'
        : `Welcome, trainer! You have ${count} monster${count > 1 ? 's' : ''}.`;

    _dialogHandler.sendDialogMenu(session, {
        menuType: 0,
        entityId: target.entityId,
        sprite: target.sprite,
        name: target.name,
        text: greeting,
        menuOptions: [
            { text: 'View My Monsters', pursuitId: 1 },
            { text: 'Set Active Monster', pursuitId: 2 },
            { text: 'Rename Monster', pursuitId: 3 },
            { text: 'Release Monster', pursuitId: 4 },
            { text: 'View Moves', pursuitId: 5 },
            { text: 'Heal All Monsters', pursuitId: 6 },
            { text: 'Monster Rankings', pursuitId: 7 },
            { text: 'Goodbye', pursuitId: 8 },
        ],
    });
}

async function handleMenuChoice(
    session: ProxySession,
    state: KeeperDialogState,
    slot: number,
    pursuitId: number,
): Promise<void> {
    if (state.flow === 'main') {
        const mainChoice = pursuitId > 0 ? pursuitId : slot + 1;
        switch (mainChoice) {
            case 1:
                state.flow = 'view';
                await showMonsterList(session, state, 'Your Monsters:');
                break;
            case 2:
                state.flow = 'set_active';
                await showMonsterList(session, state, 'Choose a monster to set as active:');
                break;
            case 3:
                state.flow = 'rename';
                await showMonsterList(session, state, 'Choose a monster to rename:');
                break;
            case 4:
                state.flow = 'release_pick';
                await showMonsterList(session, state, 'Choose a monster to release:');
                break;
            case 5:
                state.flow = 'moves';
                await showMonsterList(session, state, 'Choose a monster to view moves:');
                break;
            case 6:
                if (state.monsters.length === 0) {
                    _chat.systemMessage(session, monsterDanger('You have no monsters! Find some in the wild grass.'));
                    state.flow = 'main';
                    showMainMenu(session, state.monsters, state.entityId);
                    break;
                }

                if (isInBattle(session.id)) {
                    _chat.systemMessage(session, monsterDanger('You cannot heal monsters during battle.'));
                    state.flow = 'main';
                    showMainMenu(session, state.monsters, state.entityId);
                    break;
                }

                await healMonstersByOwner(session.characterName);
                state.monsters = await getMonstersByOwner(session.characterName);
                _chat.systemMessage(session, monsterSuccess('All of your monsters were healed to full HP!'));
                await refreshCompanion(session);
                state.flow = 'main';
                showMainMenu(session, state.monsters, state.entityId);
                break;
            case 7:
                await showRankings(session, state.entityId);
                dialogStates.delete(session.id);
                break;
            default:
                dialogStates.delete(session.id);
                break;
        }
        return;
    }

    if (
        state.flow === 'view'
        || state.flow === 'set_active'
        || state.flow === 'rename'
        || state.flow === 'release_pick'
        || state.flow === 'moves'
    ) {
        const selectedMonster = resolveMonsterChoice(state, slot, pursuitId);
        if (!selectedMonster) {
            state.flow = 'main';
            showMainMenu(session, state.monsters, state.entityId);
            return;
        }

        state.selectedIndex = state.monsters.findIndex(monster => monster.id === selectedMonster.id);
        switch (state.flow) {
            case 'view':
                showMonsterDetail(session, selectedMonster, state.entityId);
                dialogStates.delete(session.id);
                break;
            case 'set_active':
                await setActiveMonster(session.characterName, selectedMonster.id);
                _chat.systemMessage(session, monsterSuccess(`${selectedMonster.nickname} is now your active monster!`));
                state.monsters = await getMonstersByOwner(session.characterName);
                state.flow = 'main';
                showMainMenu(session, state.monsters, state.entityId);
                break;
            case 'rename':
                {
                    const target = getDialogTarget(state.entityId);
                    _dialogHandler.sendDialog(session, {
                        type: DialogType.TextInput,
                        entityId: target.entityId,
                        sprite: target.sprite,
                        name: target.name,
                        text: `Enter a new name for ${selectedMonster.nickname}:`,
                        pursuitId: 1,
                        stepId: 0,
                        hasPrevious: false,
                        hasNext: false,
                    });
                }
                break;
            case 'release_pick':
                {
                    const target = getDialogTarget(state.entityId);
                    _dialogHandler.sendDialogMenu(session, {
                        menuType: 0,
                        entityId: target.entityId,
                        sprite: target.sprite,
                        name: target.name,
                        text: `Are you sure you want to release ${selectedMonster.nickname} (Lv.${selectedMonster.level} ${selectedMonster.speciesName})? This cannot be undone!`,
                        menuOptions: [
                            { text: 'Yes, release', pursuitId: 1 },
                            { text: 'No, keep', pursuitId: 2 },
                        ],
                    });
                }
                state.flow = 'release_confirm';
                break;
            case 'moves':
                showMonsterMoves(session, selectedMonster, state.entityId);
                dialogStates.delete(session.id);
                break;
        }
        return;
    }

    if (state.flow === 'release_confirm') {
        const confirmed = pursuitId === 1 || (pursuitId !== 2 && slot === 0);
        if (confirmed) {
            const monster = state.monsters[state.selectedIndex];
            await deleteMonster(monster.id, session.characterName);
            _chat.systemMessage(session, monsterDanger(`${monster.nickname} was released. Goodbye, ${monster.nickname}...`));
        }

        state.monsters = await getMonstersByOwner(session.characterName);
        state.flow = 'main';
        showMainMenu(session, state.monsters, state.entityId);
    }
}

async function handleTextInput(
    session: ProxySession,
    state: KeeperDialogState,
    text: string,
): Promise<void> {
    if (state.flow === 'rename' && text.trim()) {
        const monster = state.monsters[state.selectedIndex];
        const newName = text.trim().substring(0, 20);
        await renameMonster(monster.id, session.characterName, newName);
        _chat.systemMessage(session, monsterSuccess(`${monster.nickname} was renamed to ${newName}!`));
        state.monsters = await getMonstersByOwner(session.characterName);
    }

    state.flow = 'main';
    showMainMenu(session, state.monsters, state.entityId);
}

async function showMonsterList(session: ProxySession, state: KeeperDialogState, prompt: string): Promise<void> {
    state.monsters = await getMonstersByOwner(session.characterName);

    if (state.monsters.length === 0) {
        _chat.systemMessage(session, monsterDanger('You have no monsters! Find some in the wild grass.'));
        state.flow = 'main';
        showMainMenu(session, state.monsters, state.entityId);
        return;
    }

    const target = getDialogTarget(state.entityId);

    const options = state.monsters.map((monster, index) => ({
        text: `${monster.isActive ? '>' : ' '} ${monster.nickname} Lv.${monster.level} (${monster.speciesName})`,
        pursuitId: index + 1,
    }));
    options.push({ text: 'Back', pursuitId: state.monsters.length + 1 });

    _dialogHandler.sendDialogMenu(session, {
        menuType: 0,
        entityId: target.entityId,
        sprite: target.sprite,
        name: target.name,
        text: prompt,
        menuOptions: options,
    });
}

function showMonsterDetail(session: ProxySession, monster: CapturedMonster, entityId?: number): void {
    const target = getDialogTarget(entityId);
    const nature = NATURE_MODIFIERS[monster.nature];
    const moveList = monster.moves.filter(Boolean).join(', ') || 'None';
    const text = [
        `${monster.nickname} (${monster.speciesName})`,
        `Level: ${monster.level}  XP: ${monster.xp}/${monster.xpToNext}`,
        `Nature: ${monster.nature} (+${nature.increased}, -${nature.decreased})`,
        `HP: ${monster.hp}/${monster.maxHp}`,
        `ATK: ${monster.atk}  DEF: ${monster.def}  SPD: ${monster.spd}`,
        `SP.ATK: ${monster.spAtk}  SP.DEF: ${monster.spDef}`,
        `Moves: ${moveList}`,
        `Record: ${monster.wins}W / ${monster.losses}L`,
        monster.isActive ? '[ ACTIVE ]' : '',
    ].join('\n');

    _dialogHandler.sendDialog(session, {
        type: DialogType.Popup,
        entityId: target.entityId,
        sprite: target.sprite,
        name: target.name,
        text,
        pursuitId: 1,
        stepId: 0,
        hasPrevious: false,
        hasNext: false,
    });
}

function showMonsterMoves(session: ProxySession, monster: CapturedMonster, entityId?: number): void {
    const target = getDialogTarget(entityId);
    const lines = [`${monster.nickname}'s Moves:`];
    for (let i = 0; i < 4; i++) {
        const moveName = monster.moves[i];
        if (!moveName) {
            lines.push(`${i + 1}. (empty)`);
            continue;
        }

        const move = getMove(moveName);
        if (move) {
            lines.push(`${i + 1}. ${move.name} [${move.type}] PWR:${move.power} ACC:${move.accuracy}% (${move.category})`);
        } else {
            lines.push(`${i + 1}. ${moveName}`);
        }
    }

    _dialogHandler.sendDialog(session, {
        type: DialogType.Popup,
        entityId: target.entityId,
        sprite: target.sprite,
        name: target.name,
        text: lines.join('\n'),
        pursuitId: 1,
        stepId: 0,
        hasPrevious: false,
        hasNext: false,
    });
}

async function showRankings(session: ProxySession, entityId?: number): Promise<void> {
    const target = getDialogTarget(entityId);
    const leaders = await getLeaderboard(10);
    if (leaders.length === 0) {
        _dialogHandler.sendDialog(session, {
            type: DialogType.Popup,
            entityId: target.entityId,
            sprite: target.sprite,
            name: target.name,
            text: 'No battles have been recorded yet!',
            pursuitId: 1,
            stepId: 0,
            hasPrevious: false,
            hasNext: false,
        });
        return;
    }

    const lines = ['Monster Rankings (by Wins):'];
    leaders.forEach((entry, index) => {
        lines.push(
            `${index + 1}. ${entry.nickname} (${entry.speciesName}) - ${entry.ownerName} `
            + `| ${entry.wins}W/${entry.losses}L Lv.${entry.level}`,
        );
    });

    _dialogHandler.sendDialog(session, {
        type: DialogType.Popup,
        entityId: target.entityId,
        sprite: target.sprite,
        name: target.name,
        text: lines.join('\n'),
        pursuitId: 1,
        stepId: 0,
        hasPrevious: false,
        hasNext: false,
    });
}

function resolveMonsterChoice(
    state: KeeperDialogState,
    slot: number,
    pursuitId: number,
): CapturedMonster | null {
    if (pursuitId === state.monsters.length + 1) {
        return null;
    }

    if (pursuitId > 0 && pursuitId <= state.monsters.length) {
        const byIndex = state.monsters[pursuitId - 1];
        if (byIndex) {
            return byIndex;
        }
    }

    if (slot < 0 || slot >= state.monsters.length) {
        return null;
    }

    return state.monsters[slot];
}
