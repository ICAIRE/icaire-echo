// Google Meet page automation: join, wait to be admitted, watch for the end of the meeting.
// Meet's UI is forced to English (--lang=en-US) so these labels are stable.

const re = {
  noDevices: /continue without (microphone and camera|mic and camera)/i,
  join: /^(join now|ask to join|join here too|join anyway)$/i,
  blocked: /you can.t join this (video )?call|this meeting has been locked|check your meeting code/i,
  denied: /denied your request|you.ve been removed|you have been removed/i,
  // Meet drops a request nobody answered after a few minutes; a person would simply ask again
  unanswered: /no one responded to your request/i,
  dialogBtn: /^(got it|dismiss|ok|okay|no thanks|not now)$/i,
};

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
  if (await clickIf(page.getByRole('button', { name: /^other ways to join/i }))) {
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
  return !WAITING.test(body);
}

// resolves to fallback when p takes longer than ms
const within = (p, ms, fallback) => Promise.race([p.catch(() => fallback), new Promise((r) => setTimeout(() => r(fallback), ms))]);

async function join(page, { url, name, log, talk = false, onWaiting = () => {}, shouldAbort = () => false, admitTimeoutMs = 15 * 60 * 1000 }) {
  // Don't block on the initial load: Meet keeps connections open and may redirect.
  // The loop below inspects whatever page is there.
  page.goto(url, { waitUntil: 'commit', timeout: 60000 }).catch((e) => log('Page load issue: ' + e.message.split('\n')[0]));
  const t0 = Date.now();
  let asked = false;
  let saidWaiting = false;
  let askedAt = 0;
  let answered = Date.now(); // the last time the page answered at all

  while (Date.now() - t0 < admitTimeoutMs) {
    if (shouldAbort()) throw new Error('Cancelled before joining.');
    // a page that stops answering must not hold the bot forever: every look at it has a time limit
    const here = await within(inCall(page), 8000, null);
    if (here === true) return true;
    if (here === null) {
      if (Date.now() - answered > 120000) throw new Error('The Meet page stopped responding. Try again.');
      continue;
    }
    answered = Date.now();

    const host = new URL(page.url()).host;
    if (host.includes('accounts.google.com')) {
      throw new Error('This meeting only allows signed-in Google accounts. Run "npm run login" once to sign the bot in, then try again.');
    }
    const body = await page.locator('body').innerText().catch(() => '');
    if (re.blocked.test(body)) {
      throw new Error('Google refused to let the bot join ("' + (body.match(re.blocked) || [''])[0] + '"). Sign the bot in with "npm run login", or check the link.');
    }
    if (asked && re.denied.test(body)) throw new Error('The host declined the request to join.');
    if (asked && Date.now() - askedAt > 20000 && re.unanswered.test(body)) {
      asked = false; // the Ask to join button comes back: ask again below, until admitTimeoutMs runs out
      saidWaiting = false;
      log('Nobody answered the request yet. Asking again...');
      const again = page.getByRole('button', { name: /^(ask to join|try again|rejoin)$/i });
      await clickIf(again);
      await page.waitForTimeout(1500);
    }

    if (!talk) await clickIf(page.getByRole('button', { name: re.noDevices }));

    const nameBox = page.locator('input[aria-label="Your name" i], input[placeholder="Your name" i]');
    if (await visible(nameBox)) {
      const v = await nameBox.first().inputValue().catch(() => '');
      if (v !== name) await nameBox.first().fill(name);
    }

    if (!asked && (await clickJoin(page))) {
      asked = true;
      askedAt = Date.now();
      onWaiting();
      log('Join request sent. If you are the host, click "Admit" in Meet.');
    } else if (!saidWaiting && (asked || (await leaveButton(page).count())) && (WAITING.test(body) || /let you in/i.test(body))) {
      if (!asked) onWaiting();
      saidWaiting = true;
      log('Waiting to be admitted...');
    }
    await page.waitForTimeout(1000);
  }
  throw new Error('Timed out waiting to be admitted to the meeting.');
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

module.exports = { join, tidyAfterJoin, dismissPopups, leave, inCall, clickJoin };
