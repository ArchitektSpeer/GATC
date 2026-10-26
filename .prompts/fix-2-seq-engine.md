你负责维护 `src/modules/seq-engine/`（OpenSnapGene 的序列引擎模块）。只允许修改该目录下的文件；禁止修改 `src/types/schema.ts`、其他模块、`src/app/`、package.json；禁止 npm install。代码与注释中不得出现作者署名或 AI 工具名称，不得有 TODO。

## 问题（集成评测发现）
用真实 pUC19（NCBI L09137，文件 `src/app/samples/pUC19.gb`，2686 bp）调用 `autoAnnotateFeatures` 只得到 4 个特征：`lacUV5 promoter`、`ColE1/pUC ori`、`AmpR (bla)`、`AmpR promoter`。
1. pUC19 携带的是**野生型 lac promoter**，而不是 lacUV5（两者 -10 区仅差 2 bp）。容错匹配把它错标成了 lacUV5。
2. 缺失 pUC19 的标志性元件：**lacZα**（CDS，反向链）、**lac operator**、**CAP binding site**、**M13 fwd / M13 rev 引物结合位点**（primer_bind），以及 pUC19 MCS（misc_feature，可选）。
3. 建议同时补充其他常用质粒常见元件（如 T7 promoter/terminator、T3、SP6 promoter、lac promoter、araBAD promoter、tac promoter、RBS 等），全部使用真实公开序列（可以通过 NCBI efetch 获取，例如 L09137、U55762、X65315 等）。

## 要求
- 匹配策略：同一区域有多个候选（如 lac 与 lacUV5）时，必须选择同一性最高者；精确匹配优先于容错匹配；对相似元件只保留最佳一个。
- 在 `seq-engine.test.ts` 中新增测试：读取 `src/app/samples/pUC19.gb`（用 `node:fs` 读取文本，并在测试内用简单的 ORIGIN 段解析提取序列，**不得导入其他模块**），断言注释结果包含 `lacZα`（名称可含 lacZ）、`lac promoter`（且不含 lacUV5）、`lac operator`、`M13 fwd`、`M13 rev`、`AmpR`、`ori`；同时 pEGFP-N1（`src/app/samples/pEGFP-N1.gb`）仍能注释出 EGFP、CMV promoter、SV40 polyA、KanR/NeoR、f1 ori、SV40 ori。
- 性能：100 kb 序列 `autoAnnotateFeatures` 仍需 < 30 ms。
- 完成后必须通过：`npx vitest run src/modules/seq-engine` 全部通过，且 `npx tsc --noEmit -p tsconfig.json 2>&1 | grep src/modules/seq-engine` 无输出。
