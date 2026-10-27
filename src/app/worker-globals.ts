// SPDX-License-Identifier: GPL-3.0-or-later
// Some parser dependencies expect Node's `global`, which a Web Worker lacks.
// Imported first by bio.worker.ts so it runs before those modules are evaluated.
const scope = globalThis as typeof globalThis & { global?: typeof globalThis };
scope.global ??= globalThis;
