// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Text as fixed-size Uint8Array chunks addressed by the hash of their contents.
// A megabase project differs from the one saved a few seconds earlier in one or
// two chunks, so storing it again costs those chunks rather than the whole
// thing. The bytes are split before they are decoded, so a chunk boundary may
// fall inside a UTF-8 sequence; only the joined bytes are ever decoded.
export const CHUNK_BYTES = 64 * 1024;

export interface ChunkedText {
  /** The chunks in order; the same hash may appear more than once. */
  hashes: string[];
  /** Each distinct chunk once. */
  chunks: Map<string, Uint8Array>;
  /** Total length in bytes, so a reassembled text can be checked. */
  byteLength: number;
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * Split `text` into chunks keyed by the SHA-256 of their bytes. Returns null
 * where SubtleCrypto is unavailable (an insecure origin, say), which means the
 * caller should store the text as it is.
 */
export async function chunkText(text: string, chunkBytes = CHUNK_BYTES): Promise<ChunkedText | null> {
  const digest = globalThis.crypto?.subtle?.digest;
  if (typeof digest !== 'function') return null;
  const bytes = new TextEncoder().encode(text);
  const hashes: string[] = [];
  const chunks = new Map<string, Uint8Array>();
  for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkBytes, bytes.length));
    let hash: string;
    try {
      hash = toHex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', chunk)));
    } catch {
      return null;
    }
    hashes.push(hash);
    // A copy, because `chunk` is a view on a buffer the caller may reuse.
    if (!chunks.has(hash)) chunks.set(hash, new Uint8Array(chunk));
  }
  return { hashes, chunks, byteLength: bytes.length };
}

/**
 * Put the text back together. Returns null when a chunk is missing or the
 * joined bytes are not the length that was recorded, so a half-written set of
 * chunks can never be read as a short but valid text.
 */
export function joinChunks(
  hashes: string[],
  lookup: (hash: string) => Uint8Array | undefined,
  byteLength?: number,
): string | null {
  const pieces: Uint8Array[] = [];
  let total = 0;
  for (const hash of hashes) {
    const chunk = lookup(hash);
    if (!chunk) return null;
    pieces.push(chunk);
    total += chunk.length;
  }
  if (byteLength !== undefined && byteLength !== total) return null;
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const piece of pieces) {
    bytes.set(piece, offset);
    offset += piece.length;
  }
  return new TextDecoder().decode(bytes);
}

/** Which of `next`'s chunks are not in `previous` yet, and which are now unused. */
export function chunkDelta(
  previous: Iterable<string>,
  next: Iterable<string>,
): { added: string[]; removed: string[] } {
  const before = new Set(previous);
  const after = new Set(next);
  return {
    added: [...after].filter((hash) => !before.has(hash)),
    removed: [...before].filter((hash) => !after.has(hash)),
  };
}
