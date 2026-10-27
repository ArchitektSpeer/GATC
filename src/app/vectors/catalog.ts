// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// The built-in vector catalogue.
//
// Every entry names an authoritative GenBank accession, so each sequence is traceable and
// freely redistributable. Vectors whose only published sequence comes from a vendor
// (pET-28a, pcDNA3.1, pQE, pGEM-T and the like) have no such record and are deliberately
// absent; GATC fetches those by accession or opens the vendor's own file instead.
//
// Entries marked `bundled` ship as GenBank files under ./data and open with no network.
// The SEVA collection is catalogued by accession only and fetched on demand; that
// name-to-accession mapping comes from OpenCloning (MIT), see THIRD-PARTY-NOTICES.md.

export type VectorCategory =
  | 'cloning'
  | 'bacterial-expression'
  | 'mammalian'
  | 'yeast'
  | 'plant-broadhost'
  | 'seva';

export interface VectorEntry {
  /** Stable id; for a bundled vector it is also the GenBank file's basename. */
  id: string;
  name: string;
  accession: string;
  /** Length from the record's LOCUS line; 0 when the record has not been fetched yet. */
  lengthBp: number;
  category: VectorCategory;
  host: string;
  markers: string[];
  notes: string;
  /** True when the sequence ships with GATC and opens offline. */
  bundled: boolean;
}

export const VECTOR_CATEGORIES: { value: VectorCategory; label: string }[] = [
  { value: 'cloning', label: '通用克隆' },
  { value: 'bacterial-expression', label: '原核表达' },
  { value: 'mammalian', label: '哺乳动物' },
  { value: 'yeast', label: '酵母' },
  { value: 'plant-broadhost', label: '植物与广宿主' },
  { value: 'seva', label: 'SEVA 标准载体' },
];

const BUNDLED: VectorEntry[] = [
  { id: 'pUC19', name: 'pUC19', accession: 'L09137', lengthBp: 2686, category: 'cloning', host: '大肠杆菌', markers: ['AmpR'], notes: '高拷贝克隆载体，lacZα 蓝白斑筛选，pUC ori', bundled: true },
  { id: 'pUC18', name: 'pUC18', accession: 'L09136', lengthBp: 2686, category: 'cloning', host: '大肠杆菌', markers: ['AmpR'], notes: '同 pUC19，多克隆位点方向相反', bundled: true },
  { id: 'pBR322', name: 'pBR322', accession: 'J01749', lengthBp: 4361, category: 'cloning', host: '大肠杆菌', markers: ['AmpR', 'TetR'], notes: '经典中拷贝载体，双抗性，许多载体的骨架来源', bundled: true },
  { id: 'pACYC184', name: 'pACYC184', accession: 'X06403', lengthBp: 4245, category: 'cloning', host: '大肠杆菌', markers: ['CmR', 'TetR'], notes: 'p15A 复制子，可与 ColE1 质粒共存', bundled: true },
  { id: 'pACYC177', name: 'pACYC177', accession: 'X06402', lengthBp: 3941, category: 'cloning', host: '大肠杆菌', markers: ['AmpR', 'KanR'], notes: 'p15A 复制子，与 pACYC184 配套的另一组抗性', bundled: true },
  { id: 'pBluescript-II-SK-plus', name: 'pBluescript II SK(+)', accession: 'X52328', lengthBp: 2961, category: 'cloning', host: '大肠杆菌', markers: ['AmpR'], notes: '噬菌粒，T3/T7 启动子，可产单链 DNA', bundled: true },
  { id: 'pBluescript-II-KS-plus', name: 'pBluescript II KS(+)', accession: 'X52327', lengthBp: 2961, category: 'cloning', host: '大肠杆菌', markers: ['AmpR'], notes: '同 SK(+)，多克隆位点方向相反', bundled: true },
  { id: 'pGEM-3Zf-plus', name: 'pGEM-3Zf(+)', accession: 'X65306', lengthBp: 3197, category: 'cloning', host: '大肠杆菌', markers: ['AmpR'], notes: 'SP6/T7 启动子，体外转录常用', bundled: true },
  { id: 'pGEM-5Zf-plus', name: 'pGEM-5Zf(+)', accession: 'X65308', lengthBp: 3000, category: 'cloning', host: '大肠杆菌', markers: ['AmpR'], notes: 'SP6/T7 启动子，含 ApaI/SphI 等稀有位点', bundled: true },
  { id: 'pSP64', name: 'pSP64', accession: 'X65327', lengthBp: 2999, category: 'cloning', host: '大肠杆菌', markers: ['AmpR'], notes: 'SP6 启动子，经典体外转录载体', bundled: true },
  { id: 'pTZ19R', name: 'pTZ19R', accession: 'Y14835', lengthBp: 2862, category: 'cloning', host: '大肠杆菌', markers: ['AmpR'], notes: '噬菌粒，f1 ori，T7 启动子', bundled: true },
  { id: 'pWSK29', name: 'pWSK29', accession: 'AF016889', lengthBp: 5434, category: 'cloning', host: '大肠杆菌', markers: ['AmpR'], notes: 'pSC101 低拷贝，适合毒性基因与基因剂量实验', bundled: true },

  { id: 'pGEX-4T-1', name: 'pGEX-4T-1', accession: 'U13853', lengthBp: 4969, category: 'bacterial-expression', host: '大肠杆菌', markers: ['AmpR'], notes: 'GST 融合表达，tac 启动子，凝血酶切割位点', bundled: true },
  { id: 'pGEX-6P-1', name: 'pGEX-6P-1', accession: 'U78872', lengthBp: 4984, category: 'bacterial-expression', host: '大肠杆菌', markers: ['AmpR'], notes: 'GST 融合表达，PreScission 蛋白酶切割位点', bundled: true },
  { id: 'pTrc99A', name: 'pTrc99A', accession: 'M22744', lengthBp: 4176, category: 'bacterial-expression', host: '大肠杆菌', markers: ['AmpR'], notes: 'trc 启动子，IPTG 诱导，不需要 T7 聚合酶菌株', bundled: true },
  { id: 'pBAD24', name: 'pBAD24', accession: 'X81837', lengthBp: 4542, category: 'bacterial-expression', host: '大肠杆菌', markers: ['AmpR'], notes: 'araBAD 启动子，阿拉伯糖剂量可调，本底极低', bundled: true },
  { id: 'pBAD33', name: 'pBAD33', accession: 'LC760188', lengthBp: 5352, category: 'bacterial-expression', host: '大肠杆菌', markers: ['CmR'], notes: 'araBAD 启动子 + p15A 复制子，可与 pBAD24 共转', bundled: true },
  { id: 'pET-3a', name: 'pET-3a', accession: 'LT727576', lengthBp: 4640, category: 'bacterial-expression', host: '大肠杆菌', markers: ['AmpR'], notes: 'T7 启动子，最早的 pET 系列，无标签', bundled: true },
  { id: 'pET-11a', name: 'pET-11a', accession: 'LT727489', lengthBp: 5677, category: 'bacterial-expression', host: '大肠杆菌', markers: ['AmpR'], notes: 'T7 lac 启动子，需 DE3 溶原菌株', bundled: true },
  { id: 'pGFPuv', name: 'pGFPuv', accession: 'U62636', lengthBp: 3337, category: 'bacterial-expression', host: '大肠杆菌', markers: ['AmpR'], notes: 'UV 优化的 GFP，常用作表达与转化阳性对照', bundled: true },

  { id: 'pEGFP-N1', name: 'pEGFP-N1', accession: 'U55762', lengthBp: 4733, category: 'mammalian', host: '哺乳动物细胞', markers: ['KanR/NeoR'], notes: 'CMV 启动子，目的基因融合在 EGFP 的 N 端', bundled: true },
  { id: 'pEGFP-C1', name: 'pEGFP-C1', accession: 'U55763', lengthBp: 4731, category: 'mammalian', host: '哺乳动物细胞', markers: ['KanR/NeoR'], notes: 'CMV 启动子，目的基因融合在 EGFP 的 C 端', bundled: true },
  { id: 'pGL3-Basic', name: 'pGL3-Basic', accession: 'U47295', lengthBp: 4818, category: 'mammalian', host: '哺乳动物细胞', markers: ['AmpR'], notes: '无启动子萤火虫荧光素酶报告载体，用于启动子活性检测', bundled: true },

  { id: 'pRS313', name: 'pRS313', accession: 'U03439', lengthBp: 4967, category: 'yeast', host: '酿酒酵母', markers: ['HIS3', 'AmpR'], notes: 'CEN/ARS 单拷贝穿梭载体', bundled: true },
  { id: 'pRS314', name: 'pRS314', accession: 'U03440', lengthBp: 4783, category: 'yeast', host: '酿酒酵母', markers: ['TRP1', 'AmpR'], notes: 'CEN/ARS 单拷贝穿梭载体', bundled: true },
  { id: 'pRS315', name: 'pRS315', accession: 'U03441', lengthBp: 6018, category: 'yeast', host: '酿酒酵母', markers: ['LEU2', 'AmpR'], notes: 'CEN/ARS 单拷贝穿梭载体', bundled: true },
  { id: 'pRS316', name: 'pRS316', accession: 'U03442', lengthBp: 4887, category: 'yeast', host: '酿酒酵母', markers: ['URA3', 'AmpR'], notes: 'CEN/ARS 单拷贝穿梭载体，可用 5-FOA 反筛', bundled: true },
  { id: 'pRS425', name: 'pRS425', accession: 'U03452', lengthBp: 6849, category: 'yeast', host: '酿酒酵母', markers: ['LEU2', 'AmpR'], notes: '2μ 高拷贝穿梭载体', bundled: true },
  { id: 'pRS426', name: 'pRS426', accession: 'U03451', lengthBp: 5726, category: 'yeast', host: '酿酒酵母', markers: ['URA3', 'AmpR'], notes: '2μ 高拷贝穿梭载体', bundled: true },

  { id: 'pCAMBIA1301', name: 'pCAMBIA1301', accession: 'AF234297', lengthBp: 11849, category: 'plant-broadhost', host: '植物（农杆菌介导）', markers: ['HygR', 'KanR'], notes: '双元载体，T-DNA 边界 + GUS 报告基因', bundled: true },
  { id: 'pBI121', name: 'pBI121', accession: 'AF485783', lengthBp: 14758, category: 'plant-broadhost', host: '植物（农杆菌介导）', markers: ['KanR'], notes: '双元载体，CaMV 35S 驱动 GUS，植物转化经典对照', bundled: true },
  { id: 'pBBR1MCS', name: 'pBBR1MCS', accession: 'U02374', lengthBp: 4707, category: 'plant-broadhost', host: '广宿主革兰氏阴性菌', markers: ['CmR'], notes: '广宿主复制子，可动员，适用于多种非模式细菌', bundled: true },
];

// pSEVA name -> GenBank accession. Fetched on demand, not shipped.
const SEVA: [string, string][] = [
  ['pSEVA111', 'JX560321'],
  ['pSEVA211', 'JX560326'],
  ['pSEVA311', 'JX560331'],
  ['pSEVA411', 'JX560336'],
  ['pSEVA511', 'JX560341'],
  ['pSEVA611', 'JX560346'],
  ['pSEVA121', 'JX560322'],
  ['pSEVA221', 'JX560327'],
  ['pSEVA321', 'JX560332'],
  ['pSEVA421', 'JX560337'],
  ['pSEVA521', 'JX560342'],
  ['pSEVA621', 'JX560347'],
  ['pSEVA131', 'JX560323'],
  ['pSEVA231', 'JX560328'],
  ['pSEVA331', 'JX560333'],
  ['pSEVA431', 'JX560338'],
  ['pSEVA531', 'JX560343'],
  ['pSEVA631', 'JX560348'],
  ['pSEVA141', 'JX560324'],
  ['pSEVA241', 'JX560329'],
  ['pSEVA341', 'JX560334'],
  ['pSEVA441', 'JX560339'],
  ['pSEVA541', 'JX560344'],
  ['pSEVA641', 'JX560349'],
  ['pSEVA151', 'JX560325'],
  ['pSEVA251', 'JX560330'],
  ['pSEVA351', 'JX560335'],
  ['pSEVA451', 'JX560340'],
  ['pSEVA551', 'JX560345'],
  ['pSEVA651', 'JX560350'],
  ['pSEVA132', 'JX560351'],
  ['pSEVA232', 'JX560355'],
  ['pSEVA432', 'JX560363'],
  ['pSEVA532', 'JX560367'],
  ['pSEVA632', 'JX560371'],
  ['pSEVA133', 'JX560352'],
  ['pSEVA233', 'JX560356'],
  ['pSEVA333', 'JX560360'],
  ['pSEVA433', 'JX560364'],
  ['pSEVA533', 'JX560368'],
  ['pSEVA633', 'JX560372'],
  ['pSEVA142', 'JX560353'],
  ['pSEVA242', 'JX560357'],
  ['pSEVA342', 'JX560361'],
  ['pSEVA442', 'JX560365'],
  ['pSEVA542', 'JX560369'],
  ['pSEVA642', 'JX560373'],
  ['pSEVA143', 'JX560354'],
  ['pSEVA243', 'JX560358'],
  ['pSEVA343', 'JX560362'],
  ['pSEVA443', 'JX560366'],
  ['pSEVA543', 'JX560370'],
  ['pSEVA643', 'JX560374'],
  ['pSEVA112S', 'JX560375'],
  ['pSEVA212S', 'JX560376'],
  ['pSEVA312S', 'JX560377'],
  ['pSEVA412S', 'JX560378'],
  ['pSEVA512S', 'JX560379'],
  ['pSEVA612S', 'JX560380'],
  ['pSEVA114', 'JX560381'],
  ['pSEVA214', 'JX560382'],
  ['pSEVA414', 'JX560384'],
  ['pSEVA514', 'JX560385'],
  ['pSEVA614', 'JX560386'],
  ['pSEVA224', 'KC847291'],
  ['pSEVA424', 'KC847293'],
  ['pSEVA234', 'KC847292'],
  ['pSEVA434', 'KC847294'],
  ['pSEVA228', 'JX560388'],
  ['pSEVA328', 'JX560389'],
  ['pSEVA238', 'KC847295'],
  ['pSEVA338', 'KC847296'],
  ['pSEVA438', 'KC847297'],
  ['pSEVA225', 'JX560393'],
  ['pSEVA235', 'JX560394'],
  ['pSEVA245', 'JX560395'],
  ['pSEVA225T', 'KC847299'],
  ['pSEVA226', 'JX560396'],
  ['pSEVA236', 'JX560397'],
  ['pSEVA246', 'JX560398'],
  ['pSEVA256', 'KC847298'],
  ['pSEVA227Y', 'JX560399'],
  ['pSEVA237Y', 'JX560400'],
  ['pSEVA247Y', 'JX560401'],
  ['pSEVA227C', 'JX560402'],
  ['pSEVA237C', 'JX560403'],
  ['pSEVA247C', 'JX560404'],
  ['pSEVA227D', 'JX560405'],
  ['pSEVA237D', 'JX560406'],
  ['pSEVA247D', 'JX560407'],
  ['pSEVA227R', 'JX560408'],
  ['pSEVA237R', 'JX560409'],
  ['pSEVA247R', 'JX560410'],
  ['pSEVA2214', 'MH650998'],
  ['pSEVA2314', 'MH650997'],
  ['pSEVA2514', 'MH638301'],
  ['pSEVA2215', 'OP405364'],
  ['pSEVA234C', 'OM855579'],
  ['pSEVA2320', 'OP405359'],
  ['pSEVA2321', 'OP405360'],
  ['pSEVA2322', 'OP405361'],
  ['pSEVA2323', 'OP405362'],
  ['pSEVA2324', 'OP405363'],
  ['pSEVA2a2d1', 'OP272536'],
  ['pSEVA3a2d1', 'OP272537'],
];

export const VECTOR_LIBRARY: VectorEntry[] = [
  ...BUNDLED,
  ...SEVA.map(([name, accession]) => ({
    id: name,
    name,
    accession,
    // SEVA records are not shipped, so the length is only known once one is fetched.
    lengthBp: 0,
    category: 'seva' as const,
    host: '广宿主革兰氏阴性菌',
    markers: [],
    notes: 'SEVA 标准载体，按登录号从 NCBI 获取',
    bundled: false,
  })),
];
