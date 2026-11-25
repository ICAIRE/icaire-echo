// Control panel wired to a fake 8-person meeting, for trying the UI without a real call.
// Run: npm run demo   -> http://localhost:4778, paste any meet.google.com link, press Join.
const path = require('path');
const os = require('os');
const fs = require('fs');
const { createServer } = require('../server');
const { mockMeet } = require('./mock-meet');

const people = ['Aisha', 'Ben', 'Chen Wei', 'Dana', 'Elif', 'Faisal', 'Grace', 'Hiro'].map((name, i) => ({ id: 'u' + i, name, joinAtMs: i === 7 ? 20000 : 0 }));
const schedule = [];
let t = 1000;
for (let i = 0; i < 400; i++) {
  const p = people[(i * 5 + (i % 3)) % 8];
  const len = 1200 + ((i * 7919) % 4200);
  schedule.push({ id: p.id, from: t, to: t + len });
  t += len + (i % 4 === 0 ? -900 : 250 + ((i * 31) % 900)); // some interruptions
}

const minutes = Number(process.env.DEMO_MINUTES || 10);
const outRoot = process.env.DEMO_OUT || path.join(os.tmpdir(), 'mrb-demo-recordings');
fs.mkdirSync(outRoot, { recursive: true });
const server = createServer({
  outRoot,
  voiceRoot: process.env.DEMO_VOICE || path.join(os.tmpdir(), 'mrb-demo-voiceovers'),
  runOptions: {
    profile: fs.mkdtempSync(path.join(os.tmpdir(), 'mrb-demo-prof-')),
    noOpen: true,
    ...mockMeet({ participants: people, schedule, endAfterMs: minutes * 60000, admitDelayMs: 2500 }),
  },
});
const port = Number(process.env.PORT || 4778);
server.listen(port, '127.0.0.1', () => console.log(`demo control panel on http://localhost:${port} (recordings -> ${outRoot})`));
