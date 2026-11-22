// Builds a recording folder with REAL speech (Windows text-to-speech, or `say` on a Mac) and a known speaker
// timeline, so transcription + speaker labels can be checked end to end.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');

const VOICES = process.platform === 'darwin' ? { Alice: 'Samantha', Bob: 'Daniel', Majed: 'Majed' } : { Alice: 'Microsoft Zira Desktop', Bob: 'Microsoft Hazel Desktop' };

function speakLines(parts) {
  if (process.platform === 'darwin') {
    for (const p of parts) {
      const aiff = p.file.replace(/\.wav$/, '.aiff');
      execFileSync('say', ['-v', VOICES[p.speaker], '-o', aiff, p.text]);
      execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', aiff, p.file]);
      fs.unlinkSync(aiff);
    }
    return;
  }
  const ps = ['Add-Type -AssemblyName System.Speech', '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer'];
  for (const p of parts) {
    ps.push(`$s.SelectVoice('${VOICES[p.speaker]}')`, `$s.SetOutputToWaveFile('${p.file}')`, `$s.Speak('${p.text.replace(/'/g, "''")}')`);
  }
  ps.push('$s.Dispose()');
  execFileSync('powershell.exe', ['-NoProfile', '-Command', ps.join('; ')]);
}
// at = start second in the meeting. Bob's second line starts before Alice finishes (an interruption).
const SCRIPT = [
  { speaker: 'Alice', at: 0.8, text: 'Good morning everyone, let us start with the budget for the new office.' },
  { speaker: 'Bob', at: 6.6, text: 'Before that, the landlord called about the contract yesterday.' },
  { speaker: 'Alice', at: 12.4, text: 'Okay, what did he say about the rent increase?' },
  { speaker: 'Bob', at: 15.4, text: 'He wants a lot more money, starting in March.' },
  { speaker: 'Alice', at: 20.5, text: 'That is far too much for us, we should look at other buildings.' },
];

function probeSec(file) {
  let err = '';
  try { execFileSync(ffmpeg, ['-hide_banner', '-i', file], { stdio: 'pipe' }); } catch (e) { err = String(e.stderr); }
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(err);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
}

// A meeting that switches between English and Arabic, to check each turn is written in its own language (Mac only:
// it needs the Majed voice).
const MIXED_SCRIPT = [
  { speaker: 'Alice', at: 0.8, text: 'Thanks for joining. Majed, can you tell us how the project went this month?' },
  { speaker: 'Majed', at: 6.4, text: 'نعم، المشروع يسير بشكل جيد، وأنهينا المرحلة الأولى قبل الموعد.' },
  { speaker: 'Alice', at: 12.6, text: 'That is great news. What do you need from us for the next phase?' },
  { speaker: 'Majed', at: 17.6, text: 'نحتاج إلى ميزانية إضافية وفريق صغير للاختبار.' },
];
const hasVoice = (name) => process.platform === 'darwin' && (() => { try { return execFileSync('say', ['-v', '?'], { encoding: 'utf8' }).split('\n').some((l) => l.startsWith(name + ' ')); } catch { return false; } })();

function makeSpeechRecording(dir, script = SCRIPT) {
  fs.mkdirSync(dir, { recursive: true });
  const parts = script.map((u, i) => ({ ...u, file: path.join(dir, `line${i}.wav`) }));
  speakLines(parts);

  // Text-to-speech pads each line with silence; trim it so each speaker segment is exactly the speech.
  for (const p of parts) {
    const trimmed = p.file.replace(/\.wav$/, '-t.wav');
    const edge = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02';
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', p.file, '-af', `${edge},areverse,${edge},areverse`, trimmed]);
    fs.renameSync(trimmed, p.file);
  }
  // Meet's speaking indicator lingers a moment after someone stops; mimic that with a 0.5 s tail.
  const segments = parts.map((p) => ({ speaker: p.speaker, pid: 'p-' + p.speaker, start: p.at, end: +(p.at + probeSec(p.file) + 0.5).toFixed(2) }));
  const duration = Math.ceil(Math.max(...segments.map((s) => s.end)) + 1.5);
  const inputs = parts.flatMap((p) => ['-i', p.file]);
  const delays = parts.map((p, i) => `[${i}:a]adelay=${Math.round(p.at * 1000)}:all=1[a${i}]`).join(';');
  const mix = parts.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${parts.length}:normalize=0,apad=whole_dur=${duration}[out]`;
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', `${delays};${mix}`, '-map', '[out]', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', path.join(dir, 'audio.wav')]);
  for (const p of parts) fs.unlinkSync(p.file);

  fs.writeFileSync(path.join(dir, 'speakers.json'), JSON.stringify({ segments }, null, 2));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ meetUrl: 'https://meet.google.com/abc-defg-hij', startedAt: new Date().toISOString(), durationSec: duration }, null, 2));
  return { script, segments, duration };
}

module.exports = { makeSpeechRecording, SCRIPT, MIXED_SCRIPT, hasVoice };
