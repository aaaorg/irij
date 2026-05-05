// World RPCs — viz docs/03-message-katalog.md.
// Handlery jsou pojmenované exportované funkce; registrují se inline v main.ts InitModule.

import type { FindOrCreateMatchResponse } from 'irij-shared/messages';

const MATCH_MODULE = 'world';
const MATCH_LABEL = 'world.main';

const SINGLETON_COLLECTION = '_world_singleton';
const SINGLETON_KEY = 'active_match_id';
const SINGLETON_USER_ID = '00000000-0000-0000-0000-000000000000';

// rpc.world.find_or_create_match
//
// Singleton match handshake — Nakama nevytváří match automaticky při startu serveru.
// Klient po loginu zavolá tento RPC, dostane matchId a teprve pak udělá socket.joinMatch.
//
// Race prevention: CAS lock přes nk.storageWrite s version='' (create-if-not-exists).
// Jen první caller uspěje s vytvořením storage záznamu; ostatní paralelní callers
// dostanou version conflict, re-readnou match_id a joinnou existující match.
// Orphan matches eliminovány — vždy existuje max 1 running match.
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

  // 1) Zkus přečíst existující singleton záznam.
  const existing = nk.storageRead([
    { collection: SINGLETON_COLLECTION, key: SINGLETON_KEY, userId: SINGLETON_USER_ID },
  ]);
  if (existing.length > 0 && existing[0]) {
    const record = existing[0].value as { match_id: string };
    if (record.match_id) {
      // Ověř, že match stále běží (matchList s přesným match_id label).
      try {
        const matches = nk.matchList(1, true, MATCH_LABEL, 0, 1000);
        const alive = matches.some((m) => m.matchId === record.match_id);
        if (alive) {
          logger.debug(`find_or_create_match: reusing ${record.match_id} for ${userId}`);
          return JSON.stringify({ ok: true, match_id: record.match_id } satisfies FindOrCreateMatchResponse);
        }
      } catch (err) {
        logger.warn(`matchList check failed: ${String(err)}, will try to create new`);
      }
      // Match neběží — smaž stale záznam a pokračuj k vytvoření nového.
      try {
        nk.storageDelete([
          { collection: SINGLETON_COLLECTION, key: SINGLETON_KEY, userId: SINGLETON_USER_ID },
        ]);
      } catch {
        // Ignoruj — jiný caller ho mohl smazat mezitím.
      }
    }
  }

  // 2) Vytvoř match a zkus atomicky zapsat singleton (version='' = create-if-not-exists).
  let matchId: string;
  try {
    matchId = nk.matchCreate(MATCH_MODULE, {});
  } catch (err) {
    logger.error(`matchCreate failed: ${String(err)}`);
    return JSON.stringify({ ok: false, error: 'match_create_failed' } satisfies FindOrCreateMatchResponse);
  }

  try {
    nk.storageWrite([
      {
        collection: SINGLETON_COLLECTION,
        key: SINGLETON_KEY,
        userId: SINGLETON_USER_ID,
        value: { match_id: matchId },
        version: '',
        permissionRead: 2,
        permissionWrite: 0,
      },
    ]);
    logger.info(`find_or_create_match: created ${matchId} for ${userId}`);
    return JSON.stringify({ ok: true, match_id: matchId } satisfies FindOrCreateMatchResponse);
  } catch {
    // CAS conflict — jiný caller vyhrál race. Přečti jeho match_id.
    const retry = nk.storageRead([
      { collection: SINGLETON_COLLECTION, key: SINGLETON_KEY, userId: SINGLETON_USER_ID },
    ]);
    if (retry.length > 0 && retry[0]) {
      const winner = retry[0].value as { match_id: string };
      logger.info(`find_or_create_match: race lost, joining winner ${winner.match_id} for ${userId}`);
      return JSON.stringify({ ok: true, match_id: winner.match_id } satisfies FindOrCreateMatchResponse);
    }
    // Edge case: race winner's match_id gone — fallback na právě vytvořený match.
    logger.warn(`find_or_create_match: race fallback to own ${matchId} for ${userId}`);
    return JSON.stringify({ ok: true, match_id: matchId } satisfies FindOrCreateMatchResponse);
  }
}

// Cleanup singleton záznamu při match terminate — volá se z matchTerminate.
export function clearWorldSingleton(nk: nkruntime.Nakama, logger: nkruntime.Logger): void {
  try {
    nk.storageDelete([
      { collection: SINGLETON_COLLECTION, key: SINGLETON_KEY, userId: SINGLETON_USER_ID },
    ]);
    logger.info('World singleton record cleared');
  } catch {
    // Non-critical — singleton bude stale, ale find_or_create_match ověří matchList.
  }
}
