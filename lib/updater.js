// Keeping the app up to date from GitHub (github.com/ICAIRE/meet-recorder-bot, branch main).
// A copy made with git is updated with `git pull --ff-only`; a copy from a downloaded zip gets the new version's
// files written over its own. Your recordings, voice-overs, models and the bot's sign-in are never touched.
// After an update the server exits with RESTART_CODE and the launcher starts it again (installing any new parts).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { EventEmitter } = require('events');
const { unzip } = require('./archive');

const ROOT = path.join(__dirname, '..');
const REPO = process.env.MRB_UPDATE_REPO || 'ICAIRE/meet-recorder-bot';
const BRANCH = 'main';
const RESTART_CODE = 75;
const VERSION_FILE = path.join(ROOT, '.mrb-version.json');
// folders that are yours, not the app's
const KEEP = new Set(['models', 'recordings', 'voiceovers', 'bot-profile', 'node_modules', '.git']);
const EVERY = 6 * 3600 * 1000;

const git = (args) =>
  new Promise((resolve) => execFile('git', args, { cwd: ROOT, windowsHide: true, encoding: 'utf8', timeout: 120000 }, (err, stdout, stderr) => resolve({ ok: !err, out: (stdout || '').trim(), err: (stderr || '').trim() })));
const isGit = () => fs.existsSync(path.join(ROOT, '.git'));

function readVersion() {
  try { return JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8')); } catch { return {}; }
}

async function current() {
  if (isGit()) {
    const r = await git(['rev-parse', 'HEAD']);
    if (r.ok) return { mode: 'git', sha: r.out };
  }
  return { mode: 'zip', sha: readVersion().sha || null };
}

async function latest() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'meet-recorder-updater' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(res.status === 404 ? 'The update page was not found.' : `GitHub answered ${res.status}.`);
  const j = await res.json();
  return { sha: j.sha, date: j.commit && j.commit.committer && j.commit.committer.date, message: ((j.commit && j.commit.message) || '').split('\n')[0] };
}

class Updater extends EventEmitter {
  constructor() {
    super();
    this.status = 'idle'; // idle | checking | current | available | updating | updated | error
    this.current = null;
    this.latest = null;
    this.error = null;
    this.checkedAt = null;
  }
  snapshot() {
    return { status: this.status, current: this.current && this.current.sha && this.current.sha.slice(0, 7), latest: this.latest && { sha: this.latest.sha.slice(0, 7), date: this.latest.date, message: this.latest.message }, error: this.error, checkedAt: this.checkedAt };
  }
  set(f) {
    Object.assign(this, f);
    this.emit('update', this.snapshot());
  }
  get busy() {
    return this.status === 'checking' || this.status === 'updating';
  }

  // quiet: an automatic check; without a connection it leaves the panel as it was (the app works offline)
  async check({ quiet = false } = {}) {
    if (this.busy) return this.snapshot();
    const before = this.status;
    if (!quiet) this.set({ status: 'checking', error: null });
    try {
      const [cur, lat] = await Promise.all([current(), latest()]);
      this.set({ current: cur, latest: lat, checkedAt: new Date().toISOString(), status: cur.sha === lat.sha ? 'current' : 'available', error: null });
    } catch (e) {
      const offline = /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ENETUNREACH|timeout|aborted/i.test(`${e.message} ${e.cause && e.cause.code}`);
      if (quiet) this.set({ status: before === 'checking' ? 'idle' : before });
      else this.set({ status: 'error', error: offline ? 'No internet connection. Everything else works offline.' : 'Could not check for updates: ' + e.message });
    }
    return this.snapshot();
  }

  // a copy with changes of its own is a developer's: it is never updated automatically
  async locallyChanged() {
    if (!isGit()) return false;
    const r = await git(['status', '--porcelain', '--untracked-files=no']);
    return !r.ok || !!r.out;
  }

  async apply() {
    if (this.busy) return this.snapshot();
    if (!this.latest || this.status !== 'available') await this.check();
    if (this.status !== 'available') return this.snapshot();
    this.set({ status: 'updating', error: null });
    try {
      if (this.current.mode === 'git') {
        if (await this.locallyChanged()) throw new Error('this copy has changes of its own. Update it with git.');
        const r = await git(['pull', '--ff-only', 'origin', BRANCH]);
        if (!r.ok) throw new Error(r.err.split('\n').pop() || 'git pull failed');
      } else await this.applyZip();
      this.set({ status: 'updated' });
    } catch (e) {
      this.set({ status: 'error', error: 'The update stopped: ' + e.message });
    }
    return this.snapshot();
  }

  async applyZip() {
    const sha = this.latest.sha;
    const res = await fetch(`https://codeload.github.com/${REPO}/zip/${sha}`, { headers: { 'user-agent': 'meet-recorder-updater' }, signal: AbortSignal.timeout(300000) });
    if (!res.ok) throw new Error(`the download answered ${res.status}`);
    const entries = unzip(Buffer.from(await res.arrayBuffer()));
    const files = [];
    for (const [name, data] of Object.entries(entries)) {
      const rel = name.split('/').slice(1).join('/'); // drop the "meet-recorder-bot-<sha>/" folder
      if (!rel || rel.endsWith('/') || KEEP.has(rel.split('/')[0]) || rel.split('/').includes('..')) continue;
      const dst = path.join(ROOT, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst + '.new', data);
      fs.renameSync(dst + '.new', dst);
      if (/\.(command|sh)$/.test(rel)) fs.chmodSync(dst, 0o755);
      files.push(rel);
    }
    if (!files.includes('server.js')) throw new Error('the download was not a complete copy of the app');
    // files the last version had and this one no longer has
    for (const rel of readVersion().files || []) {
      if (!files.includes(rel) && !KEEP.has(rel.split('/')[0])) fs.rmSync(path.join(ROOT, rel), { force: true });
    }
    fs.writeFileSync(VERSION_FILE, JSON.stringify({ sha, updatedAt: new Date().toISOString(), files }, null, 1));
  }

  // check now and every few hours; when there is a new version and isIdle() says nothing is running, update and
  // call onUpdated (which restarts the app)
  auto({ isIdle, onUpdated }) {
    if (process.env.MRB_NO_AUTO_UPDATE) return;
    const tick = async () => {
      await this.check({ quiet: true });
      if (this.status !== 'available' || (await this.locallyChanged())) return;
      const tryNow = async () => {
        if (!isIdle()) return setTimeout(tryNow, 60000).unref(); // after the meeting or the job
        await this.apply();
        if (this.status === 'updated') onUpdated();
      };
      tryNow();
    };
    setTimeout(tick, 15000).unref();
    setInterval(tick, EVERY).unref();
  }
}

module.exports = { Updater, RESTART_CODE, REPO };
