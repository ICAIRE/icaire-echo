// Injected into the bot's Meet tab before Meet's own code runs.
// 1. Hooks RTCPeerConnection so every remote audio track (= everyone else's voice) is captured.
// 2. On start(): mixes those tracks, captures the tab's video, records both with MediaRecorder.
// 3. Logs every class/style change inside each participant tile (the "speaking" indicator lives
//    there). Node turns that raw log into a who-spoke-when timeline after the meeting.
(() => {
  if (window.__mrb) return;
  const S = (window.__mrb = {
    audioTracks: new Set(),
    connected: new Map(),
    recording: false,
    t0: 0,
  });

  // ---------- 1. capture remote audio tracks ----------
  const NativePC = window.RTCPeerConnection;
  S.pcs = new Set();
  if (NativePC) {
    const onTrack = (e) => {
      const tr = e.track;
      if (!tr || tr.kind !== 'audio') return;
      S.audioTracks.add(tr);
      tr.addEventListener('ended', () => S.audioTracks.delete(tr));
      if (S.recording) connectTrack(tr);
    };
    class PC extends NativePC {
      constructor(...args) {
        super(...args);
        S.pcs.add(this);
        this.addEventListener('track', onTrack);
        this.addEventListener('connectionstatechange', () => this.connectionState === 'closed' && S.pcs.delete(this));
      }
    }
    window.RTCPeerConnection = PC;
    if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = PC;
  }

  function connectTrack(track) {
    if (S.connected.has(track) || track.readyState !== 'live' || !S.bus) return;
    const ms = new MediaStream([track]);
    // Chrome only feeds remote WebRTC audio into WebAudio if a media element consumes it too.
    const el = new Audio();
    el.muted = true;
    el.srcObject = ms;
    el.play().catch(() => {});
    const src = S.ctx.createMediaStreamSource(ms);
    src.connect(S.bus.rtc.input);
    S.connected.set(track, { el, src });
    track.addEventListener('ended', () => {
      try { src.disconnect(); } catch {}
      el.srcObject = null;
      S.connected.delete(track);
    });
  }

  // ---------- 1b. capture what Meet itself plays ----------
  // Meet (Nov 2026) doesn't let Chrome decode call audio: it takes the encoded frames (insertable streams),
  // decodes them in its own AudioWorklet ("neteq-processor") and plays them through its own AudioContext.
  // So the WebRTC tracks above carry no sound (0 decoded samples). Instead, copy everything a page
  // AudioContext sends to the speakers into a stream: that is exactly what a person in the call hears.
  S.meetOut = new Map(); // Meet's AudioContext -> MediaStreamAudioDestinationNode
  S.meetTapped = new Set();
  const nativeConnect = AudioNode.prototype.connect;
  const nativeDisconnect = AudioNode.prototype.disconnect;
  const isSpeakers = (n) => typeof AudioDestinationNode !== 'undefined' && n instanceof AudioDestinationNode;
  const isMeetCtx = (c) => c && c !== S.ctx && !(window.OfflineAudioContext && c instanceof OfflineAudioContext);

  function meetTap(ctx) {
    let d = S.meetOut.get(ctx);
    if (!d) {
      d = ctx.createMediaStreamDestination();
      S.meetOut.set(ctx, d);
      if (S.recording) connectMeetTap(d);
    }
    return d;
  }
  function connectMeetTap(d) {
    if (S.meetTapped.has(d) || !S.bus) return;
    S.meetTapped.add(d);
    S.ctx.createMediaStreamSource(d.stream).connect(S.bus.meet.input);
  }
  AudioNode.prototype.connect = function (dst, ...rest) {
    try {
      if (isSpeakers(dst) && isMeetCtx(this.context)) nativeConnect.call(this, meetTap(this.context));
    } catch {}
    return nativeConnect.call(this, dst, ...rest);
  };
  AudioNode.prototype.disconnect = function (...args) {
    try {
      if (isSpeakers(args[0]) && S.meetOut.has(this.context)) nativeDisconnect.call(this, S.meetOut.get(this.context));
    } catch {}
    return nativeDisconnect.apply(this, args);
  };

  // ---------- helpers ----------
  const now = () => performance.now() - S.t0;
  const TILE = '[data-participant-id]';

  function pathInTile(el, tile) {
    const parts = [];
    let cur = el;
    while (cur && cur !== tile && parts.length < 30) {
      const parent = cur.parentElement;
      if (!parent) break;
      parts.push(cur.tagName.toLowerCase() + Array.prototype.indexOf.call(parent.children, cur));
      cur = parent;
    }
    return parts.reverse().join('>') || '.';
  }

  const NOT_A_NAME = 'button, i, [role="button"], [role="menu"], [role="menuitem"], [role="tooltip"], [aria-hidden="true"], [class*="material"], [class*="icon"]';
  const shown = (el) => {
    if (!el.getClientRects().length) return false; // display:none somewhere up the tree
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.opacity !== '0';
  };

  function tileNames(tile) {
    const out = [];
    const walker = document.createTreeWalker(tile, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode()) && out.length < 4) {
      const s = (n.nodeValue || '').trim();
      if (!s || s.length > 80) continue;
      const el = n.parentElement;
      if (!el || el.closest(NOT_A_NAME) || !shown(el)) continue; // hidden tooltips/menu labels aren't names
      if (/^[a-z0-9_]+$/.test(s)) continue; // icon ligatures like "mic_off", "more_vert"
      if (!out.includes(s)) out.push(s);
    }
    return out;
  }
  // Controls Meet puts only on your own tile (seen live, Nov 2026), plus the data-self-name marker some versions use.
  const SELF_ONLY = /^(backgrounds and effects|reframe|apply visual effects)$|others might still see your full video/i;
  const selfMarked = (tile) => {
    if (tile.hasAttribute('data-self-name') || tile.querySelector('[data-self-name]')) return true;
    for (const e of tile.querySelectorAll('[role="tooltip"], [aria-label], span')) {
      const s = (e.getAttribute('aria-label') || e.textContent || '').trim();
      if (s.length < 60 && SELF_ONLY.test(s)) return true;
    }
    return false;
  };

  // ---------- 3. speaking-indicator log ----------
  let pending = [];
  const clip = (v) => (v == null ? '' : String(v).slice(0, 160));

  function onMutations(list) {
    if (!S.recording) return;
    const t = Math.round(now());
    for (const m of list) {
      if (m.type !== 'attributes') continue;
      const el = m.target;
      if (!(el instanceof Element)) continue;
      const tag = el.tagName;
      if (tag === 'VIDEO' || tag === 'CANVAS' || tag === 'AUDIO') continue;
      const tile = el.closest(TILE);
      if (!tile) continue;
      const nv = el.getAttribute(m.attributeName);
      if (nv === m.oldValue) continue;
      pending.push({
        t,
        p: tile.getAttribute('data-participant-id'),
        k: pathInTile(el, tile) + '|' + m.attributeName,
        o: clip(m.oldValue),
        n: clip(nv),
      });
    }
  }

  let lastNames = '';
  function scanTiles() {
    const map = {};
    const self = [];
    for (const tile of document.querySelectorAll(TILE)) {
      const id = tile.getAttribute('data-participant-id');
      if (!id || map[id]) continue;
      const names = tileNames(tile);
      if (names.length) map[id] = names;
      if (selfMarked(tile) && !self.includes(id)) self.push(id);
    }
    // The bot's own tile: Meet marks it with data-self-name. Signed in, it shows the account's name instead
    // of "You", so tag it. Only trusted when exactly one tile carries the marker.
    if (self.length === 1 && map[self[0]]) map[self[0]] = [...map[self[0]], '(you)'];
    const json = JSON.stringify(map);
    if (json !== lastNames) {
      lastNames = json;
      window.__mrbNames && window.__mrbNames(json, Math.round(now()));
    }
  }

  function flushEvents() {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    window.__mrbEvents && window.__mrbEvents(JSON.stringify(batch));
  }

  // ---------- 2. recording ----------
  const LOUD = 0.003; // RMS, about -50 dBFS: clearly more than codec noise
  const SWITCH_AFTER_MS = 3000;

  function makeBus() {
    const input = S.ctx.createGain();
    const meter = S.ctx.createAnalyser();
    meter.fftSize = 2048;
    const gate = S.ctx.createGain();
    gate.gain.value = 0;
    input.connect(meter);
    input.connect(gate).connect(S.dest);
    return { input, meter, gate, buf: new Float32Array(meter.fftSize), peak: 0, loudMs: 0, lastLoud: 0 };
  }

  function applySource(instant) {
    for (const [name, b] of Object.entries(S.bus)) {
      const v = name === S.source ? 1 : 0;
      if (instant) b.gate.gain.value = v;
      else b.gate.gain.setTargetAtTime(v, S.ctx.currentTime, 0.02);
    }
  }

  // Measures both sources. If the one being recorded stays silent while the other carries sound,
  // switch to the other one (and say so in the log).
  function meterTick() {
    const t = now();
    for (const b of Object.values(S.bus)) {
      b.meter.getFloatTimeDomainData(b.buf);
      let sum = 0;
      for (const x of b.buf) sum += x * x;
      const rms = Math.sqrt(sum / b.buf.length);
      b.peak = Math.max(b.peak, rms);
      if (rms > LOUD) {
        b.loudMs += 200;
        b.lastLoud = t;
      }
    }
    if (S.bus[S.source].loudMs > 0) return;
    const alt = Object.entries(S.bus)
      .filter(([name, b]) => name !== S.source && b.loudMs >= SWITCH_AFTER_MS && t - b.lastLoud < 500)
      .sort((a, b) => b[1].loudMs - a[1].loudMs)[0];
    if (alt) {
      S.source = alt[0];
      applySource(false);
      window.__mrbNotice && window.__mrbNotice('audio-source:' + alt[0]);
    }
  }

  function pickMime(list) {
    return list.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
  }

  function blobToB64(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => {
        const s = String(r.result); // "data:<mime, may contain commas>;base64,<data>"
        const i = s.indexOf(';base64,');
        res(i < 0 ? '' : s.slice(i + 8));
      };
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  }

  function makeRecorder(kind, stream, mime, opts) {
    const rec = new MediaRecorder(stream, { mimeType: mime, ...opts });
    let chain = Promise.resolve();
    rec.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      const blob = e.data;
      chain = chain.then(() => blobToB64(blob)).then((b64) => window.__mrbWrite(kind, b64)).catch((err) => {
        console.error('[mrb] write failed', err);
      });
    };
    rec.finished = new Promise((res) => {
      rec.onstop = () => res(chain);
    });
    return rec;
  }

  S.start = async ({ fps = 24, videoBps = 2500000 } = {}) => {
    if (S.recording) return S.info;
    S.ctx = new AudioContext({ sampleRate: 48000 });
    await S.ctx.resume();
    S.dest = S.ctx.createMediaStreamDestination();
    // Silent source keeps the audio track ticking even when nobody talks.
    const silent = S.ctx.createConstantSource();
    const g = S.ctx.createGain();
    g.gain.value = 0;
    silent.connect(g).connect(S.dest);
    silent.start();

    // Three ways to hear the meeting, each metered: "meet" = what Meet's own AudioContexts play (see 1b; the one
    // that works today), "tab" = Chrome's tab-audio capture, "rtc" = the raw WebRTC tracks. Only one feeds the
    // recording at a time; if it stays silent while another carries sound, meterTick switches.
    S.bus = { meet: makeBus(), tab: makeBus(), rtc: makeBus() };
    for (const d of S.meetOut.values()) connectMeetTap(d);

    const shape = { video: { frameRate: fps }, preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude' };
    let display;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        ...shape,
        audio: { suppressLocalAudioPlayback: true, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        systemAudio: 'exclude',
      });
    } catch {
      display = await navigator.mediaDevices.getDisplayMedia({ ...shape, audio: false });
    }
    S.display = display;
    const vTrack = display.getVideoTracks()[0];
    const tabAudio = display.getAudioTracks()[0];
    if (tabAudio) S.ctx.createMediaStreamSource(new MediaStream([tabAudio])).connect(S.bus.tab.input);
    S.source = 'meet';
    applySource(true);
    const aTrack = S.dest.stream.getAudioTracks()[0];

    // WebM container on purpose: it streams to disk every timeslice. Chrome's MP4 recorder holds
    // the whole video in memory until stop(), which would blow up on a long meeting.
    // H.264 inside WebM is remuxed to a normal .mp4 afterwards without re-encoding.
    const vMime = pickMime([
      'video/webm;codecs=h264,opus',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ]);
    const aMime = pickMime(['audio/webm;codecs=opus', 'audio/webm']);

    S.vRec = makeRecorder('video', new MediaStream([vTrack, aTrack]), vMime, {
      videoBitsPerSecond: videoBps,
      audioBitsPerSecond: 128000,
      videoKeyFrameIntervalDuration: 2000, // seekable, and a crash loses at most ~2 s
    });
    S.aRec = makeRecorder('audio', new MediaStream([aTrack.clone()]), aMime, { audioBitsPerSecond: 128000 });

    S.observer = new MutationObserver(onMutations);
    S.observer.observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ['class', 'style'],
    });

    S.t0 = performance.now();
    S.recording = true;
    S.vRec.start(2000);
    S.aRec.start(2000);
    for (const t of S.audioTracks) connectTrack(t);

    S.flushTimer = setInterval(flushEvents, 500);
    S.meterTimer = setInterval(meterTick, 200);
    // Voice level of what is being recorded, every 100 ms, for the panel's live waveform (0-1000, RMS x 1000).
    S.levelHist = [];
    S.levelBuf = new Float32Array(2048);
    S.levelTimer = setInterval(() => {
      const b = S.bus[S.source];
      b.meter.getFloatTimeDomainData(S.levelBuf);
      let sum = 0;
      for (const x of S.levelBuf) sum += x * x;
      S.levelHist.push(Math.min(1000, Math.round(Math.sqrt(sum / S.levelBuf.length) * 1000)));
      if (S.levelHist.length > 600) S.levelHist.shift();
    }, 100);
    S.scanTimer = setInterval(scanTiles, 2000);
    scanTiles();

    vTrack.addEventListener('ended', () => window.__mrbNotice && window.__mrbNotice('video-ended'));
    S.info = {
      videoMime: vMime,
      audioMime: aMime,
      audioSource: S.source,
      startedAt: new Date().toISOString(),
      width: vTrack.getSettings().width,
      height: vTrack.getSettings().height,
    };
    return S.info;
  };

  S.stop = async () => {
    if (!S.recording) return;
    S.recording = false;
    clearInterval(S.flushTimer);
    clearInterval(S.scanTimer);
    clearInterval(S.meterTimer);
    clearInterval(S.levelTimer);
    scanTiles();
    S.observer.disconnect();
    flushEvents();
    const doneV = S.vRec.finished;
    const doneA = S.aRec.finished;
    if (S.vRec.state !== 'inactive') S.vRec.stop();
    if (S.aRec.state !== 'inactive') S.aRec.stop();
    await (await doneV);
    await (await doneA);
    S.display.getTracks().forEach((t) => t.stop());
    return { durationMs: Math.round(now()) };
  };

  function dbOf(b, reset) {
    const p = b.peak;
    if (reset) b.peak = 0;
    return p > 0 ? Math.round(20 * Math.log10(p)) : -120;
  }

  // Troubleshooting: what WebRTC says it is receiving (decoded audio energy per receiver).
  S.audioDebug = async () => {
    const recv = [];
    for (const pc of S.pcs) {
      try {
        const stats = await pc.getStats();
        stats.forEach((r) => {
          if (r.type === 'inbound-rtp' && r.kind === 'audio') {
            recv.push({ bytes: r.bytesReceived, energy: r.totalAudioEnergy, level: r.audioLevel, samples: r.totalSamplesReceived, concealed: r.concealedSamples });
          }
        });
      } catch {}
    }
    const tracks = [...S.audioTracks].map((t) => ({ state: t.readyState, muted: t.muted, enabled: t.enabled, label: t.label }));
    const els = [...document.querySelectorAll('audio, video')].map((e) => ({ tag: e.tagName, muted: e.muted, paused: e.paused, src: !!e.srcObject, tracks: e.srcObject ? e.srcObject.getAudioTracks().length : 0 }));
    const meetCtx = [...S.meetOut.keys()].map((c) => c.state + '@' + c.sampleRate);
    return { pcs: S.pcs.size, recv, tracks, els, ctx: S.ctx && S.ctx.state, meetCtx, meetTapped: S.meetTapped.size };
  };

  S.status = () => ({
    recording: S.recording,
    elapsedMs: S.recording ? Math.round(now()) : 0,
    audioTracks: S.audioTracks.size,
    levels: S.levelHist ? S.levelHist.splice(0) : [],
    connected: S.connected.size,
    audio: S.bus && {
      source: S.source,
      // loudest level since the last status call, in dBFS
      meetDb: dbOf(S.bus.meet, true),
      tabDb: dbOf(S.bus.tab, true),
      rtcDb: dbOf(S.bus.rtc, true),
      meetLoudSec: S.bus.meet.loudMs / 1000,
      tabLoudSec: S.bus.tab.loudMs / 1000,
      rtcLoudSec: S.bus.rtc.loudMs / 1000,
      tabTrack: !!(S.display && S.display.getAudioTracks().length),
    },
    pids: [...new Set([...document.querySelectorAll(TILE)].map((t) => t.getAttribute('data-participant-id')))],
  });
})();
