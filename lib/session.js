// Launches the bot's Chrome, wires the in-page recorder to files on disk, and finalizes output.
const fs = require('fs');
const path = require('path');
// playwright-core is loaded only when the bot or the sign-in window opens: loading it costs 170 ms and 90 MB
const chromium = () => require('playwright-core').chromium;

// Google Chrome on Windows, macOS or Linux. Set CHROME_PATH to use another copy.
function findChrome() {
  const env = process.env;
  const list = [env.CHROME_PATH];
  if (process.platform === 'win32') {
    for (const base of [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA, 'C:\\Program Files', 'C:\\Program Files (x86)']) {
      if (base) list.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
  } else if (process.platform === 'darwin') {
    const app = 'Google Chrome.app/Contents/MacOS/Google Chrome';
    list.push(path.join('/Applications', app), path.join(require('os').homedir(), 'Applications', app));
  } else {
    list.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser');
  }
  return list.find((p) => p && fs.existsSync(p)) || list.filter(Boolean)[0] || 'chrome';
}
const CHROME = findChrome();
const HAS_CHROME = fs.existsSync(CHROME);
const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(require('./paths').DATA, 'bot-profile');

function chromeArgs({ show, talk = false }) {
  const args = [
    '--auto-accept-this-tab-capture', // lets the bot record its own tab with no picker
    '--autoplay-policy=no-user-gesture-required',
    '--disable-blink-features=AutomationControlled',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--lang=en-US',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1600,900',
  ];
  // Unless you talk through the bot's window yourself: no mic or camera, and no sound out (you would hear it twice)
  if (!talk) args.push('--deny-permission-prompts', '--mute-audio');
  // Hidden mode runs Chrome headless; make it introduce itself as regular Chrome.
  if (!show) args.push('--user-agent=' + regularUserAgent());
  return args;
}

function regularUserAgent() {
  let major = '157';
  try {
    const dir = path.dirname(CHROME);
    const v = fs.readdirSync(dir).find((d) => /^\d+\.\d+\.\d+\.\d+$/.test(d));
    if (v) major = v.split('.')[0];
  } catch {}
  if (process.platform === 'darwin') {
    try {
      const plist = fs.readFileSync(path.join(path.dirname(CHROME), '..', 'Info.plist'), 'utf8');
      const v = /CFBundleShortVersionString<\/key>\s*<string>(\d+)/.exec(plist);
      if (v) major = v[1];
    } catch {}
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
  }
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

// testMedia (tests only): Chrome's fake camera and microphone, and talk mode may stay hidden
async function launch({ outDir, show = false, talk = false, testMedia = false, profile = PROFILE, onNotice = () => {} }) {
  if (talk && !testMedia) show = true;
  const headless = !show;
  fs.mkdirSync(outDir, { recursive: true });
  const files = {};
  const open = (kind, name) => (files[kind] = { name, stream: fs.createWriteStream(path.join(outDir, name)) });
  open('video', 'video.part');
  open('audio', 'audio.part');
  const events = fs.createWriteStream(path.join(outDir, 'events.ndjson'));
  const state = { names: {}, nameHistory: [], eventCount: 0, events: [], bytes: { video: 0, audio: 0 } };

  const context = await chromium().launchPersistentContext(profile, {
    executablePath: CHROME,
    headless,
    viewport: headless ? { width: 1600, height: 900 } : null,
    locale: 'en-US',
    args: [...chromeArgs({ show, talk }), ...(testMedia ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] : [])],
    // the Mac keychain and Chrome's normal password store, as in the sign-in window: otherwise the bot cannot read
    // the Google sign-in and Google turns it away as an anonymous guest
    ignoreDefaultArgs: ['--enable-automation', '--use-mock-keychain', '--password-store=basic'],
  });

  if (talk) await context.grantPermissions(['microphone', 'camera'], { origin: 'https://meet.google.com' });
  await context.exposeFunction('__mrbWrite', (kind, b64) =>
    new Promise((res) => {
      const buf = Buffer.from(b64, 'base64');
      state.bytes[kind] += buf.length;
      files[kind].stream.write(buf, res);
    })
  );
  await context.exposeFunction('__mrbEvents', (json) => {
    const batch = JSON.parse(json);
    state.eventCount += batch.length;
    for (const e of batch) state.events.push(e);
    events.write(batch.map((e) => JSON.stringify(e)).join('\n') + '\n');
  });
  await context.exposeFunction('__mrbNames', (json, t) => {
    const map = JSON.parse(json);
    for (const [pid, names] of Object.entries(map)) {
      if (JSON.stringify(state.names[pid]) !== JSON.stringify(names)) state.nameHistory.push({ t, pid, names });
      state.names[pid] = names;
    }
  });
  await context.exposeFunction('__mrbNotice', (what) => onNotice(what));
  await context.addInitScript({ path: path.join(ROOT, 'page', 'agent.js') });

  const page = context.pages()[0] || (await context.newPage());

  async function start() {
    const info = await page.evaluate((withMic) => window.__mrb.start({ withMic }), talk);
    state.info = info;
    return info;
  }

  async function stop() {
    let result = { durationMs: 0 };
    try {
      result = (await page.evaluate(() => window.__mrb.stop())) || result;
    } catch (e) {
      console.warn('  (page was gone before stop; keeping what was already written)');
    }
    await Promise.all(
      [...Object.values(files).map((f) => f.stream), events].map((s) => new Promise((r) => s.end(r)))
    );
    state.durationMs = result.durationMs;
    return result;
  }

  return { context, page, start, stop, state, outDir };
}

module.exports = { launch, PROFILE, CHROME, HAS_CHROME, regularUserAgent };
