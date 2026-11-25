#!/usr/bin/env node
// One-time setup for transcription, on Windows and macOS. For a copy run from the code (the installed app has all of this inside). No Python is needed:
// the voice engine comes with the app (npm install), and the transcriber is whisper.cpp's program, whisper-cli:
//   Mac:      `brew install whisper-cpp` (Homebrew), or the download page when there is no Homebrew
//   Windows:  the official build from github.com/ggml-org/whisper.cpp, into models/whisper/bin (the NVIDIA build
//             when there is an NVIDIA graphics card, which makes transcription many times faster)
// The models themselves are downloaded later, from the app, with a progress bar. The meeting bot works without any
// of this.
const { spawnSync } = require('child_process');
const whisper = require('./lib/whisper');

const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';
const say = (m) => console.log(m);
const has = (cmd, args = ['--version']) => spawnSync(cmd, args, { stdio: 'ignore', shell: false }).status === 0;
const runLoud = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit' }).status === 0;

function openPage(url) {
  spawnSync(WIN ? 'cmd' : MAC ? 'open' : 'xdg-open', WIN ? ['/c', 'start', '', url] : [url], { stdio: 'ignore' });
}

(async () => {
  if (whisper.findEngine()) {
    say('Transcriber: ready.');
    return;
  }
  if (WIN) {
    const cuda = !process.env.MRB_NO_CUDA && has('nvidia-smi', ['-L']);
    const b = whisper.WINDOWS_BUILDS[cuda ? 'cuda' : 'cpu'];
    say(`Setting up the transcriber (whisper.cpp${cuda ? ' for the NVIDIA graphics card' : ''}, ${Math.round(b.bytes / 1e6)} MB). This happens once.`);
    let last = -1;
    await whisper.installWindowsEngine({
      cuda,
      onProgress: (s) => {
        const pct = Math.floor(s.percent / 5) * 5;
        if (s.status === 'running' && pct !== last) {
          last = pct;
          process.stdout.write(`\r  downloading: ${pct}%   `);
        }
      },
    });
    say('\nTranscriber: ready. Its model downloads from the app the first time you use it.');
    return;
  }
  if (MAC) {
    if (!has('brew')) {
      say('\nThe transcriber (whisper.cpp) installs with Homebrew, which is not on this Mac.');
      say('The Homebrew page is opening: install it, then run node setup.js again.');
      say('(The meeting bot and voice-overs work without it.)\n');
      openPage('https://brew.sh');
      return;
    }
    say('Installing the transcriber (whisper.cpp, Homebrew). This happens once.');
    if (!runLoud('brew', ['install', 'whisper-cpp'])) {
      say('The install stopped. Check the internet connection and run node setup.js again.');
      return;
    }
    say('Transcriber: ready. Its model downloads from the app the first time you use it.');
    return;
  }
  say('Install whisper.cpp (whisper-cli) with your package manager, or set WHISPER_CPP to its path, to transcribe.');
})().catch((e) => say('Setup problem: ' + e.message));
