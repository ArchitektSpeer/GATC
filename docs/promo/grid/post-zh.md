GATC：开源的分子克隆工作台，网页打开即用，未发表的序列不出本机。

读写 SnapGene 的 .dna，质粒图谱、酶切与虚拟电泳、引物设计、Gibson/Golden Gate/Gateway 等克隆模拟、Sanger 与多序列比对；构建历史可导出带断言的 pydna 脚本，可随文发表，跑一遍即是复核。

底层基于 Teselagen bio-parsers、seqviz 等成熟开源组件，酶库数据源自 REBASE；算法自行实现并逐项对照 Biopython、primer3、pydna 验证：Tm 最大偏差 0.00 °C、切点 5592/5592 一致，未覆盖范围同样列明。

GPL-3.0，无席位限制，整组共用也不另计费。作为参照，同类商业软件按席位年费订阅，官网现价学术版单席位 350 美元/年、10 席位 3,250 美元/年（2026-10-29 查）。

SnapGene 为 Dotmatics 商标，本项目为独立实现，与其无关联。

在线 https://architektspeer.github.io/GATC/
源码（GPL-3.0） https://github.com/ArchitektSpeer/GATC
