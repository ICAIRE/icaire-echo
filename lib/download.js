// Big downloads with a progress bar. Ordinary connections cut off multi-GB files, so each file keeps what
// arrived in <name>.part and carries on from there, a few times, before giving up. Used for the voices, the
// Whisper model and the Windows transcriber program.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const sizeOf = (f) => { try { return fs.statSync(f).size; } catch { return -1; } };

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

// Fetches files: [{ name, url, bytes, sha256? }] into dir. Emits 'update' with snapshot().
class Download extends EventEmitter {
  constructor(label = '') {
    super();
    this.label = label;
    this.status = 'idle';
    this.got = 0;
    this.total = 0;
    this.error = null;
  }
  get active() {
    return this.status === 'running';
  }
  snapshot() {
    return { status: this.status, name: this.label, got: this.got, total: this.total, percent: this.total ? Math.min(99.9, Math.round((this.got / this.total) * 1000) / 10) : 0, error: this.error };
  }
  set(f) {
    Object.assign(this, f);
    this.emit('update', this.snapshot());
  }
  async run(files, dir, { label } = {}) {
    if (label) this.label = label;
    this.abort = new AbortController();
    this.set({ status: 'running', got: 0, total: files.reduce((a, f) => a + f.bytes, 0), error: null });
    fs.mkdirSync(dir, { recursive: true });
    let base = 0;
    let last = 0;
    try {
      for (const f of files) {
        const dst = path.join(dir, f.name);
        fs.mkdirSync(path.dirname(dst), { recursive: true }); // a name may sit in a sub-folder
        if (sizeOf(dst) === f.bytes) {
          base += f.bytes;
          this.set({ got: base });
          continue;
        }
        const part = dst + '.part';
        for (let attempt = 0; ; attempt++) {
          const from = Math.max(0, sizeOf(part));
          if (from >= f.bytes) break;
          try {
            const res = await fetch(f.url, { signal: this.abort.signal, redirect: 'follow', headers: from ? { range: `bytes=${from}-` } : {} });
            if (!res.ok || !res.body) throw new Error(`the server answered ${res.status}`);
            const resumed = res.status === 206;
            const out = fs.createWriteStream(part, { flags: resumed ? 'a' : 'w' });
            let n = resumed ? from : 0;
            try {
              for await (const chunk of res.body) {
                if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
                n += chunk.length;
                if (Date.now() - last > 250) {
                  last = Date.now();
                  this.set({ got: base + n });
                }
              }
            } finally {
              await new Promise((r) => out.end(r));
            }
          } catch (e) {
            if (e.name === 'AbortError' || this.status === 'cancelled') throw e;
            if (attempt >= 8) throw new Error(`The download of ${f.name} keeps stopping (${e.message}). Check the connection and try again; it continues where it stopped.`);
            await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          }
        }
        if (sizeOf(part) !== f.bytes) throw new Error(`${f.name} arrived incomplete. Try again; it continues where it stopped.`);
        if (f.sha256 && (await sha256(part)) !== f.sha256) {
          fs.rmSync(part, { force: true });
          throw new Error(`${f.name} arrived damaged. Try again.`);
        }
        fs.renameSync(part, dst);
        base += f.bytes;
        this.set({ got: base });
      }
      this.set({ status: 'done', got: this.total });
    } catch (e) {
      this.set({ status: this.status === 'cancelled' ? 'cancelled' : 'error', error: e.name === 'AbortError' ? null : e.message });
    }
    return this.status;
  }
  cancel() {
    if (!this.active) return;
    this.status = 'cancelled';
    try { this.abort.abort(); } catch {}
  }
}

module.exports = { Download, sha256 };
