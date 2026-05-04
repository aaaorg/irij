CREATE TABLE irij.audit_log (
    id         BIGSERIAL       NOT NULL,
    ts         TIMESTAMPTZ     NOT NULL DEFAULT now(),
    user_id    UUID,
    ip         TEXT,
    event      TEXT            NOT NULL,
    payload    JSONB,
    PRIMARY KEY (id, ts)
) PARTITION BY RANGE (ts);

-- Initial partition covering 2026. Add new partitions as needed.
CREATE TABLE irij.audit_log_2026 PARTITION OF irij.audit_log
    FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

CREATE INDEX idx_audit_log_event ON irij.audit_log (event);
CREATE INDEX idx_audit_log_user_id ON irij.audit_log (user_id) WHERE user_id IS NOT NULL;
