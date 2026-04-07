export interface LegendMark {
    icon: number;
    color: number;
    key: string;
    text: string;
}
export interface PlayerSession {
    appeared: string | null;
    disappeared: string | null;
}
export interface PlayerRecord {
    name: string;
    className: string;
    classId: number;
    title: string;
    isMaster: boolean;
    firstSeen: string | null;
    lastSeen: string | null;
    userListSightings: string[];
    sessions?: PlayerSession[];
    appearance?: any;
    lastAppearanceUpdate?: string;
    groupName?: string;
    legends?: LegendMark[];
    legendHistory?: {
        timestamp: string;
        legends: LegendMark[];
    }[];
    lastLegendUpdate?: string | null;
    legendClassName?: string;
    online?: boolean;
    source?: string;
}
export interface UserListEntry {
    name: string;
    className: string;
    classId: number;
    title: string;
    isMaster: boolean;
    socialStatus: number;
    iconByte: number;
}
export interface PlayerDetailResult {
    name: string;
    className: string;
    classId: number;
    title: string;
    isMaster: boolean;
    firstSeen: string | null;
    lastSeen: string | null;
    sessions: PlayerSession[];
    userListSightings: string[];
    chatLogs: string[];
    legends: LegendMark[];
    legendHistory: {
        timestamp: string;
        legends: LegendMark[];
    }[];
    lastLegendUpdate: string | null;
    legendClassName: string;
    groupName: string;
    appearance: any;
}
export interface ProfileResult {
    serial: number;
    name: string;
    className: string;
    groupName: string;
    legends: LegendMark[];
}
