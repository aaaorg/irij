// Auth RPCs — viz docs/03-message-katalog.md sekce Auth

export function registerAuthRpcs(initializer: nkruntime.Initializer): void {
  // TODO: rpc.auth.login_oidc, rpc.auth.login_email, rpc.auth.guest_create
  // Nakama poskytuje built-in auth flows přes `nk.authenticateCustom`,
  // `nk.authenticateEmail`, `nk.authenticateDevice` — wrappujeme je RPCs
  // pro konzistentní client API.

  initializer.registerRpc('rpc.auth.ping', (_ctx, _logger, _nk, _payload) => {
    return JSON.stringify({ ok: true, ts: Date.now() });
  });
}
