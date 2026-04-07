"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HotReloader = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class HotReloader {
    io;
    proxySystem;
    featureRegistry;
    basePath;
    watcher = null;
    debounceTimers = new Map();
    reloadCount = 0;
    constructor(opts) {
        this.io = opts.io;
        this.proxySystem = opts.proxySystem;
        this.featureRegistry = opts.featureRegistry;
        this.basePath = opts.basePath;
    }
    start() {
        const libDir = path_1.default.join(this.basePath, 'lib');
        try {
            this.watcher = fs_1.default.watch(libDir, { recursive: true }, (eventType, filename) => {
                if (!filename || !filename.endsWith('.js'))
                    return;
                // Ignore source maps and declaration files
                if (filename.endsWith('.js.map') || filename.endsWith('.d.ts'))
                    return;
                const absolutePath = path_1.default.join(libDir, filename);
                // Debounce: tsc writes atomically but fs.watch can fire multiple times
                const existing = this.debounceTimers.get(absolutePath);
                if (existing)
                    clearTimeout(existing);
                this.debounceTimers.set(absolutePath, setTimeout(() => {
                    this.debounceTimers.delete(absolutePath);
                    this.reloadFile(absolutePath);
                }, 500));
            });
            console.log('[HotReload] Watching lib/ for changes');
        }
        catch (e) {
            console.error('[HotReload] Failed to start watcher:', e.message);
        }
    }
    stop() {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();
    }
    reloadFile(absolutePath) {
        const relative = path_1.default.relative(this.basePath, absolutePath);
        const category = this.classifyFile(relative);
        if (category === 'skip' || category === 'proxy-core') {
            console.log(`[HotReload] Skipping ${relative} (${category})`);
            return { success: false, file: relative, type: category, error: 'skipped' };
        }
        let result;
        if (category === 'feature') {
            result = this.reloadFeature(absolutePath, relative);
        }
        else {
            result = this.reloadProxyModule(absolutePath, relative);
        }
        if (result.success) {
            this.reloadCount++;
            this.io?.emit?.('hotreload:success', { file: relative, type: category, count: this.reloadCount });
        }
        else {
            this.io?.emit?.('hotreload:error', { file: relative, error: result.error });
        }
        return result;
    }
    reloadAll() {
        const results = [];
        let succeeded = 0;
        let failed = 0;
        // Reload all registered features
        for (const [resolvedPath, entry] of this.featureRegistry) {
            const relative = path_1.default.relative(this.basePath, resolvedPath);
            const result = this.reloadFeature(resolvedPath, relative);
            results.push(result);
            if (result.success)
                succeeded++;
            else
                failed++;
        }
        console.log(`[HotReload] Reloaded all: ${succeeded} succeeded, ${failed} failed`);
        return { succeeded, failed, results };
    }
    reloadByName(name) {
        // Search feature registry by name
        for (const [resolvedPath, entry] of this.featureRegistry) {
            if (entry.name === name) {
                const relative = path_1.default.relative(this.basePath, resolvedPath);
                return this.reloadFeature(resolvedPath, relative);
            }
        }
        // Try to find a proxy module by name
        const libDir = path_1.default.join(this.basePath, 'lib');
        const candidates = [
            path_1.default.join(libDir, 'proxy', 'augmentation', name + '.js'),
            path_1.default.join(libDir, 'proxy', 'automation', name + '.js'),
            path_1.default.join(libDir, 'proxy', 'commands', name + '.js'),
            path_1.default.join(libDir, 'proxy', 'triggers', name + '.js'),
            path_1.default.join(libDir, 'features', name + '.js'),
            path_1.default.join(libDir, 'games', name + '.js'),
        ];
        for (const candidate of candidates) {
            if (fs_1.default.existsSync(candidate)) {
                const relative = path_1.default.relative(this.basePath, candidate);
                const category = this.classifyFile(relative);
                if (category === 'feature')
                    return this.reloadFeature(candidate, relative);
                if (category === 'proxy-subsystem')
                    return this.reloadProxyModule(candidate, relative);
            }
        }
        return { success: false, file: name, type: 'unknown', error: 'Module not found' };
    }
    classifyFile(relative) {
        // Normalize separators
        const normalized = relative.replace(/\\/g, '/');
        // Features
        if (normalized.startsWith('lib/features/') && normalized.endsWith('.js')) {
            // Don't try to hot-reload hot-reloader itself
            if (normalized.includes('hot-reloader'))
                return 'skip';
            return 'feature';
        }
        // Games
        if (normalized.startsWith('lib/games/') && normalized.endsWith('.js')) {
            return 'feature';
        }
        // Proxy subsystems (safe to prototype-swap)
        if (normalized.startsWith('lib/proxy/augmentation/'))
            return 'proxy-subsystem';
        if (normalized.startsWith('lib/proxy/automation/'))
            return 'proxy-subsystem';
        if (normalized.startsWith('lib/proxy/commands/'))
            return 'proxy-subsystem';
        if (normalized.startsWith('lib/proxy/triggers/'))
            return 'proxy-subsystem';
        if (normalized === 'lib/proxy/packet-inspector.js')
            return 'proxy-subsystem';
        if (normalized === 'lib/proxy/player-registry.js')
            return 'proxy-subsystem';
        // Proxy core (never touch)
        if (normalized === 'lib/proxy/proxy-server.js')
            return 'proxy-core';
        if (normalized === 'lib/proxy/proxy-session.js')
            return 'proxy-core';
        if (normalized === 'lib/proxy/proxy-crypto.js')
            return 'proxy-core';
        if (normalized === 'lib/proxy/index.js')
            return 'proxy-core';
        // Core modules (fundamental types)
        if (normalized.startsWith('lib/core/'))
            return 'skip';
        return 'skip';
    }
    /**
     * Reload a feature module: clear cache, re-require, reassign var, re-init.
     */
    reloadFeature(absolutePath, relative) {
        let resolved;
        try {
            resolved = require.resolve(absolutePath);
        }
        catch {
            return { success: false, file: relative, type: 'feature', error: 'Cannot resolve module' };
        }
        const entry = this.featureRegistry.get(resolved);
        const oldModule = require.cache[resolved];
        // Clear from cache + dependents
        this.clearRequireCacheTree(resolved);
        try {
            const fresh = require(resolved);
            if (entry) {
                // Reassign the panel.js var
                entry.setRef(fresh);
                // Re-initialize with same deps
                if (typeof fresh.init === 'function') {
                    const deps = entry.getInitDeps();
                    if (entry.initStyle === 'spread' && Array.isArray(deps)) {
                        fresh.init(...deps);
                    }
                    else {
                        fresh.init(deps);
                    }
                }
                console.log(`[HotReload] Feature reloaded: ${entry.name} (${relative})`);
            }
            else {
                console.log(`[HotReload] Feature cache cleared: ${relative} (no registry entry)`);
            }
            return { success: true, file: relative, type: 'feature' };
        }
        catch (e) {
            // Rollback: restore old module to cache
            if (oldModule) {
                require.cache[resolved] = oldModule;
            }
            console.error(`[HotReload] FAILED to reload ${relative}: ${e.message}`);
            return { success: false, file: relative, type: 'feature', error: e.message };
        }
    }
    /**
     * Reload a proxy subsystem module via prototype swapping.
     * Preserves instance state while replacing methods.
     */
    reloadProxyModule(absolutePath, relative) {
        let resolved;
        try {
            resolved = require.resolve(absolutePath);
        }
        catch {
            return { success: false, file: relative, type: 'proxy-subsystem', error: 'Cannot resolve module' };
        }
        const oldModule = require.cache[resolved];
        // Clear cache
        this.clearRequireCacheTree(resolved);
        try {
            const freshModule = require(resolved);
            const FreshClass = freshModule.default || freshModule;
            const normalized = relative.replace(/\\/g, '/');
            let patched = 0;
            // Augmentation subsystems
            if (normalized.startsWith('lib/proxy/augmentation/')) {
                patched = this.patchAugmentation(normalized, FreshClass, freshModule);
            }
            // Automation subsystems
            else if (normalized.startsWith('lib/proxy/automation/')) {
                patched = this.patchAutomation(normalized, FreshClass, freshModule);
            }
            // Commands
            else if (normalized.startsWith('lib/proxy/commands/')) {
                patched = this.patchCommands(normalized, FreshClass, freshModule);
            }
            // Triggers
            else if (normalized.startsWith('lib/proxy/triggers/')) {
                patched = this.patchTriggers(normalized, FreshClass, freshModule);
            }
            // PacketInspector
            else if (normalized === 'lib/proxy/packet-inspector.js') {
                patched = this.patchPacketInspector(freshModule);
            }
            // PlayerRegistry
            else if (normalized === 'lib/proxy/player-registry.js') {
                patched = this.patchPlayerRegistry(FreshClass);
            }
            console.log(`[HotReload] Proxy module reloaded: ${path_1.default.basename(absolutePath)} (${patched} instance(s) patched)`);
            return { success: true, file: relative, type: 'proxy-subsystem' };
        }
        catch (e) {
            if (oldModule) {
                require.cache[resolved] = oldModule;
            }
            console.error(`[HotReload] FAILED to reload ${relative}: ${e.message}`);
            return { success: false, file: relative, type: 'proxy-subsystem', error: e.message };
        }
    }
    patchAugmentation(normalized, FreshClass, freshModule) {
        const aug = this.proxySystem?.augmentation;
        if (!aug)
            return 0;
        const basename = path_1.default.basename(normalized, '.js');
        const targetMap = {
            'index': aug,
            'npc-injector': aug.npcs,
            'chat-injector': aug.chat,
            'dialog-handler': aug.dialogs,
            'exit-marker': aug.exitMarker,
            'custom-doors': aug.customDoors,
        };
        const target = targetMap[basename];
        if (target && typeof FreshClass === 'function') {
            Object.setPrototypeOf(target, FreshClass.prototype);
            return 1;
        }
        return 0;
    }
    patchAutomation(normalized, FreshClass, freshModule) {
        const auto = this.proxySystem?.automation;
        if (!auto)
            return 0;
        const basename = path_1.default.basename(normalized, '.js');
        // AutomationManager itself
        if (basename === 'index') {
            if (typeof FreshClass === 'function') {
                Object.setPrototypeOf(auto, FreshClass.prototype);
                return 1;
            }
            return 0;
        }
        // Per-session engine mapping
        const sessionPropMap = {
            'proxy-navigator': 'navigator',
            'spell-caster': 'caster',
            'buff-tracker': 'buffs',
            'combat-engine': 'combat',
            'heal-engine': 'heal',
            'loot-engine': 'loot',
            'desync-monitor': 'desync',
        };
        const prop = sessionPropMap[basename];
        if (prop && typeof FreshClass === 'function') {
            // Patch all active sessions
            let count = 0;
            const sessions = auto.sessions;
            if (sessions && typeof sessions.entries === 'function') {
                for (const [, sessionAuto] of sessions) {
                    if (sessionAuto[prop]) {
                        Object.setPrototypeOf(sessionAuto[prop], FreshClass.prototype);
                        count++;
                    }
                }
            }
            return count;
        }
        // Static utility modules (proxy-collision, proxy-movement, humanizer, target-selector)
        // These don't have persistent instances to patch, but clearing cache is enough
        // since they'll be re-required by their consumers on next use
        return 0;
    }
    patchCommands(normalized, FreshClass, freshModule) {
        const basename = path_1.default.basename(normalized, '.js');
        if (basename === 'command-registry') {
            // Patch the CommandRegistry prototype
            const commands = this.proxySystem?.augmentation?.commands;
            if (commands && typeof FreshClass === 'function') {
                Object.setPrototypeOf(commands, FreshClass.prototype);
                return 1;
            }
        }
        // For commands/index.js (built-in command definitions), the commands
        // themselves are registered during createProxySystem. Clearing cache
        // means they'll pick up fresh logic on next require.
        return 0;
    }
    patchTriggers(normalized, FreshClass, freshModule) {
        const triggers = this.proxySystem?.triggers;
        if (!triggers)
            return 0;
        const basename = path_1.default.basename(normalized, '.js');
        if (basename === 'trigger-engine' && typeof FreshClass === 'function') {
            Object.setPrototypeOf(triggers, FreshClass.prototype);
            return 1;
        }
        return 0;
    }
    patchPacketInspector(freshModule) {
        const inspector = this.proxySystem?.inspector;
        if (!inspector)
            return 0;
        // Patch the inspector prototype if PacketInspector class is exported
        const FreshInspector = freshModule.PacketInspector;
        if (FreshInspector && typeof FreshInspector === 'function') {
            Object.setPrototypeOf(inspector, FreshInspector.prototype);
        }
        // Also update the playerState middleware if the factory is exported
        if (typeof freshModule.playerStateMiddleware === 'function') {
            const middlewares = inspector.middlewares;
            if (Array.isArray(middlewares)) {
                const mw = middlewares.find((m) => m.name === 'playerState');
                if (mw) {
                    mw.fn = freshModule.playerStateMiddleware();
                    return 1;
                }
            }
        }
        return 0;
    }
    patchPlayerRegistry(FreshClass) {
        const registry = this.proxySystem?.registry;
        if (registry && typeof FreshClass === 'function') {
            Object.setPrototypeOf(registry, FreshClass.prototype);
            return 1;
        }
        return 0;
    }
    /**
     * Clear a module and its in-lib dependents from require.cache.
     */
    clearRequireCacheTree(resolved) {
        const toDelete = new Set([resolved]);
        const libPrefix = path_1.default.join(this.basePath, 'lib');
        // Find modules in lib/ that directly depend on the changed module
        for (const [key, mod] of Object.entries(require.cache)) {
            if (!mod || !key.startsWith(libPrefix))
                continue;
            if (key.includes('node_modules'))
                continue;
            if (mod.children?.some(child => child.id === resolved)) {
                toDelete.add(key);
            }
        }
        for (const key of toDelete) {
            delete require.cache[key];
        }
    }
    getStatus() {
        return {
            watching: this.watcher !== null,
            reloadCount: this.reloadCount,
            registeredFeatures: Array.from(this.featureRegistry.values()).map(e => e.name),
        };
    }
}
exports.HotReloader = HotReloader;
//# sourceMappingURL=hot-reloader.js.map