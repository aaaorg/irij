// Tenký wrapper kolem @heroiclabs/nakama-js — ponechává Client/Session/Socket
// nakama-js objekty viditelné, jen orchestrují guest auth + WebSocket connect.

import { Client, type Session, type Socket } from '@heroiclabs/nakama-js';

export interface NakamaConfig {
  serverKey: string;
  host: string;
  port: string;
  useSSL: boolean;
}

export interface NakamaConnection {
  client: Client;
  session: Session;
  socket: Socket;
}

// Defaulty pasují na infra/docker-compose.yml + infra/nakama/local.yml.
// Pro production override přes import.meta.env (VITE_NAKAMA_*).
const DEFAULT_CONFIG: NakamaConfig = {
  serverKey: 'irij-local-server-key',
  host: '127.0.0.1',
  port: '7350',
  useSSL: false,
};

export function loadNakamaConfig(): NakamaConfig {
  const env = import.meta.env;
  return {
    serverKey: env.VITE_NAKAMA_SERVER_KEY ?? DEFAULT_CONFIG.serverKey,
    host: env.VITE_NAKAMA_HOST ?? DEFAULT_CONFIG.host,
    port: env.VITE_NAKAMA_PORT ?? DEFAULT_CONFIG.port,
    useSSL: env.VITE_NAKAMA_USE_SSL === 'true' || DEFAULT_CONFIG.useSSL,
  };
}

export function createClient(config: NakamaConfig = loadNakamaConfig()): Client {
  return new Client(config.serverKey, config.host, config.port, config.useSSL);
}

// Phase 1 happy path: device-based guest auth + WebSocket connect.
// `create=true` u authenticateDevice znamená "vytvoř account, pokud neexistuje" —
// pro guest flow chceme. Po Phase 19 (OIDC/email) se sem přidá link flow.
export async function connectAsGuest(
  deviceId: string,
  config: NakamaConfig = loadNakamaConfig(),
): Promise<NakamaConnection> {
  const client = createClient(config);
  const session = await client.authenticateDevice(deviceId, true);
  const socket = client.createSocket(config.useSSL, false);
  await socket.connect(session, true);
  return { client, session, socket };
}
