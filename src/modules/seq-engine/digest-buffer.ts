// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// NEBuffer activity, incubation temperature, heat-inactivation and star-activity
// data transcribed from the public NEBuffer Performance Chart with Restriction
// Enzymes (NEB, https://www.neb.com). Percentages are approximate.
import type { RestrictionEnzyme } from '../../types/schema';

export type NebBufferName = 'r1.1' | 'r2.1' | 'r3.1' | 'rCutSmart';

export interface EnzymeDigestCondition {
  activities: Record<NebBufferName, number>;
  incubationC: number;
  heatInactivation: string;
  starBuffers: NebBufferName[];
  starNotes: string[];
}

export const ENZYME_DIGEST_CONDITIONS: Record<string, EnzymeDigestCondition> = {
  'AatII': { activities: { 'r1.1': 0, 'r2.1': 50, 'r3.1': 50, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: ['r2.1'], starNotes: [] },
  'Acc65I': { activities: { 'r1.1': 10, 'r2.1': 75, 'r3.1': 100, rCutSmart: 25 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: ['r2.1'], starNotes: [] },
  'AccI': { activities: { 'r1.1': 50, 'r2.1': 50, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'AciI': { activities: { 'r1.1': 0, 'r2.1': 25, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'AclI': { activities: { 'r1.1': 0, 'r2.1': 0, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'AcuI': { activities: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 50, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from extended digestion, high enzyme concentration, or >5% glycerol.'] },
  'AfeI': { activities: { 'r1.1': 25, 'r2.1': 100, 'r3.1': 25, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'AflII': { activities: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'AflIII': { activities: { 'r1.1': 10, 'r2.1': 50, 'r3.1': 100, rCutSmart: 50 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'AgeI': { activities: { 'r1.1': 100, 'r2.1': 50, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'AhdI': { activities: { 'r1.1': 25, 'r2.1': 25, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'AleI': { activities: { 'r1.1': 0, 'r2.1': 0, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'AluI': { activities: { 'r1.1': 25, 'r2.1': 100, 'r3.1': 50, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'AlwI': { activities: { 'r1.1': 50, 'r2.1': 50, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: ['Star activity may result from extended digestion, high enzyme concentration, or >5% glycerol.'] },
  'AlwNI': { activities: { 'r1.1': 10, 'r2.1': 100, 'r3.1': 50, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'ApaI': { activities: { 'r1.1': 25, 'r2.1': 25, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'ApaLI': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'ApeKI': { activities: { 'r1.1': 25, 'r2.1': 50, 'r3.1': 100, rCutSmart: 10 }, incubationC: 75, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'ApoI': { activities: { 'r1.1': 10, 'r2.1': 100, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'AscI': { activities: { 'r1.1': 0, 'r2.1': 10, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'AseI': { activities: { 'r1.1': 0, 'r2.1': 50, 'r3.1': 100, rCutSmart: 10 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: ['r2.1'], starNotes: ['Star activity may result from a glycerol concentration above 5%.'] },
  'AsiSI': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 25, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from extended digestion.'] },
  'AvaI': { activities: { 'r1.1': 0, 'r2.1': 100, 'r3.1': 25, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'AvaII': { activities: { 'r1.1': 50, 'r2.1': 75, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'AvrII': { activities: { 'r1.1': 100, 'r2.1': 50, 'r3.1': 50, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'BaeGI': { activities: { 'r1.1': 75, 'r2.1': 75, 'r3.1': 100, rCutSmart: 25 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'BaeI': { activities: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 50, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'BamHI': { activities: { 'r1.1': 75, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: ['r1.1', 'r2.1', 'rCutSmart'], starNotes: ['Star activity may result from a glycerol concentration above 5%.'] },
  'BanI': { activities: { 'r1.1': 10, 'r2.1': 25, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from extended digestion, high enzyme concentration, or >5% glycerol.'] },
  'BanII': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 50, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from extended digestion.'] },
  'BbsI': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 25, rCutSmart: 75 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'BbvCI': { activities: { 'r1.1': 10, 'r2.1': 100, 'r3.1': 50, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: ['Star activity may result from extended digestion, high enzyme concentration, or >5% glycerol.'] },
  'BbvI': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 25, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from a glycerol concentration above 5%.'] },
  'BccI': { activities: { 'r1.1': 100, 'r2.1': 50, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from a glycerol concentration above 5%.'] },
  'BceAI': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: ['r1.1', 'r2.1', 'rCutSmart'], starNotes: ['Star activity may result from extended digestion, high enzyme concentration, or >5% glycerol.'] },
  'BcgI': { activities: { 'r1.1': 10, 'r2.1': 75, 'r3.1': 100, rCutSmart: 50 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: ['r2.1', 'rCutSmart'], starNotes: [] },
  'BciVI': { activities: { 'r1.1': 100, 'r2.1': 25, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'BclI': { activities: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 100, rCutSmart: 75 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'BcoDI': { activities: { 'r1.1': 50, 'r2.1': 75, 'r3.1': 75, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'BfaI': { activities: { 'r1.1': 0, 'r2.1': 10, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from extended digestion.'] },
  'BfuAI': { activities: { 'r1.1': 0, 'r2.1': 25, 'r3.1': 100, rCutSmart: 10 }, incubationC: 50, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from a glycerol concentration above 5%.'] },
  'BglI': { activities: { 'r1.1': 10, 'r2.1': 25, 'r3.1': 100, rCutSmart: 10 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'BglII': { activities: { 'r1.1': 10, 'r2.1': 10, 'r3.1': 100, rCutSmart: 0 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'BlpI': { activities: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'BmgBI': { activities: { 'r1.1': 0, 'r2.1': 10, 'r3.1': 100, rCutSmart: 10 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from a glycerol concentration above 5%.'] },
  'BmrI': { activities: { 'r1.1': 75, 'r2.1': 100, 'r3.1': 75, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: ['rCutSmart'], starNotes: [] },
  'BmtI': { activities: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'BpmI': { activities: { 'r1.1': 75, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: ['rCutSmart'], starNotes: ['Star activity may result from extended digestion.'] },
  'Bpu10I': { activities: { 'r1.1': 10, 'r2.1': 25, 'r3.1': 100, rCutSmart: 25 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from a glycerol concentration above 5%.'] },
  'BpuEI': { activities: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 50, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: ['r1.1', 'r3.1'], starNotes: [] },
  'BsaAI': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'BsaBI': { activities: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 75, rCutSmart: 100 }, incubationC: 60, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from extended digestion.'] },
  'BsaHI': { activities: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'BsaI-HF®v2': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'BsaJI': { activities: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 60, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'BsaWI': { activities: { 'r1.1': 10, 'r2.1': 100, 'r3.1': 50, rCutSmart: 100 }, incubationC: 60, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'BsaXI': { activities: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: ['r1.1', 'r2.1'], starNotes: [] },
  'BseRI': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 75, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'BseYI': { activities: { 'r1.1': 10, 'r2.1': 50, 'r3.1': 100, rCutSmart: 50 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'BsgI': { activities: { 'r1.1': 25, 'r2.1': 50, 'r3.1': 25, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'BsiEI': { activities: { 'r1.1': 25, 'r2.1': 50, 'r3.1': 0, rCutSmart: 100 }, incubationC: 60, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: ['Star activity may result from extended digestion, high enzyme concentration, or >5% glycerol.'] },
  'BsiHKAI': { activities: { 'r1.1': 25, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 65, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'BsiWI': { activities: { 'r1.1': 25, 'r2.1': 50, 'r3.1': 100, rCutSmart: 25 }, incubationC: 55, heatInactivation: '80°C for 20 minutes', starBuffers: ['r2.1'], starNotes: [] },
  'BslI': { activities: { 'r1.1': 50, 'r2.1': 75, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'BsmAI': { activities: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'BsmBI': { activities: { 'r1.1': 0, 'r2.1': 50, 'r3.1': 100, rCutSmart: 25 }, incubationC: 55, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'BsmFI': { activities: { 'r1.1': 25, 'r2.1': 50, 'r3.1': 50, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from extended digestion, high enzyme concentration, or >5% glycerol.'] },
  'BsmI': { activities: { 'r1.1': 25, 'r2.1': 100, 'r3.1': 0, rCutSmart: 100 }, incubationC: 65, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'BsoBI': { activities: { 'r1.1': 25, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'Bsp1286I': { activities: { 'r1.1': 25, 'r2.1': 25, 'r3.1': 25, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from a glycerol concentration above 5%.'] },
  'BspCNI': { activities: { 'r1.1': 100, 'r2.1': 75, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'BspDI': { activities: { 'r1.1': 25, 'r2.1': 75, 'r3.1': 50, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'BspEI': { activities: { 'r1.1': 0, 'r2.1': 10, 'r3.1': 100, rCutSmart: 0 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'BspHI': { activities: { 'r1.1': 10, 'r2.1': 50, 'r3.1': 25, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'BspMI': { activities: { 'r1.1': 10, 'r2.1': 50, 'r3.1': 100, rCutSmart: 10 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: ['r2.1'], starNotes: [] },
  'BspQI': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 50, heatInactivation: '80°C for 20 minutes', starBuffers: ['r1.1', 'r2.1', 'rCutSmart'], starNotes: ['Star activity may result from a glycerol concentration above 5%.'] },
  'BsrBI': { activities: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'BsrDI': { activities: { 'r1.1': 10, 'r2.1': 100, 'r3.1': 75, rCutSmart: 25 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from a glycerol concentration above 5%.'] },
  'BsrFI': { activities: { 'r1.1': 25, 'r2.1': 25, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'BsrGI': { activities: { 'r1.1': 10, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'BsrI': { activities: { 'r1.1': 0, 'r2.1': 50, 'r3.1': 100, rCutSmart: 10 }, incubationC: 65, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'BssHII': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'BssSI': { activities: { 'r1.1': 10, 'r2.1': 25, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'BstAPI': { activities: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 25, rCutSmart: 100 }, incubationC: 60, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'BstBI': { activities: { 'r1.1': 75, 'r2.1': 100, 'r3.1': 10, rCutSmart: 100 }, incubationC: 65, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'BstEII': { activities: { 'r1.1': 0, 'r2.1': 10, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'BstNI': { activities: { 'r1.1': 10, 'r2.1': 100, 'r3.1': 100, rCutSmart: 75 }, incubationC: 60, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'BstUI': { activities: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 25, rCutSmart: 100 }, incubationC: 60, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'BstXI': { activities: { 'r1.1': 0, 'r2.1': 50, 'r3.1': 100, rCutSmart: 25 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from a glycerol concentration above 5%.'] },
  'BstYI': { activities: { 'r1.1': 25, 'r2.1': 100, 'r3.1': 75, rCutSmart: 100 }, incubationC: 60, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'BstZ17I': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'Bsu36I': { activities: { 'r1.1': 25, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'BtgI': { activities: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'BtgZI': { activities: { 'r1.1': 10, 'r2.1': 25, 'r3.1': 0, rCutSmart: 100 }, incubationC: 60, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from a glycerol concentration above 5%.'] },
  'BtsCI': { activities: { 'r1.1': 10, 'r2.1': 100, 'r3.1': 25, rCutSmart: 100 }, incubationC: 50, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'BtsI': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 25, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: ['Star activity may result from extended digestion, high enzyme concentration, or >5% glycerol.'] },
  'BtsIMutI': { activities: { 'r1.1': 100, 'r2.1': 50, 'r3.1': 10, rCutSmart: 100 }, incubationC: 55, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'Cac8I': { activities: { 'r1.1': 50, 'r2.1': 75, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'ClaI': { activities: { 'r1.1': 10, 'r2.1': 50, 'r3.1': 50, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'CspCI': { activities: { 'r1.1': 10, 'r2.1': 100, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'CviKI-1': { activities: { 'r1.1': 25, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: ['Star activity may result from extended digestion, high enzyme concentration, or >5% glycerol.'] },
  'CviQI': { activities: { 'r1.1': 75, 'r2.1': 100, 'r3.1': 100, rCutSmart: 75 }, incubationC: 25, heatInactivation: 'Not heat inactivated', starBuffers: ['r2.1', 'rCutSmart'], starNotes: [] },
  'DdeI': { activities: { 'r1.1': 75, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'DpnI': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 75, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'DpnII': { activities: { 'r1.1': 25, 'r2.1': 25, 'r3.1': 100, rCutSmart: 25 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: ['r3.1'], starNotes: [] },
  'DraI': { activities: { 'r1.1': 75, 'r2.1': 75, 'r3.1': 50, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'DraIII': { activities: { 'r1.1': 0, 'r2.1': 50, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'DrdI': { activities: { 'r1.1': 25, 'r2.1': 50, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from a glycerol concentration above 5%.'] },
  'EaeI': { activities: { 'r1.1': 10, 'r2.1': 50, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'EagI': { activities: { 'r1.1': 25, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'EarI': { activities: { 'r1.1': 50, 'r2.1': 10, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'EciI': { activities: { 'r1.1': 100, 'r2.1': 50, 'r3.1': 50, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from extended digestion.'] },
  'Eco53kI': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from a glycerol concentration above 5%.'] },
  'EcoNI': { activities: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 75, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'EcoO109I': { activities: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 50, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from a glycerol concentration above 5%.'] },
  'EcoP15I': { activities: { 'r1.1': 75, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'EcoRI': { activities: { 'r1.1': 25, 'r2.1': 100, 'r3.1': 50, rCutSmart: 50 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: ['r2.1', 'rCutSmart'], starNotes: [] },
  'EcoRV': { activities: { 'r1.1': 10, 'r2.1': 50, 'r3.1': 100, rCutSmart: 10 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'Esp3I': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'FatI': { activities: { 'r1.1': 10, 'r2.1': 100, 'r3.1': 50, rCutSmart: 50 }, incubationC: 55, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'FauI': { activities: { 'r1.1': 100, 'r2.1': 50, 'r3.1': 10, rCutSmart: 100 }, incubationC: 55, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from a glycerol concentration above 5%.'] },
  'Fnu4HI': { activities: { 'r1.1': 0, 'r2.1': 0, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'FokI': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 75, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from a glycerol concentration above 5%.'] },
  'FseI': { activities: { 'r1.1': 100, 'r2.1': 75, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'FspI': { activities: { 'r1.1': 10, 'r2.1': 100, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'HaeII': { activities: { 'r1.1': 25, 'r2.1': 100, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'HaeIII': { activities: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 25, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'HgaI': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 25, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: ['rCutSmart'], starNotes: ['Star activity may result from extended digestion, high enzyme concentration, or >5% glycerol.'] },
  'HhaI': { activities: { 'r1.1': 25, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'HinP1I': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'HincII': { activities: { 'r1.1': 25, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'HindIII': { activities: { 'r1.1': 25, 'r2.1': 100, 'r3.1': 50, rCutSmart: 50 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'HinfI': { activities: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'HpaI': { activities: { 'r1.1': 0, 'r2.1': 75, 'r3.1': 25, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: ['r2.1'], starNotes: ['Star activity may result from extended digestion, high enzyme concentration, or >5% glycerol.'] },
  'HpaII': { activities: { 'r1.1': 100, 'r2.1': 50, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'HphI': { activities: { 'r1.1': 50, 'r2.1': 50, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from extended digestion, high enzyme concentration, or >5% glycerol.'] },
  'Hpy166II': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 50, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'Hpy188I': { activities: { 'r1.1': 25, 'r2.1': 100, 'r3.1': 50, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from extended digestion, high enzyme concentration, or >5% glycerol.'] },
  'Hpy188III': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from a glycerol concentration above 5%.'] },
  'Hpy99I': { activities: { 'r1.1': 50, 'r2.1': 10, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'HpyAV': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 25, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from a glycerol concentration above 5%.'] },
  'HpyCH4III': { activities: { 'r1.1': 100, 'r2.1': 25, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'HpyCH4IV': { activities: { 'r1.1': 100, 'r2.1': 50, 'r3.1': 25, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'HpyCH4V': { activities: { 'r1.1': 50, 'r2.1': 50, 'r3.1': 25, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'I-CeuI': { activities: { 'r1.1': 0, 'r2.1': 0, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'I-SceI': { activities: { 'r1.1': 10, 'r2.1': 50, 'r3.1': 25, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'KasI': { activities: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 50, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from a glycerol concentration above 5%.'] },
  'KpnI': { activities: { 'r1.1': 100, 'r2.1': 25, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'MboI': { activities: { 'r1.1': 75, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'MboII': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 50, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: ['r1.1'], starNotes: [] },
  'MfeI': { activities: { 'r1.1': 75, 'r2.1': 25, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'MluCI': { activities: { 'r1.1': 100, 'r2.1': 10, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'MluI': { activities: { 'r1.1': 25, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'MlyI': { activities: { 'r1.1': 50, 'r2.1': 50, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'MmeI': { activities: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 50, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'MnlI': { activities: { 'r1.1': 75, 'r2.1': 100, 'r3.1': 50, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'MscI': { activities: { 'r1.1': 25, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'MseI': { activities: { 'r1.1': 75, 'r2.1': 100, 'r3.1': 75, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'MslI': { activities: { 'r1.1': 50, 'r2.1': 50, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'MspA1I': { activities: { 'r1.1': 10, 'r2.1': 50, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'MspI': { activities: { 'r1.1': 75, 'r2.1': 100, 'r3.1': 50, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'MspJI': { activities: { 'r1.1': 0, 'r2.1': 0, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from extended digestion, high enzyme concentration, or >5% glycerol.'] },
  'MwoI': { activities: { 'r1.1': 0, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 60, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'NaeI': { activities: { 'r1.1': 25, 'r2.1': 25, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'NarI': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'Nb.BbvCI': { activities: { 'r1.1': 25, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'Nb.BsmI': { activities: { 'r1.1': 0, 'r2.1': 50, 'r3.1': 100, rCutSmart: 10 }, incubationC: 65, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'Nb.BsrDI': { activities: { 'r1.1': 25, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'Nb.BssSI': { activities: { 'r1.1': 10, 'r2.1': 100, 'r3.1': 100, rCutSmart: 25 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'Nb.BtsI': { activities: { 'r1.1': 75, 'r2.1': 100, 'r3.1': 75, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'NciI': { activities: { 'r1.1': 100, 'r2.1': 25, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'NcoI': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 100, rCutSmart: 0 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'NdeI': { activities: { 'r1.1': 75, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'NgoMIV': { activities: { 'r1.1': 100, 'r2.1': 50, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: ['Star activity may result from extended digestion, high enzyme concentration, or >5% glycerol.'] },
  'NheI': { activities: { 'r1.1': 100, 'r2.1': 25, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'NlaIII': { activities: { 'r1.1': 0, 'r2.1': 0, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'NlaIV': { activities: { 'r1.1': 10, 'r2.1': 10, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'NmeAIII': { activities: { 'r1.1': 10, 'r2.1': 10, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'NotI': { activities: { 'r1.1': 0, 'r2.1': 50, 'r3.1': 100, rCutSmart: 25 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'NruI': { activities: { 'r1.1': 0, 'r2.1': 25, 'r3.1': 50, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'NsiI': { activities: { 'r1.1': 10, 'r2.1': 75, 'r3.1': 100, rCutSmart: 25 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'NspI': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'Nt.AlwI': { activities: { 'r1.1': 10, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'Nt.BbvCI': { activities: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'Nt.BsmAI': { activities: { 'r1.1': 100, 'r2.1': 50, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'Nt.BspQI': { activities: { 'r1.1': 0, 'r2.1': 25, 'r3.1': 100, rCutSmart: 10 }, incubationC: 50, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'Nt.BstNBI': { activities: { 'r1.1': 0, 'r2.1': 10, 'r3.1': 100, rCutSmart: 10 }, incubationC: 55, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'Nt.CviPII': { activities: { 'r1.1': 10, 'r2.1': 100, 'r3.1': 25, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'PI-PspI': { activities: { 'r1.1': 10, 'r2.1': 10, 'r3.1': 10, rCutSmart: 10 }, incubationC: 65, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'PI-SceI': { activities: { 'r1.1': 10, 'r2.1': 10, 'r3.1': 10, rCutSmart: 10 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'PacI': { activities: { 'r1.1': 100, 'r2.1': 75, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'PaeR7I': { activities: { 'r1.1': 25, 'r2.1': 100, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'PaqCI': { activities: { 'r1.1': 10, 'r2.1': 100, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from extended digestion, high enzyme concentration, or >5% glycerol.'] },
  'PciI': { activities: { 'r1.1': 50, 'r2.1': 75, 'r3.1': 100, rCutSmart: 50 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: ['rCutSmart'], starNotes: [] },
  'PflFI': { activities: { 'r1.1': 25, 'r2.1': 100, 'r3.1': 25, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'PflMI': { activities: { 'r1.1': 0, 'r2.1': 100, 'r3.1': 100, rCutSmart: 50 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from a glycerol concentration above 5%.'] },
  'PleI': { activities: { 'r1.1': 25, 'r2.1': 50, 'r3.1': 25, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'PluTI': { activities: { 'r1.1': 100, 'r2.1': 25, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'PmeI': { activities: { 'r1.1': 0, 'r2.1': 50, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'PmlI': { activities: { 'r1.1': 100, 'r2.1': 50, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'PpuMI': { activities: { 'r1.1': 0, 'r2.1': 0, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'PshAI': { activities: { 'r1.1': 25, 'r2.1': 50, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'PsiI': { activities: { 'r1.1': 25, 'r2.1': 50, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from a glycerol concentration above 5%.'] },
  'PspGI': { activities: { 'r1.1': 25, 'r2.1': 100, 'r3.1': 50, rCutSmart: 100 }, incubationC: 75, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: ['Star activity may result from a glycerol concentration above 5%.'] },
  'PspOMI': { activities: { 'r1.1': 10, 'r2.1': 10, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'PspXI': { activities: { 'r1.1': 0, 'r2.1': 100, 'r3.1': 25, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'PstI': { activities: { 'r1.1': 75, 'r2.1': 75, 'r3.1': 100, rCutSmart: 50 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: ['rCutSmart'], starNotes: [] },
  'PvuI': { activities: { 'r1.1': 25, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'PvuII': { activities: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: ['rCutSmart'], starNotes: [] },
  'RsaI': { activities: { 'r1.1': 25, 'r2.1': 50, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'RsrII': { activities: { 'r1.1': 25, 'r2.1': 75, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'SacI': { activities: { 'r1.1': 10, 'r2.1': 50, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'SacII': { activities: { 'r1.1': 10, 'r2.1': 100, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'SalI': { activities: { 'r1.1': 0, 'r2.1': 0, 'r3.1': 100, rCutSmart: 0 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'SapI': { activities: { 'r1.1': 75, 'r2.1': 50, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'Sau3AI': { activities: { 'r1.1': 100, 'r2.1': 50, 'r3.1': 10, rCutSmart: 0 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'Sau96I': { activities: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'SbfI': { activities: { 'r1.1': 50, 'r2.1': 25, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'ScaI': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'ScrFI': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from extended digestion.'] },
  'SexAI': { activities: { 'r1.1': 100, 'r2.1': 75, 'r3.1': 50, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from a glycerol concentration above 5%.'] },
  'SfaNI': { activities: { 'r1.1': 0, 'r2.1': 75, 'r3.1': 100, rCutSmart: 25 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from a glycerol concentration above 5%.'] },
  'SfcI': { activities: { 'r1.1': 75, 'r2.1': 50, 'r3.1': 25, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from a glycerol concentration above 5%.'] },
  'SfiI': { activities: { 'r1.1': 25, 'r2.1': 100, 'r3.1': 50, rCutSmart: 100 }, incubationC: 50, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'SfoI': { activities: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'SgrAI': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from extended digestion, high enzyme concentration, or >5% glycerol.'] },
  'SmaI': { activities: { 'r1.1': 0, 'r2.1': 0, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'SmlI': { activities: { 'r1.1': 25, 'r2.1': 75, 'r3.1': 25, rCutSmart: 100 }, incubationC: 55, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'SnaBI': { activities: { 'r1.1': 50, 'r2.1': 50, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: ['r1.1'], starNotes: ['Star activity may result from extended digestion, high enzyme concentration, or >5% glycerol.'] },
  'SpeI': { activities: { 'r1.1': 25, 'r2.1': 50, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'SphI': { activities: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 50, rCutSmart: 0 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from extended digestion.'] },
  'SrfI': { activities: { 'r1.1': 10, 'r2.1': 50, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'SspI': { activities: { 'r1.1': 25, 'r2.1': 100, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'StuI': { activities: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 50, rCutSmart: 100 }, incubationC: 37, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'StyD4I': { activities: { 'r1.1': 10, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'StyI': { activities: { 'r1.1': 25, 'r2.1': 100, 'r3.1': 25, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'SwaI': { activities: { 'r1.1': 10, 'r2.1': 10, 'r3.1': 100, rCutSmart: 10 }, incubationC: 25, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'TaqI': { activities: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 50, rCutSmart: 100 }, incubationC: 65, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'TfiI': { activities: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 65, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'TseI': { activities: { 'r1.1': 75, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 65, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: ['Star activity may result from a glycerol concentration above 5%.'] },
  'Tsp45I': { activities: { 'r1.1': 100, 'r2.1': 50, 'r3.1': 0, rCutSmart: 100 }, incubationC: 65, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'TspMI': { activities: { 'r1.1': 50, 'r2.1': 75, 'r3.1': 50, rCutSmart: 100 }, incubationC: 75, heatInactivation: 'Not heat inactivated', starBuffers: ['r1.1', 'r2.1', 'r3.1'], starNotes: [] },
  'TspRI': { activities: { 'r1.1': 25, 'r2.1': 50, 'r3.1': 25, rCutSmart: 100 }, incubationC: 65, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'Tth111I': { activities: { 'r1.1': 25, 'r2.1': 100, 'r3.1': 25, rCutSmart: 100 }, incubationC: 65, heatInactivation: 'Not heat inactivated', starBuffers: [], starNotes: [] },
  'WarmStart® Nt.BstNBI': { activities: { 'r1.1': 0, 'r2.1': 10, 'r3.1': 100, rCutSmart: 25 }, incubationC: 55, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
  'XbaI': { activities: { 'r1.1': 0, 'r2.1': 100, 'r3.1': 75, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'XcmI': { activities: { 'r1.1': 10, 'r2.1': 100, 'r3.1': 25, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: ['rCutSmart'], starNotes: ['Star activity may result from extended digestion.'] },
  'XhoI': { activities: { 'r1.1': 75, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'XmaI': { activities: { 'r1.1': 25, 'r2.1': 50, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: ['Star activity may result from a glycerol concentration above 5%.'] },
  'XmnI': { activities: { 'r1.1': 50, 'r2.1': 75, 'r3.1': 0, rCutSmart: 100 }, incubationC: 37, heatInactivation: '65°C for 20 minutes', starBuffers: [], starNotes: [] },
  'ZraI': { activities: { 'r1.1': 100, 'r2.1': 25, 'r3.1': 10, rCutSmart: 100 }, incubationC: 37, heatInactivation: '80°C for 20 minutes', starBuffers: [], starNotes: [] },
};

const BUFFER_ORDER: NebBufferName[] = ['rCutSmart', 'r3.1', 'r2.1', 'r1.1'];

const BUFFER_LABELS: Record<NebBufferName, string> = {
  'r1.1': 'NEBuffer r1.1',
  'r2.1': 'NEBuffer r2.1',
  'r3.1': 'NEBuffer r3.1',
  rCutSmart: 'rCutSmart Buffer',
};

const CONDITIONS_BY_NAME = new Map<string, EnzymeDigestCondition>(
  Object.entries(ENZYME_DIGEST_CONDITIONS).map(([name, condition]) => [
    name.toLowerCase(),
    condition,
  ]),
);

function conditionFor(enzyme: RestrictionEnzyme): EnzymeDigestCondition | undefined {
  return CONDITIONS_BY_NAME.get((enzyme.name ?? '').trim().toLowerCase());
}

function activityIn(
  enzyme: RestrictionEnzyme,
  buffer: NebBufferName,
): number {
  const condition = conditionFor(enzyme);
  if (condition) return condition.activities[buffer] ?? 0;
  return enzyme.nebBuffers?.[buffer] ?? 100;
}

function incubationTemperature(enzyme: RestrictionEnzyme): number {
  return conditionFor(enzyme)?.incubationC ?? 37;
}

function heatInactivationFor(enzyme: RestrictionEnzyme): string {
  return conditionFor(enzyme)?.heatInactivation ?? 'Not heat inactivated';
}

function bestBufferFor(enzyme: RestrictionEnzyme): {
  buffer: NebBufferName;
  activity: number;
} {
  let bestBuffer = BUFFER_ORDER[0];
  let bestActivity = -1;
  for (const buffer of BUFFER_ORDER) {
    const activity = activityIn(enzyme, buffer);
    if (activity > bestActivity) {
      bestActivity = activity;
      bestBuffer = buffer;
    }
  }
  return { buffer: bestBuffer, activity: Math.max(0, bestActivity) };
}

function starActivityWarnings(
  enzyme: RestrictionEnzyme,
  buffer: NebBufferName,
): string[] {
  const condition = conditionFor(enzyme);
  if (!condition) return [];
  const warnings: string[] = [];
  if (condition.starBuffers.includes(buffer)) {
    warnings.push(
      `${enzyme.name}: may exhibit star activity in ${BUFFER_LABELS[buffer]}.`,
    );
  }
  for (const note of condition.starNotes) {
    warnings.push(`${enzyme.name}: ${note}`);
  }
  return warnings;
}

function uniqueEnzymes(enzymes: RestrictionEnzyme[]): RestrictionEnzyme[] {
  const seen = new Set<string>();
  const result: RestrictionEnzyme[] = [];
  for (const enzyme of enzymes) {
    if (!enzyme || typeof enzyme.name !== 'string') continue;
    const key = enzyme.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(enzyme);
  }
  return result;
}

/**
 * Recommend a common NEBuffer for a double digest. A buffer is usable only
 * when every enzyme retains at least 75% activity. If no single buffer meets
 * that criterion the function returns a deterministic sequential-digest plan
 * with buffer, temperature and heat-inactivation guidance for each step.
 */
export function recommendDoubleDigestBuffer(
  enzymes: RestrictionEnzyme[],
): DoubleDigestRecommendation {
  const unique = uniqueEnzymes(enzymes);
  const temperatureC = [
    ...new Set(unique.map((enzyme) => incubationTemperature(enzyme))),
  ];
  const heatInactivation: Record<string, string> = {};
  for (const enzyme of unique) {
    heatInactivation[enzyme.name] = heatInactivationFor(enzyme);
  }

  if (unique.length === 0) {
    return {
      buffer: 'rCutSmart',
      activities: {},
      starActivityWarning: [],
      notes: ['No enzymes were supplied for the digest.'],
      temperatureC: [],
      heatInactivation,
    };
  }

  const candidates = BUFFER_ORDER.map((buffer) => {
    const activities = unique.map((enzyme) => activityIn(enzyme, buffer));
    return {
      buffer,
      activities,
      minimum: Math.min(...activities),
      total: activities.reduce((sum, value) => sum + value, 0),
    };
  });

  const eligible = candidates
    .filter((candidate) => candidate.minimum >= 75)
    .sort(
      (left, right) =>
        right.minimum - left.minimum ||
        right.total - left.total ||
        BUFFER_ORDER.indexOf(left.buffer) - BUFFER_ORDER.indexOf(right.buffer),
    );

  if (eligible.length > 0) {
    const chosen = eligible[0];
    const activities: Record<string, number> = {};
    unique.forEach((enzyme, index) => {
      activities[enzyme.name] = chosen.activities[index];
    });
    const warnings: string[] = [];
    const notes: string[] = [
      `All enzymes retain at least 75% activity in ${BUFFER_LABELS[chosen.buffer]}.`,
    ];
    for (const enzyme of unique) {
      warnings.push(...starActivityWarnings(enzyme, chosen.buffer));
    }
    if (temperatureC.length > 1) {
      notes.push(
        `Incubation temperatures differ (${temperatureC
          .map((temperature) => `${temperature}°C`)
          .join(', ')}); use the temperature recommended for each enzyme.`,
      );
    }
    if (chosen.minimum < 100) {
      notes.push(
        `The lowest activity in this buffer is ${chosen.minimum}%; increasing the enzyme amount or incubation time may be needed.`,
      );
    }
    return {
      buffer: chosen.buffer,
      activities,
      starActivityWarning: warnings,
      notes,
      temperatureC,
      heatInactivation,
    };
  }

  // Sequential digest: give each enzyme its own optimal buffer. Thermophilic
  // enzymes run first so that a later 37°C incubation does not require an
  // additional high-temperature step.
  const ordered = [...unique].sort((left, right) => {
    const temperatureDelta =
      incubationTemperature(right) - incubationTemperature(left);
    if (temperatureDelta !== 0) return temperatureDelta;
    const activityDelta =
      bestBufferFor(right).activity - bestBufferFor(left).activity;
    if (activityDelta !== 0) return activityDelta;
    return left.name.localeCompare(right.name);
  });

  const activities: Record<string, number> = {};
  const warnings: string[] = [];
  const notes: string[] = [
    'No single NEBuffer supports every enzyme at 75% activity or higher; perform a sequential digest.',
  ];

  ordered.forEach((enzyme, index) => {
    const best = bestBufferFor(enzyme);
    activities[enzyme.name] = best.activity;
    warnings.push(...starActivityWarnings(enzyme, best.buffer));
    notes.push(
      `Step ${index + 1}: digest with ${enzyme.name} in ${BUFFER_LABELS[best.buffer]} at ${incubationTemperature(enzyme)}°C (${best.activity}% activity).`,
    );
    if (index < ordered.length - 1) {
      const next = ordered[index + 1];
      const nextBest = bestBufferFor(next);
      const heat = heatInactivationFor(enzyme);
      if (heat === 'Not heat inactivated') {
        notes.push(
          `${enzyme.name} is not heat-inactivated under standard conditions; purify the DNA before switching to ${BUFFER_LABELS[nextBest.buffer]} for ${next.name}.`,
        );
      } else {
        notes.push(
          `Heat-inactivate ${enzyme.name} at ${heat}, then adjust the sample to ${BUFFER_LABELS[nextBest.buffer]} for ${next.name}.`,
        );
      }
    }
  });

  notes.push(
    'As an alternative to heat inactivation, purify the DNA with a spin column between the two digests.',
  );

  return {
    buffer: 'sequential',
    activities,
    starActivityWarning: [...new Set(warnings)],
    notes,
    temperatureC,
    heatInactivation,
  };
}

export interface DoubleDigestRecommendation {
  buffer: 'r1.1' | 'r2.1' | 'r3.1' | 'rCutSmart' | 'sequential';
  activities: Record<string, number>;
  starActivityWarning: string[];
  notes: string[];
  temperatureC: number[];
  heatInactivation: Record<string, string>;
}
