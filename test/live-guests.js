// Live test helper: sends a few fake "people" into a REAL Google Meet so the bot has someone to hear.
// Each guest is a hidden Chrome whose microphone is a generated speech file (Windows text-to-speech),
// and each one logs, from its own microphone, exactly when it was talking (the ground truth).
//
//   node test/live-guests.js https://meet.google.com/xxx-xxxx-xxx [--guests 3] [--out test/out/live]
//
// The host has to admit each guest. Ctrl+C makes them leave. Compare afterwards with test/live-compare.js.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright-core');
const { CHROME } = require('../lib/session');

const args = process.argv.slice(2);
const url = args.find((a) => /meet\.google\.com/.test(a));
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const COUNT = Number(opt('--guests', 3));
const OUT = path.resolve(opt('--out', path.join(__dirname, 'out', 'live')));
if (!url) {
  console.error('usage: node test/live-guests.js <meet link> [--guests 3]');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

const GUESTS = [
  { name: 'Guest Hazel', voice: 'Microsoft Hazel Desktop', rate: 0, seed: 1 },
  { name: 'Guest Zira', voice: 'Microsoft Zira Desktop', rate: 0, seed: 2 },
  { name: 'Guest Quick', voice: 'Microsoft Zira Desktop', rate: 4, seed: 3 },
  { name: 'Guest Slow', voice: 'Microsoft Hazel Desktop', rate: -3, seed: 4 },
].slice(0, COUNT);

const LINES = [
  'I think we should start with the budget numbers before anything else.',
  'Wait, can I add something here?',
  'No, no, let me finish first.',
  'The second point is about the timeline for the launch, which keeps moving.',
  'Right.',
  'Okay, so what does everyone think about moving it to March?',
  'That works for me, but only if the design is ready by then, which honestly I doubt.',
  'Yes.',
  'Let us take that offline.',
  'Actually, one more thing about the contract and the legal review.',
];

// Random-but-repeatable sequence of sentences and pauses, rendered to a 48 kHz mono WAV.
function makeWav(g) {
  const file = path.join(OUT, g.name.replace(/\s+/g, '-') + '.wav');
  let x = g.seed * 9301;
  const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  const parts = [];
  for (let i = 0; i < 9; i++) {
    parts.push(`$p.AppendBreak([TimeSpan]::FromMilliseconds(${Math.round(1500 + rnd() * 7000)}))`);
    parts.push(`$p.AppendText('${LINES[Math.floor(rnd() * LINES.length)].replace(/'/g, "''")}')`);
  }
  const ps = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    `$s.SelectVoice('${g.voice}')`,
    `$s.Rate = ${g.rate}`,
    '$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
    `$s.SetOutputToWaveFile('${file}', $f)`,
    '$p = New-Object System.Speech.Synthesis.PromptBuilder',
    ...parts,
    '$s.Speak($p)',
    '$s.Dispose()',
  ].join('; ');
  execFileSync('powershell.exe', ['-NoProfile', '-Command', ps]);
  return file;
}

// Runs inside each guest page: watch the guest's own microphone and log talk on/off (wall clock).
const TRUTH_PROBE = () => {
  const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  let watching = null;
  navigator.mediaDevices.getUserMedia = async (c) => {
    const stream = await orig(c);
    const track = stream.getAudioTracks()[0];
    if (track) {
      if (watching) clearInterval(watching);
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      ctx.createMediaStreamSource(new MediaStream([track.clone()])).connect(an);
      const buf = new Float32Array(an.fftSize);
      let on = false;
      let lastLoud = 0;
      watching = setInterval(() => {
        if (ctx.state !== 'running') ctx.resume();
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const loud = Math.sqrt(sum / buf.length) > 0.01;
        const now = Date.now();
        if (loud) lastLoud = now;
        if (loud && !on) {
          on = true;
          window.__gt(JSON.stringify({ ev: 'on', t: now }));
        } else if (!loud && on && now - lastLoud > 250) {
          on = false;
          window.__gt(JSON.stringify({ ev: 'off', t: lastLoud }));
        }
      }, 20);
    }
    return stream;
  };
};

async function runGuest(g, i) {
  const wav = makeWav(g);
  const truth = fs.createWriteStream(path.join(OUT, g.name.replace(/\s+/g, '-') + '.truth.ndjson'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mrb-guest-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME,
    headless: true,
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--use-file-for-fake-audio-capture=' + wav,
      '--autoplay-policy=no-user-gesture-required',
      '--disable-blink-features=AutomationControlled',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--mute-audio',
      '--lang=en-US',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
    ],
  });
  await ctx.exposeFunction('__gt', (json) => truth.write(JSON.stringify({ name: g.name, ...JSON.parse(json) }) + '\n'));
  await ctx.addInitScript(TRUTH_PROBE);
  const page = ctx.pages()[0] || (await ctx.newPage());
  const say = (m) => console.log(`[${g.name}] ${m}`);
  page.goto(url, { waitUntil: 'commit', timeout: 60000 }).catch(() => {});

  let asked = false;
  for (let n = 0; n < 900; n++) {
    if (await page.locator('[aria-label*="Leave call" i]').count()) {
      say('in the call');
      break;
    }
    const body = await page.locator('body').innerText().catch(() => '');
    if (/you can.t join this (video )?call/i.test(body)) throw new Error(g.name + ': Meet refused the guest');
    const cam = page.locator('[role="button"][aria-label*="Turn off camera" i], button[aria-label*="Turn off camera" i]');
    if (await cam.first().isVisible().catch(() => false)) await cam.first().click().catch(() => {});
    const nameBox = page.locator('input[aria-label="Your name" i], input[placeholder="Your name" i]');
    if (await nameBox.first().isVisible().catch(() => false)) {
      if ((await nameBox.first().inputValue().catch(() => '')) !== g.name) await nameBox.first().fill(g.name);
    }
    if (!asked) {
      const btn = page.getByRole('button', { name: /^(ask to join|join now)$/i });
      if (await btn.first().isVisible().catch(() => false)) {
        await btn.first().click().catch(() => {});
        asked = true;
        say('asked to join - admit me');
      }
    }
    if (n === 30) await page.screenshot({ path: path.join(OUT, g.name.replace(/\s+/g, '-') + '-prejoin.png') });
    await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: path.join(OUT, g.name.replace(/\s+/g, '-') + '-incall.png') }).catch(() => {});
  return { g, ctx, page, truth };
}

(async () => {
  const guests = [];
  // Stagger joins so the host sees one request at a time.
  for (let i = 0; i < GUESTS.length; i++) {
    guests.push(runGuest(GUESTS[i], i).catch((e) => (console.error(String(e)), null)));
    await new Promise((r) => setTimeout(r, 4000));
  }
  const live = (await Promise.all(guests)).filter(Boolean);
  console.log(`${live.length} guest(s) in the call, talking. Ctrl+C to make them leave.`);
  const bye = async () => {
    for (const x of live) {
      await x.page.locator('[aria-label*="Leave call" i]').first().click({ timeout: 2000 }).catch(() => {});
      x.truth.end();
      await x.ctx.close().catch(() => {});
    }
    process.exit(0);
  };
  process.on('SIGINT', bye);
  const stopFile = path.join(OUT, 'STOP');
  setInterval(() => fs.existsSync(stopFile) && (fs.unlinkSync(stopFile), bye()), 1000);
})();
