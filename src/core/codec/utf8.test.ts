import { describe, expect, it } from 'vitest';
import { createRng } from '../math/rng.ts';
import { utf8Decode, utf8Encode } from './utf8.ts';

const SAMPLES = ['', 'Hola', '¡Hola, mundo! ñ á ü', '👋🏽 漢字 Ελληνικά', 'a'.repeat(10_000)];

describe('utf8', () => {
  it('encodes exactly like the platform TextEncoder', () => {
    const encoder = new TextEncoder();
    for (const s of SAMPLES) expect(utf8Encode(s)).toEqual(encoder.encode(s));
  });

  it('round-trips text', () => {
    for (const s of SAMPLES) expect(utf8Decode(utf8Encode(s))).toBe(s);
  });

  it('round-trips random code points', () => {
    const rng = createRng(5);
    for (let t = 0; t < 50; t++) {
      let s = '';
      for (let k = 0; k < 20; k++) {
        let cp = rng.int(1, 0x10ffff);
        if (cp >= 0xd800 && cp <= 0xdfff) cp = 0x41;
        s += String.fromCodePoint(cp);
      }
      expect(utf8Decode(utf8Encode(s))).toBe(s);
    }
  });

  it('replaces malformed sequences with U+FFFD instead of throwing', () => {
    expect(utf8Decode(Uint8Array.from([0x48, 0xff, 0x49]))).toBe('H�I');
    expect(utf8Decode(Uint8Array.from([0xc3]))).toBe('�'); // truncated "ñ"
    expect(utf8Decode(Uint8Array.from([0xc3, 0x41]))).toBe('�A');
    expect(utf8Decode(Uint8Array.from([0xe0, 0x80, 0x80]))).toBe('�'); // overlong
  });

  it('never throws on random bytes', () => {
    const rng = createRng(9);
    const bytes = Uint8Array.from({ length: 5000 }, () => rng.int(0, 255));
    expect(() => utf8Decode(bytes)).not.toThrow();
  });
});
