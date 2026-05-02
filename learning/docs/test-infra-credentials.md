# Test infrastructure — credentials needed for PR-F

PR-E (this PR) ships the **Docker-only** test infrastructure: Postgres, MailHog, stripe-mock. No external credentials are required to run `npm run test:infra` — everything runs locally.

PR-F adds infrastructure-bound tests on top of the Docker stack, and one of the items in PR-F's sequencing is a real OAuth round-trip against a sandbox provider. That requires credentials this repo doesn't have. This document captures what the team needs to provision so PR-F's last item isn't blocked when we get there.

---

## What PR-F item 9 needs

A single OAuth provider sandbox account, used to verify the real callback → token-exchange → encrypted-storage round-trip. Google is the chosen spike provider because:
- Google's OAuth sandbox is free and self-serve.
- We already have the most Google integration code paths (Gmail, Calendar, Drive, Sheets, Docs) — exercising one provider's full callback proves the pattern.
- Google's refresh-token semantics are the most common in our handler universe (Microsoft, Notion, HubSpot, etc. follow similar shapes).

The other providers (Microsoft, Slack, Discord, Notion, Airtable, Shopify, Stripe Connect) are **not** part of PR-F's scope — their OAuth tests are deferred until after the spike validates the approach.

---

## What the team needs to provision

**Owner:** infrastructure / engineering manager (whoever has access to a Google Cloud project for ChainReact).

### 1. Google Cloud OAuth client (for sandbox)

A dedicated OAuth client distinct from production. Specifically:

- Create a new GCP project named `chainreact-test-oauth` (or reuse a pre-existing test project).
- Enable the APIs the integrations exercise:
  - Gmail API
  - Google Calendar API
  - Google Drive API
  - Google Sheets API
- Create an OAuth 2.0 Client ID of type **Web application**:
  - Authorized redirect URIs: `http://localhost:3000/api/integrations/google/callback` and `http://127.0.0.1:3000/api/integrations/google/callback`.
- Note the **Client ID** and **Client Secret**.
- Configure the OAuth consent screen as **External** + **Testing** so test users can authorize without going through Google's verification process. Add the test Google account (next item) as a test user.

### 2. A throwaway Google account

A Google account whose data the test suite is allowed to read/write/delete. This is a real account but should contain zero sensitive data. Recommended pattern:
- Create a new Gmail account `chainreact-test-<short-id>@gmail.com`.
- Use a long random password stored in 1Password (or whichever secrets manager the team uses).
- Enable 2-step verification and generate an **app password** if the test flow needs IMAP/SMTP fallbacks (it doesn't today).

### 3. Test-user refresh token (for unattended CI)

CI cannot click through Google's consent screen. The pattern is:
- Locally, use the test account to authorize the sandbox OAuth client via the running ChainReact dev server, capturing the refresh token from the post-callback DB row.
- Store that refresh token as a GitHub Actions secret `TEST_GOOGLE_REFRESH_TOKEN`.
- The infra test imports this token via `tokenRefreshService.refresh(...)` to obtain a fresh access token at the start of each test run, then exercises the integration handlers against the live sandbox account.
- Rotate quarterly by re-authorizing.

---

## What goes into GitHub Actions secrets

| Secret name | Source | Used by |
|---|---|---|
| `TEST_GOOGLE_CLIENT_ID` | step 1 | infra OAuth tests |
| `TEST_GOOGLE_CLIENT_SECRET` | step 1 | infra OAuth tests |
| `TEST_GOOGLE_REFRESH_TOKEN` | step 3 | infra OAuth tests |
| `TEST_GOOGLE_USER_EMAIL` | step 2 | infra OAuth tests (assertion target) |

These are wired into `.github/workflows/ci.yml`'s `infra-tests` job as of PR-F item 9. The test file [`__tests__/infra/google-oauth.infra.test.ts`](../../__tests__/infra/google-oauth.infra.test.ts) skips cleanly when any of the three required secrets (`TEST_GOOGLE_CLIENT_ID` / `TEST_GOOGLE_CLIENT_SECRET` / `TEST_GOOGLE_REFRESH_TOKEN`) is unset, so CI passes today and starts exercising the live round-trip the moment the secrets are provisioned. `TEST_GOOGLE_USER_EMAIL` is optional metadata.

---

## What PR-E itself needs (none)

The PR-E smoke tests run entirely against locally-launched Docker containers. No credentials are required, no GitHub secrets are referenced. CI's `infra-tests` job runs cleanly today.

---

## Out of scope

- Microsoft / Slack / Discord / Notion / etc. sandbox accounts. Add them when the corresponding integrations gain dedicated infra tests in a future PR.
- Production OAuth clients. PR-F's tests must NEVER use production credentials — that would put real user data inside the test fixture.
- Stripe live-mode credentials. stripe-mock covers the test-side work; real Stripe is out of scope until the team decides Stripe-Connect tests are worth the cost.
