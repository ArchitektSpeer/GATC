你负责维护 `src/modules/cloning-primer/`（OpenSnapGene 引物热力学与克隆模拟模块，MIT 许可）。只允许修改该目录下的文件；禁止修改 `src/types/schema.ts`、其他模块、`src/app/`、`test-data/`、package.json；禁止 npm install。代码与注释中不得出现作者署名或 AI 工具名称，不得有 TODO。不得改变任何已导出函数签名。

## 洁净室（Clean-room）实现的硬性约束 —— 违反即视为失败
本项目采用 MIT 许可，因此：
- **严禁**查看、检索、下载或回忆复现任何 GPL/LGPL/非宽松许可的热力学代码，包括但不限于 Primer3（`thal.c`、`oligotm.c`、`thal_parameters`）、ViennaRNA、UNAFold/mfold、NUPACK、RNAstructure、MELTING、OligoCalc 源码。
- **禁止任何网络访问**（不使用 WebFetch / WebSearch / curl / wget），禁止读取 `/tmp`、`.build-logs/`、`site-packages`、`/usr/share`、`/usr/include` 等目录。
- 只能依据已发表文献中的物理模型与参数（这些是科学事实）自行设计数据结构与动态规划：SantaLucia & Hicks (2004) *Annu. Rev. Biophys. Biomol. Struct.* 33:415 的 Watson-Crick 堆积、内部错配、末端错配、悬垂端、发夹/内环/凸环长度惩罚与 Jacobson–Stockmayer 外推；SantaLucia (1998) 统一参数；Owczarzy et al. (2008) 盐校正（已在 `thermo.ts` 中实现，复用即可）。
- 参数表必须以你自己的结构表达（例如按 `"AT/TA"` 形式的字典或小型查表函数），并在文件头注释中注明所依据的文献。

## 任务
`evaluateOligoThermodynamics` 的 Tm 已与参考实现一致，**保持 Tm 计算完全不变**。当前 `hairpinDeltaG`、`selfDimerDeltaG` 与 `calcCrossDimer` 使用的简化模型误差过大（最多偏差 3.4 kcal/mol，且漏检部分结构）。请用基于上述文献的最小自由能动态规划重写二级结构预测：
- 发夹：最小环长 3 nt；包含堆积、末端错配、单/多核苷酸凸环、内环、发夹环惩罚；返回最稳定结构的 ΔG(37 °C)，若无比 0 更稳定的结构则返回 0。
- 二聚体（同源与异源）：两条链任意偏移的局部双链比对，包含起始自由能、堆积、内部错配/内环、末端错配与悬垂端；返回最稳定结构 ΔG，无稳定结构返回 0。
- ΔG 做与 Tm 相同的盐/Mg2+ 有效浓度熵校正（0.368·N·ln[Na+eq] 的形式）。
- ASCII 配对图继续正确输出。
- 性能：30-mer 发夹 + 二聚体合计 < 10 ms。

## 验收（测试）
`test-data/primer3-reference.json` 含 46 条寡核苷酸在 50 mM Na+ / 2 mM Mg2+ / 0.8 mM dNTP / 250 nM 条件下的参考输出值（仅数值，不含代码）。在 `cloning-primer.test.ts` 新增测试读取该 JSON（用 `node:fs`），断言：
- Tm 偏差全部 ≤ 0.1 °C；
- hairpin 与 homodimer ΔG：≥ 90% 的寡核苷酸绝对偏差 ≤ 1.0 kcal/mol，且全部 ≤ 2.0 kcal/mol；
- 参考值为 0 的条目，预测值需 ≥ -1.0。
已有测试必须继续全部通过（与参考数据冲突的旧 ΔG 预期以参考数据为准更新）。

完成后必须通过：`npx vitest run src/modules/cloning-primer` 全部通过，`npx tsc --noEmit -p tsconfig.json 2>&1 | grep src/modules/cloning-primer` 无输出。
