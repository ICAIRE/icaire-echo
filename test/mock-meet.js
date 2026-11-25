// A scriptable fake Google Meet, served at real meet.google.com URLs through Playwright routing
// (nothing touches the network). Mirrors the real flow: device prompt -> name -> "Ask to join"
// -> waiting room -> admitted -> in-call tiles with speaking indicators + real WebRTC audio.

const BASE = {
  scenario: 'normal', // normal | blocked | signin | denied
  admitDelayMs: 1500,
  endAfterMs: null, // meeting ends (host ends call) this long after admission
  everyoneLeavesAfterMs: null, // all tiles disappear, call stays open
  participants: [
    { id: 'p1', name: 'Alice' },
    { id: 'p2', name: 'Bob' },
    { id: 'p3', name: 'Chen Wei', joinAtMs: 3000 }, // joins late
  ],
  // talking schedule, ms after admission
  schedule: [
    { id: 'p1', from: 1500, to: 3500 },
    { id: 'p2', from: 3000, to: 5500 },
    { id: 'p3', from: 6000, to: 7000 },
    { id: 'p1', from: 6500, to: 8000 },
  ],
  upsellAtMs: null, // show the "Talk up to an hour" card with only an X
  indicator: 'bars', // bars (animated levels) | border (on/off only)
  tones: [440, 660],
};

function html(cfg) {
  return `<!doctype html><html><head><title>Meet</title><style>
body{margin:0;background:#202124;color:#e8eaed;font:15px system-ui}
#app{padding:16px}.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.tile{height:200px;background:#3c4043;border-radius:8px;position:relative}
.tile.spk{outline:3px solid #8ab4f8}
.nm{position:absolute;left:10px;bottom:8px}.bars{position:absolute;right:10px;top:10px;display:flex;gap:2px;align-items:end;height:16px}
.bars b{width:3px;height:3px;background:#8ab4f8}.l1{height:6px!important}.l2{height:10px!important}.l3{height:16px!important}
[role=dialog]{position:fixed;inset:30% 30% auto;background:#fff;color:#000;padding:20px;border-radius:8px}
.bar{position:fixed;bottom:12px;left:50%}
</style></head><body><div id="app"></div><script>
const cfg = ${JSON.stringify(cfg)};
const app = document.getElementById('app');
const $h = (s) => { const d = document.createElement('div'); d.innerHTML = s; return d.firstElementChild; };
let selfName = 'You';
window.__log = [];

function prejoin() {
  if (cfg.scenario === 'noJoin') {
    app.innerHTML = '<button>Switch here</button><button>Allow</button>';
    app.onclick = () => incall(); // An unsafe click must fail the timeout test.
    return;
  }
  app.innerHTML = '<h2>Ready to join?</h2><input aria-label="Your name" placeholder="Your name"><button>Ask to join</button>';
  const dlg = $h('<div role="dialog"><p>Do you want people to see and hear you in the meeting?</p><a href="#">Continue without microphone and camera</a><button>Allow microphone and camera</button></div>');
  document.body.append(dlg);
  dlg.querySelector('a').onclick = (e) => { e.preventDefault(); window.__log.push('no-devices'); dlg.remove(); };
  dlg.querySelector('button').onclick = () => window.__log.push('allowed');
  if (cfg.prejoinTip) {
    const tip = $h('<aside style="position:fixed;inset:0;background:white"><p>Switch the call here</p><button>Got it</button></aside>');
    document.body.append(tip);
    tip.querySelector('button').onclick = () => {
      window.__log.push('tip-dismissed');
      tip.innerHTML = '<p>Receive desktop notifications</p><button>Allow</button><button>Not now</button>';
      tip.querySelector('button').onclick = () => window.__log.push('allowed');
      tip.lastElementChild.onclick = () => { window.__log.push('notifications-dismissed'); tip.remove(); };
    };
  }
  function ask() {
    if (document.querySelector('[role=dialog]')) { window.__log.push('join-clicked-under-dialog'); }
    selfName = app.querySelector('input').value || 'Guest';
    window.__log.push('ask:' + selfName);
    app.innerHTML = '<p>Asking to be let in...</p>';
    setTimeout(() => cfg.scenario === 'denied'
      ? (app.innerHTML = '<p>Someone in the call denied your request to join</p>')
      : incall(), cfg.admitDelayMs);
  }
  const main = app.querySelector('button');
  if (cfg.scenario === 'otherDevice') {
    main.textContent = 'Switch here';
    main.onclick = () => window.__log.push('switched');
    const other = $h('<button>Other ways to join</button>');
    app.append(other);
    other.onclick = () => {
      window.__log.push('other-ways');
      const too = $h('<div role="menuitem" tabindex="0">Join here too</div>');
      app.append(too);
      too.onclick = () => { window.__log.push('join-here-too'); ask(); };
    };
  } else main.onclick = ask;
}

function tile(id, name) {
  return $h('<div class="tile" data-participant-id="spaces/abc/devices/' + id + '"><div class="bars"><b></b><b></b><b></b></div><div class="nm"><i class="google-material-icons">mic_off</i><span>' + name + '</span></div></div>');
}

function incall() {
  window.__incallAt = performance.now();
  app.innerHTML = '<div class="tiles"></div>';
  const tiles = app.firstChild;
  const bar = $h('<div class="bar"><button aria-label="Leave call">call_end</button></div>');
  document.body.append(bar);
  bar.querySelector('button').onclick = () => { bar.remove(); app.innerHTML = '<p>You left the meeting</p>'; };
  tiles.append(tile('self', selfName));
  const got = $h('<div role="dialog"><p>Others may see your video differently</p><button>Got it</button></div>');
  document.body.append(got);
  got.querySelector('button').onclick = () => { window.__log.push('got-it'); got.remove(); };
  cfg.tones.forEach((f, i) => setTimeout(() => tone(f), i * 2500));
  // the free plan's upsell card: only an X to close it, shows up a while into the call
  if (cfg.upsellAtMs) setTimeout(() => {
    const up = $h('<div role="dialog" aria-label="Talk up to an hour, no charge"><button aria-label="Close">close</button><p>Talk up to an hour, no charge</p><button>Learn more</button></div>');
    document.body.append(up);
    up.querySelector('[aria-label=Close]').onclick = () => { window.__log.push('upsell-closed'); up.remove(); };
    up.querySelectorAll('button')[1].onclick = () => window.__log.push('upsell-learn-more');
  }, cfg.upsellAtMs);

  const t0 = performance.now();
  const timer = setInterval(() => {
    const t = performance.now() - t0;
    for (const p of cfg.participants) {
      let el = tiles.querySelector('[data-participant-id$="/' + p.id + '"]');
      const present = t >= (p.joinAtMs || 0) && !(cfg.everyoneLeavesAfterMs && t >= cfg.everyoneLeavesAfterMs);
      if (present && !el) tiles.append(el = tile(p.id, p.name));
      if (!present && el) { el.remove(); continue; }
      if (!el) continue;
      const on = cfg.schedule.some((s) => s.id === p.id && t >= s.from && t < s.to);
      if (cfg.indicator === 'border') el.classList.toggle('spk', on);
      else el.querySelectorAll('.bars b').forEach((b) => (b.className = on ? 'l' + (1 + Math.floor(Math.random() * 3)) : ''));
    }
    if (cfg.endAfterMs && t >= cfg.endAfterMs) {
      clearInterval(timer);
      bar.remove();
      app.innerHTML = '<p>The call ended because everyone left</p>';
    }
  }, 70);
}

async function tone(freq) {
  const ac = new AudioContext(); await ac.resume();
  const osc = ac.createOscillator(); osc.frequency.value = freq;
  const dst = ac.createMediaStreamDestination();
  // rise and fall like speech (syllables ~4/s, phrases ~every 4 s) so the panel's waveform has something to show
  const amp = ac.createGain(); amp.gain.value = 0.07;
  for (const [hz, depth] of [[4.3, 0.05], [0.23, 0.04]]) {
    const lfo = ac.createOscillator(); lfo.frequency.value = hz;
    const d = ac.createGain(); d.gain.value = depth;
    lfo.connect(d).connect(amp.gain); lfo.start();
  }
  osc.connect(amp).connect(dst); osc.start();
  const a = new RTCPeerConnection(), b = new RTCPeerConnection();
  a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate);
  b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate);
  a.addTrack(dst.stream.getAudioTracks()[0], dst.stream);
  b.ontrack = (e) => { const el = new Audio(); el.srcObject = e.streams[0]; el.play().catch(() => {}); };
  const off = await a.createOffer(); await a.setLocalDescription(off); await b.setRemoteDescription(off);
  const ans = await b.createAnswer(); await b.setLocalDescription(ans); await a.setRemoteDescription(ans);
  (window.__pcs = window.__pcs || []).push(a, b, ac);
}

if (cfg.scenario === 'blocked') app.innerHTML = "<h2>You can't join this video call</h2><p>Return to home screen</p>";
else prejoin();
</script></body></html>`;
}

// BotRun options for a fake meeting and its signed-in accounts.
function mockMeet(overrides = {}) {
  const cfg = { ...BASE, ...overrides };
  return {
    listAccounts: async () => (cfg.accounts || []).map((email) => ({ email, valid: true })),
    async setupPage(page) {
      await page.route('https://accounts.google.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<h1>Sign in</h1>' }));
      await page.route('https://meet.google.com/**', (r) => {
        if (cfg.scenario === 'signin') return r.fulfill({ contentType: 'text/html', body: '<script>location.replace("https://accounts.google.com/v3/signin?continue=meet")</script>' });
        return r.fulfill({ contentType: 'text/html', body: html(cfg) });
      });
    },
  };
}

module.exports = { mockMeet, BASE };
