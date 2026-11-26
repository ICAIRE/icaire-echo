//! Native recording for "On this computer": the microphone, and the computer's own sound (the call), each written
//! to its own WAV file in the recording's folder (`mic.wav`, `system.wav`, 32-bit float, mono, at the device's rate).
//! When the recording ends, the app mixes them into `audio.wav` with ffmpeg, so nothing here has to line up two clocks.
//!
//! - Microphone: CoreAudio / WASAPI through cpal.
//! - The computer's sound: ScreenCaptureKit on a Mac (macOS asks once for "Screen & System Audio Recording"; only
//!   sound is taken, the picture is 2x2 pixels once a second and thrown away), WASAPI loopback on Windows (no prompt).
//!
//! Every device is opened on its own thread, never on the app's main thread: opening a microphone can wait on the
//! permission prompt, and that prompt needs the main thread free (the lesson from Diwan's recorder). Pausing stops
//! writing both files at once, so the paused time is simply not in the recording.
use std::fs::File;
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

type Wav = hound::WavWriter<BufWriter<File>>;

/// One file being written: a microphone, or the computer's sound.
pub struct Track {
    writer: Mutex<Option<Wav>>,
    paused: Arc<AtomicBool>,
    level_x10k: AtomicU32,
    frames: AtomicU64,
    rate: AtomicU32,
}

impl Track {
    fn new(paused: Arc<AtomicBool>) -> Arc<Track> {
        Arc::new(Track { writer: Mutex::new(None), paused, level_x10k: AtomicU32::new(0), frames: AtomicU64::new(0), rate: AtomicU32::new(0) })
    }

    fn open(&self, path: &Path, rate: u32) -> Result<(), String> {
        let spec = hound::WavSpec { channels: 1, sample_rate: rate, bits_per_sample: 32, sample_format: hound::SampleFormat::Float };
        let w = hound::WavWriter::create(path, spec).map_err(|e| format!("could not write {}: {e}", path.display()))?;
        *self.writer.lock().unwrap() = Some(w);
        self.rate.store(rate, Ordering::SeqCst);
        Ok(())
    }

    /// interleaved samples of `channels`, mixed down to mono
    fn push(&self, data: &[f32], channels: usize) {
        if channels == 0 || data.is_empty() {
            return;
        }
        if self.paused.load(Ordering::Relaxed) {
            self.level_x10k.store(0, Ordering::Relaxed);
            return;
        }
        let mut sum = 0f32;
        let mut n = 0u64;
        if let Some(w) = self.writer.lock().unwrap().as_mut() {
            for frame in data.chunks(channels) {
                let s = frame.iter().sum::<f32>() / channels as f32;
                let _ = w.write_sample(s);
                sum += s * s;
                n += 1;
            }
        }
        if n > 0 {
            self.frames.fetch_add(n, Ordering::Relaxed);
            let rms = (sum / n as f32).sqrt().clamp(0.0, 1.0);
            self.level_x10k.store((rms * 10_000.0) as u32, Ordering::Relaxed);
        }
    }

    fn finish(&self) {
        if let Some(w) = self.writer.lock().unwrap().take() {
            let _ = w.finalize();
        }
    }

    pub fn level(&self) -> f32 {
        self.level_x10k.load(Ordering::Relaxed) as f32 / 10_000.0
    }

    pub fn seconds(&self) -> f64 {
        let r = self.rate.load(Ordering::SeqCst);
        if r == 0 { 0.0 } else { self.frames.load(Ordering::Relaxed) as f64 / r as f64 }
    }
}

/// A recording in progress.
pub struct Recording {
    pub mic: Arc<Track>,
    pub system: Option<Arc<Track>>,
    pub device: String,
    pub system_error: Option<String>,
    /// the screen, when asked for (video.rs); `video_error` says why it could not start
    pub video: Option<crate::video::Video>,
    pub video_error: Option<String>,
    paused: Arc<AtomicBool>,
    stop: Arc<AtomicBool>,
    threads: Vec<JoinHandle<()>>,
}

impl Recording {
    /// Opens the microphone (and the computer's sound when `system`), each on its own thread, and waits until they
    /// are recording (or failed). The microphone is required; the computer's sound is best effort: if it cannot be
    /// opened the recording goes on with the microphone, and `system_error` says why.
    pub fn start(dir: &Path, system: bool, video_ffmpeg: Option<&Path>) -> Result<Recording, String> {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let paused = Arc::new(AtomicBool::new(false));
        let stop = Arc::new(AtomicBool::new(false));
        let mic = Track::new(paused.clone());
        let mut threads = Vec::new();

        let (tx, rx) = mpsc::channel::<Result<String, String>>();
        threads.push(spawn_input(mic.clone(), dir.join("mic.wav"), stop.clone(), tx, Source::Microphone));
        let device = match rx.recv_timeout(Duration::from_secs(90)) {
            Ok(Ok(name)) => name,
            Ok(Err(e)) => {
                stop.store(true, Ordering::SeqCst);
                return Err(e);
            }
            Err(_) => {
                stop.store(true, Ordering::SeqCst);
                return Err("The microphone did not start. Allow ICAIRE Echo under System Settings › Privacy & Security › Microphone, then try again.".into());
            }
        };

        let anchor = std::time::Instant::now(); // the microphone is recording: the video counts from here
        let (mut sys_track, mut system_error) = (None, None);
        if system {
            let t = Track::new(paused.clone());
            let (tx, rx) = mpsc::channel::<Result<String, String>>();
            threads.push(spawn_input(t.clone(), dir.join("system.wav"), stop.clone(), tx, Source::System));
            match rx.recv_timeout(Duration::from_secs(90)) {
                Ok(Ok(_)) => sys_track = Some(t),
                Ok(Err(e)) => system_error = Some(e),
                Err(_) => system_error = Some("The computer's sound did not start in time.".into()),
            }
        }
        // the screen is best effort too: the sound goes on without it
        let (mut video, mut video_error) = (None, None);
        if let Some(ffmpeg) = video_ffmpeg {
            match crate::video::Video::start(dir, ffmpeg, paused.clone(), anchor) {
                Ok(v) => video = Some(v),
                Err(e) => video_error = Some(e),
            }
        }
        Ok(Recording { mic, system: sys_track, device, system_error, video, video_error, paused, stop, threads })
    }

    pub fn set_paused(&self, on: bool) {
        self.paused.store(on, Ordering::SeqCst);
    }

    /// Stops both, closes the files (bounded: a device stuck in the OS is left to its thread), returns the seconds recorded.
    pub fn stop(mut self) -> f64 {
        self.stop.store(true, Ordering::SeqCst);
        let deadline = std::time::Instant::now() + Duration::from_secs(4);
        for t in self.threads.drain(..) {
            while !t.is_finished() && std::time::Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(20));
            }
            if t.is_finished() {
                let _ = t.join();
            }
        }
        self.mic.finish();
        if let Some(s) = &self.system {
            s.finish();
        }
        if let Some(v) = self.video.take() {
            v.stop();
        }
        self.mic.seconds()
    }
}

#[derive(Clone, Copy)]
enum Source {
    Microphone,
    System,
}

/// One thread per device: opens it, tells `ready` (the device's name, or why it failed), keeps it running until `stop`.
fn spawn_input(track: Arc<Track>, path: PathBuf, stop: Arc<AtomicBool>, ready: mpsc::Sender<Result<String, String>>, source: Source) -> JoinHandle<()> {
    std::thread::spawn(move || {
        #[cfg(target_os = "macos")]
        if let Source::System = source {
            return mac_system::run(track, path, stop, ready);
        }
        let opened = open_cpal(&track, &path, source);
        match opened {
            Ok((stream, name)) => {
                let _ = ready.send(Ok(name));
                while !stop.load(Ordering::SeqCst) {
                    std::thread::sleep(Duration::from_millis(50));
                }
                drop(stream);
                track.finish();
            }
            Err(e) => {
                let _ = ready.send(Err(e));
            }
        }
    })
}

/// The microphone (input device), or on Windows the computer's sound (WASAPI loopback: an input stream on the output device).
fn open_cpal(track: &Arc<Track>, path: &Path, source: Source) -> Result<(cpal::Stream, String), String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    let host = cpal::default_host();
    let (device, config) = match source {
        Source::Microphone => {
            let d = host.default_input_device().ok_or("No microphone was found on this computer.")?;
            let c = d.default_input_config().map_err(|e| format!("The microphone could not be opened: {e}"))?;
            (d, c)
        }
        Source::System => {
            let d = host.default_output_device().ok_or("No speakers or headphones were found to record the call from.")?;
            let c = d.default_output_config().map_err(|e| format!("The computer's sound could not be opened: {e}"))?;
            (d, c)
        }
    };
    let name = device.name().unwrap_or_else(|_| "Microphone".into());
    let channels = config.channels() as usize;
    track.open(path, config.sample_rate().0)?;
    let err = |e| eprintln!("audio stream error: {e}");
    let cfg: cpal::StreamConfig = config.clone().into();
    let t = track.clone();
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(&cfg, move |d: &[f32], _| t.push(d, channels), err, None),
        cpal::SampleFormat::I16 => device.build_input_stream(&cfg, move |d: &[i16], _| t.push(&d.iter().map(|s| *s as f32 / 32768.0).collect::<Vec<_>>(), channels), err, None),
        cpal::SampleFormat::I32 => device.build_input_stream(&cfg, move |d: &[i32], _| t.push(&d.iter().map(|s| *s as f32 / 2147483648.0).collect::<Vec<_>>(), channels), err, None),
        cpal::SampleFormat::U16 => device.build_input_stream(&cfg, move |d: &[u16], _| t.push(&d.iter().map(|s| (*s as f32 - 32768.0) / 32768.0).collect::<Vec<_>>(), channels), err, None),
        other => return Err(format!("The sound device uses a format this app does not read ({other:?}).")),
    }
    .map_err(|e| match source {
        Source::Microphone => format!("The microphone could not be opened: {e}. Allow ICAIRE Echo under System Settings › Privacy & Security › Microphone."),
        Source::System => format!("The computer's sound could not be opened: {e}"),
    })?;
    stream.play().map_err(|e| format!("The sound device would not start: {e}"))?;
    Ok((stream, name))
}

#[cfg(target_os = "macos")]
mod mac_system {
    use super::Track;
    use screencapturekit::prelude::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{mpsc, Arc};
    use std::time::Duration;

    const RATE: u32 = 48_000;

    struct Sound(Arc<Track>);

    impl SCStreamOutputTrait for Sound {
        fn did_output_sample_buffer(&self, sample: CMSampleBuffer, kind: SCStreamOutputType) {
            if !matches!(kind, SCStreamOutputType::Audio) {
                return;
            }
            if let Ok(list) = sample.audio_buffer_list() {
                // mono was asked for: the first buffer is the sound (more buffers would be further channels)
                if let Some(buffer) = (&list).into_iter().next() {
                    let samples: Vec<f32> = buffer.data().chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
                    self.0.push(&samples, 1);
                }
            }
        }
    }

    pub fn run(track: Arc<Track>, path: PathBuf, stop: Arc<AtomicBool>, ready: mpsc::Sender<Result<String, String>>) {
        let started = (|| -> Result<SCStream, String> {
            let denied = "macOS has not allowed ICAIRE Echo to record the call. Open System Settings › Privacy & Security › Screen & System Audio Recording and switch ICAIRE Echo on. If it is already on, switch it off and on again (a new version of the app needs it again), then try again. (Only the sound is recorded.)";
            let content = SCShareableContent::get().map_err(|_| denied.to_string())?;
            let display = content.displays().into_iter().next().ok_or(denied)?;
            let filter = SCContentFilter::create().with_display(&display).with_excluding_windows(&[]).build().map_err(|e| format!("{e}"))?;
            let config = SCStreamConfiguration::new()
                .with_width(2)
                .with_height(2)
                .with_minimum_frame_interval(&CMTime::new(1, 1))
                .with_captures_audio(true)
                .with_excludes_current_process_audio(true)
                .with_sample_rate(RATE as i32)
                .with_channel_count(1);
            track.open(&path, RATE)?;
            let mut stream = SCStream::new(&filter, &config).map_err(|e| format!("{denied} ({e})"))?;
            stream.add_output_handler(Sound(track.clone()), SCStreamOutputType::Audio).map_err(|e| format!("{e}"))?;
            stream.start_capture().map_err(|e| format!("{denied} ({e})"))?;
            Ok(stream)
        })();
        match started {
            Ok(stream) => {
                let _ = ready.send(Ok("the computer's sound".into()));
                while !stop.load(Ordering::SeqCst) {
                    std::thread::sleep(Duration::from_millis(50));
                }
                let _ = stream.stop_capture();
                track.finish();
            }
            Err(e) => {
                let _ = ready.send(Err(e));
            }
        }
    }
}
