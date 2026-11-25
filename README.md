# mboard-frontend
Web frontend for mboard, a tiny serverless message board: plain HTML, CSS and JavaScript with no build step. The infrastructure (S3 bucket, CloudFront) lives in the separate `mboard` repo, and the API in `mboard-backend`.

| Path | What |
|---|---|
| `site/` | The files that are deployed |
| `site/auth.js` | Sign-in with Cognito |
| `site/config.js` | Sign-in settings; the committed one is for running locally, and the deploy writes the real one |
| `scripts/deploy.sh` | Uploads `site/` and clears CloudFront's cache |

The deployed site calls the API on its own domain (`/api/*`), which CloudFront routes to API Gateway, so it needs no API URL.

## Sign-in
Users sign in on Amazon Cognito's own pages (Managed Login), which also handle changing the temporary password, setting up MFA and resetting a forgotten password. Accounts are invite-only, created by an admin as described in the infra repo's README. The page uses the authorization code flow with PKCE, in [site/auth.js](site/auth.js):

1. Without tokens, the page sends the browser to Cognito's sign-in page. It includes a SHA-256 hash of a random secret, the code verifier, and a random `state`. Both are kept in `sessionStorage` meanwhile.
2. After signing in, Cognito sends the browser back to the site with `?code=...&state=...`.
3. The page checks that `state` matches, then swaps the code and the verifier for tokens at Cognito's token endpoint. Someone who intercepted the code can't use it without the verifier. The code is removed from the URL.
4. API calls send the access token as `Authorization: Bearer <token>`. API Gateway checks it.

The access token is valid for an hour. Shortly before it expires, the page gets a new one with the refresh token, which works for 30 days; after that, users sign in again. If the API answers 401 anyway, the page refreshes the token and tries once more. If the refresh fails too, it sends the browser to sign in.

The tokens are kept in `localStorage`, so you stay signed in across tabs and browser restarts. Any script running on the page could read them, so the page never inserts user input as HTML, only as text.

**Sign out** revokes the refresh token, clears the tokens and sends the browser to Cognito's logout page, which ends the Cognito session and sends it back to the site, and from there to the sign-in page. An access token that was already issued keeps working at the API until it expires, since API Gateway doesn't check revocations.

Images are loaded with `<img src>`, which can't send a token. The API serves them without one; the infra repo's README explains how they're protected.

`site/config.js` sets `AUTH_CONFIG` to the Cognito sign-in domain and app client ID. The committed version sets it to `null`, for running locally.

## Run locally
Start the API locally as described in `mboard-backend`'s README, then:

```bash
make serve
```

Open http://localhost:8080. When the page is served from `localhost`, it calls the API on http://localhost:8000. There's no sign-in locally: the committed `config.js` turns it off, and the local API treats every request as its `DEV_USER`. Image uploads work against the local API, but images don't display: resized images and originals are served by the resize Lambda and CloudFront, which don't run locally.

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
2. Reads the bucket, distribution and sign-in settings from SSM: `/mboard/frontend/bucket`, `/mboard/frontend/distribution-id`, `/mboard/frontend/auth-url` and `/mboard/frontend/auth-client-id`, written by the infra stack.
3. Copies `site/` to a temporary folder and writes `config.js` there with the sign-in settings. That folder is what gets deployed.
4. Compares its contents with the bucket, and stops if nothing changed. It compares MD5 hashes with the objects' ETags rather than timestamps, so a fresh clone doesn't look like a change.
5. Syncs it to the bucket. `--delete` removes files no longer in `site/`.
6. Invalidates CloudFront's cache, so visitors get the new files within a minute or two rather than up to a day.

A file's ETag is its MD5 only when it was uploaded in one part, which the AWS CLI does for files under 8 MB. A larger file would count as changed on every deploy.

To roll back, check out an earlier commit and deploy again.

Deploying needs AWS credentials with:

| Action | Resource |
|---|---|
| `ssm:GetParameter` | `/mboard/frontend/*` |
| `s3:ListBucket` | the site bucket (to compare contents, and for `sync`) |
| `s3:PutObject`, `s3:DeleteObject` | objects in the site bucket |
| `cloudfront:CreateInvalidation` | the distribution |
