// Structured logging bridge — wraps Nakama logger with JSON-serialized fields.
// Phase 21 can swap to native structured API when available.

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export function log(
  logger: nkruntime.Logger,
  level: LogLevel,
  msg: string,
  fields?: Record<string, unknown>,
): void {
  const line = fields ? `${msg} ${JSON.stringify(fields)}` : msg;
  logger[level](line);
}
