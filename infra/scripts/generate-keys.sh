#!/usr/bin/env bash
set -euo pipefail

# Generuje produkční secrets do infra/.env (pokud ještě neexistuje).
# Spusť jednou při prvním deploy; rotuj každých 90 dnů nebo při personnel change.

ENV_FILE="$(dirname "$0")/../.env"

if [ -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE already exists. Delete it first if you want to regenerate." >&2
  exit 1
fi

SESSION_KEY=$(openssl rand -hex 32)
REFRESH_KEY=$(openssl rand -hex 32)
SERVER_KEY=$(openssl rand -hex 16)
CONSOLE_PASS=$(openssl rand -hex 16)
PG_PASS=$(openssl rand -hex 16)

cat > "$ENV_FILE" <<EOF
NAKAMA_CONSOLE_USERNAME=admin
NAKAMA_CONSOLE_PASSWORD=${CONSOLE_PASS}
NAKAMA_SESSION_ENCRYPTION_KEY=${SESSION_KEY}
NAKAMA_SESSION_REFRESH_ENCRYPTION_KEY=${REFRESH_KEY}
NAKAMA_SERVER_KEY=${SERVER_KEY}
POSTGRES_PASSWORD=${PG_PASS}
EOF

echo "Generated $ENV_FILE with fresh secrets."
echo "Keep this file safe — it is .gitignored and must NOT be committed."
