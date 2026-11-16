#!/usr/bin/env bash
# App-wide audit suite (card #901024): boots a throwaway Operation Kit (scratch
# guard on, temp DB, temp knowledge base, EMPTY environment), seeds test data and
# runs the Playwright specs against it in light/dark x desktop/narrow.
#
#   bash tests/e2e/app-audit/run.sh [playwright args, e.g. --project=dark-narrow]
#
# Needs app/client/dist built, and @playwright/test + Chromium on this machine
# (not a repo dependency, by design: this is not part of CI). PW_NODE_PATH may
# point at a node_modules dir that has @playwright/test.
#
# The server is started with `env -i`: nothing from the caller's shell (API keys,
# bot tokens, DATABASE_URL, ...) reaches it, so the run cannot touch a live system.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
PORT="${E2E_PORT:-3922}"
# Set E2E_WORK_ROOT to a folder on an exec-able disk if /tmp is mounted noexec.
WORK="$(mktemp -d "${E2E_WORK_ROOT:-${TMPDIR:-/tmp}}/ok-app-audit.XXXXXX")"
export E2E_BASE_URL="http://127.0.0.1:$PORT"
export E2E_ADMIN_USER=e2e-admin E2E_MEMBER_USER=e2e-member E2E_PASS="${E2E_PASS:-e2e-$(date +%s)-pass}"
export E2E_SEED_FILE="$WORK/seed.json"
# A brand name that is NOT the default, so a hard-coded product name shows up as a failure.
export E2E_BRAND_NAME="${E2E_BRAND_NAME:-Acme Ops}"

if curl -s -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then echo "port $PORT is already in use — stop that process first"; exit 1; fi
[ -f "$REPO/app/client/dist/index.html" ] || { echo "app/client/dist is missing — run: (cd app && npm run build --workspace=client)"; exit 1; }

# Our own child only: the server runs in its own process group (setsid), so
# cleanup stops tsx AND its node child without touching any other server.
SRV=
cleanup() { [ -n "$SRV" ] && kill -- "-$SRV" 2>/dev/null || true; }
trap cleanup EXIT

mkdir -p "$WORK/home" "$WORK/vault" "$WORK/agents" "$WORK/ai-workspace" "$WORK/projects"
node "$HERE/seed.mjs" files "$WORK/vault" "$WORK/agents"

setsid env -i PATH="$PATH" HOME="$WORK/home" \
  CC_SCRATCH_SERVER=1 PORT="$PORT" DB_PATH="$WORK/cc.db" JWT_SECRET=scratch-only-e2e \
  SECRETS_KEK_PROVIDER=env SECRETS_MASTER_KEY="$(head -c 32 /dev/urandom | base64)" \
  CC_ACCOUNT_ROUTER_STATE_FILE="$WORK/account-router-state.json" CC_RATE_LIMIT_LOG="$WORK/rate-limit.jsonl" \
  CC_SEAT_HOME_ROOT="$WORK/seats" CC_LEGACY_CODEX_HOME="$WORK/no-codex" GROK_HOME_DIR="$WORK/no-grok" \
  SECOND_BRAIN_ROOT="$WORK/vault" AGENT_FILES_DIR="$WORK/agents" AGENT_CHAT_PROVIDER=demo \
  AI_WORKSPACE_DIR="$WORK/ai-workspace" PROJECTS_DIR="$WORK/projects" USER_HOME="$WORK/home" \
  TRANSCRIPT_DIR="$WORK/transcripts" ASSISTANT_DIR="$WORK/assistant" SECOND_BRAIN_DIR="$WORK/vault" \
  OK_BRAND_NAME="${E2E_BRAND_NAME}" \
  bash -c 'cd "$0/app/server" && exec npx tsx src/index.ts' "$REPO" > "$WORK/server.log" 2>&1 &
SRV=$!

for _ in $(seq 1 120); do curl -sf "$E2E_BASE_URL/api/health" >/dev/null 2>&1 && break; sleep 1; done
if ! grep -q 'SCRATCH instance' "$WORK/server.log"; then
  echo "scratch guard line missing — refusing to run"; tail -30 "$WORK/server.log"; exit 1
fi
node "$HERE/seed.mjs" db "$WORK/cc.db" "$E2E_BASE_URL"
echo "[app-audit] server log: $WORK/server.log   seed manifest: $E2E_SEED_FILE"
[ "${E2E_SEED_ONLY:-}" = 1 ] && { echo "[app-audit] E2E_SEED_ONLY=1 — leaving the server up on $E2E_BASE_URL (Ctrl-C to stop)"; wait "$SRV"; exit 0; }
PW=$(command -v playwright || echo "npx playwright")
NODE_PATH="${PW_NODE_PATH:-}" $PW test -c "$HERE/playwright.config.ts" "$@"
