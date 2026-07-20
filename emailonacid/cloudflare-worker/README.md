# EOA GitHub App Proxy Worker

This worker enables **one-click baseline updates** from the EOA diff report without requiring PAT entry or OAuth device flow in the browser.

The browser sends update details to the worker; the worker authenticates as a GitHub App installation and calls `repository_dispatch`.

## 1) Create a GitHub App

Configure the app with:
- Repository permissions: **Contents: Read & write**
- Install it on this repository (`SelligentMarketingCloud/ResponsiveFramework`)

Collect:
- **App ID**
- **Installation ID**
- **Private key PEM**

## 2) Deploy Worker

Use the script in `worker.js`.

Set Worker variables/secrets:
- `GITHUB_APP_ID`
- `GITHUB_INSTALLATION_ID`
- `GITHUB_APP_PRIVATE_KEY_PEM` (secret)
- `ALLOWED_OWNER=SelligentMarketingCloud`
- `ALLOWED_REPO=ResponsiveFramework`
- `ALLOWED_ORIGIN` (optional, e.g. `https://selligentmarketingcloud.github.io`)

## 3) Wire repository variable

In repository variables, set:
- `EOA_GITHUB_APP_PROXY_URL=https://<your-worker-domain>/`

`pr-eoa.yml` injects this URL into the report via `inject-pr-info.js`.

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
- Browser no longer stores long-lived GitHub credentials.
- GitHub App private key stays server-side in Worker secrets.
