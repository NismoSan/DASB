/**
 * Hot-reload system for the DASB proxy.
 *
 * Watches lib/ for compiled JS changes and hot-swaps modules without
 * dropping TCP connections. Feature modules get require.cache invalidation
 * + var reassignment; proxy subsystems get prototype-swapped.
 */
interface FeatureRegistryEntry {
    name: string;
    getRef: () => any;
    setRef: (m: any) => void;
    getInitDeps: () => any;
    initStyle?: 'single' | 'spread';
}
interface ReloadResult {
    success: boolean;
    file: string;
    type: string;
    error?: string;
}
export declare class HotReloader {
    private io;
    private proxySystem;
    private featureRegistry;
    private basePath;
    private watcher;
    private debounceTimers;
    private reloadCount;
    constructor(opts: {
        io: any;
        proxySystem: any;
        featureRegistry: Map<string, FeatureRegistryEntry>;
        basePath: string;
    });
    start(): void;
    stop(): void;
    reloadFile(absolutePath: string): ReloadResult;
    reloadAll(): {
        succeeded: number;
        failed: number;
        results: ReloadResult[];
    };
    reloadByName(name: string): ReloadResult;
    private classifyFile;
    /**
     * Reload a feature module: clear cache, re-require, reassign var, re-init.
     */
    private reloadFeature;
    /**
     * Reload a proxy subsystem module via prototype swapping.
     * Preserves instance state while replacing methods.
     */
    private reloadProxyModule;
    private patchAugmentation;
    private patchAutomation;
    private patchCommands;
    private patchTriggers;
    private patchPacketInspector;
    private patchPlayerRegistry;
    /**
     * Clear a module and its in-lib dependents from require.cache.
     */
    private clearRequireCacheTree;
    getStatus(): {
        watching: boolean;
        reloadCount: number;
        registeredFeatures: string[];
    };
}
export {};
