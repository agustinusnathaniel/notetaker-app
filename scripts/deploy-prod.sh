#!/usr/bin/env bash
#
# Production deploy for notetaker-app (Alchemy, stage: prod).
#
# Usage:
#   ./scripts/deploy-prod.sh
#   pnpm run deploy:prod
#
# What it does:
#   1. Runs database migrations (pnpm run db:migrate).
#   2. Deploys the prod stage from packages/infra (no env args; prod CORS
#      and custom domains are static in packages/infra/alchemy.run.ts).
#   3. Prints verify commands against the static prod domains.
#
# Static prod domains (exact, no wildcards):
#   web: https://notetaker-app.sznm.dev
#   api: https://notetaker-api.sznm.dev
#
# Notes:
#   - This script takes no arguments and requires no env vars. Prod CORS
#     (CORS_ORIGIN) is a static literal in alchemy.run.ts, so local
#     localhost values in apps/server/.env can never leak into prod.
#   - Optional transition override: if CORS_EXTRA_ORIGINS is set in the
#     environment (e.g. a workers.dev web URL during cutover), it is
#     forwarded as-is; otherwise it is omitted and defaults to empty.
#     The script never writes to local .env files.
#   - No secrets are read, printed, or embedded here. Provider auth comes
#     from `~/.alchemy` (see: pnpm run infra:login); the only expected
#     failure is a missing login.
#
set -euo pipefail

WEB_PROD_URL="https://notetaker-app.sznm.dev"
SERVER_PROD_URL="https://notetaker-api.sznm.dev"
EVIL_ORIGIN="https://evil.example.com"

if [[ $# -gt 0 ]]; then
  echo "error: this script takes no arguments. Run: ./scripts/deploy-prod.sh" >&2
  exit 1
fi

echo "==> Running database migrations"
pnpm run db:migrate

echo "==> Deploying stage prod (static CORS_ORIGIN=${WEB_PROD_URL})"
(
  cd packages/infra
  if [[ -n "${CORS_EXTRA_ORIGINS:-}" ]]; then
    echo "    (forwarding optional CORS_EXTRA_ORIGINS override)"
    CORS_EXTRA_ORIGINS="${CORS_EXTRA_ORIGINS}" \
      pnpm exec alchemy deploy --stage prod --yes
  else
    pnpm exec alchemy deploy --stage prod --yes
  fi
)

cat <<VERIFY

==> Deploy finished. Verify with:

  # 1. Server health (expect: OK)
  curl -sS "${SERVER_PROD_URL}/"

  # 2. Prod web origin (expect: 200)
  curl -sS -o /dev/null -w "%{http_code}\n" "${WEB_PROD_URL}/"

  # 3. CORS allows the prod web origin (expect: access-control-allow-origin: ${WEB_PROD_URL})
  curl -sS -D - -o /dev/null -H "Origin: ${WEB_PROD_URL}" "${SERVER_PROD_URL}/" | grep -i access-control-allow-origin

  # 4. CORS evil-origin check (expect: NO access-control-allow-origin header)
  curl -sS -D - -o /dev/null -H "Origin: ${EVIL_ORIGIN}" "${SERVER_PROD_URL}/" | grep -i access-control-allow-origin && echo "CORS CHECK FAILED: evil origin allowed" || echo "CORS OK: evil origin not allowed"
VERIFY
