import type { CapturedMonster, BattleState, WildEncounter } from './types';
export declare function getBattle(sessionId: string): BattleState | undefined;
export declare function isInBattle(sessionId: string): boolean;
export declare function createPvpBattle(trainerASession: string, monA: CapturedMonster, monASerial: number, monAX: number, monAY: number, trainerBSession: string, monB: CapturedMonster, monBSerial: number, monBX: number, monBY: number): BattleState;
export declare function createWildBattle(trainerSession: string, mon: CapturedMonster, monSerial: number, monX: number, monY: number, wildEncounter: WildEncounter): BattleState;
export interface TurnResult {
    attackerName: string;
    defenderName: string;
    moveName: string;
    damage: number;
    effectiveness: string;
    attackerSerial: number;
    defenderSerial: number;
    defenderHpPercent: number;
    defenderFainted: boolean;
    healed?: number;
}
export interface RoundResult {
    turnResults: TurnResult[];
    battleOver: boolean;
    winner: 'a' | 'b' | null;
}
/**
 * Submit a move for one side. When both sides have submitted,
 * resolve the round and return results.
 */
export declare function submitMove(battleId: string, side: 'a' | 'b', moveName: string): RoundResult | null;
export declare function finishBattle(battleId: string, winner: 'a' | 'b'): Promise<{
    winnerName: string;
    loserName: string;
}>;
export declare function forfeitBattle(sessionId: string): BattleState | undefined;
export declare function cleanupBattle(battleId: string): void;
