#!/usr/bin/env bash
#
# Production deploy for notetaker-app (Alchemy, stage: prod).
#
# Usage:
#   WEB_PROD_URL=https://<web-prod> ./scripts/deploy-prod.sh
#
# Optional:
#   CORS_EXTRA_ORIGINS=https://custom.example.com,... ./scripts/deploy-prod.sh
#   (defaults to https://notetaker-app.sznm.dev)
#
# What it does:
#   1. Runs database migrations (pnpm run db:migrate).
#   2. Deploys the prod stage from packages/infra with exact CORS origins.
#   3. Prints verify commands (server/web/custom + CORS evil-origin check).
#
# Notes:
#   - Origins are passed as process env vars only. This script never writes
#     to local .env files (apps/server/.env, apps/web/.env, packages/infra/.env).
#   - Origins must be exact https URLs with no wildcards and no trailing slash.
#   - No secrets are read, printed, or embedded here. Provider auth comes from
#     `~/.alchemy` (see: pnpm run infra:login).
#
set -euo pipefail

DEFAULT_EXTRA_ORIGINS="https://notetaker-app.sznm.dev"
EVIL_ORIGIN="https://evil.example.com"

usage() {
  echo "Usage: WEB_PROD_URL=https://<web-prod> ./scripts/deploy-prod.sh" >&2
  echo "  Optional: CORS_EXTRA_ORIGINS=\"https://custom.example.com,...\" (default: ${DEFAULT_EXTRA_ORIGINS})" >&2
}

if [[ -z "${WEB_PROD_URL:-}" ]]; then
  echo "error: WEB_PROD_URL is required." >&2
  usage
  exit 1
fi

EXTRA_ORIGINS="${CORS_EXTRA_ORIGINS:-${DEFAULT_EXTRA_ORIGINS}}"

is_exact_origin() {
  local origin="$1"
  [[ "${origin}" =~ ^https://[^*[:space:],/]+$ ]]
}

if ! is_exact_origin "${WEB_PROD_URL}"; then
  echo "error: WEB_PROD_URL must be an exact https origin (no wildcard, no path, no trailing slash). Got: ${WEB_PROD_URL}" >&2
  exit 1
fi

IFS=',' read -r -a _extra_list <<< "${EXTRA_ORIGINS}"
for _origin in "${_extra_list[@]}"; do
  _origin="$(echo "${_origin}" | tr -d '[:space:]')"
  [[ -z "${_origin}" ]] && continue
  if ! is_exact_origin "${_origin}"; then
    echo "error: CORS_EXTRA_ORIGINS must be exact https origins (no wildcards). Bad entry: ${_origin}" >&2
    exit 1
  fi
done

echo "==> Running database migrations"
pnpm run db:migrate

echo "==> Deploying stage prod (CORS_ORIGIN=${WEB_PROD_URL})"
(
  cd packages/infra
  CORS_ORIGIN="${WEB_PROD_URL}" CORS_EXTRA_ORIGINS="${EXTRA_ORIGINS}" \
    pnpm exec alchemy deploy --stage prod --yes
)

CUSTOM_ORIGIN="$(echo "${EXTRA_ORIGINS}" | cut -d',' -f1 | tr -d '[:space:]')"

cat <<VERIFY

==> Deploy finished. Verify with (SERVER_PROD_URL from the alchemy outputs above):

  # 1. Server health (expect: OK)
  curl -sS "\${SERVER_PROD_URL:-<server-prod-url>}/"

  # 2. Prod web origin (expect: 200)
  curl -sS -o /dev/null -w "%{http_code}\n" "${WEB_PROD_URL}/"

  # 3. Custom domain (expect: 200)
  curl -sS -o /dev/null -w "%{http_code}\n" "${CUSTOM_ORIGIN}/"

  # 4. CORS allows the prod web origin (expect: access-control-allow-origin: ${WEB_PROD_URL})
  curl -sS -D - -o /dev/null -H "Origin: ${WEB_PROD_URL}" "\${SERVER_PROD_URL:-<server-prod-url>}/" | grep -i access-control-allow-origin

  # 5. CORS evil-origin check (expect: NO access-control-allow-origin header)
  curl -sS -D - -o /dev/null -H "Origin: ${EVIL_ORIGIN}" "\${SERVER_PROD_URL:-<server-prod-url>}/" | grep -i access-control-allow-origin && echo "CORS CHECK FAILED: evil origin allowed" || echo "CORS OK: evil origin not allowed"
VERIFY
