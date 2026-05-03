// Profile RPCs — viz docs/03-message-katalog.md sekce Profile

export function registerProfileRpcs(initializer: nkruntime.Initializer): void {
  // TODO:
  //   rpc.profile.create_character
  //   rpc.profile.get_self
  //   rpc.profile.update_settings

  initializer.registerRpc('rpc.profile.get_self', (ctx, logger, _nk, _payload) => {
    logger.info(`get_self called by ${ctx.userId}`);
    // TODO: load Player + skills + atributy + inventory + equipment
    return JSON.stringify({ player_id: ctx.userId, ready: false });
  });
}
