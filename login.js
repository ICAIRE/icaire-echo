#!/usr/bin/env node
// One-time (optional): sign the bot's own Chrome profile into a Google account.
// Needed only if a meeting refuses guests or Google blocks the bot as a guest.
// Opens a normal Chrome window (no automation) on the bot's profile; sign in, then close the window.
const { spawn } = require('child_process');
const fs = require('fs');
const { PROFILE, CHROME } = require('./lib/session');

fs.mkdirSync(PROFILE, { recursive: true });
console.log('Opening Chrome with the bot\'s own profile.');
console.log('Sign in to the Google account the bot should use (a separate account is best), then close that window.');
const p = spawn(CHROME, [`--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', 'https://accounts.google.com/'], { stdio: 'ignore' });
p.on('exit', () => console.log('Done. The bot will use this sign-in from now on. (Delete the bot-profile folder to sign out.)'));
