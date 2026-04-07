export declare const SESSION_MAX_AGE: number;
export declare function isValidSession(token: string | undefined): boolean;
export declare function parseCookies(cookieHeader: string | undefined): Record<string, string>;
export declare function login(username: string, password: string): {
    success: true;
    token: string;
} | {
    success: false;
};
export declare function logout(token: string | undefined): void;
export declare function cleanup(): void;
