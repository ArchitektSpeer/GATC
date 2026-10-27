// SPDX-License-Identifier: GPL-3.0-or-later
import type { PlasmidDocument } from '../types/schema';

/**
 * Give documents fresh ids where they collide with open ones, rewriting every
 * reference to a renamed id inside them (history parents), so a second copy of
 * a project never points at the first copy.
 */
export function remapDocIds(docs: PlasmidDocument[], taken: (id: string) => boolean, newId: (d: PlasmidDocument) => string): { docs: PlasmidDocument[]; idMap: Map<string, string> } {
  const idMap = new Map(docs.map((d) => [d.id, taken(d.id) ? newId(d) : d.id] as const));
  const remapped = docs.map((d) => {
    const id = idMap.get(d.id)!;
    const touchesHistory = d.history.some((h) => h.parentSnapshots?.some((p) => idMap.get(p.id) !== undefined && idMap.get(p.id) !== p.id));
    if (id === d.id && !touchesHistory) return d;
    return {
      ...d,
      id,
      history: touchesHistory
        ? d.history.map((h) => (h.parentSnapshots ? { ...h, parentSnapshots: h.parentSnapshots.map((p) => ({ ...p, id: idMap.get(p.id) ?? p.id })) } : h))
        : d.history,
    };
  });
  return { docs: remapped, idMap };
}
