GATC 第三阶段更新

GATC 是一个纯前端的分子克隆工作台，可直接读写 SnapGene 的 .dna 文件，
计算全部在浏览器内完成，不上传数据。本次更新：

· 多步克隆方案的沙盒推演：把一条路线写成有向无环图（12 种操作），
  每步调用与对应向导相同的引擎逐步计算，确认后才写入工作区。
· 测序异常归因：只依据 Phred 与高质量区、引物在分子上的足迹、连接边界
  三类可核对的证据作判断；证据不足的改动标注为「未能归因」，不作推测。
· 比对内核改用 WebAssembly（3.6 kB，随应用打包、可离线），实测约为原
  JavaScript 实现的 3.5 倍；保留等价 JavaScript 实现作回退，并有测试
  要求二者逐格相等。
· 崩溃恢复快照按内容寻址分块（64 kB），重复保存只写改动的块。

498 项单元测试、浏览器走查 40/40 且无控制台错误。

下一步计划把更多生物信息学开源工具整合进同一平台，并通过 MCP 统一暴露，
供 Agent 直接调用；项目现有的 MCP 服务器已提供 15 个工具。

在线使用：https://architektspeer.github.io/GATC/
源码（GPL-3.0）：https://github.com/ArchitektSpeer/GATC
MCP 说明：https://github.com/ArchitektSpeer/GATC/blob/main/docs/MCP.md

注：SnapGene 为 Dotmatics 的商标，本项目为独立实现，与其无关联。
