# mboard-frontend
Web frontend for mboard, a tiny serverless message board: plain HTML, CSS and JavaScript with no build step. The infrastructure (S3 bucket, CloudFront) lives in the separate `mboard` repo, and the API in `mboard-backend`.

| Path | What |
|---|---|
| `site/` | The files that are deployed |
| `scripts/deploy.sh` | Uploads `site/` and clears CloudFront's cache |

The deployed site calls the API on its own domain (`/api/*`), which CloudFront routes to API Gateway, so it needs no configuration.

## Run locally
Start the API locally as described in `mboard-backend`'s README, then:

```bash
make serve
```

Open http://localhost:8080. When the page is served from `localhost`, it calls the API on http://localhost:8000.

## Deploy
```bash
make deploy
```

1. Refuses to run with uncommitted changes, so the live site always matches a commit.
2. Reads the bucket and distribution from SSM: `/mboard/frontend/bucket` and `/mboard/frontend/distribution-id`, written by the infra stack.
3. Syncs `site/` to the bucket. `--delete` removes files no longer in `site/`.
4. Invalidates CloudFront's cache, so visitors get the new files within a minute or two rather than up to a day.

To roll back, check out an earlier commit and deploy again.

Deploying needs AWS credentials with:

| Action | Resource |
|---|---|
| `ssm:GetParameter` | `/mboard/frontend/*` |
| `s3:ListBucket` | the site bucket |
| `s3:PutObject`, `s3:DeleteObject` | objects in the site bucket |
| `cloudfront:CreateInvalidation` | the distribution |
