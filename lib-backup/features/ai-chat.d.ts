export declare function init(deps: {
    sendSay: (text: string) => void;
    sendWhisper: (target: string, text: string) => void;
    getUsername: () => string;
    io: any;
    db?: any;
    getChatHistory?: () => any[];
    playerTracker?: any;
    chatGames?: any;
}): void;
export declare function isEnabled(): boolean;
export declare function setEnabled(val: boolean): void;
export declare function refreshKnowledgeCache(): void;
export declare function handlePublicMention(sender: string, message: string): void;
export declare function handleWhisper(sender: string, message: string): boolean;
export declare function addToBlacklist(name: string): void;
export declare function removeFromBlacklist(name: string): void;
export declare function getBlacklist(): string[];
export declare function setBlacklist(names: string[]): void;
