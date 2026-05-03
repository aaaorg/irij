// Auth RPCs — viz docs/03-message-katalog.md sekce Auth.
// Handlery jsou pojmenované exportované funkce; registrují se inline v main.ts InitModule.
// Nakama Goja runtime parsuje InitModule AST a extrahuje identifikátory pouze z přímých
// `initializer.registerRpc(...)` výrazů — neprochází do helperů.

export function authPing(
  _ctx: nkruntime.Context,
  _logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  _payload: string,
): string {
  return JSON.stringify({ ok: true, ts: Date.now() });
}

// TODO: authLoginOidc, authLoginEmail, authGuestCreate
// Nakama poskytuje built-in auth flows přes `nk.authenticateCustom`,
// `nk.authenticateEmail`, `nk.authenticateDevice` — wrappujeme je RPCs
// pro konzistentní client API.
