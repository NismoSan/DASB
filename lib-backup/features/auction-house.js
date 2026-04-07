"use strict";
// ── Auction House Module ──────────────────────────────────────────
// Virtual NPC that lets players list items for sale and buy items.
// Uses the parcel system for item transfer via a bot character escrow.
// Gold is exchanged via the DA exchange protocol (0x4A/0x42).
// Data persisted in PostgreSQL (auction_listings, auction_balances, auction_transactions).
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VIRTUAL_BOARD_ID = void 0;
exports.init = init;
exports.handleViewBoard = handleViewBoard;
exports.handleViewPost = handleViewPost;
exports.handleExchangeMessage = handleExchangeMessage;
exports.onParcelSent = onParcelSent;
exports.handleBotAddItem = handleBotAddItem;
exports.handleBotRemoveItem = handleBotRemoveItem;
exports.handleWhisper = handleWhisper;
exports.onSessionEnd = onSessionEnd;
exports.handleAuctionCommand = handleAuctionCommand;
exports.getAuctionNpcSerial = getAuctionNpcSerial;
exports.getNpc = getNpc;
exports.getAuctionNpcSerials = getAuctionNpcSerials;
exports.isAuctionNpc = isAuctionNpc;
exports.assignToNpc = assignToNpc;
exports.unassignFromNpc = unassignFromNpc;
exports.isInitialized = isInitialized;
const packet_1 = __importDefault(require("../core/packet"));
const database_1 = require("./database");
const dialog_handler_1 = require("../proxy/augmentation/dialog-handler");
// ── Constants ────────────────────────────────────────────────────
const ITEMS_PER_PAGE = 8;
const BOARD_POSTS_PER_PAGE = 10;
exports.VIRTUAL_BOARD_ID = 0xFF00;
const INTAKE_TIMEOUT_MS = 60_000;
const PURCHASE_TIMEOUT_MS = 120_000;
// ── Module State ─────────────────────────────────────────────────
let deps = null;
/** All NPCs that serve as auctioneers (supports multiple) */
const auctionNpcs = new Map(); // serial → VirtualNPC
/** Legacy single-NPC reference (the first/primary auctioneer for init-placed NPC) */
let auctionNpcSerial = 0;
/**
 * Get the NPC for a session's current dialog, or fall back to any available auctioneer.
 * Most dialog functions use this instead of the old global auctionNpc.
 */
function getSessionNpc(session) {
    const state = dialogStates.get(session.id);
    if (state && auctionNpcs.has(state.npcSerial)) {
        return auctionNpcs.get(state.npcSerial);
    }
    // Fallback: return the first auctioneer
    if (auctionNpcs.size > 0)
        return auctionNpcs.values().next().value;
    return null;
}
// Bot inventory tracking (populated from 0x37/0x38)
const botInventory = new Map(); // slot → itemName
// Per-session dialog state
const dialogStates = new Map();
// Parcel intake queue (sellers sending items to bot)
const pendingIntakes = [];
// Active purchase (one at a time, like slot-machine)
let pendingPurchase = null;
let pendingPurchaseTimer = null;
// Active gold cashout (seller withdrawing balance)
let pendingCashout = null;
// ── Initialization ───────────────────────────────────────────────
function init(d) {
    deps = d;
    // Check if an auctioneer NPC was already restored from config
    // (restoreVirtualNpcs runs before init and may have placed one)
    const existing = deps.npcInjector.getAllNPCs().find(npc => npc.mapNumber === deps.npcMapNumber
        && npc.x === deps.npcX
        && npc.y === deps.npcY);
    if (existing) {
        // Reuse the restored NPC instead of placing a duplicate
        auctionNpcSerial = existing.serial;
        existing.onInteract = createInteractHandler(existing.serial);
        auctionNpcs.set(existing.serial, existing);
    }
    else {
        // Place the Auctioneer NPC (no pre-existing one found)
        auctionNpcSerial = deps.npcInjector.placeNPC({
            name: 'Auctioneer',
            sprite: deps.npcSprite,
            x: deps.npcX,
            y: deps.npcY,
            mapNumber: deps.npcMapNumber,
            direction: 2,
            creatureType: 2, // Mundane
        });
        const placedNpc = deps.npcInjector.getNPC(auctionNpcSerial) || null;
        if (placedNpc) {
            placedNpc.onInteract = createInteractHandler(placedNpc.serial);
            auctionNpcs.set(placedNpc.serial, placedNpc);
        }
    }
    // Inject "Auction House" into the board list when the client opens the boards screen
    deps.proxy.on('virtualBoard:getBoards', (boards) => {
        boards.push({ id: exports.VIRTUAL_BOARD_ID, name: 'Auction House' });
    });
    // Listen for virtual board events (0x3B intercepted for boardId >= 0xFF00)
    deps.proxy.on('virtualBoard:view', (session, boardId, startPostId) => {
        handleViewBoard(session, boardId, startPostId);
    });
    deps.proxy.on('virtualBoard:viewPost', (session, boardId, postId, navigation) => {
        handleViewPost(session, boardId, postId, navigation);
    });
    console.log(`[Auction] Initialized — NPC serial=0x${auctionNpcSerial.toString(16)} at map ${deps.npcMapNumber} (${deps.npcX},${deps.npcY})`);
}
// ── Dialog Interaction Handler ───────────────────────────────────
/**
 * Create an interaction handler bound to a specific NPC serial.
 * Each auctioneer NPC gets its own closure so the session knows which NPC it's talking to.
 */
function createInteractHandler(npcSerial) {
    return function handleInteract(session, event) {
        if (!deps)
            return;
        const npc = auctionNpcs.get(npcSerial);
        if (!npc)
            return;
        if (event.type === 'click') {
            // Reset state and show main menu
            dialogStates.set(session.id, {
                flow: 'main',
                npcSerial: npc.serial,
                page: 0,
                pageListingIds: [],
                selectedId: null,
                sellSlots: [],
                sellSelectedSlot: null,
                sellPrice: null,
                lastDialogType: 'menu',
                hasNextPage: false,
            });
            sendMainMenu(session);
            return;
        }
        const state = dialogStates.get(session.id);
        if (!state)
            return;
        if (event.type === 'menuChoice') {
            handleMenuChoice(session, state, event.slot);
        }
        else if (event.type === 'dialogChoice') {
            handleDialogChoice(session, state, event.stepId);
        }
        else if (event.type === 'textInput') {
            handleTextInput(session, state, event.text);
        }
    };
}
// ── Main Menu ────────────────────────────────────────────────────
function sendMainMenu(session) {
    const npc = getSessionNpc(session);
    if (!deps || !npc)
        return;
    const state = dialogStates.get(session.id);
    if (state) {
        state.flow = 'main';
        state.lastDialogType = 'menu';
    }
    deps.dialogHandler.sendDialog(session, {
        type: dialog_handler_1.DialogType.Menu,
        entityId: npc.serial,
        sprite: npc.sprite,
        name: npc.name,
        text: 'Welcome to the Auction House.\nWhat would you like to do?',
        pursuitId: 1,
        stepId: 0,
        hasPrevious: false,
        hasNext: false,
        options: [
            'Browse Listings',
            'Sell an Item',
            'My Listings',
            'My Balance',
            'Close',
        ],
    });
}
// ── Menu Choice Dispatch ─────────────────────────────────────────
function handleMenuChoice(session, state, slot) {
    if (state.flow === 'main') {
        switch (slot) {
            case 0:
                browseListings(session, state, 0);
                break;
            case 1:
                showSellInventory(session, state);
                break;
            case 2:
                showMyListings(session, state, 0);
                break;
            case 3:
                showMyBalance(session, state);
                break;
            case 4:
                closeDialog(session);
                break;
        }
    }
    else if (state.flow === 'browse') {
        handleBrowseChoice(session, state, slot);
    }
    else if (state.flow === 'my_listings') {
        handleMyListingsChoice(session, state, slot);
    }
    else if (state.flow === 'cancel_confirm') {
        handleCancelConfirmChoice(session, state, slot);
    }
}
// ── Dialog Choice (Next/Previous) Dispatch ───────────────────────
function handleDialogChoice(session, state, _stepId) {
    // When a Popup with hasNext=true is shown, the client handles ESC locally (no packet sent).
    // So 0x3A argsType=0 arriving here from a popup_with_next IS the "Next" click.
    // For all other dialog types (menu, popup_no_next, item_choices, text_input),
    // 0x3A argsType=0 means ESC/close.
    if (state.lastDialogType === 'popup_with_next' && state.flow === 'detail' && state.selectedId !== null) {
        // Player clicked "Next" on item detail → confirm purchase
        initiatePurchase(session, state);
    }
    else {
        // ESC / close — exit the dialog entirely
        closeDialog(session);
    }
}
// ── Browse Listings ──────────────────────────────────────────────
async function browseListings(session, state, page) {
    const npc = getSessionNpc(session);
    if (!deps || !npc)
        return;
    state.flow = 'browse';
    state.page = page;
    try {
        const offset = page * ITEMS_PER_PAGE;
        const result = await database_1.pool.query('SELECT id, seller_name, item_name, item_sprite, item_color, price FROM auction_listings WHERE status = $1 ORDER BY listed_at DESC LIMIT $2 OFFSET $3', ['active', ITEMS_PER_PAGE + 1, offset]);
        const rows = result.rows;
        const hasNextPage = rows.length > ITEMS_PER_PAGE;
        const listings = rows.slice(0, ITEMS_PER_PAGE);
        state.pageListingIds = listings.map((r) => r.id);
        state.hasNextPage = hasNextPage;
        if (listings.length === 0) {
            state.lastDialogType = 'popup_no_next';
            deps.dialogHandler.sendDialog(session, {
                type: dialog_handler_1.DialogType.Popup,
                entityId: npc.serial,
                sprite: npc.sprite,
                name: npc.name,
                text: 'There are no items listed for sale.',
                pursuitId: 1,
                stepId: 0,
                hasPrevious: false,
                hasNext: false,
            });
            state.flow = 'main';
            return;
        }
        // Build menu options: listing entries + navigation
        const options = listings.map((r) => `${r.item_name} - ${formatGold(r.price)}`);
        if (hasNextPage)
            options.push('Next Page >>');
        if (page > 0)
            options.push('<< Previous Page');
        options.push('Back to Menu');
        state.lastDialogType = 'menu';
        deps.dialogHandler.sendDialog(session, {
            type: dialog_handler_1.DialogType.Menu,
            entityId: npc.serial,
            sprite: npc.sprite,
            name: npc.name,
            text: `Auction Listings (Page ${page + 1})\nSelect an item for details.`,
            pursuitId: 1,
            stepId: page,
            hasPrevious: false,
            hasNext: false,
            options,
        });
    }
    catch (err) {
        console.error('[Auction] Browse query failed:', err);
        sendMainMenu(session);
    }
}
function handleBrowseChoice(session, state, slot) {
    const listingCount = state.pageListingIds.length;
    if (slot < listingCount) {
        // Selected a listing → show detail
        state.selectedId = state.pageListingIds[slot];
        showListingDetail(session, state);
        return;
    }
    // Navigation options appear after listing entries in order:
    // [Next Page >>] (if hasNextPage), [<< Previous Page] (if page > 0), [Back to Menu] (always)
    const page = state.page;
    const navOptions = [];
    if (state.hasNextPage)
        navOptions.push('next');
    if (page > 0)
        navOptions.push('prev');
    navOptions.push('back');
    const navIndex = slot - listingCount;
    const action = navIndex >= 0 && navIndex < navOptions.length ? navOptions[navIndex] : 'back';
    if (action === 'next') {
        browseListings(session, state, page + 1);
    }
    else if (action === 'prev') {
        browseListings(session, state, page - 1);
    }
    else {
        sendMainMenu(session);
    }
}
// ── Virtual Auction Board ────────────────────────────────────────
// The Auction House appears as a board in the mail/boards screen.
// When the server sends a BoardList (0x31 type 1), the proxy injects
// an extra "Auction House" entry. When the client requests to view or
// read posts from that board, the proxy intercepts and responds with
// synthesized packets from the auction database.
/**
 * Handle 0x3B ViewBoard for the virtual auction board.
 * Called from proxy event system when client requests board listing.
 */
async function handleViewBoard(session, boardId, startPostId) {
    if (!deps || boardId !== exports.VIRTUAL_BOARD_ID)
        return;
    try {
        const offset = startPostId > 0 ? startPostId - 1 : 0;
        const result = await database_1.pool.query('SELECT id, seller_name, item_name, price FROM auction_listings WHERE status = $1 ORDER BY listed_at DESC LIMIT $2 OFFSET $3', ['active', BOARD_POSTS_PER_PAGE, offset]);
        const now = new Date();
        const month = now.getMonth() + 1;
        const day = now.getDate();
        const posts = result.rows.map((r, i) => ({
            postId: offset + i + 1,
            author: r.seller_name,
            month,
            day,
            subject: `${r.item_name} - ${formatGold(r.price)}`,
        }));
        deps.dialogHandler.sendBoard(session, {
            boardId: exports.VIRTUAL_BOARD_ID,
            boardName: 'Auction House',
            posts,
        });
    }
    catch (err) {
        console.error('[Auction] ViewBoard query failed:', err);
    }
}
/**
 * Handle 0x3B ViewPost for the virtual auction board.
 * Called from proxy event system when client clicks a board post.
 */
async function handleViewPost(session, boardId, postId, _navigation) {
    if (!deps || boardId !== exports.VIRTUAL_BOARD_ID)
        return;
    try {
        // postId is 1-based index into our listing query
        const offset = postId > 0 ? postId - 1 : 0;
        const result = await database_1.pool.query('SELECT id, seller_name, item_name, item_sprite, item_color, price, description, listed_at FROM auction_listings WHERE status = $1 ORDER BY listed_at DESC LIMIT 1 OFFSET $2', ['active', offset]);
        if (result.rows.length === 0) {
            // Post not found — send empty post
            const now = new Date();
            deps.dialogHandler.sendPost(session, {
                postId,
                author: 'System',
                month: now.getMonth() + 1,
                day: now.getDate(),
                subject: 'Listing Not Found',
                body: 'This listing is no longer available.',
            });
            return;
        }
        const listing = result.rows[0];
        const listedAt = new Date(listing.listed_at);
        const bodyLines = [
            `Item: ${listing.item_name}`,
            `Price: ${formatGold(listing.price)}`,
            `Seller: ${listing.seller_name}`,
            `Listed: ${listedAt.toLocaleDateString()}`,
        ];
        if (listing.description) {
            bodyLines.push('', listing.description);
        }
        bodyLines.push('', `To purchase, speak with the Auctioneer NPC.`);
        deps.dialogHandler.sendPost(session, {
            postId,
            author: listing.seller_name,
            month: listedAt.getMonth() + 1,
            day: listedAt.getDate(),
            subject: `${listing.item_name} - ${formatGold(listing.price)}`,
            body: bodyLines.join('\n'),
        });
    }
    catch (err) {
        console.error('[Auction] ViewPost query failed:', err);
    }
}
// ── Listing Detail ───────────────────────────────────────────────
async function showListingDetail(session, state) {
    const npc = getSessionNpc(session);
    if (!deps || !npc || state.selectedId === null)
        return;
    state.flow = 'detail';
    try {
        const result = await database_1.pool.query('SELECT id, seller_name, item_name, price FROM auction_listings WHERE id = $1 AND status = $2', [state.selectedId, 'active']);
        if (result.rows.length === 0) {
            state.lastDialogType = 'popup_no_next';
            deps.dialogHandler.sendDialog(session, {
                type: dialog_handler_1.DialogType.Popup,
                entityId: npc.serial,
                sprite: npc.sprite,
                name: npc.name,
                text: 'This listing is no longer available.',
                pursuitId: 1,
                stepId: 0,
                hasPrevious: false,
                hasNext: false,
            });
            state.flow = 'main';
            return;
        }
        const listing = result.rows[0];
        const isSelf = listing.seller_name.toLowerCase() === session.characterName.toLowerCase();
        const text = [
            listing.item_name,
            '',
            `Seller: ${listing.seller_name}`,
            `Price: ${formatGold(listing.price)}`,
            '',
            isSelf ? '(This is your own listing)' : 'Click Next to purchase this item.',
        ].join('\n');
        state.lastDialogType = isSelf ? 'popup_no_next' : 'popup_with_next';
        deps.dialogHandler.sendDialog(session, {
            type: dialog_handler_1.DialogType.Popup,
            entityId: npc.serial,
            sprite: npc.sprite,
            name: npc.name,
            text,
            pursuitId: 1,
            stepId: 0,
            hasPrevious: false,
            hasNext: !isSelf, // Only show Next (buy) if not own listing
        });
    }
    catch (err) {
        console.error('[Auction] Detail query failed:', err);
        sendMainMenu(session);
    }
}
// ── Sell Flow ────────────────────────────────────────────────────
function showSellInventory(session, state) {
    const npc = getSessionNpc(session);
    if (!deps || !npc)
        return;
    state.flow = 'sell';
    const inventory = session.playerState.inventory;
    if (inventory.size === 0) {
        state.lastDialogType = 'popup_no_next';
        deps.dialogHandler.sendDialog(session, {
            type: dialog_handler_1.DialogType.Popup,
            entityId: npc.serial,
            sprite: npc.sprite,
            name: npc.name,
            text: 'Your inventory is empty.',
            pursuitId: 1,
            stepId: 0,
            hasPrevious: false,
            hasNext: false,
        });
        state.flow = 'main';
        return;
    }
    // Build item list from player's tracked inventory
    const items = [];
    const slots = [];
    for (const [slot, item] of inventory) {
        items.push({
            sprite: item.sprite,
            color: item.color,
            quantity: item.quantity,
            name: item.name,
        });
        slots.push(slot);
    }
    state.sellSlots = slots;
    state.lastDialogType = 'item_choices';
    deps.dialogHandler.sendDialogMenu(session, {
        menuType: 4, // ItemChoices
        entityId: npc.serial,
        sprite: npc.sprite,
        name: npc.name,
        text: 'Select an item to list for sale:',
        items,
    });
}
function handleSellChoice(session, state, slot) {
    console.log(`[Auction] handleSellChoice: slot=${slot} sellSlots=[${state.sellSlots.join(',')}] sellSlotsLen=${state.sellSlots.length}`);
    if (slot >= state.sellSlots.length) {
        sendMainMenu(session);
        return;
    }
    const invSlot = state.sellSlots[slot];
    const item = session.playerState.inventory.get(invSlot);
    console.log(`[Auction] Selected invSlot=${invSlot} item=${item ? item.name : 'NOT FOUND'}`);
    if (!item) {
        sendMainMenu(session);
        return;
    }
    state.sellSelectedSlot = invSlot;
    state.flow = 'sell_price';
    state.lastDialogType = 'text_input';
    // Show text input dialog via 0x2F MenuType 2 (TextInput)
    const npc = getSessionNpc(session);
    if (!deps || !npc)
        return;
    deps.dialogHandler.sendDialogMenu(session, {
        menuType: 2, // TextInput
        entityId: npc.serial,
        sprite: npc.sprite,
        name: npc.name,
        text: `Enter the price in gold for:\n${item.name}`,
    });
}
// ── Text Input Handler (Price Entry) ─────────────────────────────
async function handleTextInput(session, state, text) {
    const npc = getSessionNpc(session);
    if (!deps || !npc)
        return;
    console.log(`[Auction] handleTextInput: flow=${state.flow} sellSelectedSlot=${state.sellSelectedSlot} text="${text}"`);
    // ItemChoices selection comes as text (the item name)
    if (state.flow === 'sell') {
        // Find the item in inventory by name
        const inventory = session.playerState.inventory;
        let matchedSlot = null;
        for (const [slot, item] of inventory) {
            if (item.name === text) {
                matchedSlot = slot;
                break;
            }
        }
        if (matchedSlot === null) {
            state.lastDialogType = 'popup_no_next';
            deps.dialogHandler.sendDialog(session, {
                type: dialog_handler_1.DialogType.Popup,
                entityId: npc.serial,
                sprite: npc.sprite,
                name: npc.name,
                text: `Item "${text}" not found in your inventory.`,
                pursuitId: 1, stepId: 0,
                hasPrevious: false, hasNext: false,
            });
            state.flow = 'main';
            return;
        }
        const item = inventory.get(matchedSlot);
        state.sellSelectedSlot = matchedSlot;
        state.flow = 'sell_price';
        state.lastDialogType = 'text_input';
        // Show text input dialog for price
        deps.dialogHandler.sendDialogMenu(session, {
            menuType: 2,
            entityId: npc.serial,
            sprite: npc.sprite,
            name: npc.name,
            text: `Enter the price in gold for:\n${item.name}`,
        });
        return;
    }
    if (state.flow === 'sell_price' && state.sellSelectedSlot !== null) {
        const price = parseInt(text.replace(/[^0-9]/g, ''), 10);
        if (!price || price <= 0) {
            state.lastDialogType = 'popup_no_next';
            deps.dialogHandler.sendDialog(session, {
                type: dialog_handler_1.DialogType.Popup,
                entityId: npc.serial,
                sprite: npc.sprite,
                name: npc.name,
                text: 'Invalid price. Please enter a number.',
                pursuitId: 1, stepId: 0,
                hasPrevious: false, hasNext: false,
            });
            state.flow = 'main';
            return;
        }
        const item = session.playerState.inventory.get(state.sellSelectedSlot);
        if (!item) {
            state.lastDialogType = 'popup_no_next';
            deps.dialogHandler.sendDialog(session, {
                type: dialog_handler_1.DialogType.Popup,
                entityId: npc.serial,
                sprite: npc.sprite,
                name: npc.name,
                text: 'Item no longer in your inventory.',
                pursuitId: 1, stepId: 0,
                hasPrevious: false, hasNext: false,
            });
            state.flow = 'main';
            return;
        }
        // Save price and prompt for optional description
        state.sellPrice = price;
        state.flow = 'sell_description';
        state.lastDialogType = 'text_input';
        deps.dialogHandler.sendDialogMenu(session, {
            menuType: 2, // TextInput
            entityId: npc.serial,
            sprite: npc.sprite,
            name: npc.name,
            text: `${item.name} — ${formatGold(price)}\n\nEnter a description (or leave blank):`,
        });
        return;
    }
    if (state.flow === 'sell_description' && state.sellSelectedSlot !== null && state.sellPrice !== null) {
        const description = text.trim();
        const price = state.sellPrice;
        const item = session.playerState.inventory.get(state.sellSelectedSlot);
        if (!item) {
            state.lastDialogType = 'popup_no_next';
            deps.dialogHandler.sendDialog(session, {
                type: dialog_handler_1.DialogType.Popup,
                entityId: npc.serial,
                sprite: npc.sprite,
                name: npc.name,
                text: 'Item no longer in your inventory.',
                pursuitId: 1, stepId: 0,
                hasPrevious: false, hasNext: false,
            });
            state.flow = 'main';
            return;
        }
        const botName = deps.botCharacterName;
        // Queue a pending intake so when the bot receives the item, the listing is created
        pendingIntakes.push({
            senderName: session.characterName,
            price,
            timestamp: Date.now(),
            description: description || null,
            expectedItemName: item.name,
        });
        // Timeout: clear the intake if the player doesn't send the parcel
        const intakeRef = pendingIntakes[pendingIntakes.length - 1];
        setTimeout(() => {
            const idx = pendingIntakes.indexOf(intakeRef);
            if (idx >= 0) {
                pendingIntakes.splice(idx, 1);
                console.log(`[Auction] Sell intake from ${session.characterName} timed out (${item.name})`);
                if (deps) {
                    deps.sendWhisper(session.characterName, `Listing timed out. You did not send "${item.name}" in time.`);
                }
            }
        }, INTAKE_TIMEOUT_MS + 1000);
        console.log(`[Auction] ${session.characterName} queued sell: "${item.name}" for ${formatGold(price)} — awaiting parcel to ${botName}`);
        // Close the dialog and instruct the player to send the item via parcel
        closeDialog(session);
        deps.sendWhisper(session.characterName, `To complete your listing, open Mail and send "${item.name}" as a parcel to "${botName}". Set the subject line to: ${price}`);
        state.flow = 'sell_pending_parcel';
        state.sellSelectedSlot = null;
        state.sellPrice = null;
        return;
    }
    // Default: go back to main menu
    sendMainMenu(session);
}
// ── My Listings ──────────────────────────────────────────────────
async function showMyListings(session, state, page) {
    const npc = getSessionNpc(session);
    if (!deps || !npc)
        return;
    state.flow = 'my_listings';
    state.page = page;
    try {
        const offset = page * ITEMS_PER_PAGE;
        const result = await database_1.pool.query('SELECT id, item_name, price, status FROM auction_listings WHERE seller_lower = $1 AND status = $2 ORDER BY listed_at DESC LIMIT $3 OFFSET $4', [session.characterName.toLowerCase(), 'active', ITEMS_PER_PAGE + 1, offset]);
        const rows = result.rows;
        const hasNextPage = rows.length > ITEMS_PER_PAGE;
        const listings = rows.slice(0, ITEMS_PER_PAGE);
        state.pageListingIds = listings.map((r) => r.id);
        state.hasNextPage = hasNextPage;
        if (listings.length === 0) {
            state.lastDialogType = 'popup_no_next';
            deps.dialogHandler.sendDialog(session, {
                type: dialog_handler_1.DialogType.Popup,
                entityId: npc.serial,
                sprite: npc.sprite,
                name: npc.name,
                text: 'You have no active listings.',
                pursuitId: 1,
                stepId: 0,
                hasPrevious: false,
                hasNext: false,
            });
            state.flow = 'main';
            return;
        }
        const options = listings.map((r) => `${r.item_name} - ${formatGold(r.price)}`);
        if (hasNextPage)
            options.push('Next Page >>');
        if (page > 0)
            options.push('<< Previous Page');
        options.push('Back');
        state.lastDialogType = 'menu';
        deps.dialogHandler.sendDialog(session, {
            type: dialog_handler_1.DialogType.Menu,
            entityId: npc.serial,
            sprite: npc.sprite,
            name: npc.name,
            text: 'Your active listings (select to cancel):',
            pursuitId: 1,
            stepId: page,
            hasPrevious: false,
            hasNext: false,
            options,
        });
    }
    catch (err) {
        console.error('[Auction] My listings query failed:', err);
        sendMainMenu(session);
    }
}
function handleMyListingsChoice(session, state, slot) {
    const listingCount = state.pageListingIds.length;
    if (slot < listingCount) {
        // Selected a listing → confirm cancellation
        state.selectedId = state.pageListingIds[slot];
        showCancelConfirm(session, state);
        return;
    }
    // Navigation options appear after listing entries in order:
    // [Next Page >>] (if hasNextPage), [<< Previous Page] (if page > 0), [Back] (always)
    const page = state.page;
    const navOptions = [];
    if (state.hasNextPage)
        navOptions.push('next');
    if (page > 0)
        navOptions.push('prev');
    navOptions.push('back');
    const navIndex = slot - listingCount;
    const action = navIndex >= 0 && navIndex < navOptions.length ? navOptions[navIndex] : 'back';
    if (action === 'next') {
        showMyListings(session, state, page + 1);
    }
    else if (action === 'prev') {
        showMyListings(session, state, page - 1);
    }
    else {
        sendMainMenu(session);
    }
}
// ── Cancel Listing Confirmation ──────────────────────────────────
async function showCancelConfirm(session, state) {
    const npc = getSessionNpc(session);
    if (!deps || !npc || state.selectedId === null)
        return;
    state.flow = 'cancel_confirm';
    try {
        const result = await database_1.pool.query('SELECT id, item_name, price FROM auction_listings WHERE id = $1 AND seller_lower = $2 AND status = $3', [state.selectedId, session.characterName.toLowerCase(), 'active']);
        if (result.rows.length === 0) {
            state.lastDialogType = 'popup_no_next';
            deps.dialogHandler.sendDialog(session, {
                type: dialog_handler_1.DialogType.Popup,
                entityId: npc.serial,
                sprite: npc.sprite,
                name: npc.name,
                text: 'This listing is no longer available.',
                pursuitId: 1,
                stepId: 0,
                hasPrevious: false,
                hasNext: false,
            });
            state.flow = 'main';
            return;
        }
        const listing = result.rows[0];
        state.lastDialogType = 'menu';
        deps.dialogHandler.sendDialog(session, {
            type: dialog_handler_1.DialogType.Menu,
            entityId: npc.serial,
            sprite: npc.sprite,
            name: npc.name,
            text: `Cancel listing?\n\n${listing.item_name} - ${formatGold(listing.price)}\n\nThe item will be returned to you via parcel.`,
            pursuitId: 1,
            stepId: 0,
            hasPrevious: false,
            hasNext: false,
            options: ['Yes, cancel it', 'No, keep it'],
        });
    }
    catch (err) {
        console.error('[Auction] Cancel confirm query failed:', err);
        sendMainMenu(session);
    }
}
function handleCancelConfirmChoice(session, state, slot) {
    if (slot === 0 && state.selectedId !== null) {
        cancelListing(session, state.selectedId);
    }
    else {
        sendMainMenu(session);
    }
}
async function cancelListing(session, listingId) {
    const npc = getSessionNpc(session);
    if (!deps || !npc)
        return;
    const state = dialogStates.get(session.id);
    try {
        const result = await database_1.pool.query('UPDATE auction_listings SET status = $1 WHERE id = $2 AND seller_lower = $3 AND status = $4 RETURNING item_name, bot_inventory_slot', ['cancelled', listingId, session.characterName.toLowerCase(), 'active']);
        if (result.rows.length === 0) {
            if (state)
                state.lastDialogType = 'popup_no_next';
            deps.dialogHandler.sendDialog(session, {
                type: dialog_handler_1.DialogType.Popup,
                entityId: npc.serial,
                sprite: npc.sprite,
                name: npc.name,
                text: 'Could not cancel — listing may have already been sold.',
                pursuitId: 1, stepId: 0, hasPrevious: false, hasNext: false,
            });
            return;
        }
        const row = result.rows[0];
        // Log transaction
        await database_1.pool.query('INSERT INTO auction_transactions (listing_id, type, player_name, item_name) VALUES ($1, $2, $3, $4)', [listingId, 'cancel', session.characterName, row.item_name]);
        // Send item back to seller via parcel
        sendParcelToPlayer(session.characterName, 'Cancelled Listing', row.item_name);
        if (state)
            state.lastDialogType = 'popup_no_next';
        deps.dialogHandler.sendDialog(session, {
            type: dialog_handler_1.DialogType.Popup,
            entityId: npc.serial,
            sprite: npc.sprite,
            name: npc.name,
            text: `Listing cancelled.\n\n${row.item_name} will be returned\nto you via parcel.`,
            pursuitId: 1, stepId: 0, hasPrevious: false, hasNext: false,
        });
        console.log(`[Auction] ${session.characterName} cancelled listing #${listingId}: ${row.item_name}`);
    }
    catch (err) {
        console.error('[Auction] Cancel failed:', err);
        sendMainMenu(session);
    }
}
// ── My Balance ───────────────────────────────────────────────────
async function showMyBalance(session, state) {
    const npc = getSessionNpc(session);
    if (!deps || !npc)
        return;
    state.flow = 'my_balance';
    try {
        const result = await database_1.pool.query('SELECT balance, total_earned, total_withdrawn FROM auction_balances WHERE player_lower = $1', [session.characterName.toLowerCase()]);
        const balance = result.rows.length > 0 ? Number(result.rows[0].balance) : 0;
        const totalEarned = result.rows.length > 0 ? Number(result.rows[0].total_earned) : 0;
        const botName = deps.botCharacterName;
        state.lastDialogType = 'popup_no_next';
        deps.dialogHandler.sendDialog(session, {
            type: dialog_handler_1.DialogType.Popup,
            entityId: npc.serial,
            sprite: npc.sprite,
            name: npc.name,
            text: [
                `Your Auction Balance: ${formatGold(balance)}`,
                `Total Earned: ${formatGold(totalEarned)}`,
                '',
                balance > 0
                    ? `To withdraw, approach "${botName}"\nand whisper: withdraw`
                    : 'You have no gold to withdraw.',
            ].join('\n'),
            pursuitId: 1,
            stepId: 0,
            hasPrevious: false,
            hasNext: false,
        });
    }
    catch (err) {
        console.error('[Auction] Balance query failed:', err);
        sendMainMenu(session);
    }
}
// ── Purchase Flow ────────────────────────────────────────────────
async function initiatePurchase(session, state) {
    const npc = getSessionNpc(session);
    if (!deps || !npc || state.selectedId === null)
        return;
    // Only one purchase at a time
    if (pendingPurchase) {
        state.lastDialogType = 'popup_no_next';
        deps.dialogHandler.sendDialog(session, {
            type: dialog_handler_1.DialogType.Popup,
            entityId: npc.serial,
            sprite: npc.sprite,
            name: npc.name,
            text: 'Another purchase is in progress.\nPlease try again in a moment.',
            pursuitId: 1, stepId: 0, hasPrevious: false, hasNext: false,
        });
        return;
    }
    try {
        // Atomically claim the listing
        const result = await database_1.pool.query('UPDATE auction_listings SET status = $1 WHERE id = $2 AND status = $3 RETURNING id, seller_name, item_name, price, bot_inventory_slot', ['pending', state.selectedId, 'active']);
        if (result.rows.length === 0) {
            state.lastDialogType = 'popup_no_next';
            deps.dialogHandler.sendDialog(session, {
                type: dialog_handler_1.DialogType.Popup,
                entityId: npc.serial,
                sprite: npc.sprite,
                name: npc.name,
                text: 'This item has already been sold or cancelled.',
                pursuitId: 1, stepId: 0, hasPrevious: false, hasNext: false,
            });
            return;
        }
        const listing = result.rows[0];
        const botName = deps.botCharacterName;
        pendingPurchase = {
            listingId: listing.id,
            buyerName: session.characterName,
            buyerSessionId: session.id,
            price: Number(listing.price),
            itemName: listing.item_name,
            timestamp: Date.now(),
        };
        // Timeout: if exchange not completed, release the listing
        pendingPurchaseTimer = setTimeout(() => {
            if (pendingPurchase && pendingPurchase.listingId === listing.id) {
                releasePendingPurchase('Purchase timed out');
            }
        }, PURCHASE_TIMEOUT_MS);
        closeDialog(session);
        // Tell player to trade the bot
        deps.sendWhisper(session.characterName, `Trade "${botName}" and place ${formatGold(listing.price)} to buy: ${listing.item_name}`);
        console.log(`[Auction] ${session.characterName} initiating purchase of listing #${listing.id}: ${listing.item_name} for ${formatGold(listing.price)}`);
    }
    catch (err) {
        console.error('[Auction] Purchase initiation failed:', err);
        sendMainMenu(session);
    }
}
async function releasePendingPurchase(reason) {
    if (!pendingPurchase)
        return;
    const purchase = pendingPurchase;
    pendingPurchase = null;
    if (pendingPurchaseTimer) {
        clearTimeout(pendingPurchaseTimer);
        pendingPurchaseTimer = null;
    }
    try {
        // Set listing back to active
        await database_1.pool.query('UPDATE auction_listings SET status = $1 WHERE id = $2 AND status = $3', ['active', purchase.listingId, 'pending']);
        console.log(`[Auction] Released pending purchase #${purchase.listingId}: ${reason}`);
    }
    catch (err) {
        console.error('[Auction] Failed to release purchase:', err);
    }
}
// ── Exchange Handlers (Bot Session Packets) ──────────────────────
// Called from the bot's packet handler when exchange events occur.
/**
 * Handle 0x42 Exchange packet on the bot session.
 * Subtypes: 0x00=Started, 0x02=ItemAdded, 0x03=GoldAdded, 0x04=Cancelled, 0x05=Accepted
 */
function handleExchangeMessage(packet) {
    if (!deps)
        return;
    const subtype = packet.readByte();
    if (subtype === 0x00) {
        // Exchange started — another player initiated trade with bot
        const otherSerial = packet.readUInt32();
        const otherName = packet.readString8();
        // Check if this is a pending purchase
        if (pendingPurchase && pendingPurchase.buyerName.toLowerCase() === otherName.toLowerCase()) {
            // Accept the exchange
            setTimeout(() => {
                const accept = new packet_1.default(0x4A);
                accept.writeByte(0x05);
                accept.writeUInt32(otherSerial);
                deps.sendPacket(accept);
            }, 500);
            console.log(`[Auction] Exchange started with buyer ${otherName} for purchase #${pendingPurchase.listingId}`);
        }
        else if (pendingCashout && pendingCashout.playerName.toLowerCase() === otherName.toLowerCase()) {
            // Cashout exchange — accept and place gold
            pendingCashout.playerSerial = otherSerial;
            setTimeout(() => {
                const accept = new packet_1.default(0x4A);
                accept.writeByte(0x05);
                accept.writeUInt32(otherSerial);
                deps.sendPacket(accept);
                // Place gold after accepting
                setTimeout(() => {
                    if (!pendingCashout)
                        return;
                    const placeGold = new packet_1.default(0x4A);
                    placeGold.writeByte(0x03);
                    placeGold.writeUInt32(pendingCashout.playerSerial);
                    placeGold.writeUInt32(pendingCashout.goldAmount);
                    deps.sendPacket(placeGold);
                    pendingCashout.goldPlaced = true;
                    // Confirm after placing gold
                    setTimeout(() => {
                        if (!pendingCashout)
                            return;
                        const confirm = new packet_1.default(0x4A);
                        confirm.writeByte(0x00);
                        confirm.writeUInt32(pendingCashout.playerSerial);
                        deps.sendPacket(confirm);
                        setTimeout(() => {
                            if (!pendingCashout)
                                return;
                            const finalConfirm = new packet_1.default(0x4A);
                            finalConfirm.writeByte(0x05);
                            finalConfirm.writeUInt32(pendingCashout.playerSerial);
                            deps.sendPacket(finalConfirm);
                        }, 1000);
                    }, 500);
                }, 1000);
            }, 500);
            console.log(`[Auction] Cashout exchange started with ${otherName}`);
        }
    }
    else if (subtype === 0x03) {
        // Gold added by the other party
        const party = packet.readByte();
        const goldAmount = packet.readUInt32();
        if (party === 1 && pendingPurchase) {
            // Buyer placed gold
            if (goldAmount >= pendingPurchase.price) {
                // Confirm the exchange
                const buyerSerial = deps.getSerialByName
                    ? deps.getSerialByName(pendingPurchase.buyerName)
                    : undefined;
                if (buyerSerial) {
                    setTimeout(() => {
                        const confirm = new packet_1.default(0x4A);
                        confirm.writeByte(0x00);
                        confirm.writeUInt32(buyerSerial);
                        deps.sendPacket(confirm);
                        setTimeout(() => {
                            const finalConfirm = new packet_1.default(0x4A);
                            finalConfirm.writeByte(0x05);
                            finalConfirm.writeUInt32(buyerSerial);
                            deps.sendPacket(finalConfirm);
                        }, 1000);
                    }, 500);
                }
                console.log(`[Auction] Buyer placed ${formatGold(goldAmount)} for purchase #${pendingPurchase.listingId}`);
            }
            else {
                console.log(`[Auction] Buyer placed insufficient gold: ${formatGold(goldAmount)} < ${formatGold(pendingPurchase.price)}`);
            }
        }
    }
    else if (subtype === 0x05) {
        // Exchange accepted/completed
        const party = packet.readByte();
        if (party === 0x01 && pendingPurchase) {
            completePurchase();
        }
        else if (party === 0x01 && pendingCashout && pendingCashout.goldPlaced) {
            completeCashout();
        }
    }
    else if (subtype === 0x04) {
        // Exchange cancelled
        if (pendingPurchase) {
            releasePendingPurchase('Exchange cancelled by player');
        }
        if (pendingCashout) {
            console.log(`[Auction] Cashout cancelled for ${pendingCashout.playerName}`);
            pendingCashout = null;
        }
    }
}
async function completePurchase() {
    if (!deps || !pendingPurchase)
        return;
    const purchase = pendingPurchase;
    pendingPurchase = null;
    if (pendingPurchaseTimer) {
        clearTimeout(pendingPurchaseTimer);
        pendingPurchaseTimer = null;
    }
    try {
        // Mark listing as sold
        await database_1.pool.query('UPDATE auction_listings SET status = $1, sold_at = NOW(), buyer_name = $2 WHERE id = $3', ['sold', purchase.buyerName, purchase.listingId]);
        // Credit seller's balance
        await database_1.pool.query(`INSERT INTO auction_balances (player_name, player_lower, balance, total_earned)
       VALUES ((SELECT seller_name FROM auction_listings WHERE id = $1),
               (SELECT seller_lower FROM auction_listings WHERE id = $1),
               $2, $2)
       ON CONFLICT (player_lower) DO UPDATE SET
         balance = auction_balances.balance + $2,
         total_earned = auction_balances.total_earned + $2,
         updated_at = NOW()`, [purchase.listingId, purchase.price]);
        // Log transaction
        await database_1.pool.query('INSERT INTO auction_transactions (listing_id, type, player_name, item_name, gold_amount) VALUES ($1, $2, $3, $4, $5)', [purchase.listingId, 'buy', purchase.buyerName, purchase.itemName, purchase.price]);
        // Deliver item to buyer via parcel
        sendParcelToPlayer(purchase.buyerName, 'Auction Purchase', purchase.itemName);
        // Whisper confirmation to buyer
        deps.sendWhisper(purchase.buyerName, `Purchase complete! ${purchase.itemName} will be delivered via parcel.`);
        console.log(`[Auction] Sale complete: ${purchase.buyerName} bought "${purchase.itemName}" for ${formatGold(purchase.price)} (listing #${purchase.listingId})`);
    }
    catch (err) {
        console.error('[Auction] Failed to complete purchase:', err);
    }
}
async function completeCashout() {
    if (!deps || !pendingCashout)
        return;
    const cashout = pendingCashout;
    pendingCashout = null;
    try {
        await database_1.pool.query(`UPDATE auction_balances SET
         balance = balance - $1,
         total_withdrawn = total_withdrawn + $1,
         updated_at = NOW()
       WHERE player_lower = $2`, [cashout.goldAmount, cashout.playerName.toLowerCase()]);
        await database_1.pool.query('INSERT INTO auction_transactions (type, player_name, gold_amount) VALUES ($1, $2, $3)', ['withdraw', cashout.playerName, cashout.goldAmount]);
        deps.sendWhisper(cashout.playerName, `Withdrawn ${formatGold(cashout.goldAmount)} from your auction balance.`);
        console.log(`[Auction] ${cashout.playerName} withdrew ${formatGold(cashout.goldAmount)}`);
    }
    catch (err) {
        console.error('[Auction] Failed to complete cashout:', err);
    }
}
// ── Parcel Intake (Seller → Bot) ─────────────────────────────────
// Called when the proxy detects a 0x3B SendMail addressed to the bot.
/**
 * Record a pending parcel intake. Called when a player sends a parcel to the bot.
 */
function onParcelSent(senderName, subject) {
    const price = parseInt(subject.replace(/[^0-9]/g, ''), 10);
    if (!price || price <= 0) {
        if (deps) {
            deps.sendWhisper(senderName, 'Invalid price. Set the parcel SUBJECT to the gold price (e.g., 500000).');
        }
        return;
    }
    pendingIntakes.push({
        senderName,
        price,
        timestamp: Date.now(),
        description: null,
        expectedItemName: '',
    });
    console.log(`[Auction] Pending intake from ${senderName}: price=${formatGold(price)}`);
    // Timeout old intakes
    setTimeout(() => {
        const idx = pendingIntakes.findIndex(i => i.senderName === senderName && i.price === price);
        if (idx >= 0 && Date.now() - pendingIntakes[idx].timestamp >= INTAKE_TIMEOUT_MS) {
            pendingIntakes.splice(idx, 1);
            console.log(`[Auction] Intake from ${senderName} timed out`);
        }
    }, INTAKE_TIMEOUT_MS + 1000);
}
/**
 * Handle 0x37 AddItem on the bot session. If there's a pending intake, create a listing.
 */
async function handleBotAddItem(packet) {
    const slot = packet.readByte();
    const sprite = packet.readUInt16();
    const color = packet.readByte();
    const name = packet.readString8();
    botInventory.set(slot, name);
    // Check if this matches a pending intake
    // Prefer matching by expectedItemName (from sell dialog flow), fall back to FIFO (legacy parcel flow)
    if (pendingIntakes.length > 0) {
        let intakeIdx = pendingIntakes.findIndex(i => i.expectedItemName && i.expectedItemName.toLowerCase() === name.toLowerCase());
        if (intakeIdx < 0)
            intakeIdx = 0; // FIFO fallback
        const intake = pendingIntakes.splice(intakeIdx, 1)[0];
        try {
            const result = await database_1.pool.query(`INSERT INTO auction_listings (seller_name, seller_lower, item_name, item_sprite, item_color, price, bot_inventory_slot, description, status, listed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', NOW()) RETURNING id`, [intake.senderName, intake.senderName.toLowerCase(), name, sprite, color, intake.price, slot, intake.description]);
            const listingId = result.rows[0].id;
            await database_1.pool.query('INSERT INTO auction_transactions (listing_id, type, player_name, item_name, gold_amount) VALUES ($1, $2, $3, $4, $5)', [listingId, 'list', intake.senderName, name, intake.price]);
            if (deps) {
                deps.sendWhisper(intake.senderName, `Listed: ${name} for ${formatGold(intake.price)} (listing #${listingId})`);
            }
            console.log(`[Auction] Created listing #${listingId}: "${name}" from ${intake.senderName} for ${formatGold(intake.price)}`);
        }
        catch (err) {
            console.error('[Auction] Failed to create listing:', err);
        }
    }
}
/**
 * Handle 0x38 RemoveItem on the bot session.
 */
function handleBotRemoveItem(packet) {
    const slot = packet.readByte();
    botInventory.delete(slot);
}
// ── Whisper Handler ──────────────────────────────────────────────
// Called when a player whispers the bot.
async function handleWhisper(senderName, message) {
    if (!deps)
        return;
    const msg = message.trim().toLowerCase();
    if (msg === 'withdraw') {
        try {
            const result = await database_1.pool.query('SELECT balance FROM auction_balances WHERE player_lower = $1', [senderName.toLowerCase()]);
            const balance = result.rows.length > 0 ? Number(result.rows[0].balance) : 0;
            if (balance <= 0) {
                deps.sendWhisper(senderName, 'You have no auction balance to withdraw.');
                return;
            }
            if (pendingCashout) {
                deps.sendWhisper(senderName, 'Another withdrawal is in progress. Please wait.');
                return;
            }
            pendingCashout = {
                playerName: senderName,
                playerSerial: 0, // will be set when exchange starts
                goldAmount: balance,
                goldPlaced: false,
            };
            deps.sendWhisper(senderName, `Withdrawing ${formatGold(balance)}. Trade me to collect your gold!`);
            console.log(`[Auction] ${senderName} requested withdrawal of ${formatGold(balance)}`);
        }
        catch (err) {
            console.error('[Auction] Withdrawal query failed:', err);
        }
    }
}
// ── Parcel Sending (Bot → Player) ────────────────────────────────
function sendParcelToPlayer(recipientName, subject, _itemName) {
    if (!deps)
        return;
    // The bot sends a parcel via 0x3B SendMail
    // The server will attach the item from the bot's inventory
    const pkt = new packet_1.default(0x3B);
    pkt.writeByte(6); // Action: SendMail (MessageBoardAction.SendMail = 6)
    pkt.writeUInt16(0); // BoardId (parcel board)
    pkt.writeString8(recipientName);
    pkt.writeString8(subject);
    pkt.writeString16('From the Auction House.');
    deps.sendPacket(pkt);
    console.log(`[Auction] Sent parcel to ${recipientName}: "${subject}"`);
}
// ── Session Cleanup ──────────────────────────────────────────────
function onSessionEnd(sessionId) {
    dialogStates.delete(sessionId);
    // If the disconnecting session had a pending purchase, release it
    if (pendingPurchase && pendingPurchase.buyerSessionId === sessionId) {
        releasePendingPurchase('Buyer disconnected');
    }
}
// ── Utility ────────────────────────────────────────────────���─────
function closeDialog(session) {
    const npc = getSessionNpc(session);
    if (!deps || !npc)
        return;
    deps.dialogHandler.sendCloseDialog(session, npc);
    dialogStates.delete(session.id);
}
function formatGold(amount) {
    if (amount >= 1_000_000) {
        const m = (amount / 1_000_000).toFixed(amount % 1_000_000 === 0 ? 0 : 1);
        return m + 'm gold';
    }
    if (amount >= 1_000) {
        const k = (amount / 1_000).toFixed(amount % 1_000 === 0 ? 0 : 1);
        return k + 'k gold';
    }
    return amount.toLocaleString() + ' gold';
}
// ── Slash Commands ───────────────────────────────────────────────
async function handleAuctionCommand(session, _args) {
    try {
        const listingsResult = await database_1.pool.query('SELECT COUNT(*) as count FROM auction_listings WHERE status = $1', ['active']);
        const totalResult = await database_1.pool.query('SELECT COUNT(*) as count, COALESCE(SUM(price), 0) as volume FROM auction_listings WHERE status = $1', ['sold']);
        const activeCount = listingsResult.rows[0].count;
        const soldCount = totalResult.rows[0].count;
        const totalVolume = Number(totalResult.rows[0].volume);
        if (deps) {
            const chat = `[Auction] Active: ${activeCount} listings | Sold: ${soldCount} | Volume: ${formatGold(totalVolume)}`;
            // Send as system message via the proxy's chat injector if available
            deps.proxy.emit('system:message', session, chat);
        }
    }
    catch (err) {
        console.error('[Auction] Stats query failed:', err);
    }
}
// ── Exports ──────────────────────────────────────────────────────
function getAuctionNpcSerial() {
    return auctionNpcSerial;
}
function getNpc() {
    if (auctionNpcs.size > 0)
        return auctionNpcs.values().next().value;
    return null;
}
/** Get all NPC serials currently assigned as auctioneers */
function getAuctionNpcSerials() {
    return Array.from(auctionNpcs.keys());
}
/**
 * Check if a given NPC serial is an auctioneer.
 */
function isAuctionNpc(serial) {
    return auctionNpcs.has(serial);
}
/**
 * Attach the auction handler to an existing virtual NPC.
 * Supports multiple NPCs — each one becomes an independent auctioneer.
 */
function assignToNpc(npc) {
    if (!deps) {
        console.log('[Auction] Cannot assign — auction house not initialized. Call init() first.');
        return;
    }
    if (auctionNpcs.has(npc.serial)) {
        console.log(`[Auction] NPC "${npc.name}" (0x${npc.serial.toString(16)}) is already an auctioneer.`);
        return;
    }
    npc.onInteract = createInteractHandler(npc.serial);
    auctionNpcs.set(npc.serial, npc);
    console.log(`[Auction] Assigned to NPC "${npc.name}" serial=0x${npc.serial.toString(16)} at map ${npc.mapNumber} (${npc.x},${npc.y}) — total auctioneers: ${auctionNpcs.size}`);
}
/**
 * Remove auction handler from an NPC.
 */
function unassignFromNpc(serial) {
    const npc = auctionNpcs.get(serial);
    if (npc) {
        npc.onInteract = undefined;
        auctionNpcs.delete(serial);
        console.log(`[Auction] Unassigned NPC "${npc.name}" (0x${serial.toString(16)}) — total auctioneers: ${auctionNpcs.size}`);
    }
}
function isInitialized() {
    return deps !== null;
}
//# sourceMappingURL=auction-house.js.map