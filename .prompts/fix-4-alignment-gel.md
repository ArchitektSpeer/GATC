你负责维护 `src/modules/alignment-gel/`（OpenSnapGene 的 Sanger/电泳模块）。只允许修改该目录下的文件；禁止修改 `src/types/schema.ts`、其他模块、`src/app/`、package.json；禁止 npm install。代码与注释中不得出现作者署名或 AI 工具名称，不得有 TODO。不得改变已导出函数签名。

## 问题（真实 .ab1 文件评测发现）
真实文件 TeselaGen `example1.ab1`（1345 bases）的 PCON 标签不含有效质量值（全部 ≤ 1），`parseAb1Trace` 因此回退到 `abif.ts` 的 `estimateQualities`。但回退估算只看主峰相对全局最大峰的高度：
- 碱基为 `N` 的位置仍得到 Q≈30（读长 3' 端 `CCNNNGGGGTTTTTTTNCCCAAANGNGG...` 平均 Q 仍 > 20）；
- 因此 `mottTrim` 对整条读长返回 `[0, 1345]`，完全没有修剪，而真实读长两端明显是低质量区。

## 要求
1. 改进 `estimateQualities`，使其接近 Phred/KB basecaller 的行为：
   - 非 ACGT 的调用（N 及 IUPAC 简并码）质量 ≤ 5；
   - 结合主峰与次高峰比值（signal-to-noise / peak-ratio，比值越接近 1 质量越低）、局部峰间距均匀性（与相邻峰间距中位数的偏差）以及局部信号强度（相对窗口内中位峰高，而非全局最大峰）；
   - 输出范围 0–62，读长中部高质量区通常应为 Q30–Q60。
2. `mottTrim` 保持 Mott 算法定义（累计 `errorThreshold - 10^(-Q/10)` 的最大子段和），确认在上述估算质量下能裁掉两端低质量区。
3. 在 `alignment-gel.test.ts` 中新增测试：用 `node:fs` 读取环境变量 `AB1_SAMPLE` 指向的真实文件（若变量未设置或文件不存在则 `it.skip`），断言 3' 末端 60 个碱基的平均质量 < 20、`trimRange[1] - trimRange[0]` < 1345 且 > 600；另外用纯合成数据（不依赖外部文件）测试：含 N 的位置 Q ≤ 5、主次峰比 0.9 的位置质量明显低于比值 0.1 的位置。
4. 完成后必须通过：`AB1_SAMPLE=test-data/example1.ab1 npx vitest run src/modules/alignment-gel` 全部通过，`npx tsc --noEmit -p tsconfig.json 2>&1 | grep src/modules/alignment-gel` 无输出。
