import type { SeedProject } from "../types";

export const AUDIO_PROJECTS: SeedProject[] = [
  {
    slug: "software-synthesizer",
    title: "Build a polyphonic software synthesizer",
    summary: "Generate sound from oscillators, envelopes and filters, play it from a MIDI keyboard and record it.",
    description:
      "Sound is just numbers at 44,100 per second. Generate a sine, saw and square oscillator, shape notes with an ADSR envelope, add a resonant low-pass filter and an LFO, and route it all through a mixer to the audio output with a small buffer so latency stays low. Connect a MIDI keyboard (or the computer keyboard) and play chords: polyphony means managing voices, stealing the oldest when you run out.\n\nThen explore: band-limited oscillators to remove aliasing, delay and reverb effects, an arpeggiator, presets, and a UI with knobs. On the web the Web Audio API and AudioWorklets let you do all this in the browser; natively, a real-time audio thread teaches lock-free communication with the UI. Every step is audible, which makes debugging unusually fun.",
    difficulty: "INTERMEDIATE",
    estimatedHours: 10,
    popularity: 0.6,
    tags: ["audio", "creative-coding"],
    languages: ["typescript", "cpp", "rust"],
    concepts: ["oscillators and envelopes", "digital filters", "voice management and polyphony", "MIDI input", "real-time audio threads"],
    sourceUrl: "https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API",
  },
  {
    slug: "guitar-tuner-with-pitch-detection",
    title: "Build a guitar tuner with pitch detection",
    summary: "Detect the fundamental frequency of a live microphone signal with autocorrelation or YIN and show cents off.",
    description:
      "Capture microphone audio, and estimate pitch on each frame: a naive FFT peak is fooled by harmonics, so implement autocorrelation and then the YIN algorithm, which is what real tuners use. Convert frequency to the nearest note and cents deviation, smooth the estimate over frames, and show a needle or a strobe-style display that responds instantly.\n\nHandle silence and noise gracefully with a confidence threshold, support alternate tunings and a reference pitch, and test with recorded notes of known frequency. Then extend to a chromatic instrument tuner or a vocal pitch trainer. It is a short project that teaches signal processing with your own instrument as the test rig.",
    difficulty: "BEGINNER",
    estimatedHours: 3,
    popularity: 0.5,
    tags: ["audio", "algorithms", "mobile"],
    languages: ["typescript", "swift", "kotlin", "python"],
    concepts: ["microphone capture", "autocorrelation and YIN", "frequency-to-note conversion", "smoothing and confidence", "responsive meters"],
    sourceUrl: "http://audition.ens.fr/adc/pdf/2002_JASA_YIN.pdf",
  },
  {
    slug: "audio-visualizer-with-your-own-fft",
    title: "Build a real-time audio visualizer with your own FFT",
    summary: "Implement the fast Fourier transform, feed it live audio and render spectrum bars, waveforms and a spectrogram.",
    description:
      "Implement the Cooley–Tukey FFT yourself (recursive first, then iterative with bit reversal), apply a window function to reduce leakage, and turn microphone or music input into a spectrum you draw sixty times a second. Then add a scrolling spectrogram, beat detection from energy in low bands, and a few visual modes driven by the audio features.\n\nRender with canvas or move to WebGL shaders so the visuals can get elaborate without dropping frames. Verify your FFT against a library on synthetic signals, then measure how many bins you can afford per frame. It is a satisfying mix of algorithm implementation and creative coding.",
    difficulty: "BEGINNER",
    estimatedHours: 4,
    popularity: 0.55,
    tags: ["audio", "creative-coding", "webgl", "algorithms"],
    languages: ["typescript", "glsl", "python"],
    concepts: ["the fast Fourier transform", "window functions", "spectrograms", "beat detection", "real-time rendering"],
  },
  {
    slug: "step-sequencer-drum-machine",
    title: "Build a step-sequencer drum machine",
    summary: "Make a 16-step drum machine with sample playback, swing, tempo, patterns and rock-solid timing.",
    description:
      "A grid of sixteen steps by a handful of drum sounds, a play button and a tempo: it is a small UI with a hard core problem — timing. Audio must be scheduled ahead of time on the audio clock, not triggered from a UI timer, or it will drift and stutter. Implement a look-ahead scheduler, load samples, and add per-step velocity, swing, and pattern chaining.\n\nThen add synthesised drums (a kick from a pitched sine sweep, a snare from noise and an envelope), effects sends, export to WAV, and keyboard shortcuts for live use. It is a compact, delightful introduction to audio scheduling and interaction design.",
    difficulty: "BEGINNER",
    estimatedHours: 4,
    popularity: 0.5,
    tags: ["audio", "creative-coding", "web"],
    languages: ["typescript"],
    concepts: ["look-ahead audio scheduling", "sample playback", "swing and quantisation", "drum synthesis", "WAV export"],
  },
];
