export declare function getSchedules(): any[];
export declare function getSchedulesWithNextFire(schedList?: any[]): any[];
export declare function sendScheduledMessage(sched: any): void;
export declare function clearScheduleTimer(id: string): void;
export declare function startScheduleTimer(sched: any): void;
export declare function startAllSchedules(): void;
export declare function stopAllSchedules(): void;
export declare function setCachedSchedules(scheds: any[]): void;
export declare function init(deps: {
    db: any;
    io: any;
    Packet: any;
    getPrimaryBot: () => any;
    bots: Map<string, any>;
    loadConfig: () => any;
}): void;
