#!/usr/bin/env bash
# scripts/test-infra/teardown.sh
#
# Stops and removes the containers + volumes from docker-compose.test.yml.
# Invoked by `npm run test:infra:down` and from CI's always() cleanup step.
#
# Env:
#   COMPOSE_FILE — override the compose file (default: docker-compose.test.yml)

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.test.yml}"

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose -f $COMPOSE_FILE"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose -f $COMPOSE_FILE"
else
  echo "ERROR: neither 'docker compose' nor 'docker-compose' is installed" >&2
  exit 1
fi

echo "▶ Stopping test infrastructure and removing volumes..."
$COMPOSE down --volumes --remove-orphans

echo "✅ Test infrastructure torn down."
