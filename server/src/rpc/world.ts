// World RPCs — viz docs/03-message-katalog.md.
// Handlery jsou pojmenované exportované funkce; registrují se inline v main.ts InitModule.

import type { FindOrCreateMatchResponse } from 'irij-shared/messages';

const MATCH_MODULE = 'world';
const MATCH_LABEL = 'world.main';

// rpc.world.find_or_create_match
//
// Singleton match handshake — Nakama nevytváří match automaticky při startu serveru.
// Klient po loginu zavolá tento RPC, dostane matchId a teprve pak udělá socket.joinMatch.
// matchList vyfiltruje running match s label='world.main'; pokud žádný neexistuje
// (cold start, nebo všichni hráči se odhlásili a match expiroval), vytvoří se nový
// přes matchCreate('world').
//
// Race: pokud dva klienti zavolají paralelně a žádný match ještě neběží, oba mohou
// trefit "matchList prázdný → matchCreate". V tom případě vznikne 2+ matchů; vybíráme
// první z matchList. Sirotek bude bez hráčů a Nakama ho po idle timeoutu terminuje.
// Pro 100 CCU MVP přijatelné, pro production byl by lock přes nk.storageRead/Write
// se CAS, ale to je over-engineering pro MVP.
export function worldFindOrCreateMatch(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  _payload: string,
): string {
  const userId = ctx.userId;
  if (!userId) {
    return JSON.stringify({ ok: false, error: 'unauthenticated' } satisfies FindOrCreateMatchResponse);
  }

  let matches: nkruntime.Match[];
  try {
    matches = nk.matchList(10, true, MATCH_LABEL, 0, 1000);
  } catch (err) {
    logger.error(`matchList failed: ${String(err)}`);
    return JSON.stringify({ ok: false, error: 'match_list_failed' } satisfies FindOrCreateMatchResponse);
  }

  if (matches.length > 1) {
    logger.warn(
      `find_or_create_match: ${matches.length} matches with label=${MATCH_LABEL} — race or orphan, picking first`,
    );
  }

  if (matches.length > 0 && matches[0]) {
    const matchId = matches[0].matchId;
    logger.debug(`find_or_create_match: reusing existing ${matchId} for ${userId}`);
    return JSON.stringify({ ok: true, match_id: matchId } satisfies FindOrCreateMatchResponse);
  }

  let matchId: string;
  try {
    matchId = nk.matchCreate(MATCH_MODULE, {});
  } catch (err) {
    logger.error(`matchCreate failed: ${String(err)}`);
    return JSON.stringify({ ok: false, error: 'match_create_failed' } satisfies FindOrCreateMatchResponse);
  }

  logger.info(`find_or_create_match: created ${matchId} for ${userId}`);
  return JSON.stringify({ ok: true, match_id: matchId } satisfies FindOrCreateMatchResponse);
}
