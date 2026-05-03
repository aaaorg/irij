// Tenký wrapper kolem Nakama client.rpc — typovaná request/response, JSON wire format.
// Profile / auth RPCs volají odsud; match data jdou jinou cestou (socket.sendMatchState).
//
// nakama-js client.rpc(session, id, input) interně dělá JSON.stringify(input) a JSON.parse(response.payload),
// takže pracujeme přímo s JS objekty — žádný manual marshal.

import type { NakamaConnection } from './nakama.js';

export async function callRpc<TReq extends object, TRes>(
  conn: NakamaConnection,
  name: string,
  payload: TReq,
): Promise<TRes> {
  const result = await conn.client.rpc(conn.session, name, payload);
  if (result.payload === undefined) {
    throw new Error(`RPC ${name} vrátilo prázdnou odpověď`);
  }
  return result.payload as TRes;
}
