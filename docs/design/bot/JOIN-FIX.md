# Bot join: two fixes from a live Google Meet test (2026-11-25)

For: Astra. Code only (no UI change needed). Edit `lib/meet.js`, `lib/runner.js`, `server.js`, `test/` as needed. Do not
commit. The owner wants it to work "perfectly, even if the meeting requires you to ask to enter".

## What happened (evidence)

Screenshots the bot took every 15 s while joining (`MRB_DEBUG_SHOTS=1`, see `lib/meet.js` `shotDir`):
(the run's own folder, `joining-*.png`; deleted after the fix)
(look at joining-1, joining-10, joining-21).

The bot's Chrome profile has two Google accounts. It was asked to join as `work@example.org` (server.js
`/api/join` body `account`, which sets `?authuser=abdullah%40icaire.org`), but Meet opened as the profile's default
account, the same account already in the call on four other devices. So Meet's main button was **Switch here**, which
the bot must never press (it would kick the other device out). `clickJoin()` falls back to **Other ways to join**, then
**Join here too**, but a Meet onboarding bubble ("Switch the call here ... Got it") covered that button. The bot
never dismisses such bubbles before joining, so the loop retried silently for 5 minutes. Nothing was logged, and no
error came.

## Fix 1: never get stuck silently on the pre-join page

- In the join loop, before trying to join, dismiss Meet's tip bubbles and pop-ups: Got it, Dismiss, Not now, No thanks, Close.
  - Include the "Receive desktop notifications" bubble (Not now).
  - Never press Allow, or anything that grants permissions.
  - Never press Switch here.
- For `talk === false`, the new prompt "Do you want people to see and hear you in the meeting?" with "Allow microphone and camera" must not block joining. Find Meet's current "continue without" path if it exists; otherwise join anyway.
- If the bot has not managed to press a join button within about 60 s, log once in plain words what it sees (the button names on the page). If it still cannot after about 3 minutes, end with a clear error. It must never wait silently.
- Keep the existing behaviour: ask again when nobody answers, wait up to `admitTimeoutMs` once it has asked, and the denied/blocked/removed errors.

## Fix 2: join as the chosen account, reliably

`authuser=<email>` did not take. Meet does take `authuser=<index>`, where the index is the account's position in the
browser's Google sign-in. Before opening the meeting, when `account` is an email:
- Find its index from the profile's own signed-in Google accounts. For example, open `https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard` in the bot's page and read the emails in order. Check what that endpoint returns, and parse it defensively.
- Then open the meeting with `authuser=<index>`.
- If the account is not signed in, end with a clear error naming it.
- Log which account it joins as (the email), without any cookie or token.

Also make `/api/account` (server.js `botAccount`) honest. Today it reports the Chrome profile's first `account_info`
email, but Meet uses the browser's default Google account. Return `accounts: [emails in sign-in order]` and
`email: the default one`. If reading the order needs a network call, do it in the bot's browser only when the bot
runs; otherwise keep the file-based read and label it as the profile's accounts.

## Tests

- Extend `test/mock-meet.js` / `test/e2e.test.js` (they run a fake Meet page locally) so that:
  - a fake "Got it" bubble covering the join button is dismissed and the bot joins;
  - a page offering only "Switch here" plus "Other ways to join" leads to "Join here too", never "Switch here";
  - a page with no join button ends in an error within the limit.
- Run `node --test test/unit.test.js test/e2e.test.js` if your sandbox allows. If it refuses ports or browsers, say so; I will run them and the live Meet test.

## Round 2: what the live test showed (2026-11-25, 15:51)

- `resolveAccount` failed: "Could not check whether work@example.org is signed in".
  - Opening `https://accounts.google.com/` in the bot's browser redirects to `https://myaccount.google.com`, so the in-page fetch ran on the wrong origin and got a 404.
  - A GET to `https://accounts.google.com/ListAccounts?...&json=standard` answers **400**.
  - A **POST** works. With the bot's browser context (`page.context().request.post(url, { headers: { origin: 'https://www.google.com' } })`) it answers 200 with `["gaia.l.a.r", [["gaia.l.a", ..., email at [3], ..., [9] = 1, ...]]]`. Your parser matches that.
  - Use POST through `context.request`, which carries the browser's cookies and needs no page or origin. Keep the clear errors.
- The list had **one** account: the default Gmail. `work@example.org` is signed in to Chrome (Preferences `account_info`) but not to Google on the web, so Meet cannot use it.
  - When the requested email is in Chrome's `account_info` but not in ListAccounts, say exactly that, for example: "work@example.org is signed in to Chrome but not to Google in the bot's browser. Sign it in at accounts.google.com from More, Sign the bot in to Google."
  - `/api/account` must not present Chrome-only accounts as ones the bot can join with.
- Update the unit tests for the POST path and this case. Run `node --test test/unit.test.js`. No commits.

## Round 3: one e2e test fails after round 2

`node --test test/e2e.test.js`: "dismisses the covering tip and joins here too with the selected Google account" ends
with "Recorder@example.org is not signed in to the bot's browser". The cause: `context.request.post` (APIRequestContext)
does NOT go through `context.route`, so `test/mock-meet.js`'s fake ListAccounts route never answers and the request
reaches the real Google. Keep the live path exactly as it is (POST through `context.request`; checked against the
real Google: 200 and the account list). Make the test answer it:
- either a small injectable lookup used by the tests (for example a `listAccounts` function the runner options can replace, as `setupPage` does);
- or `context.request` built on the context's routing if Playwright supports it.

Pick the cleaner one. Then run `node --test test/unit.test.js` (and `test/e2e.test.js` if your sandbox launches Chrome). No commits.
