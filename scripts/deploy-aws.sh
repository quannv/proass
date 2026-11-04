#!/usr/bin/env bash
# Deploys apps/server to ECS Fargate behind an HTTPS ALB via infra/aws/backend.yml.
#   DOMAIN=api.example.com ALLOWED_ORIGINS=https://main.xxxx.amplifyapp.com scripts/deploy-aws.sh
# DOMAIN and ALLOWED_ORIGINS are remembered from the last deploy when omitted.
# Env: AWS_PROFILE (default viettrans), AWS_REGION (default ap-southeast-1).
# MUSE_API_KEY is read from apps/server/.env and stored in Secrets Manager; it is never printed.
set -euo pipefail
cd "$(dirname "$0")/.."

export AWS_PROFILE="${AWS_PROFILE:-viettrans}" AWS_REGION="${AWS_REGION:-ap-southeast-1}"
STACK=proass-server
REPO=proass-server
SECRET=proass/server
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGISTRY="$ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com"
# Uncommitted or untracked changes that end up in the image get a unique tag, so the deploy is never a silent no-op.
TAG=$(git rev-parse --short HEAD)
[[ -z $(git status --porcelain -- apps/server packages/shared package.json package-lock.json) ]] || TAG="$TAG-dirty-$(date +%s)"

deployed_param() {
  local v
  v=$(aws cloudformation describe-stacks --stack-name $STACK \
    --query "Stacks[0].Parameters[?ParameterKey=='$1'].ParameterValue" --output text 2>/dev/null || true)
  [[ "$v" == "None" ]] || echo "$v"
}
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-$(deployed_param AllowedOrigins)}"
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-http://localhost:3000}"
DOMAIN="${DOMAIN:-$(deployed_param DomainName)}"
# Same model as local dev unless overridden.
LLM_MODEL="${MUSE_LLM_MODEL:-$(grep -sE '^MUSE_LLM_MODEL=' apps/server/.env | head -1 | cut -d= -f2- || true)}"
LLM_MODEL="${LLM_MODEL:-muse-wonder-1.0}"
[[ -n "$DOMAIN" ]] || { echo "Set DOMAIN=api.yourdomain.com (backend hostname)" >&2; exit 1; }

echo "==> ACM certificate for $DOMAIN"
CERT_ARN=$(aws acm list-certificates --certificate-statuses PENDING_VALIDATION ISSUED \
  --query "CertificateSummaryList[?DomainName=='$DOMAIN'].CertificateArn | [0]" --output text)
if [[ -z "$CERT_ARN" || "$CERT_ARN" == "None" ]]; then
  CERT_ARN=$(aws acm request-certificate --domain-name "$DOMAIN" --validation-method DNS --query CertificateArn --output text)
fi
if [[ $(aws acm describe-certificate --certificate-arn "$CERT_ARN" --query Certificate.Status --output text) != ISSUED ]]; then
  # The validation record shows up a few seconds after the request.
  until RECORD=$(aws acm describe-certificate --certificate-arn "$CERT_ARN" \
    --query 'Certificate.DomainValidationOptions[0].ResourceRecord.[Type,Name,Value]' --output text) && [[ "$RECORD" != None ]]; do sleep 3; done
  echo "Add this DNS record at your DNS provider (validates the certificate; keep it for auto-renewal):"
  echo "$RECORD"
  echo "Waiting for the certificate to be issued (Ctrl+C is safe; rerun to continue)…"
  # No timeout: ACM keeps a pending request for 72 h, and DNS changes can take a while.
  until [[ $(aws acm describe-certificate --certificate-arn "$CERT_ARN" --query Certificate.Status --output text) == ISSUED ]]; do sleep 20; done
fi

echo "==> ECR repository"
aws ecr describe-repositories --repository-names $REPO >/dev/null 2>&1 ||
  aws ecr create-repository --repository-name $REPO --image-scanning-configuration scanOnPush=true >/dev/null

echo "==> Secret $SECRET"
MUSE_API_KEY=$(grep -sE '^MUSE_API_KEY=' apps/server/.env | head -1 | cut -d= -f2- || true)
[[ -n "$MUSE_API_KEY" ]] || { echo "MUSE_API_KEY missing in apps/server/.env" >&2; exit 1; }
if SECRET_ARN=$(aws secretsmanager describe-secret --secret-id $SECRET --query ARN --output text 2>/dev/null); then
  # Keep the existing SESSION_SECRET so issued tokens stay valid; refresh the Muse key.
  SESSION_SECRET=$(aws secretsmanager get-secret-value --secret-id $SECRET --query SecretString --output text |
    node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).SESSION_SECRET)')
  SECRET_JSON=$(MUSE_API_KEY="$MUSE_API_KEY" SESSION_SECRET="$SESSION_SECRET" node -e \
    'process.stdout.write(JSON.stringify({MUSE_API_KEY:process.env.MUSE_API_KEY,SESSION_SECRET:process.env.SESSION_SECRET}))')
  # Passed on stdin so the key never shows up in the process list.
  aws secretsmanager put-secret-value --secret-id $SECRET --secret-string file:///dev/stdin <<<"$SECRET_JSON" >/dev/null
else
  SECRET_JSON=$(MUSE_API_KEY="$MUSE_API_KEY" node -e \
    'process.stdout.write(JSON.stringify({MUSE_API_KEY:process.env.MUSE_API_KEY,SESSION_SECRET:require("crypto").randomBytes(32).toString("hex")}))')
  SECRET_ARN=$(aws secretsmanager create-secret --name $SECRET --secret-string file:///dev/stdin --query ARN --output text <<<"$SECRET_JSON")
fi
unset MUSE_API_KEY SESSION_SECRET SECRET_JSON

echo "==> Image $REGISTRY/$REPO:$TAG (linux/arm64)"
aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
# No provenance attestation: it turns the tag into a manifest list, which hides ECR's scan results.
docker buildx build --platform linux/arm64 --provenance=false -f apps/server/Dockerfile -t "$REGISTRY/$REPO:$TAG" --push .

echo "==> Network"
VPC_ID=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
SUBNETS=$(aws ec2 describe-subnets --filters Name=vpc-id,Values="$VPC_ID" Name=map-public-ip-on-launch,Values=true \
  --query 'Subnets[].SubnetId' --output text | tr '\t' ',')
aws iam get-role --role-name AWSServiceRoleForECS >/dev/null 2>&1 ||
  aws iam create-service-linked-role --aws-service-name ecs.amazonaws.com >/dev/null

echo "==> Stack $STACK (origins: $ALLOWED_ORIGINS, model: $LLM_MODEL)"
aws cloudformation deploy --stack-name $STACK --template-file infra/aws/backend.yml \
  --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset \
  --parameter-overrides \
    ImageUri="$REGISTRY/$REPO:$TAG" SecretArn="$SECRET_ARN" AllowedOrigins="$ALLOWED_ORIGINS" \
    VpcId="$VPC_ID" SubnetIds="$SUBNETS" DomainName="$DOMAIN" CertificateArn="$CERT_ARN" LlmModel="$LLM_MODEL"

aws cloudformation describe-stacks --stack-name $STACK --query 'Stacks[0].Outputs' --output table
echo "DNS: CNAME $DOMAIN -> $(aws elbv2 describe-load-balancers --names proass-alb --query 'LoadBalancers[0].DNSName' --output text)"
