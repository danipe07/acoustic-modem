# Acoustic Modem

A modem that runs in the browser and sends text (and, later, small files) between two
devices using nothing but a **speaker and a microphone**. Every piece of the signal
processing chain — modulation, synchronisation, error detection and correction — is
implemented from scratch in TypeScript.

> **Status:** phase 1 (binary FSK) in progress. Live demo, screenshots and measurements
> will be added as each phase is completed.

## Roadmap

| Phase | Content                                                       | Status         |
| ----- | ------------------------------------------------------------- | -------------- |
| 1     | Binary FSK, UART-style async framing, simulated channel       | 🚧 In progress |
| 2     | Frames: preamble, sync word, header, CRC                      | ⏳             |
| 3     | Forward error correction: Hamming, then Reed–Solomon          | ⏳             |
| 4     | PSK and QAM with constellation diagram                        | ⏳             |
| 5     | OFDM                                                          | ⏳             |
| 6     | Measurement bench: BER vs. noise (simulated) and vs. distance | ⏳             |

## Architecture

```
src/
├── core/    Pure DSP on Float32Array sample buffers — no browser APIs, tested in Node
│   ├── math/      seeded RNG, FFT, Goertzel, biquad filters, dB helpers
│   ├── codec/     UTF-8 text ↔ bytes
│   ├── framing/   UART-style framing (phase 1)
│   ├── modem/     modulators and streaming demodulators
│   ├── channel/   simulated acoustic channel (noise, echo, reverb, clock mismatch)
│   └── stats.ts   bit error rate and related metrics
├── audio/   Web Audio glue: AudioWorklet capture, playback, receiver worker
└── ui/      Interface, visualisations, i18n (Spanish / English)
```

The core is compiled with a separate `tsconfig.core.json` that excludes the DOM library,
so any accidental dependency on the browser is a compile error.

## Development

Requires Node.js 24 or newer.

```bash
npm install
npm run dev        # local dev server
npm test           # unit and end-to-end DSP tests (Vitest)
npm run check      # lint + format check + typecheck + tests
```

## Theory

A step-by-step explanation of every concept (in Spanish) lives in
[docs/TEORIA.md](docs/TEORIA.md).

## License

[MIT](LICENSE)
