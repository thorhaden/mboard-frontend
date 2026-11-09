#!/usr/bin/env bash
# Upload site/ to the site bucket and clear CloudFront's cache.
#
#   scripts/deploy.sh
#
# The bucket and distribution come from SSM parameters written by the infra stack.
# Refuses to run with uncommitted changes, so the live site always matches a commit;
# roll back by checking out an earlier commit and deploying again.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "uncommitted changes; commit them first so the live site matches a commit" >&2
  exit 1
fi

param() { aws ssm get-parameter --name "$1" --query Parameter.Value --output text; }
bucket=$(param /mboard/frontend/bucket)
distribution=$(param /mboard/frontend/distribution-id)

# --delete removes files that are no longer in site/.
aws s3 sync site/ "s3://$bucket/" --delete

# The files' names don't change between versions, so CloudFront would keep serving cached
# copies for up to a day. "/*" counts as one path; the first 1,000 paths a month are free.
id=$(aws cloudfront create-invalidation --distribution-id "$distribution" --paths '/*' \
  --query Invalidation.Id --output text)
echo "deployed $(git rev-parse --short HEAD); CloudFront invalidation $id takes a minute or two"
