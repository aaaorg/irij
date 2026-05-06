// Tenký wrapper kolem Nakama client.rpc — typovaná request/response, JSON wire format.
// Profile / auth RPCs volají odsud; match data jdou jinou cestou (socket.sendMatchState).

import type { NakamaConnection } from './nakama.js';

export interface RpcErrorInfo {
  code: string;
  message: string;
}

export type RpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: RpcErrorInfo };

export async function callRpc<TReq extends object, TRes>(
  conn: NakamaConnection,
  name: string,
  payload: TReq,
): Promise<TRes> {
  try {
    const result = await conn.client.rpc(conn.session, name, payload);
    if (result.payload === undefined) {
      throw new Error(`RPC ${name} vrátilo prázdnou odpověď`);
    }
    return result.payload as TRes;
  } catch (err) {
    // nakama-js v2 throws the raw fetch Response on non-2xx status.
    // We need to read the body to get the actual error message.
    if (err instanceof Response) {
      throw await responseToError(err);
    }
    throw err;
  }
}

async function responseToError(response: Response): Promise<Error> {
  try {
    const body = (await response.json()) as Record<string, unknown>;
    const msg = typeof body.message === 'string' ? body.message : response.statusText;
    return new Error(msg);
  } catch {
    return new Error(response.statusText || `HTTP ${response.status}`);
  }
}

export async function callRpcSafe<TReq extends object, TRes>(
  conn: NakamaConnection,
  name: string,
  payload: TReq,
): Promise<RpcResult<TRes>> {
  try {
    const data = await callRpc<TReq, TRes>(conn, name, payload);
    return { ok: true, data };
  } catch (err: unknown) {
    const info = parseRpcError(err);
    return { ok: false, error: info };
  }
}

function parseRpcError(err: unknown): RpcErrorInfo {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (typeof e.message === 'string') {
      // Nakama JS client wraps gRPC errors with message containing the thrown error message.
      // The server RpcError.code is embedded in the error message.
      const msg = e.message;
      return { code: extractErrorCode(msg), message: msg };
    }
  }
  return { code: 'unknown', message: String(err) };
}

function extractErrorCode(message: string): string {
  // Server throws `new RpcError(code)` kde message == code (jen [a-z_]+).
  // Nakama Goja runtime ale Error obalí do toString tvaru se stack trace,
  // takže klient přes drát dostane jeden ze tří tvarů:
  //   1) "username_taken"                                  — čistý kód
  //   2) "username_taken: detail"                          — legacy s detailem
  //   3) "Error: username_taken at index.js:360:12(3)"     — Goja runtime wrap
  const trimmed = message.trim();
  if (/^[a-z_]+$/.test(trimmed)) return trimmed;
  const colonMatch = /^([a-z_]+):\s/.exec(trimmed);
  if (colonMatch?.[1]) return colonMatch[1];
  const gojaMatch = /^Error:\s+([a-z_]+)(?:\s+at\s|$)/.exec(trimmed);
  if (gojaMatch?.[1]) return gojaMatch[1];
  return 'unknown';
}
