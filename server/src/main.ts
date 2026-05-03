// Nakama TypeScript runtime entry point.
// Volá se při startu Nakama serveru — registruje RPCs, match handler, hooks.
//
// DŮLEŽITÉ: Všechny `initializer.registerRpc(...)` a `initializer.registerMatch(...)`
// volání musí být PŘÍMO v body InitModule. Nakama Goja runtime statically analyzuje
// InitModule AST a extrahuje handler identifikátory pouze z přímých výrazů — nezachází
// do helper-funkcí. Helpery typu `registerAuthRpcs(initializer)` nefungují.

import { authPing } from './rpc/auth.js';
import { profileCreateCharacter, profileGetSelf } from './rpc/profile.js';
import { worldFindOrCreateMatch } from './rpc/world.js';
import {
  matchInit,
  matchJoinAttempt,
  matchJoin,
  matchLeave,
  matchLoop,
  matchTerminate,
  matchSignal,
} from './match/world.js';

export function InitModule(
  _ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  initializer: nkruntime.Initializer,
): void {
  logger.info('Irij server module initializing…');

  // Auth RPCs
  initializer.registerRpc('rpc.auth.ping', authPing);

  // Profile RPCs
  initializer.registerRpc('rpc.profile.get_self', profileGetSelf);
  initializer.registerRpc('rpc.profile.create_character', profileCreateCharacter);

  // World RPCs
  initializer.registerRpc('rpc.world.find_or_create_match', worldFindOrCreateMatch);

  // Match handlers — Nakama vyžaduje object s shorthand property references na top-level
  // pojmenované funkce (ne method shorthand / function literal).
  initializer.registerMatch('world', {
    matchInit,
    matchJoinAttempt,
    matchJoin,
    matchLeave,
    matchLoop,
    matchTerminate,
    matchSignal,
  });

  logger.info('Irij server module ready.');
}
