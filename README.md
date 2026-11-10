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

Open http://localhost:8080. When the page is served from `localhost`, it calls the API on http://localhost:8000. Image uploads work against the local API, but images don't display: resized images and originals are served by the resize Lambda and CloudFront, which don't run locally.

## Images
A message can have one image attached: JPEG, PNG, WebP or GIF, up to 10 MB. Posting with an image takes three requests:
1. `POST /api/uploads` returns a presigned POST.
2. The file goes straight to S3 with it.
3. `POST /api/messages` includes the returned `image_id`.

The API's README has the details.

Images are shown at a few fixed sizes from `/api/images/<id>/<size>`. That keeps the number of variants CloudFront caches per image small, whatever screens visitors have:

| Where | Size |
|---|---|
| Next to the message text | 140, a thumbnail of at most 140×140 |
| Large view, opened by clicking the thumbnail | 480, 960 or 1920, the smallest that covers the space it's shown in |
| Clicking the large image | The original at `/images/<id>`, in a new tab |

For the large view, the page works out how big the image will be shown. It may take up to 90% of the window's width and 70% of its height, leaving room for the message below. It uses the thumbnail's aspect ratio, and multiplies by `devicePixelRatio` for high-DPI screens. Until the larger image arrives, the view shows the thumbnail scaled up. A small original is never shown larger than its own size.

## Deploy
```bash
make deploy
```

1. Refuses to run with uncommitted changes, so the live site always matches a commit.
2. Reads the bucket and distribution from SSM: `/mboard/frontend/bucket` and `/mboard/frontend/distribution-id`, written by the infra stack.
3. Compares the contents of `site/` with the bucket, and stops if nothing changed. It compares MD5 hashes with the objects' ETags rather than timestamps, so a fresh clone doesn't look like a change.
4. Syncs `site/` to the bucket. `--delete` removes files no longer in `site/`.
5. Invalidates CloudFront's cache, so visitors get the new files within a minute or two rather than up to a day.

A file's ETag is its MD5 only when it was uploaded in one part, which the AWS CLI does for files under 8 MB. A larger file would count as changed on every deploy.

To roll back, check out an earlier commit and deploy again.

Deploying needs AWS credentials with:

| Action | Resource |
|---|---|
| `ssm:GetParameter` | `/mboard/frontend/*` |
| `s3:ListBucket` | the site bucket (to compare contents, and for `sync`) |
| `s3:PutObject`, `s3:DeleteObject` | objects in the site bucket |
| `cloudfront:CreateInvalidation` | the distribution |
