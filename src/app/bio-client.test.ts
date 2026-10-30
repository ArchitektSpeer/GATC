// SPDX-License-Identifier: GPL-3.0-or-later
// #21 (docs/REVIEW-2026-10-27-glue-ui.md): a broken worker must not leave tasks waiting forever.
import { describe, expect, it, vi } from 'vitest';

describe('bio worker failure', () => {
  it('fails tasks in flight and runs later calls in-thread', async () => {
    const created: FakeWorker[] = [];
    class FakeWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      constructor() {
        created.push(this);
      }
      postMessage(message: { id?: number }) {
        // The worker is created, told where the interpreter is, and only falls over
        // once a task arrives; a task in flight is what has to be failed.
        if (message?.id === undefined) return;
        setTimeout(() => this.onerror?.({ message: 'failed to load', preventDefault() {} } as ErrorEvent), 0);
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker);
    const { callBio } = await import('./bio-client');
    await expect(callBio('calcCrossDimer', 'ACGTACGTAC', 'GTACGTACGT')).rejects.toThrow(/计算线程出错/);
    expect(created.length).toBeGreaterThan(0);
    // Pool is abandoned; the call is answered in-thread.
    const dimer = await callBio('calcCrossDimer', 'ACGTACGTAC', 'GTACGTACGT');
    expect(dimer).toBeTypeOf('object');
    vi.unstubAllGlobals();
  });
});
