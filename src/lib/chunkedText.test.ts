// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { CHUNK_BYTES, chunkDelta, chunkText, joinChunks } from './chunkedText';

function sequence(length: number, seed = 3): string {
  const bases = 'ACGT';
  let state = seed >>> 0;
  let out = '';
  for (let index = 0; index < length; index += 1) {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    out += bases[((value ^ (value >>> 14)) >>> 0) % 4];
  }
  return out;
}

describe('chunked text', () => {
  it('splits and joins back to exactly the same text', async () => {
    const text = sequence(5 * CHUNK_BYTES + 777);
    const chunked = await chunkText(text);
    expect(chunked).not.toBeNull();
    if (!chunked) return;
    expect(chunked.hashes).toHaveLength(6);
    expect(joinChunks(chunked.hashes, (hash) => chunked.chunks.get(hash), chunked.byteLength)).toBe(text);
  });

  it('keeps multi-byte characters intact across a chunk boundary', async () => {
    // Fills the first chunk to one byte short, so a three-byte character straddles it.
    const text = 'a'.repeat(CHUNK_BYTES - 1) + '质粒' + 'b'.repeat(10);
    const chunked = await chunkText(text);
    expect(chunked).not.toBeNull();
    if (!chunked) return;
    expect(joinChunks(chunked.hashes, (hash) => chunked.chunks.get(hash), chunked.byteLength)).toBe(text);
  });

  it('shares every chunk but the edited one when the text barely changes', async () => {
    const text = sequence(10 * CHUNK_BYTES);
    const before = await chunkText(text);
    // One base changed in the middle of the fifth chunk.
    const position = 4 * CHUNK_BYTES + 100;
    const edited = text.slice(0, position) + (text[position] === 'A' ? 'C' : 'A') + text.slice(position + 1);
    const after = await chunkText(edited);
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    if (!before || !after) return;

    const { added, removed } = chunkDelta(before.hashes, after.hashes);
    expect(added).toHaveLength(1);
    expect(removed).toHaveLength(1);
    // Storing the new version again costs one chunk instead of 640 kB.
    expect(added.length * CHUNK_BYTES).toBe(CHUNK_BYTES);
  });

  it('refuses to return a short text when a chunk is missing', async () => {
    const chunked = await chunkText(sequence(3 * CHUNK_BYTES));
    expect(chunked).not.toBeNull();
    if (!chunked) return;
    const missing = chunked.hashes[1];
    expect(
      joinChunks(chunked.hashes, (hash) => (hash === missing ? undefined : chunked.chunks.get(hash)), chunked.byteLength),
    ).toBeNull();
    // And when the recorded length does not match what the chunks add up to.
    expect(joinChunks(chunked.hashes.slice(0, 2), (hash) => chunked.chunks.get(hash), chunked.byteLength)).toBeNull();
  });

  it('stores a run of identical chunks once', async () => {
    const chunked = await chunkText('A'.repeat(4 * CHUNK_BYTES));
    expect(chunked).not.toBeNull();
    if (!chunked) return;
    expect(chunked.hashes).toHaveLength(4);
    expect(chunked.chunks.size).toBe(1);
  });

  it('handles the empty text', async () => {
    const chunked = await chunkText('');
    expect(chunked).not.toBeNull();
    if (!chunked) return;
    expect(chunked.hashes).toHaveLength(0);
    expect(joinChunks([], () => undefined, 0)).toBe('');
  });
});
