import { DiscordRule, DiscordMessage } from '../types';
export declare function init(_: any, db: any): void;
export declare function setRulesFromDB(rules: DiscordRule[]): void;
export declare function checkAndDispatch(msg: DiscordMessage): void;
export declare function getRules(): DiscordRule[];
export declare function saveRule(rule: DiscordRule): DiscordRule[];
export declare function deleteRule(id: string): DiscordRule[];
export declare function toggleRule(id: string, enabled: boolean): DiscordRule[];
export declare function testWebhook(url: string, botName?: string): Promise<{
    success: boolean;
    error?: string;
}>;
