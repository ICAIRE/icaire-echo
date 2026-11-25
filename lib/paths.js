// Where ICAIRE Echo keeps things.
// ROOT: the app's own files (code, interface, voice presets). Read only.
// DATA: what is yours: recordings, voice-overs, downloaded models, the bot's sign-in, settings.
// A copy run from its own folder (git, development) keeps DATA next to the code, as before. The installed app's
// launcher sets ECHO_DATA to a folder in your user account (Application Support on a Mac, AppData on Windows), so
// the app itself can be replaced by a new version without touching your things.
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = process.env.ECHO_DATA ? path.resolve(process.env.ECHO_DATA) : ROOT;
// the installed app (its launcher says so): updates come as a new version of the whole app
const PACKAGED = process.env.ECHO_PACKAGED === '1';

const models = (...parts) => path.join(DATA, 'models', ...parts);

module.exports = { ROOT, DATA, PACKAGED, models };
