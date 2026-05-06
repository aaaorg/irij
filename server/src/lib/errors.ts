// Typed RPC error — Nakama runtime catches thrown errors and maps them to
// gRPC/HTTP error responses. Klient receives proper error status instead of
// 200 OK + {ok:false} body.

export class RpcError extends Error {
  public readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
