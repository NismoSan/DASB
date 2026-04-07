export declare class Server {
    address: string;
    port: number;
    name: string;
    constructor(address: string, port: number, name: string);
    endPoint(): string;
}
export declare function getServerFromAddress(address: string, port: number): Server | undefined;
export declare const LoginServer: Server;
export declare const TemuairServer: Server;
export declare const MedeniaServer: Server;
