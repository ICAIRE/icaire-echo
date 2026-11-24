// One bot run: launch -> join -> record -> auto-stop -> process files.
// Emits 'update' (live snapshot) and 'log'. Used by both the control panel (server.js) and the CLI (bot.js).
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { launch } = require('./session');
const { join, tidyAfterJoin, dismissPopups, leave, inCall } = require('./meet');
const { buildTimeline } = require('./timeline');
const { finalize, botPidsOf, isBotName } = require('./finalize');

const ROOT = path.join(__dirname, '..');
const ACTIVE = new Set(['starting', 'joining', 'waiting', 'recording', 'stopping', 'processing']);
const AUDIO_SOURCE = { meet: "Meet's own audio output", tab: 'the tab audio capture', rtc: 'the WebRTC tracks' };

class BotRun extends EventEmitter {
  constructor(opts) {
    super();
    this.opts = {
      name: 'Recorder',
      show: false,
      aloneMinutes: 2,
      maxHours: 4,
      outRoot: path.join(ROOT, 'recordings'),
      previewMs: 3000,
      pollMs: 1000,
      ...opts,
    };
    this.id = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    this.outDir = path.join(this.opts.outRoot, this.id);
    this.status = 'starting';
    this.logs = [];
    this.error = null;
    this.stopReason = null;
    this.elapsedMs = 0;
    this.live = { pids: [], connected: 0 };
    this.levelHist = []; // voice level every 100 ms (0-1000), last 2 minutes
    this.timeline = { segments: [] };
    this.preview = null;
    this.notes = [];
  }

  get active() {
    return ACTIVE.has(this.status);
  }

  log(msg) {
    const line = { t: Date.now(), msg };
    this.logs.push(line);
    if (this.logs.length > 300) this.logs.shift();
    this.emit('log', line);
    this.changed();
  }

  setStatus(s) {
    this.status = s;
    clearTimeout(this._pending);
    this._pending = null;
    this.emit('update', this.snapshot()); // status changes go out immediately
  }

  changed() {
    if (this._pending) return;
    this._pending = setTimeout(() => {
      this._pending = null;
      this.emit('update', this.snapshot());
    }, 50);
  }

  stop(reason = 'stopped from the control panel') {
    if (!this.stopReason) {
      this.stopReason = reason;
      this.log(`Stop requested: ${reason}`);
      // Before recording starts the join loop is waiting on the Meet page; a page that has stopped answering
      // would hold it forever. Closing the bot's browser ends those waits, so Stop always works.
      if (['starting', 'joining', 'waiting'].includes(this.status)) {
        setTimeout(() => {
          if (this.status !== 'recording' && this.session) this.session.context.close().catch(() => {});
        }, 3000).unref();
      }
    }
  }

  isBot(pid) {
    return isBotName(this.session?.state.names[pid], this.opts.name);
  }

  async run() {
    const o = this.opts;
    let started = false;
    try {
      this.log(`Launching bot "${o.name}"${o.show ? ' (visible window)' : ' (hidden)'}`);
      this.session = await launch({
        outDir: this.outDir,
        show: o.show,
        talk: !!o.talk,
        testMedia: !!o.testMedia,
        profile: o.profile,
        onNotice: (w) => {
          if (w === 'video-ended') this.stop('tab capture ended');
          const src = /^audio-source:(\w+)$/.exec(w);
          if (src) {
            this.audioSource = src[1];
            this.log(`The current audio source is silent while another carries sound; recording ${AUDIO_SOURCE[src[1]] || src[1]} instead.`);
          }
        },
      });
      const page = this.session.page;
      page.on('close', () => ['joining', 'waiting', 'recording'].includes(this.status) && this.stop('the bot window was closed'));
      if (o.setupPage) await o.setupPage(page);
      this.previewTimer = setInterval(() => this.capturePreview(), o.previewMs);

      this.setStatus('joining');
      this.log(`Opening ${o.url}`);
      await join(page, {
        url: o.url,
        name: o.name,
        talk: !!o.talk,
        log: (m) => this.log(m),
        onWaiting: () => this.setStatus('waiting'),
        shouldAbort: () => !!this.stopReason,
      });
      this.log('Joined the meeting.');
      await tidyAfterJoin(page);

      const info = await this.session.start();
      started = true;
      this.startedAt = Date.now();
      this.setStatus('recording');
      this.audioSource = info.audioSource;
      if (o.talk) this.log(info.mic ? 'Your microphone is in the recording.' : 'Your microphone could not be added to the recording: only the others will be recorded.');
      this.log(`Recording ${info.width}x${info.height} (${info.videoMime.split(';')[0]}), audio from ${AUDIO_SOURCE[info.audioSource] || info.audioSource}`);
      await this.monitor(page);
    } catch (e) {
      if (!this.stopReason) {
        this.error = e.message;
        this.log('Error: ' + e.message);
      }
    }
    clearInterval(this.previewTimer);

    this.setStatus('stopping');
    if (started) await this.session.stop();
    if (this.session) {
      // a page that stopped answering must not hold up the end
      await Promise.race([leave(this.session.page).catch(() => {}), new Promise((r) => setTimeout(r, 6000))]);
      await this.session.context.close().catch(() => {});
    }

    if (!started) {
      fs.rmSync(this.outDir, { recursive: true, force: true });
      this.setStatus(this.error ? 'error' : 'cancelled');
      return this.snapshot();
    }

    this.setStatus('processing');
    try {
      this.notes = await finalize({
        outDir: this.outDir,
        state: this.session.state,
        botName: o.name,
        meetUrl: o.url,
        log: (m) => this.log(m),
      });
      this.notes.forEach((n) => this.log('Note: ' + n));
      this.refreshTimeline(this.session.state.durationMs);
      this.setStatus('done');
      this.log('Done. Files saved to ' + this.outDir);
    } catch (e) {
      this.error = 'Processing failed: ' + e.message;
      this.log(this.error);
      this.setStatus('error');
    }
    return this.snapshot();
  }

  async monitor(page) {
    const o = this.opts;
    let misses = 0;
    let aloneSince = null;
    let seenOthers = false;
    while (!this.stopReason) {
      await new Promise((r) => setTimeout(r, o.pollMs));
      let st;
      try {
        st = await page.evaluate(() => window.__mrb.status());
      } catch {
        this.stop('the bot window closed');
        break;
      }
      this.elapsedMs = st.elapsedMs;
      this.live = st;
      if (st.levels && st.levels.length) {
        this.levelHist.push(...st.levels);
        if (this.levelHist.length > 1200) this.levelHist.splice(0, this.levelHist.length - 1200);
      }
      if (st.audio) {
        this.levels = st.audio;
        this.audioSource = st.audio.source;
      }

      // Meet's tips and upsell cards cover the tiles; close them as soon as they show up
      if ((await dismissPopups(page).catch(() => 0)) > 0) this.log('Closed a Meet pop-up that was covering the call.');

      if (await inCall(page).catch(() => false)) misses = 0;
      else if (++misses >= 3) this.stop('the meeting ended (or the bot was removed)');

      const others = st.pids.filter((p) => !this.isBot(p)).length;
      if (others > 0) {
        seenOthers = true;
        aloneSince = null;
      } else {
        aloneSince = aloneSince || Date.now();
        const limit = (seenOthers ? o.aloneMinutes : Math.max(o.aloneMinutes, 15)) * 60000;
        if (Date.now() - aloneSince > limit) this.stop(`nobody else in the meeting for ${Math.round(limit / 60000)} min`);
      }
      if (Date.now() - this.startedAt > o.maxHours * 3600000) this.stop(`reached the ${o.maxHours} h limit`);

      this.refreshTimeline(st.elapsedMs);
      this.changed();
    }
  }

  refreshTimeline(durationMs) {
    const s = this.session?.state;
    if (!s) return;
    this.timeline = buildTimeline(s.events, {
      durationMs,
      names: s.names,
      ignorePids: botPidsOf(s.names, this.opts.name),
    });
  }

  async capturePreview() {
    const page = this.session?.page;
    if (!page || page.isClosed() || this._shooting) return;
    this._shooting = true;
    try {
      this.preview = await page.screenshot({ type: 'jpeg', quality: 55, scale: 'css', timeout: 5000 });
      this.previewAt = Date.now();
      this.changed();
    } catch {}
    this._shooting = false;
  }

  // Troubleshooting: what the participant tiles look like in the live Meet page (no media, text only).
  async inspectTiles() {
    const page = this.session?.page;
    if (!page) return null;
    return page.evaluate(() => {
      const tiles = [...document.querySelectorAll('[data-participant-id]')].map((t) => ({
        pid: t.getAttribute('data-participant-id'),
        selfMarker: t.hasAttribute('data-self-name') || !!t.querySelector('[data-self-name]'),
        texts: [...t.querySelectorAll('*')]
          .filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim()))
          .map((e) => ({ text: e.textContent.trim().slice(0, 60), tag: e.tagName, role: e.getAttribute('role'), shown: !!e.getClientRects().length }))
          .slice(0, 25),
        html: t.outerHTML.replace(/<(svg|video|canvas)[\s\S]*?<\/\1>/g, '<$1/>').slice(0, 6000),
      }));
      const selfAttr = [...document.querySelectorAll('[data-self-name]')].map((e) => e.getAttribute('data-self-name'));
      return { tiles, selfAttr, bodyText: document.body.innerText.slice(0, 1500) };
    });
  }

  async inspectAudio() {
    const page = this.session?.page;
    if (!page) return null;
    return page.evaluate(() => window.__mrb.audioDebug()).then((d) => ({ ...d, levels: this.levels })).catch((e) => ({ error: e.message }));
  }

  snapshot() {
    const st = this.session?.state;
    const names = st?.names || {};
    const nowSec = this.elapsedMs / 1000;
    const segs = this.timeline.segments || [];
    const people = new Map();
    for (const [pid, n] of Object.entries(names)) {
      if (this.isBot(pid)) continue;
      people.set(pid, { pid, name: n[0], talkMs: 0, turns: 0, speaking: false, visible: this.live.pids?.includes(pid) });
    }
    for (const g of segs) {
      const p = people.get(g.pid) || people.set(g.pid, { pid: g.pid, name: g.speaker, talkMs: 0, turns: 0, speaking: false }).get(g.pid);
      p.talkMs += (g.end - g.start) * 1000;
      p.turns += 1;
      if (this.status === 'recording' && g.end >= nowSec - 0.35) p.speaking = true;
    }
    return {
      id: this.id,
      url: this.opts.url,
      name: this.opts.name,
      show: this.opts.show,
      status: this.status,
      active: this.active,
      error: this.error,
      stopReason: this.stopReason,
      elapsedMs: this.elapsedMs,
      outDir: this.outDir,
      previewAt: this.previewAt || 0,
      stats: {
        videoBytes: st?.bytes.video || 0,
        audioBytes: st?.bytes.audio || 0,
        events: st?.eventCount || 0,
        audioStreams: this.live.connected || 0,
        visible: (this.live.pids || []).filter((p) => !this.isBot(p)).length,
        audioSource: this.audioSource || null,
        audioDb: this.levels ? this.levels[this.levels.source + 'Db'] : null,
      },
      people: [...people.values()],
      // waveform: one value per 100 ms, the last one at elapsedMs
      levels: this.levelHist.slice(-600),
      segments: segs.filter((g) => this.status !== 'recording' || g.end >= nowSec - 180),
      totalSegments: segs.length,
      notes: this.notes,
      logs: this.logs.slice(-80),
    };
  }
}

module.exports = { BotRun };
