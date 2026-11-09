#!/usr/bin/env bash
# Upload site/ to the site bucket and clear CloudFront's cache, if anything changed.
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

# Compare contents, not timestamps: a fresh clone makes every file look newer, so `aws s3 sync`
# would re-upload everything. For files uploaded in one part (the CLI does that below 8 MB), the
# S3 ETag is the file's MD5, so equal hashes mean equal contents.
declare -A remote=()
while IFS=$'\t' read -r key etag; do
  [ -n "$key" ] && [ "$key" != None ] && remote[$key]=${etag//\"/}
done < <(aws s3api list-objects-v2 --bucket "$bucket" --query 'Contents[].[Key,ETag]' --output text)

changed=()
while IFS= read -r -d '' file; do
  key=${file#site/}
  [ "${remote[$key]:-}" = "$(md5sum "$file" | cut -d' ' -f1)" ] || changed+=("$key")
  unset "remote[$key]"
done < <(find site -type f -print0)
deleted=("${!remote[@]}") # in the bucket but no longer in site/

if [ ${#changed[@]} -eq 0 ] && [ ${#deleted[@]} -eq 0 ]; then
  echo "site is up to date ($(git rev-parse --short HEAD)); nothing to deploy"
  exit 0
fi
[ ${#changed[@]} -gt 0 ] && echo "changed: ${changed[*]}"
[ ${#deleted[@]} -gt 0 ] && echo "deleted: ${deleted[*]}"

# --delete removes files that are no longer in site/.
aws s3 sync site/ "s3://$bucket/" --delete --no-progress

# The files' names don't change between versions, so CloudFront would keep serving cached
# copies for up to a day. "/*" counts as one path; the first 1,000 paths a month are free.
id=$(aws cloudfront create-invalidation --distribution-id "$distribution" --paths '/*' \
  --query Invalidation.Id --output text)
echo "deployed $(git rev-parse --short HEAD); CloudFront invalidation $id takes a minute or two"
