// Profile RPCs — viz docs/03-message-katalog.md sekce Profile.
// Handlery jsou pojmenované exportované funkce; registrují se inline v main.ts InitModule.

export function profileGetSelf(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  _payload: string,
): string {
  logger.info(`get_self called by ${ctx.userId}`);
  // TODO: load Player + skills + atributy + inventory + equipment
  return JSON.stringify({ player_id: ctx.userId, ready: false });
}

// TODO: profileCreateCharacter, profileUpdateSettings
