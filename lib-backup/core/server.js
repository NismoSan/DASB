"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MedeniaServer = exports.TemuairServer = exports.LoginServer = exports.Server = void 0;
exports.getServerFromAddress = getServerFromAddress;
class Server {
    address;
    port;
    name;
    constructor(address, port, name) {
        this.address = address;
        this.port = port;
        this.name = name;
    }
    endPoint() {
        return `${this.address}:${this.port}`;
    }
}
exports.Server = Server;
function getServerFromAddress(address, port) {
    const endPoint = `${address}:${port}`;
    switch (endPoint) {
        case exports.LoginServer.endPoint(): return exports.LoginServer;
        case exports.TemuairServer.endPoint(): return exports.TemuairServer;
        case exports.MedeniaServer.endPoint(): return exports.MedeniaServer;
    }
    return undefined;
}
const address = '52.88.55.94';
exports.LoginServer = new Server(address, 2610, 'Login');
exports.TemuairServer = new Server(address, 2611, 'Temuair');
exports.MedeniaServer = new Server(address, 2612, 'Medenia');
//# sourceMappingURL=server.js.map