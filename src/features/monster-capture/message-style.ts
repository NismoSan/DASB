const SUCCESS_PREFIX = '{=q';
const NOTICE_PREFIX = '{=s';
const DANGER_PREFIX = '{=b';

function styleMessage(prefix: string, message: string): string {
    if (!message || message.startsWith('{=')) {
        return message;
    }

    return `${prefix}${message}`;
}

export function monsterSuccess(message: string): string {
    return styleMessage(SUCCESS_PREFIX, message);
}

export function monsterNotice(message: string): string {
    return styleMessage(NOTICE_PREFIX, message);
}

export function monsterDanger(message: string): string {
    return styleMessage(DANGER_PREFIX, message);
}
