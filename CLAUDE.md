# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

Browser acoustic modem (TypeScript + Web Audio API, deployed to GitHub Pages) that sends
text — and later small files — between two devices using only speaker and microphone.
It is a CV project and a learning project: the owner is a 2nd-year Telecommunications
Engineering student who has not yet taken digital communications.

## Working rules (set by the owner — always follow)

- **Phase-gated work.** Phases: 1 FSK · 2 frames (preamble, header, CRC) · 3 FEC (Hamming,
  then Reed–Solomon) · 4 PSK/QAM + constellation · 5 OFDM · 6 measurement bench (BER vs.
  noise in simulation, BER vs. distance over the air). Each phase must work in simulation
  mode first and then over the air before moving on.
- **Stop at the end of every phase.** Explain what was built as if preparing for a job
  interview, add that explanation to `docs/TEORIA.md`, and do not start the next phase
  until the owner says so. Also stop at any intermediate checkpoint the owner requests.
- **Explain before implementing.** Introduce each new concept simply (in Spanish) before
  writing the code for it.
- **No DSP libraries.** Implement modulation, demodulation, synchronisation, CRC and error
  correction ourselves. No acoustic-modem, DSP, FFT or FEC libraries.
- **Ask for confirmation before every `git push`** (and before creating the GitHub repo or
  anything else that publishes). Local commits are fine.
- **Languages:** code, comments, commit messages and README in English;
  `docs/TEORIA.md` in Spanish; UI in Spanish with an English option.
- **License:** MIT.

## Technical constraints

- `src/core` is pure signal processing on sample arrays: no DOM, no Web Audio, no UI.
  It is type-checked with `tsconfig.core.json` (no DOM lib) and ESLint forbids imports
  from `audio/` or `ui/`. It must stay runnable and testable in Node.
- The simulated channel takes a seeded RNG (`createRng(seed)`) so tests are reproducible.
- Everything is parameterised by `sampleRate` (iOS forces 48 kHz; many PCs use 44.1 kHz).
- Mic capture: `echoCancellation`, `noiseSuppression` and `autoGainControl` set to `false`.
- Real-time reception uses an AudioWorklet (capture) feeding a Web Worker (receiver).
- Audible band that phone speakers and mics handle well (phase 1 tones: 2000 / 3000 Hz).
- Relative imports use explicit `.ts` extensions (Node runs the core with type stripping).

## Over-the-air test devices

Phase acceptance over the air is tested with: **iPhone (Safari)** and **Windows laptop
(Chrome)**.

## Conventions

- Small, focused commits using Conventional Commits (`feat(fsk): ...`, `test(channel): ...`).
- One branch and PR per phase (`phase-1/fsk`, ...); tag `v0.N.0` when a phase is done.
- Tests live next to the code as `*.test.ts`; end-to-end modem tests go through the
  simulated channel.

## Commands

```bash
npm run dev           # Vite dev server
npm test              # Vitest (Node)
npm run check         # lint + prettier check + typecheck (core and app) + tests
npm run build         # production build into dist/
```

## Deployment reminder

When the GitHub Pages deploy step arrives, remind the owner what to configure in the
repository settings (Settings → Pages → Source: "GitHub Actions").
