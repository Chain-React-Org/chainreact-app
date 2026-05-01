#!/usr/bin/env bash
# scripts/test-infra/setup.sh
#
# Brings up the test infrastructure stack defined in docker-compose.test.yml
# and waits for every service to report healthy before returning. Used by:
#   - `npm run test:infra:up` (developer workflow)
#   - the `infra-tests` job in .github/workflows/ci.yml
#
# Usage:
#   ./scripts/test-infra/setup.sh
#
# Env:
#   COMPOSE_FILE — override the compose file (default: docker-compose.test.yml)
#   WAIT_TIMEOUT_SECONDS — total time to wait for healthchecks (default: 90)
#
# Exits non-zero on failure so CI fails fast.

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.test.yml}"
WAIT_TIMEOUT_SECONDS="${WAIT_TIMEOUT_SECONDS:-90}"

# Pick whichever compose CLI is available. `docker compose` (v2 plugin) is
# the modern path; the standalone `docker-compose` binary is a fallback.
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose -f $COMPOSE_FILE"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose -f $COMPOSE_FILE"
else
  echo "ERROR: neither 'docker compose' nor 'docker-compose' is installed" >&2
  exit 1
fi

echo "▶ Bringing up test infrastructure (postgres + mailhog + stripe-mock)..."
$COMPOSE up -d --wait --wait-timeout "$WAIT_TIMEOUT_SECONDS"

echo "▶ Stack is up. Healthcheck status:"
$COMPOSE ps

cat <<EOF

✅ Test infrastructure ready.

Services:
  Postgres     localhost:54329    (user=test, password=test, db=chainreact_test)
  MailHog      SMTP localhost:1025
               HTTP localhost:8025  (UI + JSON API)
  stripe-mock  HTTP localhost:12111
               HTTPS localhost:12112 (self-signed)

Run smoke tests:
  npm run test:infra

Tear down:
  npm run test:infra:down
EOF
