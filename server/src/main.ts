// Nakama TypeScript runtime entry point.
// Volá se při startu Nakama serveru — registruje RPCs, match handler, hooks.

import { registerAuthRpcs } from './rpc/auth.js';
import { registerProfileRpcs } from './rpc/profile.js';
import { worldMatchHandler } from './match/world.js';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function InitModule(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  initializer: nkruntime.Initializer,
): void {
  logger.info('Irij server module initializing…');

  // RPCs
  registerAuthRpcs(initializer);
  registerProfileRpcs(initializer);

  // Match handler
  initializer.registerMatch('world', worldMatchHandler);

  logger.info('Irij server module ready.');
}

// Nakama TS runtime hledá globální `InitModule` symbol
// @ts-expect-error -- exposed pro Nakama runtime loader
!InitModule && InitModule.bind(null);
