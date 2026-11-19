# 独立证据复核

## 结论

**有条件通过，可用于主报告整合，不足以批准产品改动。** 六个子问题均有材料覆盖，评估体系与精确发布历史的证据深度不足。主线应是“保留已有 Agent 架构，先补审批安全边界、取消传播和辅助调用计量”，不是追版本或重写框架。

**滚动文档不等于 2026 新增；npm latest 可独立证明，精确发布时间本复核未独立重验；F0 是已记录的纯函数误放行，不是端到端越权执行复现。**

| 复核项 | 结果 |
| --- | --- |
| 输入 | 完整阅读 `research/ai-agent-sdk-update-2026-11/brief.md` 及 `research/ai-agent-sdk-update-2026-11/findings/F0.md`—`research/ai-agent-sdk-update-2026-11/findings/F3.md` |
| 独立取证 | 复读 7 个既有外部 URL；核对本地声明/安装 package.json、审批纯函数、core 审批调用片段、desktop 审批闸与摘要函数/写回片段 |
| 来源预算 | F1 6＋F2 7＝去重 **13 / 15**；F0/F3 无新增外部引用；本复核不新增来源，不把网页里的未跟随链接当证据 |
| 时间口径 | 复核与访问日 2026-11-19；近期窗口 2026-05-19—2026-11-19；页面访问日不作发布日期 |
| 操作边界 | 仅写本文件；未 Git、安装、跑测试、执行示例命令或调用真实模型；未读取数据库、凭据。不是完整安全审计或产品验收 |

## 六个子问题覆盖与可用结论

| 子问题 | 材料与覆盖度 | 主报告可用结论 | 缺口 |
| --- | --- | --- | --- |
| 1 稳定版本与 API | F1＋F3，基本覆盖 | latest 非预发布包为 7.0.177；Zen 声明/安装为 7.0.169；同 minor 的补丁编号差 8，不能称落后一个大版本 | 未逐项核对 API 引入版本、8 个补丁价值；精确发布时间依赖 F1 解析记录 |
| 2 审批、校验、预算、取消 | F0＋F1＋F3，覆盖较好 | SDK 有明确机制；Zen 已用原生审批、schema 修复和取消；外层循环无 run 总步数上限 | 完整审批路径回归、MCP/摘要取消夹具、可选全局预算语义 |
| 3 上下文、动态工具、缓存 | F2＋F3，覆盖 | 官方当前有分层上下文和按需工具机制；Zen 已有压缩、回放和 cache 断点 | 当前厂商适配/稳定状态、真实缓存收益、工具 schema token 基线 |
| 4 恢复、观测、评估、多 Agent | F2＋F3，部分深度不足 | Python SDK 可作恢复/编排设计参照；Zen 已有消息恢复、usage、多 Agent 调度 | 未核验完整 evaluator API/数据集；消息恢复不等于 durable workflow 或副作用 exactly-once |
| 5 本地能力及测试定位 | F3＋F0，覆盖较好 | 不能把 ToolLoopAgent、审批、结构化修复、压缩、多 Agent、usage 列作缺失 | F0 测试是主体记录，本复核未重跑；无真实供应商及三平台验收 |
| 6 排序与验证方案 | 全部材料，覆盖 | 可提出不迁框架的小范围首批方案 | 需把 F2 通用建议按 F3 现状去重，再经用户确认实施 |

## 独立重读的外部证据

下列均为既有来源，统一访问日 **2026-11-19**；引文不超过 50 字符。置信度仅针对确实读到的正文，不针对发布日期或产品适配。

| URL | 原文短引文 | 独立支持与限制 | 置信度 |
| --- | --- | --- | --- |
| https://registry.npmjs.org/ai/latest | `"version":"7.0.177"` | 完整元数据同时含 Node >=22；证明当前 latest，不证明 API 首发时间 | 高 |
| https://registry.npmjs.org/ai | `"latest":"7.0.177"` | 首段含 latest 与 alpha/beta/canary；工具截断全量响应为 2,000,000 字符，本次未读到 time 字段 | 高（标签）；未独立重验（时间） |
| https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling | `don't pause execution` | 支持集中 toolApproval、默认 not-applicable、schema 校验与审批响应后继续调用；不是悬挂调用等待人工 | 高 |
| https://ai-sdk.dev/docs/agents/loop-control | `isStepCount(20)` | ToolLoopAgent 默认 20 步、stopWhen 任一条件满足即停，且最后一步有工具结果才评估；不等于费用硬上限 | 高 |
| https://modelcontextprotocol.io/specification/2026-07-28/server/tools | `improves LLM prompt cache hit rates` | 支持工具确定性排序、按请求授权返回列表与订阅流通知；日期路径不证明稳定发布或本地兼容 | 高（正文） |
| https://www.anthropic.com/engineering/advanced-tool-use | `Today, we're releasing three features` | 正文确有工具搜索/程序调用；读取首段未见发布日期，Today 不能翻译成访问日发布 | 高（机制）；未知（日期） |
| https://openai.github.io/openai-agents-python/tracing/ | `Tracing is enabled by default.` | 默认后台导出、敏感内容默认 True；追加 processor 不替换默认 exporter；关闭 tracing 不清除已缓冲数据 | 高 |

### npm 版本裁决

| 断言 | 裁决 |
| --- | --- |
| 当前稳定版本为 7.0.177 | 可保留，但明确定义为访问时 npm latest 非预发布包；两个 registry 端点独立读取一致 |
| Zen 使用 7.0.169 | 独立核对 `packages/agent-core/package.json:22` 与 `packages/agent-core/node_modules/ai/package.json:3`；锁文件一致性沿用 F3，未独立重查 |
| 相差 8 个补丁 | 只能写补丁编号差 8，不等于核验了 8 份发布记录、8 个必要修复或零迁移风险 |
| 7.0.177 发布于 2026-11-18T19:03:24.841Z，7.0.169 于 2026-11-10T20:18:05.811Z，7.0.0 于 2026-06-25 | F1 记录从同一 registry 只读解析；本复核未看到原始 time 投影，不能标成独立复验通过。可归因 F1，若主报告突出近期发布，应保留其原始字段输出 |
| 升到 latest 才能得到集中审批/ToolLoopAgent/Output.object | 删除；F3 已定位本地使用。当前滚动文档细项也不能自动视为 7.0.169 全部支持 |

## 冲突、应删除或降级的结论

| 表述或冲突 | 裁决及推荐写法 |
| --- | --- |
| F2 把审批状态机/轨迹整体列 P0，F3 却已有相关能力 | 属通用提案未适配本地，不是事实矛盾。改为现有审批不变量、事件及计量补强；Python 默认外传不能推导 Zen 正在外传 |
| F3 已用原生审批，F0 却发现前缀误放行 | 可同时成立：SDK 提供流程，应用仍负责风险分类；测试全过不证明未覆盖输入安全 |
| F0 已端到端复现任意命令执行 | **删除。** F0 记录的是内存转译后直接调用 evaluateApproval，smart＋remembered:false 下带写意图的字符串返回 allow，未执行命令。本复核只读 `packages/agent-core/src/agent-approval.ts:11-15`、`:67-71`、`:142-147`，确认前缀匹配/拆分依据，未重跑纯函数，更未运行完整工具链。应写“局部策略误判已有函数级验证，端到端影响待受控验证”；find 选项不宣称跨平台通用 |
| F3“ask 不被助手覆盖”推广到所有审批路径 | 限定为 `apps/desktop/src/main/approval-gate.ts:131` 起函数内部优先级。本复核确认 `packages/agent-core/src/agent-session.ts:458-479` 先 evaluateApproval，allow 即 return undefined，只有其后才调用 desktop gate；因此不能保证显式 ask 覆盖更早的 core allow。此为静态调用顺序事实，不是端到端复现 |
| 摘要迟到覆盖新状态已复现 | 降级为潜在竞态。独立确认 `packages/agent-core/src/context-overflow.ts:48-62` 未传 signal/timeout，`packages/agent-core/src/agent-session.ts:1395-1445` await 后写回；仍需受控 Promise 交错测试，不能宣布用户数据已经被覆盖 |
| MCP 取消保证远程写操作终止/回滚 | 删除硬保证；只承诺可验证的本地取消、pending/timer 清理、迟到结果隔离及兼容协议下发取消，远端副作用可能已发生 |
| stopWhen/usage 构成严格费用上限 | 删除；完成后判定不锁住在途账单，Zen 另有外层循环、子 Agent 和辅助请求；只改 isStepCount 不足以限制整个 run |
| 当前文档机制都是最近六个月新增 | 删除。滚动文档、样例模型名、API 日期标识均不等于发布事件；无日期的机制放“当前官方机制”，不放“2026 新增” |
| MCP 2026-07-28 已稳定且 Zen 升依赖即可支持 | 降级为该版本路径正文可读；未查发布索引/协商；F3 自建 transport 不因依赖升级自动支持通知或取消 |
| F3 未跑测试与 F0 全通过冲突 | 无矛盾：不同主体。统一写 F0 记录 macOS agent-core 26 文件/213 测试及 typecheck 通过，F3/独立复核未重跑；不是改后验收或三平台通过 |
| 点名 pnpm test 文件等于只跑这些文件 | 降级；F0 已记录 `vitest run -- ...` 实际跑整包。实施时核验参数透传，不以命令文字推断实际覆盖 |

## 来源预算与时效可信度

| 项目 | 结论 |
| --- | --- |
| F1 六来源 | registry latest、registry 全量、ToolLoopAgent、tools、structured data、loop control |
| F2 七来源 | Anthropic 工程文、Cookbook、MCP tools、OpenAI results/tracing/handoffs/overview |
| 总数 | **13 / 15**；独立复读其中 7 个，不增加计数；本地文件和运行记录不算外部来源 |
| 可保留的高置信度 | 访问时版本标签、官方当前机制正文、本地直接读到的实现 |
| 应降低的置信度 | 具体 API 引入时间、最近六个月新增归属、跨厂商/模型兼容、预估收益和远程副作用停止保证 |
| 补查预算 | F0 已写明使用“一轮补查”；不得因仍余 2 个来源额度就自动再启动一轮。下面是可执行后续任务入口，不是本轮继续搜索授权 |

## 可执行补查 query（本复核不执行）

优先复用现有来源与本地证据。测试新增或新一轮检索须另获授权；搜索摘要不能当证据。

| 优先级 | query / 精确取证任务 | 完成标准 |
| --- | --- | --- |
| P0 | 本地 `evaluateApproval READONLY_COMMAND_RE toolApproval approvalGate`；重定向/命令替换/带副作用参数的纯判断及 execute spy | 复用 F0 函数级证据，补完整 mock 路径；覆盖显式 ask、smart/default/full、remembered；绝不把测试字符串交给 shell |
| P1 | 相同 `https://registry.npmjs.org/ai` 精确投影 `dist-tags.latest`、`time["7.0.177"]`、`time["7.0.169"]`、`time["7.0.0"]` | 先找回 F1 已执行的字段输出；不足再经授权复取同来源，保存小段原文和访问日，不靠摘要补日期 |
| P1 | 已安装 ai 包 `toolApproval totalMs firstChunkMs activeTools prepareStep experimental_steering`，读取相邻类型/CHANGELOG 版本标题 | 明确分开“当前网页存在”“7.0.169 可用”“实验/稳定”；不装新版、不全量扫库 |
| P1 | 本地 `summarizeWithModel compactContext callMcpTool callTool pending abortSignal` | 完整参数传播链与受控迟到响应夹具；不声称远端可回滚 |
| P2，后续授权再用 | `site:anthropic.com/engineering/advanced-tool-use "Published"`；`site:modelcontextprotocol.io "2026-07-28" "release"` | 无可读日期/发布状态则保留当前机制表述；如打开新正文，累计仍不得超过 15 个来源 |

## 首批建议优先级（确认后才开发）

| 优先级/顺序 | 最小提案 | 收益、风险与范围 | 验收门槛 |
| --- | --- | --- | --- |
| P0，先安全验证 | 前缀审批回归＋完整 mock 审批路径；确认后给最小修补方案 | 安全收益高；范围仅审批判断与调用顺序；不擅改 full/default 或显式授权语义 | 副作用字符串不执行；拒绝后 execute 不调用；明确 ask 与 core allow 优先级；区分函数级与 mock 链路证据 |
| P1，首个实现候选 | F3 P1-B：摘要取消传播＋迟到写回守卫 | 收益高、风险低至中；局部改摘要签名和写回守卫，沿用已有压缩 | pause/cancel、run 替换、迟到摘要、失败 fallback、ChatGPT 裁剪均有夹具 |
| P1，随后 | F3 P1-A：MCP 单请求取消贯通 | 收益高、共享连接风险中；不替换 transport、不全局 shutdown | A 取消不影响 B；pending/timer 清理、迟到结果隔离；注明远端不可撤销 |
| P2，可独立做 | F3 P2-C：summary/repair usage 与耗时 | 收益中高、风险低；复用统计链，不记录 prompt/密钥、不新增外传 | 每请求只计一次；主循环不重复；失败/取消不虚构 usage |
| P2，先测量 | 工具 schema 成本、压缩质量、固定任务回放 | 先证明瓶颈，避免重复已有能力 | 安全/质量不回退，再比较 token、延迟及缓存读；用户点名工具与授权不丢 |
| 暂缓 | 追补丁、durable 多 Agent、模型生成程序编排、全局预算 | 没有必须升级的具体修复证据；后两类会扩大执行面或改变长任务语义 | 版本匹配变更记录、运行时兼容、回归后再决定；预算先定义父子统计、审批等待计时和退出状态 |

## 验证结果与未解决问题

| 项目 | 状态 |
| --- | --- |
| 文档覆盖与来源 | 六个子问题均映射；去重 13 个来源，未超预算 |
| 版本 | latest 与本地版本独立确认；精确发布时间仅沿用 F1 解析取证，未独立重验 |
| 安全与取消 | 独立确认关键静态片段；F0 函数级误判证据保留归因；无端到端实测结论 |
| 时效与适配 | 多数 API 首发日期、当前厂商适配和真实收益未解决，不阻止提出局部改进方案 |
| 产品验收 | 本复核未跑测试；F0 macOS 基线不代表改后、供应商端到端或 Windows/Linux 验收 |
| 改动文件 | 仅 `research/ai-agent-sdk-update-2026-11/review.md`；未改产品、其他研究文件或依赖 |
