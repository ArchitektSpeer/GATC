你负责维护 `src/modules/cloning-primer/`（OpenSnapGene 的引物热力学与克隆模拟模块）。只允许修改该目录下的文件；禁止修改 `src/types/schema.ts`、其他模块、`src/app/`、package.json；禁止 npm install。代码与注释中不得出现作者署名或 AI 工具名称，不得有 TODO。不得改变任何已导出函数的签名。

## 问题（与官方 Primer3 2.x / primer3-py 对比的集成评测结果）
`evaluateOligoThermodynamics` 的 Tm 已与 Primer3 完全一致（保持不变，不要改 Tm 计算）。但二级结构自由能偏差较大：

条件：50 mM Na+、2 mM Mg2+、0.8 mM dNTP、250 nM oligo、37 °C。

| 序列 | Primer3 hairpin ΔG | 当前 hairpin | Primer3 homodimer ΔG | 当前 selfDimer |
|---|---|---|---|---|
| AGCGGATAACAATTTCACACAGGA | 0.00 | 0.00 | -2.36 | -2.93 |
| GTAAAACGACGGCCAGT | 0.00 | 0.00 | -5.48 | -4.80 |
| TAATACGACTCACTATAGGG | 0.00 | 0.00 | -4.48 | -3.16 |
| CAGGAAACAGCTATGAC | 0.00 | 0.00 | -3.04 | -3.72 |
| ATGGTGAGCAAGGGCGAGGAG | -0.64 | 0.00 | -2.74 | 0.00 |
| TTACTTGTACAGCTCGTCCATGCC | 0.00 | 0.00 | -3.46 | -6.86 |

（Primer3 中 hairpin/dimer 若无稳定结构则 ΔG 报告为 0。）

## 要求
- 参考 Primer3 `thal`（thermodynamic alignment）的思路重写 `hairpinDeltaG`、`selfDimerDeltaG` 与 `calcCrossDimer`：SantaLucia & Hicks 2004 最邻近堆积参数、内部错配/末端错配(terminal mismatch)、悬垂端(dangling ends)、内环/凸环/发夹环的环长惩罚与 Jacobson–Stockmayer 外推、发夹最小环 3 nt；ΔG 在 37 °C 计算并做与 Tm 相同的盐校正。DP 必须为 O(n^2)~O(n^3) 且 30-mer < 5 ms。
- 在 `cloning-primer.test.ts` 新增上表 6 条序列的断言：hairpin 与 homodimer 与 Primer3 的绝对偏差均 ≤ 1.0 kcal/mol；ASCII 配对图仍正确输出。
- 已有测试必须继续全部通过（如个别旧测试的 ΔG 预期值与 Primer3 冲突，以 Primer3 为准更新）。
- 完成后必须通过：`npx vitest run src/modules/cloning-primer` 全部通过，且 `npx tsc --noEmit -p tsconfig.json 2>&1 | grep src/modules/cloning-primer` 无输出。
