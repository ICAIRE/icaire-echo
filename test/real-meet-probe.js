// Manual smoke test against the REAL Google Meet: opens a link in the hidden bot browser (fresh,
// signed-out profile), does NOT click join, and reports what Google shows the bot.
// Usage: node test/real-meet-probe.js https://meet.google.com/xxx-yyyy-zzz
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch } = require('../lib/session');

(async () => {
  const url = process.argv[2];
  if (!url) throw new Error('pass a meet.google.com link');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mrb-probe-'));
  const s = await launch({ outDir: path.join(tmp, 'out'), profile: path.join(tmp, 'profile'), show: process.argv.includes('--show') });
  await s.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => console.log('goto:', e.message.split('\n')[0]));
  await s.page.waitForTimeout(9000);
  const info = await s.page.evaluate(() => ({
    url: location.href,
    title: document.title,
    hookActive: !!window.__mrb && window.RTCPeerConnection.name === 'PC',
    webdriver: navigator.webdriver,
    text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 600),
    buttons: [...document.querySelectorAll('button,[role=button]')].map((b) => (b.getAttribute('aria-label') || b.innerText || '').trim()).filter(Boolean).slice(0, 25),
    inputs: [...document.querySelectorAll('input')].map((i) => i.getAttribute('aria-label') || i.placeholder || i.type),
  }));
  console.log(JSON.stringify(info, null, 2));
  const shot = path.join(__dirname, 'out', 'real-meet-probe.png');
  fs.mkdirSync(path.dirname(shot), { recursive: true });
  await s.page.screenshot({ path: shot });
  console.log('screenshot:', shot);
  await s.stop().catch(() => {});
  await s.context.close();
  fs.rmSync(tmp, { recursive: true, force: true });
})();
