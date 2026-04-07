"use strict";
// ── DA Monsters: Monster Keeper NPC ───────────────────────────────
// Virtual NPC for managing captured monsters. Uses onInteract pattern.
Object.defineProperty(exports, "__esModule", { value: true });
exports.initKeeper = initKeeper;
exports.onSessionEnd = onSessionEnd;
const dialog_handler_1 = require("../../proxy/augmentation/dialog-handler");
const monster_db_1 = require("./monster-db");
const species_data_1 = require("./species-data");
const dialogStates = new Map();
// ── Module refs ──────────────────────────────────────────────────
let _proxy;
let _npcInjector;
let _dialogHandler;
let _chat;
let _keeperSerial = 0;
// ── Init ─────────────────────────────────────────────────────────
function initKeeper(proxy, npcInjector, dialogHandler, chat, config) {
    _proxy = proxy;
    _npcInjector = npcInjector;
    _dialogHandler = dialogHandler;
    _chat = chat;
    const kcfg = config.keeperNpc;
    _keeperSerial = npcInjector.placeNPC({
        name: kcfg.name,
        sprite: kcfg.sprite,
        x: kcfg.x,
        y: kcfg.y,
        mapNumber: kcfg.mapNumber,
        direction: 2,
        creatureType: 2, // Mundane
    });
    // Attach dynamic dialog handler
    const npc = npcInjector.getNPC(_keeperSerial);
    if (npc) {
        npc.onInteract = (session, event) => handleInteract(session, event);
    }
    console.log(`[Monster] Keeper NPC placed on map ${kcfg.mapNumber} (${kcfg.x},${kcfg.y}) serial=0x${_keeperSerial.toString(16)}`);
    return _keeperSerial;
}
// ── Interaction Handler ──────────────────────────────────────────
async function handleInteract(session, event) {
    const npc = _npcInjector.getNPC(_keeperSerial);
    if (event.type === 'click') {
        const monsters = await (0, monster_db_1.getMonstersByOwner)(session.characterName);
        dialogStates.set(session.id, { flow: 'main', monsters, selectedIndex: 0 });
        showMainMenu(session, monsters);
        return;
    }
    const state = dialogStates.get(session.id);
    if (!state)
        return;
    if (event.type === 'menuChoice') {
        await handleMenuChoice(session, state, event.slot);
    }
    else if (event.type === 'textInput') {
        await handleTextInput(session, state, event.text);
    }
    else if (event.type === 'dialogChoice') {
        // Next/prev in popup — close
        dialogStates.delete(session.id);
    }
}
// ── Menu Flows ───────────────────────────────────────────────────
function showMainMenu(session, monsters) {
    const npc = _npcInjector.getNPC(_keeperSerial);
    const count = monsters.length;
    const greeting = count === 0
        ? 'Welcome, trainer! You have no monsters yet. Walk through the grass on the monster field to find wild monsters!'
        : `Welcome, trainer! You have ${count} monster${count > 1 ? 's' : ''}.`;
    _dialogHandler.sendDialogMenu(session, {
        menuType: 0,
        entityId: _keeperSerial,
        sprite: npc.sprite,
        name: npc.name,
        text: greeting,
        menuOptions: [
            { text: 'View My Monsters', pursuitId: 1 },
            { text: 'Set Active Monster', pursuitId: 2 },
            { text: 'Rename Monster', pursuitId: 3 },
            { text: 'Release Monster', pursuitId: 4 },
            { text: 'View Moves', pursuitId: 5 },
            { text: 'Monster Rankings', pursuitId: 6 },
            { text: 'Goodbye', pursuitId: 0 },
        ],
    });
}
async function handleMenuChoice(session, state, slot) {
    const npc = _npcInjector.getNPC(_keeperSerial);
    if (state.flow === 'main') {
        // slot maps to pursuitId order (0-indexed from dialog system)
        switch (slot) {
            case 0: // View My Monsters
                state.flow = 'view';
                await showMonsterList(session, state, 'Your Monsters:');
                break;
            case 1: // Set Active
                state.flow = 'set_active';
                await showMonsterList(session, state, 'Choose a monster to set as active:');
                break;
            case 2: // Rename
                state.flow = 'rename';
                await showMonsterList(session, state, 'Choose a monster to rename:');
                break;
            case 3: // Release
                state.flow = 'release_pick';
                await showMonsterList(session, state, 'Choose a monster to release:');
                break;
            case 4: // View Moves
                state.flow = 'moves';
                await showMonsterList(session, state, 'Choose a monster to view moves:');
                break;
            case 5: // Rankings
                await showRankings(session);
                dialogStates.delete(session.id);
                break;
            default: // Goodbye
                dialogStates.delete(session.id);
                break;
        }
        return;
    }
    if (state.flow === 'view' || state.flow === 'set_active' || state.flow === 'rename' ||
        state.flow === 'release_pick' || state.flow === 'moves') {
        if (slot >= state.monsters.length) {
            // Back/cancel
            state.flow = 'main';
            showMainMenu(session, state.monsters);
            return;
        }
        state.selectedIndex = slot;
        const mon = state.monsters[slot];
        switch (state.flow) {
            case 'view':
                showMonsterDetail(session, mon);
                dialogStates.delete(session.id);
                break;
            case 'set_active':
                await (0, monster_db_1.setActiveMonster)(session.characterName, mon.id);
                _chat.systemMessage(session, `${mon.nickname} is now your active monster!`);
                state.monsters = await (0, monster_db_1.getMonstersByOwner)(session.characterName);
                state.flow = 'main';
                showMainMenu(session, state.monsters);
                break;
            case 'rename':
                // Ask for new name via text input
                _dialogHandler.sendDialog(session, {
                    type: dialog_handler_1.DialogType.TextInput,
                    entityId: _keeperSerial,
                    sprite: npc.sprite,
                    name: npc.name,
                    text: `Enter a new name for ${mon.nickname}:`,
                    pursuitId: 1,
                    stepId: 0,
                    hasPrevious: false,
                    hasNext: false,
                });
                break;
            case 'release_pick':
                _dialogHandler.sendDialogMenu(session, {
                    menuType: 0,
                    entityId: _keeperSerial,
                    sprite: npc.sprite,
                    name: npc.name,
                    text: `Are you sure you want to release ${mon.nickname} (Lv.${mon.level} ${mon.speciesName})? This cannot be undone!`,
                    menuOptions: [
                        { text: 'Yes, release', pursuitId: 1 },
                        { text: 'No, keep', pursuitId: 0 },
                    ],
                });
                state.flow = 'release_confirm';
                break;
            case 'moves':
                showMonsterMoves(session, mon);
                dialogStates.delete(session.id);
                break;
        }
        return;
    }
    // Release confirm response
    if (state.flow === 'release_confirm') {
        if (slot === 0) {
            // Confirm release
            const mon = state.monsters[state.selectedIndex];
            await (0, monster_db_1.deleteMonster)(mon.id, session.characterName);
            _chat.systemMessage(session, `${mon.nickname} was released. Goodbye, ${mon.nickname}...`);
        }
        state.monsters = await (0, monster_db_1.getMonstersByOwner)(session.characterName);
        state.flow = 'main';
        showMainMenu(session, state.monsters);
    }
}
async function handleTextInput(session, state, text) {
    if (state.flow === 'rename' && text.trim()) {
        const mon = state.monsters[state.selectedIndex];
        const newName = text.trim().substring(0, 20);
        await (0, monster_db_1.renameMonster)(mon.id, session.characterName, newName);
        _chat.systemMessage(session, `${mon.nickname} was renamed to ${newName}!`);
        state.monsters = await (0, monster_db_1.getMonstersByOwner)(session.characterName);
    }
    state.flow = 'main';
    showMainMenu(session, state.monsters);
}
// ── Display Helpers ──────────────────────────────────────────────
async function showMonsterList(session, state, prompt) {
    state.monsters = await (0, monster_db_1.getMonstersByOwner)(session.characterName);
    const npc = _npcInjector.getNPC(_keeperSerial);
    if (state.monsters.length === 0) {
        _chat.systemMessage(session, 'You have no monsters! Find some in the wild grass.');
        state.flow = 'main';
        showMainMenu(session, state.monsters);
        return;
    }
    const options = state.monsters.map(m => ({
        text: `${m.isActive ? '>' : ' '} ${m.nickname} Lv.${m.level} (${m.speciesName})`,
        pursuitId: m.id,
    }));
    options.push({ text: 'Back', pursuitId: 0 });
    _dialogHandler.sendDialogMenu(session, {
        menuType: 0,
        entityId: _keeperSerial,
        sprite: npc.sprite,
        name: npc.name,
        text: prompt,
        menuOptions: options,
    });
}
function showMonsterDetail(session, mon) {
    const npc = _npcInjector.getNPC(_keeperSerial);
    const nature = species_data_1.NATURE_MODIFIERS[mon.nature];
    const moveList = mon.moves.filter(m => m).join(', ') || 'None';
    const text = [
        `${mon.nickname} (${mon.speciesName})`,
        `Level: ${mon.level}  XP: ${mon.xp}/${mon.xpToNext}`,
        `Nature: ${mon.nature} (+${nature.increased}, -${nature.decreased})`,
        `HP: ${mon.hp}/${mon.maxHp}`,
        `ATK: ${mon.atk}  DEF: ${mon.def}  SPD: ${mon.spd}`,
        `SP.ATK: ${mon.spAtk}  SP.DEF: ${mon.spDef}`,
        `Moves: ${moveList}`,
        `Record: ${mon.wins}W / ${mon.losses}L`,
        mon.isActive ? '[ ACTIVE ]' : '',
    ].join('\n');
    _dialogHandler.sendDialog(session, {
        type: dialog_handler_1.DialogType.Popup,
        entityId: _keeperSerial,
        sprite: npc.sprite,
        name: npc.name,
        text,
        pursuitId: 1,
        stepId: 0,
        hasPrevious: false,
        hasNext: false,
    });
}
function showMonsterMoves(session, mon) {
    const npc = _npcInjector.getNPC(_keeperSerial);
    const lines = [`${mon.nickname}'s Moves:`];
    for (let i = 0; i < 4; i++) {
        const moveName = mon.moves[i];
        if (!moveName) {
            lines.push(`${i + 1}. (empty)`);
            continue;
        }
        const move = (0, species_data_1.getMove)(moveName);
        if (move) {
            lines.push(`${i + 1}. ${move.name} [${move.type}] PWR:${move.power} ACC:${move.accuracy}% (${move.category})`);
        }
        else {
            lines.push(`${i + 1}. ${moveName}`);
        }
    }
    _dialogHandler.sendDialog(session, {
        type: dialog_handler_1.DialogType.Popup,
        entityId: _keeperSerial,
        sprite: npc.sprite,
        name: npc.name,
        text: lines.join('\n'),
        pursuitId: 1,
        stepId: 0,
        hasPrevious: false,
        hasNext: false,
    });
}
async function showRankings(session) {
    const npc = _npcInjector.getNPC(_keeperSerial);
    const leaders = await (0, monster_db_1.getLeaderboard)(10);
    if (leaders.length === 0) {
        _dialogHandler.sendDialog(session, {
            type: dialog_handler_1.DialogType.Popup,
            entityId: _keeperSerial,
            sprite: npc.sprite,
            name: npc.name,
            text: 'No battles have been recorded yet!',
            pursuitId: 1,
            stepId: 0,
            hasPrevious: false,
            hasNext: false,
        });
        return;
    }
    const lines = ['Monster Rankings (by Wins):'];
    leaders.forEach((e, i) => {
        lines.push(`${i + 1}. ${e.nickname} (${e.speciesName}) - ${e.ownerName} | ${e.wins}W/${e.losses}L Lv.${e.level}`);
    });
    _dialogHandler.sendDialog(session, {
        type: dialog_handler_1.DialogType.Popup,
        entityId: _keeperSerial,
        sprite: npc.sprite,
        name: npc.name,
        text: lines.join('\n'),
        pursuitId: 1,
        stepId: 0,
        hasPrevious: false,
        hasNext: false,
    });
}
function onSessionEnd(sessionId) {
    dialogStates.delete(sessionId);
}
//# sourceMappingURL=keeper-npc.js.map