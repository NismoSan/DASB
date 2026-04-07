import type ProxySession from '../../proxy/proxy-session';

export interface SessionWorldView {
    mapNumber: number;
    x: number;
    y: number;
    direction: number;
    worldScope: 'live' | 'afk';
}

export function getSessionWorldView(session: ProxySession): SessionWorldView {
    if (session.afkState?.active) {
        return {
            mapNumber: session.afkState.afkMapNumber,
            x: session.afkState.shadowX,
            y: session.afkState.shadowY,
            direction: getSessionWorldDirection(session),
            worldScope: 'afk',
        };
    }

    return {
        mapNumber: session.playerState.mapNumber,
        x: session.playerState.x,
        y: session.playerState.y,
        direction: session.playerState.direction,
        worldScope: 'live',
    };
}

export function getSessionWorldDirection(session: ProxySession): number {
    if (session.afkState?.active && session.lastSelfShowUser && session.lastSelfShowUser.length >= 5) {
        return session.lastSelfShowUser[4];
    }
    return session.playerState.direction;
}

export function getWorldDistance(a: ProxySession, b: ProxySession): { sameWorld: boolean; sameMap: boolean; dx: number; dy: number } {
    const av = getSessionWorldView(a);
    const bv = getSessionWorldView(b);
    return {
        sameWorld: av.worldScope === bv.worldScope,
        sameMap: av.worldScope === bv.worldScope && av.mapNumber === bv.mapNumber,
        dx: Math.abs(av.x - bv.x),
        dy: Math.abs(av.y - bv.y),
    };
}
