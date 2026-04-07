import type ProxyServer from '../proxy/proxy-server';
import { createProxyRewardGrant } from './proxy-events';
import { getActiveMonster, updateMonster } from './monster-capture/monster-db';
import { calculateXpToNext } from './monster-capture/species-data';
import { refreshCompanion } from './monster-capture/companion';

export type ProxyFeatureReward =
    | {
        kind: 'legend';
        rewardKey: string;
        icon: number;
        color: number;
        key: string;
        text: string;
    }
    | {
        kind: 'nametag_style';
        rewardKey: string;
        style: number;
    }
    | {
        kind: 'hall_record';
        rewardKey: string;
        text?: string;
    }
    | {
        kind: 'monster_xp';
        rewardKey: string;
        xp: number;
    };

export interface ProxyRewardGrantResult {
    status: 'granted' | 'already_granted' | 'failed';
    summary: string;
}

export async function grantProxyReward(
    proxy: ProxyServer,
    featureKey: string,
    ownerName: string,
    reward: ProxyFeatureReward,
    seasonId?: number | null,
): Promise<ProxyRewardGrantResult> {
    if (reward.kind === 'legend') {
        if (!applyLegendReward(proxy, ownerName, reward)) {
            return { status: 'failed', summary: `${reward.key} could not be issued right now.` };
        }
    } else if (reward.kind === 'nametag_style') {
        if (!applyNameTagReward(proxy, ownerName, reward.style)) {
            return { status: 'failed', summary: 'Name tag style could not be applied right now.' };
        }
    }

    const grant = await createProxyRewardGrant({
        featureKey,
        rewardKey: reward.rewardKey,
        ownerName,
        seasonId: seasonId ?? null,
        rewardKind: reward.kind,
        payload: getRewardPayload(reward),
    });

    if (!grant) {
        return {
            status: 'already_granted',
            summary: buildRewardSummary(reward, true),
        };
    }

    if (reward.kind === 'monster_xp') {
        const applied = await applyMonsterXpReward(proxy, ownerName, reward.xp);
        if (!applied) {
            return {
                status: 'failed',
                summary: `Recorded ${reward.xp} monster XP for ${ownerName}, but no active monster was available to receive it.`,
            };
        }
    }

    return {
        status: 'granted',
        summary: buildRewardSummary(reward, false),
    };
}

function applyLegendReward(
    proxy: ProxyServer,
    ownerName: string,
    reward: Extract<ProxyFeatureReward, { kind: 'legend' }>,
): boolean {
    if (!proxy.issueCustomLegendToPlayer) {
        return false;
    }

    return proxy.issueCustomLegendToPlayer(ownerName, {
        rewardKey: reward.rewardKey,
        icon: reward.icon,
        color: reward.color,
        key: reward.key,
        text: reward.text,
    });
}

function applyNameTagReward(proxy: ProxyServer, ownerName: string, style: number): boolean {
    if (!proxy.setPlayerNameTagStyle) {
        return false;
    }

    return proxy.setPlayerNameTagStyle(ownerName, style);
}

async function applyMonsterXpReward(proxy: ProxyServer, ownerName: string, xp: number): Promise<boolean> {
    const monster = await getActiveMonster(ownerName);
    if (!monster) {
        return false;
    }

    let remainingXp = Math.max(0, xp);
    while (remainingXp > 0) {
        const needed = Math.max(1, monster.xpToNext - monster.xp);
        const spend = Math.min(needed, remainingXp);
        monster.xp += spend;
        remainingXp -= spend;

        while (monster.xp >= monster.xpToNext) {
            monster.xp -= monster.xpToNext;
            monster.level += 1;
            monster.xpToNext = calculateXpToNext(monster.level);
        }
    }

    await updateMonster(monster);

    for (const session of proxy.sessions.values()) {
        if (session.characterName === ownerName && !session.destroyed) {
            await refreshCompanion(session);
            break;
        }
    }

    return true;
}

function getRewardPayload(reward: ProxyFeatureReward): Record<string, unknown> {
    switch (reward.kind) {
        case 'legend':
            return {
                icon: reward.icon,
                color: reward.color,
                key: reward.key,
                text: reward.text,
            };
        case 'nametag_style':
            return { style: reward.style };
        case 'hall_record':
            return reward.text ? { text: reward.text } : {};
        case 'monster_xp':
            return { xp: reward.xp };
    }
}

function buildRewardSummary(reward: ProxyFeatureReward, alreadyGranted: boolean): string {
    const prefix = alreadyGranted ? 'Already claimed' : 'Granted';
    switch (reward.kind) {
        case 'legend':
            return `${prefix}: ${reward.text}`;
        case 'nametag_style':
            return `${prefix}: name tag style ${reward.style}`;
        case 'hall_record':
            return reward.text ? `${prefix}: ${reward.text}` : `${prefix}: hall record`;
        case 'monster_xp':
            return `${prefix}: ${reward.xp} monster XP`;
    }
}
