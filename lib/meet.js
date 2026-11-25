// Google Meet page automation: join, wait to be admitted, watch for the end of the meeting.
// Meet's UI is forced to English (--lang=en-US) so these labels are stable.

const fs = require('node:fs/promises');
const path = require('node:path');

const re = {
  noDevices: /^continue without (?:a )?(?:microphone|mic) and camera$/i,
  join: /^(join now|ask to join|join here too|join anyway)$/i,
  blocked: /you can.t join this (video )?call|this meeting has been locked|check your meeting code/i,
  denied: /denied your request|you.ve been removed|you have been removed/i,
  // Meet drops a request nobody answered after a few minutes; a person would simply ask again
  unanswered: /no one responded to your request/i,
  tip: /^(got it|dismiss|not now|no thanks|close|close dialog)$/i,
};

// Google's standard ListAccounts response is a tagged array. Never guess an index
// from display names, profile preferences, or a partially understood response.
function parseAccounts(text) {
  const invalid = 'Could not read the signed-in Google accounts from the bot’s browser.';
  let data;
  try {
    data = JSON.parse(text.trim().replace(/^\)\]\}'\s*/, ''));
  } catch {
    throw new Error(invalid);
  }
  if (!Array.isArray(data) || data[0] !== 'gaia.l.a.r') throw new Error(invalid);
  const rows = data[1] ?? [];
  if (!Array.isArray(rows)) throw new Error(invalid);
  const accounts = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row[0] !== 'gaia.l.a') throw new Error(invalid);
    if (row[14] === 1 || row[14] === true) continue; // remembered, signed out
    const email = row[3];
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error(invalid);
    accounts.push({ email, valid: row[9] == null || row[9] === 1 || row[9] === true });
  }
  return accounts;
}

async function listGoogleAccounts(page) {
  const response = await page.context().request.post('https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard', {
    headers: { origin: 'https://www.google.com' },
    timeout: 10000,
  });
  try {
    if (!response.ok()) throw new Error('ListAccounts request failed');
    return parseAccounts(await response.text());
  } finally {
    await response.dispose();
  }
}

async function resolveAccount(page, url, account, log, onAccounts, listAccounts) {
  let accounts;
  try {
    accounts = await listAccounts(page);
  } catch {
    if (account?.includes('@')) throw new Error(`Could not check whether ${account} is signed in to the bot’s browser.`);
    return; // Guest and numeric authuser links can still open without the account list.
  }
  onAccounts(accounts);
  if (!account?.includes('@')) {
    const selected = accounts[Number(account || 0)];
    if (selected?.valid) log(`Joining as ${selected.email}.`);
    return;
  }
  const index = accounts.findIndex((a) => a.valid && a.email.toLowerCase() === account.toLowerCase());
  if (index < 0) {
    // Chrome reports the actual profile directory, including for custom bot profiles.
    let inChrome = false;
    try {
      await page.goto('chrome://version/', { timeout: 5000 });
      const dir = await page.locator('#profile_path').innerText({ timeout: 2000 });
      const prefs = JSON.parse(await fs.readFile(path.join(dir.trim(), 'Preferences'), 'utf8'));
      inChrome = (prefs.account_info || []).some((entry) => entry?.email?.toLowerCase() === account.toLowerCase());
    } catch {}
    if (inChrome) throw new Error(`${account} is signed in to Chrome but not to Google in the bot's browser. Sign it in at accounts.google.com from More, Sign the bot in to Google.`);
    throw new Error(`${account} is not signed in to the bot’s browser. Sign it in and try again.`);
  }
  url.searchParams.set('authuser', String(index));
  log(`Joining as ${accounts[index].email}.`);
}

async function visible(locator) {
  try {
    return await locator.first().isVisible();
  } catch {
    return false;
  }
}

async function clickIf(locator) {
  if (!(await visible(locator))) return false;
  try {
    await locator.first().click({ timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

// When the signed-in account is already in the call on another device, Meet's main button is "Switch here",
// which would kick that other device out. "Join here too" is tucked under "Other ways to join". Never switch.
async function clickJoin(page) {
  if (await clickIf(page.getByRole('button', { name: re.join }))) return true;
  if (await clickIf(page.getByRole('button', { name: /^other ways to join$/i }))) {
    await page.waitForTimeout(600);
    const tooBtn = page.getByRole('menuitem', { name: /join here too/i }).or(page.getByRole('button', { name: /join here too/i }));
    if (await clickIf(tooBtn)) return true;
    if (await clickIf(page.getByText(/^join here too$/i))) return true;
    await page.keyboard.press('Escape').catch(() => {});
  }
  return false;
}

const leaveButton = (page) => page.locator('button[aria-label*="Leave call" i], [role="button"][aria-label*="Leave call" i]');
// Meet shows the call controls (incl. Leave call) in its waiting room too; these texts mean "not admitted yet".
const WAITING = /please wait until a meeting host brings you into the call|asking to be let in|someone in the call (will|should) let you in|you.ll join the call when someone lets you in|waiting for the host/i;

async function inCall(page) {
  if (!(await leaveButton(page).count())) return false;
  const body = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  return !!body && !WAITING.test(body) && !re.denied.test(body) && !re.unanswered.test(body) && !re.blocked.test(body);
}

// resolves to fallback when p takes longer than ms
const within = (p, ms, fallback) => Promise.race([p.catch(() => fallback), new Promise((r) => setTimeout(() => r(fallback), ms))]);

async function join(page, { url, name, log, talk = false, onWaiting = () => {}, shouldAbort = () => false, admitTimeoutMs = 15 * 60 * 1000, joinTimeoutMs = 180000, account, listAccounts = listGoogleAccounts, onAccounts = () => {}, shotDir = null }) {
  const target = new URL(url);
  const requested = account || target.searchParams.get('authuser');
  await resolveAccount(page, target, requested, log, onAccounts, listAccounts);
  // Meet may redirect or keep loading while the pre-join controls are already usable.
  page.goto(target.href, { waitUntil: 'commit', timeout: 60000 }).catch((e) => log('Page load issue: ' + e.message.split('\n')[0]));
  const t0 = Date.now();
  let asked = false;
  let saidWaiting = false;
  let askedAt = 0;
  let admitDeadline = null;
  let warned = false;
  let answered = Date.now(); // the last time the page answered at all

  let shots = 0;
  const s = {};
  while (true) {
    if (shouldAbort()) throw new Error('Cancelled before joining.');
    if (admitDeadline !== null && Date.now() >= admitDeadline) {
      throw new Error('Timed out waiting to be admitted to the meeting.');
    }
    if (admitDeadline === null && Date.now() - t0 >= joinTimeoutMs / 3 && !warned) {
      warned = true;
      const buttons = await within(page.getByRole('button').evaluateAll((els) => els.map((el) => {
        const label = el.getAttribute('aria-labelledby')?.split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent).join(' ').trim();
        return label || el.getAttribute('aria-label') || el.innerText || el.value || el.title || '(unnamed)';
      }).join(', ')), 3000, 'page did not respond');
      log('Still trying to press a join button. Buttons on the page: ' + (buttons || 'none'));
    }
    if (admitDeadline === null && Date.now() - t0 >= joinTimeoutMs) {
      throw new Error('Could not press a join button on the Meet pre-join page in time.');
    }
    if (shotDir && Date.now() - t0 > shots * 15000) {
      shots++;
      await within(page.screenshot({ path: require('path').join(shotDir, `joining-${shots}.png`), timeout: 5000 }), 6000, null);
    }
    // a page that stops answering must not hold the bot forever: every look at it has a time limit
    const here = await within(inCall(page), 8000, null);
    if (here === true) return true;
    if (here === null) {
      if (Date.now() - answered > 30000 && !s.saidSlow) (s.saidSlow = true), log('The Meet page is slow to answer...');
      if (Date.now() - answered > 120000) throw new Error('The Meet page stopped responding. Try again.');
      continue;
    }
    answered = Date.now();

    const host = new URL(page.url()).host;
    if (host.includes('accounts.google.com')) {
      throw new Error('This meeting only lets in signed-in Google accounts. Sign the bot in once (More, then "Sign the bot in to Google"), then try again.');
    }
    const body = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
    if (re.blocked.test(body)) {
      throw new Error('Google refused to let the bot join ("' + (body.match(re.blocked) || [''])[0] + '"). Sign the bot in (More, then "Sign the bot in to Google"), or check the link.');
    }
    if (admitDeadline !== null && re.denied.test(body)) throw new Error('The host declined the request to join.');
    if (asked && Date.now() - askedAt > 20000 && re.unanswered.test(body)) {
      asked = false; // Keep the original admission deadline across retries.
      saidWaiting = false;
      log('Nobody answered the request yet. Asking again...');
      const again = page.getByRole('button', { name: /^(try again|rejoin)$/i });
      await clickIf(again);
      await page.waitForTimeout(1500);
    }

    if (!asked) {
      // A second tip can cover the first one's dismiss button.
      let dismissed = false;
      for (const tip of await page.getByRole('button', { name: re.tip }).all()) {
        dismissed = await clickIf(tip);
        if (dismissed) break;
      }
      if (dismissed) {
        await page.waitForTimeout(200);
        continue;
      }
      if (!talk) {
        const withoutDevices = page.getByRole('button', { name: re.noDevices }).or(page.getByText(re.noDevices));
        if (!(await clickIf(withoutDevices)) && /do you want people to see and hear you/i.test(body)) {
          await page.keyboard.press('Escape');
        }
      }
    }

    const nameBox = page.locator('input[aria-label="Your name" i], input[placeholder="Your name" i]');
    if (await visible(nameBox)) {
      const v = await nameBox.first().inputValue({ timeout: 2000 }).catch(() => '');
      if (v !== name) await nameBox.first().fill(name, { timeout: 2000 }).catch(() => {});
    }

    if (!asked && (await clickJoin(page))) {
      asked = true;
      askedAt = Date.now();
      admitDeadline ??= askedAt + admitTimeoutMs;
      onWaiting();
      log('Join request sent. If you are the host, click "Admit" in Meet.');
    } else if (!saidWaiting && (WAITING.test(body) || (asked && /let you in/i.test(body)))) {
      if (!asked) {
        asked = true;
        askedAt = Date.now();
        admitDeadline ??= askedAt + admitTimeoutMs;
        onWaiting();
      }
      saidWaiting = true;
      log('Waiting to be admitted...');
    }
    await page.waitForTimeout(1000);
  }
}

// Meet keeps putting cards over the call: "Got it" tips, and later the free plan's "Talk up to an hour,
// no charge" upsell that only has an X. They cover the tiles, so close them whenever they appear.
// Only harmless buttons are pressed: never anything that leaves, ends, switches or removes.
const CLOSE_NAME = /^(got it|dismiss|ok|okay|no thanks|not now|maybe later|close|close dialog)$/i;
const DANGER = /leave|end call|end the call|switch|remove|mute everyone|turn off/i;

async function dismissPopups(page) {
  const open = page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible');
  let closed = 0;
  for (let i = 0; i < 4; i++) {
    const n = await open.count().catch(() => 0);
    if (!n) break;
    const btn = open
      .getByRole('button', { name: CLOSE_NAME })
      .or(open.locator('button[aria-label="Close" i], [role="button"][aria-label="Close" i], button[aria-label="Close dialog" i]'));
    const first = btn.first();
    if (!(await first.isVisible().catch(() => false))) {
      // no close button we recognise: Escape closes Meet's cards without touching anything else
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(300);
      if ((await open.count().catch(() => 0)) < n) closed++;
      break;
    }
    const label = ((await first.getAttribute('aria-label').catch(() => '')) || '') + ' ' + ((await first.innerText().catch(() => '')) || '');
    if (DANGER.test(label)) break;
    try {
      await first.click({ timeout: 2000 });
      closed++;
    } catch {
      break;
    }
    await page.waitForTimeout(300);
  }
  if (closed) await page.mouse.move(1, 1).catch(() => {});
  return closed;
}

async function tidyAfterJoin(page) {
  await dismissPopups(page);
  await page.mouse.move(1, 1).catch(() => {}); // keep the cursor off the tiles (hover changes their DOM)
}

async function leave(page) {
  try {
    if (await inCall(page)) await leaveButton(page).first().click({ timeout: 3000 });
  } catch {}
}

module.exports = { join, tidyAfterJoin, dismissPopups, leave, inCall, clickJoin, parseAccounts };
