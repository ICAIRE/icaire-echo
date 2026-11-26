//! Screen video for "On this computer", next to the sound (audio.rs): the main screen, written to `screen.mp4` in the
//! recording's folder. When the recording ends, the app puts it together with the mixed sound into `video.mp4`.
//!
//! Where the frames come from:
//! - Mac: ScreenCaptureKit, the same permission as the call's sound ("Screen & System Audio Recording").
//! - Windows: ffmpeg's desktop grabber (gdigrab), read back as raw frames.
//!
//! A writer sends the newest frame to ffmpeg 15 times a second of *unpaused* time, counted from when the microphone
//! started, and the sound files are written the same way (nothing while paused). So the video lines up with the
//! sound through pauses without lining up two clocks afterwards: the first second before the screen arrives is black,
//! a screen that does not change repeats its last frame, and a slow moment is caught up with repeated frames.
use std::io::Write;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

pub const FPS: u32 = 15;
const LONGEST_SIDE: u32 = 1920;

type Frame = Arc<Mutex<Option<Vec<u8>>>>;

pub struct Video {
    stop: Arc<AtomicBool>,
    threads: Vec<JoinHandle<()>>,
}

/// even numbers, the longest side at most LONGEST_SIDE, the screen's shape kept
fn fit(w: u32, h: u32) -> (u32, u32) {
    let (w, h) = (w.max(2), h.max(2));
    let s = (LONGEST_SIDE as f64 / w.max(h) as f64).min(1.0);
    let even = |x: f64| ((x / 2.0).round() as u32 * 2).max(2);
    (even(w as f64 * s), even(h as f64 * s))
}

fn encoder(ffmpeg: &Path, dir: &Path, (w, h): (u32, u32)) -> Result<Child, String> {
    #[cfg(target_os = "macos")]
    // constant quality: a still screen costs little, text stays sharp (about 1.5 Mbit/s, 0.7 GB an hour, against
    // 4.7 Mbit/s at a fixed 4000k)
    let codec: &[&str] = &["-c:v", "h264_videotoolbox", "-q:v", "55", "-allow_sw", "1"];
    #[cfg(not(target_os = "macos"))]
    let codec: &[&str] = &["-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-tune", "stillimage"];
    let log = std::fs::File::create(dir.join("screen.log")).map_err(|e| e.to_string())?;
    let mut cmd = Command::new(ffmpeg);
    cmd.args(["-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pixel_format", "bgra", "-video_size", &format!("{w}x{h}"), "-framerate", &FPS.to_string(), "-i", "-"])
        .args(codec)
        // fragments: a recording cut short (the app closed) still plays, up to the last second
        .args(["-pix_fmt", "yuv420p", "-movflags", "+frag_keyframe+empty_moov+default_base_moof"])
        .arg(dir.join("screen.mp4"))
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::from(log));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // no console window
    }
    cmd.spawn().map_err(|e| format!("could not start ffmpeg for the video: {e}"))
}

impl Video {
    /// Starts the screen and the writer. `anchor`: when the microphone started; `paused`: the recording's pause switch.
    pub fn start(dir: &Path, ffmpeg: &Path, paused: Arc<AtomicBool>, anchor: Instant) -> Result<Video, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let frame: Frame = Arc::new(Mutex::new(None));
        let (size, source) = source::start(frame.clone(), stop.clone(), ffmpeg)?;
        let mut child = match encoder(ffmpeg, dir, size) {
            Ok(c) => c,
            Err(e) => {
                stop.store(true, Ordering::SeqCst);
                return Err(e);
            }
        };
        let stdin = child.stdin.take();
        let s = stop.clone();
        let writer = std::thread::spawn(move || pump(stdin, child, frame, size, paused, anchor, s));
        let mut threads = vec![writer];
        threads.extend(source);
        Ok(Video { stop, threads })
    }

    /// Stops the screen, lets ffmpeg finish the file (bounded).
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let deadline = Instant::now() + Duration::from_secs(15);
        for t in self.threads.drain(..) {
            while !t.is_finished() && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(20));
            }
            if t.is_finished() {
                let _ = t.join();
            }
        }
    }
}

/// FPS frames per second of unpaused time since `anchor`: the newest frame, or black until the first one comes
fn pump(stdin: Option<std::process::ChildStdin>, mut child: Child, frame: Frame, (w, h): (u32, u32), paused: Arc<AtomicBool>, anchor: Instant, stop: Arc<AtomicBool>) {
    let Some(mut stdin) = stdin else { return };
    let black = vec![0u8; (w * h * 4) as usize];
    // the time before the screen started counts too: the microphone was already recording
    let mut active = anchor.elapsed();
    let mut last = Instant::now();
    let mut written: u64 = 0;
    while !stop.load(Ordering::SeqCst) {
        let now = Instant::now();
        if !paused.load(Ordering::Relaxed) {
            active += now - last;
        }
        last = now;
        let due = (active.as_secs_f64() * FPS as f64) as u64;
        if written < due {
            // one copy of the newest frame per wake-up, written as many times as are due
            let current = frame.lock().unwrap().clone();
            let data = current.as_deref().unwrap_or(&black);
            while written < due {
                if stdin.write_all(data).is_err() {
                    let _ = child.wait();
                    return;
                }
                written += 1;
            }
        }
        std::thread::sleep(Duration::from_millis(1000 / FPS as u64 / 2));
    }
    drop(stdin); // end of input: ffmpeg writes the rest and closes the file
    let deadline = Instant::now() + Duration::from_secs(12);
    loop {
        match child.try_wait() {
            Ok(Some(_)) | Err(_) => break,
            Ok(None) if Instant::now() > deadline => {
                let _ = child.kill();
                break;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
        }
    }
}

/// tightly packed BGRA rows from a buffer whose rows may be padded
fn pack(data: &[u8], w: u32, h: u32, stride: usize) -> Option<Vec<u8>> {
    let row = (w * 4) as usize;
    if stride < row || data.len() < stride * (h as usize - 1) + row {
        return None;
    }
    if stride == row {
        return Some(data[..row * h as usize].to_vec());
    }
    let mut out = Vec::with_capacity(row * h as usize);
    for y in 0..h as usize {
        out.extend_from_slice(&data[y * stride..y * stride + row]);
    }
    Some(out)
}

#[cfg(target_os = "macos")]
mod source {
    use super::{fit, pack, Frame, FPS};
    use screencapturekit::cm::CMSampleBufferExt;
    use screencapturekit::cv::CVPixelBufferLockFlags;
    use screencapturekit::prelude::*;
    use std::path::Path;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{mpsc, Arc};
    use std::thread::JoinHandle;
    use std::time::Duration;

    struct Screen {
        frame: Frame,
        w: u32,
        h: u32,
    }

    impl SCStreamOutputTrait for Screen {
        fn did_output_sample_buffer(&self, sample: CMSampleBuffer, kind: SCStreamOutputType) {
            if !matches!(kind, SCStreamOutputType::Screen) {
                return;
            }
            let Some(pixels) = sample.pixel_buffer() else { return };
            let Ok(guard) = pixels.lock(CVPixelBufferLockFlags::READ_ONLY) else { return };
            let Some(data) = (unsafe { guard.as_slice() }) else { return };
            if let Some(f) = pack(data, self.w, self.h, guard.bytes_per_row()) {
                *self.frame.lock().unwrap() = Some(f);
            }
        }
    }

    /// The main screen through ScreenCaptureKit, on its own thread (the stream lives there until `stop`).
    pub fn start(frame: Frame, stop: Arc<AtomicBool>, _ffmpeg: &Path) -> Result<((u32, u32), Vec<JoinHandle<()>>), String> {
        let (tx, rx) = mpsc::channel::<Result<(u32, u32), String>>();
        let t = std::thread::spawn(move || {
            let started = (|| -> Result<(SCStream, (u32, u32)), String> {
                let denied = "macOS has not allowed ICAIRE Echo to record the screen. Open System Settings › Privacy & Security › Screen & System Audio Recording and switch ICAIRE Echo on. If it is already on, switch it off and on again (a new version of the app needs it again), then try again.";
                let content = SCShareableContent::get().map_err(|_| denied.to_string())?;
                let display = content.displays().into_iter().next().ok_or(denied)?;
                // points times two: the screen's pixels on a Retina display, scaled down to at most 1920
                let (w, h) = fit(display.width() * 2, display.height() * 2);
                let filter = SCContentFilter::create().with_display(&display).with_excluding_windows(&[]).build().map_err(|e| format!("{e}"))?;
                let config = SCStreamConfiguration::new()
                    .with_width(w)
                    .with_height(h)
                    .with_pixel_format(PixelFormat::BGRA)
                    .with_minimum_frame_interval(&CMTime::new(1, FPS as i32))
                    .with_shows_cursor(true)
                    .with_queue_depth(4);
                let mut stream = SCStream::new(&filter, &config).map_err(|e| format!("{denied} ({e})"))?;
                stream.add_output_handler(Screen { frame: frame.clone(), w, h }, SCStreamOutputType::Screen).map_err(|e| format!("{e}"))?;
                stream.start_capture().map_err(|e| format!("{denied} ({e})"))?;
                Ok((stream, (w, h)))
            })();
            match started {
                Ok((stream, size)) => {
                    let _ = tx.send(Ok(size));
                    while !stop.load(Ordering::SeqCst) {
                        std::thread::sleep(Duration::from_millis(50));
                    }
                    let _ = stream.stop_capture();
                }
                Err(e) => {
                    let _ = tx.send(Err(e));
                }
            }
        });
        match rx.recv_timeout(Duration::from_secs(60)) {
            Ok(Ok(size)) => Ok((size, vec![t])),
            Ok(Err(e)) => Err(e),
            Err(_) => Err("The screen did not start in time.".into()),
        }
    }
}

#[cfg(windows)]
mod source {
    use super::{Frame, FPS};
    use std::io::Read;
    use std::os::windows::process::CommandExt;
    use std::path::Path;
    use std::process::{Command, Stdio};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::thread::JoinHandle;

    // the desktop at a fixed size (letterboxed), so every frame read back is the same number of bytes
    const W: u32 = 1920;
    const H: u32 = 1080;

    pub fn start(frame: Frame, stop: Arc<AtomicBool>, ffmpeg: &Path) -> Result<((u32, u32), Vec<JoinHandle<()>>), String> {
        let scale = format!("scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2");
        let mut child = Command::new(ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-f", "gdigrab", "-framerate", &FPS.to_string(), "-draw_mouse", "1", "-i", "desktop", "-vf", &scale, "-pix_fmt", "bgra", "-f", "rawvideo", "-"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(0x0800_0000)
            .spawn()
            .map_err(|e| format!("could not start the screen capture: {e}"))?;
        let mut out = child.stdout.take().ok_or("no screen output")?;
        let t = std::thread::spawn(move || {
            let mut buf = vec![0u8; (W * H * 4) as usize];
            while !stop.load(Ordering::SeqCst) {
                if out.read_exact(&mut buf).is_err() {
                    break;
                }
                *frame.lock().unwrap() = Some(buf.clone());
            }
            let _ = child.kill();
            let _ = child.wait();
        });
        Ok(((W, H), vec![t]))
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod source {
    use super::Frame;
    use std::path::Path;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;
    use std::thread::JoinHandle;
    pub fn start(_frame: Frame, _stop: Arc<AtomicBool>, _ffmpeg: &Path) -> Result<((u32, u32), Vec<JoinHandle<()>>), String> {
        Err("Screen video is not available on this system.".into())
    }
}
