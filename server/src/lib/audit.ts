export function logAudit(
  nk: nkruntime.Nakama,
  event: string,
  fields: {
    userId?: string;
    ip?: string;
    payload?: Record<string, unknown>;
  },
): void {
  try {
    nk.sqlExec(
      `INSERT INTO irij.audit_log (user_id, ip, event, payload)
       VALUES ($1, $2, $3, $4)`,
      [
        fields.userId ?? null,
        fields.ip ?? null,
        event,
        fields.payload ? JSON.stringify(fields.payload) : null,
      ],
    );
  } catch {
    // Audit log failure must not break game flow.
  }
}
