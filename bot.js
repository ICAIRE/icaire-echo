#!/usr/bin/env node
// Command-line version (the control panel is `npm start`).
// Usage: node bot.js <meet-link> [--name "Recorder"] [--show] [--out folder] [--alone-minutes 2] [--max-hours 4]
const fs = require('fs');
const path = require('path');
const { BotRun } = require('./lib/runner');
const { ts } = require('./lib/timeline');

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--name') a.name = argv[++i];
    else if (v === '--out') a.outRoot = path.resolve(argv[++i]);
    else if (v === '--show') a.show = true;
    else if (v === '--alone-minutes') a.aloneMinutes = Number(argv[++i]);
    else if (v === '--max-hours') a.maxHours = Number(argv[++i]);
    else if (!a.url) a.url = v;
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url || !/meet\.google\.com\//.test(args.url)) {
    console.log('Usage: node bot.js https://meet.google.com/abc-defg-hij [--name "Recorder"] [--show]');
    process.exit(1);
  }
  if (!/^https?:/.test(args.url)) args.url = 'https://' + args.url;

  const run = new BotRun(args);
  run.on('log', (l) => console.log(`[${new Date(l.t).toLocaleTimeString()}] ${l.msg}`));
  let lastPrint = 0;
  run.on('update', (s) => {
    if (s.status !== 'recording' || Date.now() - lastPrint < 30000) return;
    lastPrint = Date.now();
    const talking = s.people.filter((p) => p.speaking).map((p) => p.name).join(', ') || 'nobody';
    console.log(`  ${ts(s.elapsedMs / 1000).slice(0, 8)} | ${s.stats.visible} people | ${(s.stats.videoBytes / 1048576).toFixed(0)} MB video | talking: ${talking}`);
  });
  let forced = false;
  process.on('SIGINT', () => {
    if (forced || !run.active) process.exit(130);
    forced = true;
    run.stop('Ctrl+C');
    console.log('Stopping... (Ctrl+C again to force quit)');
  });

  const s = await run.run();
  if (s.status !== 'done') process.exit(1);
  console.log('\nFiles in ' + s.outDir);
  for (const f of fs.readdirSync(s.outDir)) {
    console.log(`  ${f.padEnd(24)} ${(fs.statSync(path.join(s.outDir, f)).size / 1048576).toFixed(1)} MB`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
