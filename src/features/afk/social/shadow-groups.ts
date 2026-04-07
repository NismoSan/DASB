/**
 * Shadow Group/Party System — party formation, shared XP, group chat.
 */

export interface ShadowGroup {
    id: string;
    leaderSessionId: string;
    members: Set<string>;
    createdAt: number;
}

const groups: Map<string, ShadowGroup> = new Map();
const playerGroups: Map<string, string> = new Map();

let groupIdCounter = 0;

export function createGroup(leaderSessionId: string): ShadowGroup {
    const id = `group_${++groupIdCounter}`;
    const group: ShadowGroup = {
        id,
        leaderSessionId,
        members: new Set([leaderSessionId]),
        createdAt: Date.now(),
    };
    groups.set(id, group);
    playerGroups.set(leaderSessionId, id);
    return group;
}

export function getPlayerGroup(sessionId: string): ShadowGroup | undefined {
    const groupId = playerGroups.get(sessionId);
    if (!groupId) return undefined;
    return groups.get(groupId);
}

export function addToGroup(groupId: string, sessionId: string): boolean {
    const group = groups.get(groupId);
    if (!group) return false;
    if (group.members.size >= 5) return false;
    if (playerGroups.has(sessionId)) return false;
    group.members.add(sessionId);
    playerGroups.set(sessionId, groupId);
    return true;
}

export function removeFromGroup(sessionId: string): boolean {
    const groupId = playerGroups.get(sessionId);
    if (!groupId) return false;

    const group = groups.get(groupId);
    if (!group) {
        playerGroups.delete(sessionId);
        return false;
    }

    group.members.delete(sessionId);
    playerGroups.delete(sessionId);

    if (group.members.size === 0) {
        groups.delete(groupId);
    } else if (group.leaderSessionId === sessionId) {
        group.leaderSessionId = group.members.values().next().value!;
    }

    return true;
}

export function disbandGroup(groupId: string): string[] {
    const group = groups.get(groupId);
    if (!group) return [];

    const members = Array.from(group.members);
    for (const member of members) {
        playerGroups.delete(member);
    }
    groups.delete(groupId);
    return members;
}

export function getGroupMembers(sessionId: string): string[] {
    const group = getPlayerGroup(sessionId);
    if (!group) return [];
    return Array.from(group.members);
}

export function isInSameGroup(sessionId1: string, sessionId2: string): boolean {
    const g1 = playerGroups.get(sessionId1);
    const g2 = playerGroups.get(sessionId2);
    return g1 !== undefined && g1 === g2;
}

export function splitExpAmongGroup(
    killerSessionId: string,
    totalExp: number,
    getSessionMapId: (sessionId: string) => number | null
): Map<string, number> {
    const result = new Map<string, number>();
    const group = getPlayerGroup(killerSessionId);

    if (!group) {
        result.set(killerSessionId, totalExp);
        return result;
    }

    const killerMapId = getSessionMapId(killerSessionId);
    const eligibleMembers = Array.from(group.members).filter(id => {
        const mapId = getSessionMapId(id);
        return mapId !== null && mapId === killerMapId;
    });

    if (eligibleMembers.length === 0) {
        result.set(killerSessionId, totalExp);
        return result;
    }

    // Group XP bonus: 10% per additional member
    const bonus = 1 + (eligibleMembers.length - 1) * 0.1;
    const sharedExp = Math.floor((totalExp * bonus) / eligibleMembers.length);

    for (const memberId of eligibleMembers) {
        result.set(memberId, sharedExp);
    }

    return result;
}
