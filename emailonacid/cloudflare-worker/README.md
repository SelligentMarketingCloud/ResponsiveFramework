# EOA GitHub App Proxy Worker

This worker enables **one-click baseline updates** from the EOA diff report while ensuring each update is executed by the signed-in GitHub user (not a shared bot token).

The browser sends update details to the worker, the worker verifies request safety, and then calls `repository_dispatch` with that user's GitHub App OAuth token.

## 1) Create and configure the GitHub App (detailed)

1. Go to **GitHub → Settings → Developer settings → GitHub Apps**.
2. Click **New GitHub App**.
3. Fill in the basics:
   - **GitHub App name**: e.g. `ResponsiveFramework EOA Update Proxy`
   - **Homepage URL**: repository URL or project site URL
   - **Description**: optional
4. Configure OAuth:
   - Check **Request user authorization (OAuth) during installation**.
   - Set **Callback URL** to your worker callback endpoint:
     - `https://<your-worker-domain>/auth/callback`
   - (Optional) add the same URL in additional callback URLs if your worker has more than one domain.
5. Webhook settings:
   - Disable webhook delivery (not needed for this proxy flow).
6. Repository permissions (minimum required):
   - **Contents: Read & write** (required for `repository_dispatch` updates)
   - Keep all other permissions at **No access** unless you intentionally need more.
7. Install the app:
   - Open the app page → **Install App**.
   - Install on **SelligentMarketingCloud/ResponsiveFramework** (or the intended target repo only).
8. Collect required values from the app page:
   - **Client ID**
   - **Client secret** (generate if needed)
   - **App ID** (optional reference only)
9. Generate and save a private key only if you also need server-to-server installation auth elsewhere. The user-authenticated flow in this worker does not require the private key.

## 2) Deploy Worker

Deploy `worker.js` as a Cloudflare Worker.

Set Worker variables/secrets:

- `GITHUB_APP_CLIENT_ID` (plain text)
- `GITHUB_APP_CLIENT_SECRET` (secret)
- `AUTH_STATE_SECRET` (secret, long random string for signing OAuth state)
- `ALLOWED_OWNER=SelligentMarketingCloud`
- `ALLOWED_REPO=ResponsiveFramework`
- `ALLOWED_ORIGIN` (required; exact report origin, e.g. `https://selligentmarketingcloud.github.io`)

Optional:
- `GITHUB_APP_REDIRECT_URI=https://<your-worker-domain>/auth/callback`
- `AUTH_COOKIE_NAME=eoa_gh_user_token`

## 3) Wire repository variable

In repository **Variables**, set:

- `EOA_GITHUB_APP_PROXY_URL=https://<your-worker-domain>/`

`pr-eoa.yml` injects this URL into the report via `inject-pr-info.js`.

## 4) User flow

1. User clicks **Update** in the EOA report.
2. Browser checks auth status via `GET /auth/status`.
3. If not authenticated, browser opens `GET /auth/start`.
4. User signs in to GitHub and authorizes the GitHub App.
5. Worker receives callback on `/auth/callback`, stores short-lived token in secure cookie, and returns success to the opener window.
6. Browser retries baseline update dispatch.

## Request contract from browser

`POST <worker-url>`

```json
{
  "owner": "SelligentMarketingCloud",
  "repo": "ResponsiveFramework",
  "event_type": "eoa-update-baseline",
  "client_payload": {
    "clientId": "m365com-lm_chrcurrent_win10",
    "prNumber": 123,
    "branch": "feature/branch",
    "compareUrl": "https://selligentmarketingcloud.github.io/ResponsiveFramework/eoa/run-.../compare/m365com-lm_chrcurrent_win10.png"
  }
}
```

## Security notes

- Worker validates repo, event type, clientId, branch format, and compare URL prefix.
- Each dispatch runs with the signed-in user's GitHub identity.
- Worker checks user repository access before dispatching.
- OAuth state is HMAC-signed (`AUTH_STATE_SECRET`) with short expiration.
- Browser no longer needs PAT entry; no long-lived GitHub credential is embedded in report assets.
