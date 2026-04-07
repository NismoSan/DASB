export class Server {
  address: string;
  port: number;
  name: string;

  constructor(address: string, port: number, name: string) {
    this.address = address;
    this.port = port;
    this.name = name;
  }

  endPoint(): string {
    return `${this.address}:${this.port}`;
  }
}

export function getServerFromAddress(address: string, port: number): Server | undefined {
  const endPoint = `${address}:${port}`;
  switch (endPoint) {
    case LoginServer.endPoint(): return LoginServer;
    case TemuairServer.endPoint(): return TemuairServer;
    case MedeniaServer.endPoint(): return MedeniaServer;
  }
  return undefined;
}

const address = process.env.DA_SERVER_ADDRESS || '127.0.0.1';
export const LoginServer = new Server(address, 2610, 'Login');
export const TemuairServer = new Server(address, 2611, 'Temuair');
export const MedeniaServer = new Server(address, 2612, 'Medenia');
