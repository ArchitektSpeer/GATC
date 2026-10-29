GATC 第三阶段更新：多步克隆方案的沙盒推演与测序异常归因

GATC（Gene Assembly & Toolkit for Cloning）是一个纯前端的分子克隆工作台，
可直接读写 SnapGene 的 .dna 文件，全部计算在浏览器内完成，不上传任何数据。
本次更新完成路线图第三阶段，共四项。

一、多步克隆方案的沙盒推演

把一条克隆路线描述为有向无环图，节点为 12 种操作：PCR、酶切、末端处理、
连接、Gibson、Golden Gate、引物退火、定点突变、Gateway BP/LR、位点特异性
重组，以及诊断性酶切。每一步调用与对应向导相同的引擎，按拓扑序逐步计算；
某一步失败只中断依赖它的分支，其余分支继续。全部算完并经使用者确认后，
产物才写入工作区。方案可手写，也可由内置的 AI 助手给出——后者的输出先在
模块层校验结构，再在应用层对照当前已打开的文档校验名称与酶是否真实存在。

二、测序异常归因

先将逐碱基错配合并为事件（例如连续 3 bp 缺失计为一个事件，这决定编码区
是否移码），再依据三类可核对的证据归因：该位点的 Phred 质量值与 Mott 修剪
得到的高质量区、引物在分子上的足迹（5′ 尾与退火区分别判定）、以及连接边界
的位置。连接边界取自克隆历史中记录的酶在产物上的实际位点；Golden Gate 与
Gibson 不保留识别位点，界面因此明确声明不对该类作判断，并允许手工补充坐标。
三类证据均不支持的改动一律标注为「未能归因」，不给出推测性解释。

三、比对内核的 WebAssembly 实现

Sanger 比对的 Gotoh 局部比对、读长比对的带状半全局比对、多序列比对的
profile–profile 一遍，三个内层循环以 C 编写，经 clang 的 wasm32 目标编译为
3.6 kB 模块，随应用打包、不依赖 CDN、可离线运行。本机实测约为原 JavaScript
实现的 3.5 倍（1500×1500 矩阵：103 ms 对 363 ms）。每个内核保留等价的
JavaScript 实现作为回退，并有测试要求二者在全部得分矩阵与指针矩阵上逐格相等。

四、崩溃恢复快照的分块存储

快照按内容寻址（SHA-256）切分为 64 kB 块，重复保存只写入发生变化的块；
缺块或总长度不符时拒绝返回部分内容，而不是读回一个看似完整的工程。

验证

498 项单元测试、浏览器端走查 40/40 且无控制台错误。与 Biopython、REBASE、
primer3、pydna 的交叉验证逐项结果见下方 CROSSCHECK 文档。

下一步

计划把更多生物信息学开源工具整合进同一平台，并通过 Model Context Protocol
(MCP) 统一对外暴露，使 Agent 与其他工具链可以直接调用。项目目前已有的 MCP
服务器提供 15 个工具（序列文件读写、酶切位点、引物设计、PCR / Gibson /
Golden Gate 模拟、ORF 查找、特征注释、Sanger 比对等），以本地进程经 stdio
通信，不向外发送数据。

在线使用：https://architektspeer.github.io/GATC/
源码（GPL-3.0）：https://github.com/ArchitektSpeer/GATC
交叉验证明细：https://github.com/ArchitektSpeer/GATC/blob/main/docs/CROSSCHECK.md
MCP 服务器说明：https://github.com/ArchitektSpeer/GATC/blob/main/docs/MCP.md

注：SnapGene 为 Dotmatics 的商标，本项目为独立实现，与其无关联。
