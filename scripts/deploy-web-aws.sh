#!/usr/bin/env bash
# Builds apps/web as a static export and uploads it to Amplify Hosting (manual deploy, no Git link).
#   scripts/deploy-web-aws.sh
# NEXT_PUBLIC_SERVER_URL defaults to the ServerUrl output (https://DOMAIN) of the proass-server stack.
# Env: AWS_PROFILE (default viettrans), AWS_REGION (default ap-southeast-1).
set -euo pipefail
cd "$(dirname "$0")/.."

export AWS_PROFILE="${AWS_PROFILE:-viettrans}" AWS_REGION="${AWS_REGION:-ap-southeast-1}"
APP_NAME=proass-web
BRANCH=main

SERVER_URL="${NEXT_PUBLIC_SERVER_URL:-$(aws cloudformation describe-stacks --stack-name proass-server \
  --query "Stacks[0].Outputs[?OutputKey=='ServerUrl'].OutputValue" --output text 2>/dev/null || true)}"
[[ "$SERVER_URL" == https://* ]] || { echo "No backend URL found; deploy the backend first (DOMAIN=... scripts/deploy-aws.sh)" >&2; exit 1; }

echo "==> Amplify app $APP_NAME"
# Static hosts can't run Next's headers(), so Amplify sets them. Only our own page may use the mic and tab
# capture, and no other site may frame it (clickjacking a page that records audio).
HEADERS="customHeaders:
  - pattern: '**'
    headers:
      - key: Permissions-Policy
        value: microphone=(self), display-capture=(self)
      - key: Strict-Transport-Security
        value: max-age=31536000; includeSubDomains
      - key: X-Frame-Options
        value: DENY
      - key: Content-Security-Policy
        value: frame-ancestors 'none'; base-uri 'self'; object-src 'none'
      - key: X-Content-Type-Options
        value: nosniff
      - key: Referrer-Policy
        value: strict-origin-when-cross-origin
"
APP_ID=$(aws amplify list-apps --query "apps[?name=='$APP_NAME'].appId | [0]" --output text)
if [[ -z "$APP_ID" || "$APP_ID" == "None" ]]; then
  APP_ID=$(aws amplify create-app --name $APP_NAME --platform WEB --custom-headers "$HEADERS" --query app.appId --output text)
else
  aws amplify update-app --app-id "$APP_ID" --custom-headers "$HEADERS" >/dev/null # keep headers in sync on every deploy
fi
aws amplify get-branch --app-id "$APP_ID" --branch-name $BRANCH >/dev/null 2>&1 ||
  aws amplify create-branch --app-id "$APP_ID" --branch-name $BRANCH --stage PRODUCTION >/dev/null
WEB_URL="https://$BRANCH.$APP_ID.amplifyapp.com"

echo "==> Build (server: $SERVER_URL)"
rm -rf apps/web/out
STATIC_EXPORT=1 NEXT_PUBLIC_SERVER_URL="$SERVER_URL" npm run build -w @proass/web
ZIP=$(mktemp -d)/web.zip
(cd apps/web/out && zip -qr "$ZIP" .)

echo "==> Upload"
read -r JOB_ID UPLOAD_URL < <(aws amplify create-deployment --app-id "$APP_ID" --branch-name $BRANCH \
  --query '[jobId, zipUploadUrl]' --output text)
curl -sSf -X PUT -H "Content-Type: application/zip" --upload-file "$ZIP" "$UPLOAD_URL"
aws amplify start-deployment --app-id "$APP_ID" --branch-name $BRANCH --job-id "$JOB_ID" >/dev/null

while :; do
  STATUS=$(aws amplify get-job --app-id "$APP_ID" --branch-name $BRANCH --job-id "$JOB_ID" --query job.summary.status --output text)
  [[ "$STATUS" == PENDING || "$STATUS" == RUNNING ]] || break
  sleep 5
done
echo "Deployment $JOB_ID: $STATUS"
[[ "$STATUS" == SUCCEED ]] || exit 1
echo "Web: $WEB_URL"
echo "Backend must allow this origin: ALLOWED_ORIGINS=$WEB_URL scripts/deploy-aws.sh"
