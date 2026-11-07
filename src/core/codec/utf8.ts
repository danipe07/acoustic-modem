/**
 * UTF-8 text ↔ bytes, implemented by hand because the core does not rely on
 * browser APIs such as TextEncoder.
 *
 * UTF-8 stores each Unicode code point in 1–4 bytes: ASCII stays one byte, so
 * "Hola" costs 4 bytes, while "ñ" costs 2 and "👋" costs 4.
 */
const REPLACEMENT = 0xfffd;

export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (const char of text) {
    let cp = char.codePointAt(0) ?? REPLACEMENT;
    if (cp >= 0xd800 && cp <= 0xdfff) cp = REPLACEMENT; // lone surrogate
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

/**
 * Decodes UTF-8, replacing malformed sequences with U+FFFD (�). Received data
 * can contain bit errors, so decoding must never throw.
 */
export function utf8Decode(bytes: Uint8Array): string {
  const codePoints: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    if (b0 < 0x80) {
      codePoints.push(b0);
      i++;
      continue;
    }

    let needed: number;
    let cp: number;
    let min: number;
    if (b0 >= 0xc2 && b0 <= 0xdf) {
      needed = 1;
      cp = b0 & 0x1f;
      min = 0x80;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      needed = 2;
      cp = b0 & 0x0f;
      min = 0x800;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      needed = 3;
      cp = b0 & 0x07;
      min = 0x10000;
    } else {
      codePoints.push(REPLACEMENT);
      i++;
      continue;
    }

    let j = 1;
    for (; j <= needed; j++) {
      const b = bytes[i + j];
      if (b === undefined || (b & 0xc0) !== 0x80) break;
      cp = (cp << 6) | (b & 0x3f);
    }

    const truncated = j <= needed;
    if (truncated || cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      codePoints.push(REPLACEMENT);
      i += truncated ? j : needed + 1;
    } else {
      codePoints.push(cp);
      i += needed + 1;
    }
  }

  let text = '';
  const CHUNK = 4096; // avoid exceeding the maximum number of call arguments
  for (let k = 0; k < codePoints.length; k += CHUNK) {
    text += String.fromCodePoint(...codePoints.slice(k, k + CHUNK));
  }
  return text;
}
