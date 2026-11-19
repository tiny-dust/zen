# Zen：AI、Agent 与 AI SDK 调研及择优更新方案

## 结论先行

1. **不建议换 Agent 框架，也不建议仅因有新版本就升级。** 访问时 npm latest 为 `ai@7.0.177`；Zen 声明、锁定及安装为 `7.0.169`，是同 minor 的补丁编号差 8，而非落后一个大版本。Zen 已使用 ToolLoopAgent、toolApproval 和 Output.object。[1][2][3][4][5] 本地证据见 `findings/F3.md`。
2. **第一优先级是现有审批规则的安全边界。** SDK 审批不替应用判断操作是否安全。Zen 的 smart 模式前缀白名单存在函数级误放行证据；应先补 mock 执行链回归并最小修补，而不是新增第二套审批系统。[4][9] 证据见 `findings/F0.md`。
3. **首批可靠性更新应补摘要和 MCP 的取消传播。** SDK 接收取消信号不代表每个外部工作会实际停止；Zen 的局部传播链存在可定位缺口。摘要迟到写回属于待夹具验证的潜在竞态，不宣布已发生数据丢失。[3][4] 证据见 `findings/F3.md`。
4. **成本优化先测量，再加复杂能力。** 官方当前实践支持分层上下文、按需工具发现、稳定缓存前缀和运行轨迹；Zen 已有压缩、缓存断点、消息回放和 usage，优先补辅助请求计量，再试验工具筛选，不能把已有功能当缺失。[6][7][8][10][11]
5. **保留主 Agent 汇总与现有多 Agent 调度。** 新增 durable workflow、自由程序化工具编排或跨框架 handoff 会扩大改动和安全面，不适合作为本轮首批更新；Python SDK 机制只能作设计参照，不能直接移植成 TypeScript API。[8][12][13]

## 首批实施结果与自测（2026-11-19）

用户确认后已实施 **P0 终端只读规则加固＋P1-A 摘要取消保护**；以下原调研章节保留调研时点的证据与边界。本批不升级依赖、不切换框架、不改 MCP、数据库或 UI，不执行 Git、不调用真实供应商模型。

| 改动文件 | 实施内容 |
| --- | --- |
| `packages/agent-core/src/agent-approval.ts` | 只读命令从前缀判断改为有限参数检查；拒绝自动放行重定向、替换、转义、控制字符、未引用通配符、Git 写参数、find 执行/写入选项及解释器任意代码 |
| `packages/agent-core/src/agent-approval.test.ts` | 表驱动字符串测试覆盖可疑语法与普通只读命令；不执行其中的危险字符串，保留 default/full、remembered 和工作区写审批回归 |
| `packages/agent-core/src/agent-config.ts` | 自定义摘要回调新增可选 AbortSignal 参数，原有两参数回调继续兼容 |
| `packages/agent-core/src/context-overflow.ts` | 默认摘要 generateText 透传 abortSignal，保留 ChatGPT 方案裁剪回退 |
| `packages/agent-core/src/agent-session.ts` | 压缩等待可被中止；摘要与文件回灌等待后校验 controller/run 状态，取消时不回退裁剪、不写回旧摘要、不继续模型循环 |
| `packages/agent-core/src/agent-session.test.ts` | mock 进程的审批执行链回归；摘要挂起时 pause/cancel、恢复后迟到成功和迟到拒绝回归 |
| `packages/agent-core/src/context-overflow.test.ts` | 默认模型请求的取消信号测试，以及 ChatGPT 方案不发非流式摘要请求的测试 |

| 验证 | 实际结果 |
| --- | --- |
| 首轮相关回归 | 3 文件、215 测试通过；随后另补 2 个审批执行链测试 |
| 审批执行链 | 无自动闸／自动闸不放行两种配置均通过：请求人工审批；拒绝前后 spawn 均未调用 |
| 完整 agent-core 回归 | `TMPDIR="$HOME/.zen/cache" pnpm --filter @zen/agent-core test`：26 文件、377 测试全部通过，7.32 秒 |
| core 类型检查 | `pnpm --filter @zen/agent-core typecheck` 通过 |
| desktop 类型检查 | `pnpm --filter @zen/desktop typecheck` 通过 |
| 索引 | coder 索引已刷新（1199 文件）；启发式 `--check` 退出 1，报告 59 个体量和 9 个枚举候选，包含构建产物及本批未修改文件；不以此扩展到全仓重构 |
| 测试夹具修正 | 新增执行链测试首次报 `Cannot spy on export "spawn". Module namespace is not configurable in ESM.`；改成模块 factory mock 后复跑通过，未修改产品行为来迁就测试 |
| 平台与外部边界 | 本机 macOS 实测；新增保护使用跨平台 JS/AbortSignal，语法检查对 POSIX/cmd/PowerShell 特殊字符保守确认；Windows/Linux 未实机运行，真实供应商模型和远端 MCP 未验证 |

**保留的权衡：** 这是缩小 smart 自动放行面的规则加固，不是完整 shell 解析器或沙箱。复杂但安全的命令也可能转入审批。原有 `npm test --`／`npm test -- --watch` 兼容例外仍保留，测试脚本本身不保证只读；full、会话明确记忆与既有自动审批闸仍保持原授权语义。core allow 先于 desktop gate，只有 core confirm 才进入该闸，故本批没有把显式 ask 规则改成全局否决。自动闸批准仍可能放行可疑命令，本批测试验证的是无闸／闸不放行时不执行。忽略 signal 的自定义摘要器只能解除会话等待并隔离迟到结果，不能强制停止其内部工作。图片 part 弃用警告及负向用例 APICallError 日志仍存在，不属于本批失败。

完整测试输出保存于用户缓存目录，未放入仓库；本批未安装、打包、发布或重启正在运行的桌面客户端。

## 1. 调研范围与可信边界

| 字段 | 口径 |
| --- | --- |
| 访问截止 | 2026-11-19；近期窗口约为 2026-05-19—2026-11-19 |
| 目标 | 可落地到本地编码桌面 Agent 的官方进展与工程机制，不做无基准的新模型排行榜 |
| 证据 | 13 个外部官方来源；3 路并行取证＋1 路独立复核；本地静态调用链和基线测试 |
| “最新”定义 | npm latest 用实时标签验证；无发布日期的滚动文档仅称“当前官方机制”，不包装成最近六个月新增 |
| 发布历史 | F1 从 npm time 字段记录 7.0.177 发布于 2026-11-18 UTC、7.0.169 于 2026-11-10 UTC、7.0.0 于 2026-06-25 UTC；独立复核确认 latest，但未重验精确时间字段，不以时间细节作为更新必要性的依据 |
| 授权范围 | 用户选择“调研当前 Zen 项目，给出优先方案，经确认后实施”；本轮不改产品代码、不安装、不升级、不执行 Git、不发真实模型请求 |
| 自我更新边界 | 只能更新本地 Zen 实现及配置，不能改变底层模型权重或绕过平台规则；没有实施就不称“已自我升级” |

## 2. 当前官方进展：哪些值得借鉴

| 主题 | 本次核实的机制 | 应采纳的原则 | 不应得出的结论 |
| --- | --- | --- | --- |
| AI SDK 版本 | latest 7.0.177；ToolLoopAgent、集中 toolApproval、output、prepareStep/activeTools、取消/分层超时有当前官方文档。[1]—[6] | 按本地匹配版本类型核对；有具体修复收益才升级 | 补丁较新必然值得升级；所有文档细项都在 7.0.169 可用 |
| 审批与校验 | schema 校验与本地工具审批分工；审批请求落到应用，响应后再次调用继续；provider-executed tools 不由同一机制控制。[4] | 风险分类、输入验证、授权与恢复都要测试；不以工具名或 schema 替代授权 | SDK 自带审批便自动安全；恢复等于副作用 exactly-once |
| 上下文管理 | 官方区分 compaction、旧工具结果 clearing、长期 memory。[7] | 可重读结果与不可重建记录分别处理；摘要保留限制、批准范围和验证结论 | 清空历史可无损；摘要可成为新授权来源 |
| 工具发现与缓存 | Anthropic 工具搜索按需展开定义；MCP 正文建议确定性排序；工具搜索与稳定核心前缀可协作。[8][9] | 大工具集先测 schema token 与召回率；保留用户点名工具和完整审批 | Anthropic 参数天然跨厂商通用；动态改变任意工具表不影响缓存 |
| 预算与取消 | stopWhen 可累计已完成 usage，SDK 向工具传 signal；已运行工具须配合终止实际工作。[3][4][6] | 分开 run、step、工具、父子 Agent、辅助请求统计；停止状态清晰 | 步数默认值等于全局硬费用上限；发取消即可撤销远端操作 |
| 恢复与观测 | OpenAI Python 有审批状态恢复、trace 和 agent 编排原语。[10]—[13] | 借鉴调用 ID、可检查状态与本地最小轨迹；外传默认关闭、内容默认不记 | Zen 当前向 OpenAI 外传；直接把 Python 方法名用进 Zen |
| 多 Agent | agents-as-tools 与 handoff 分别面向专家返回结果、移交会话控制；参数授权仍需宿主检查。[12][13] | 默认保持主 Agent 面向用户、子 Agent 返回证据；控制资源竞争和总成本 | Agent 越多越好；上下文过滤就是权限隔离 |

**稳定性说明：** Anthropic 工程文章有 beta 语境；MCP `2026-07-28` 路径正文可读不代表本轮验证了其稳定发布和本地兼容；AI SDK 的 experimental_sandbox/experimental_steering 不作为稳定安全基础。[6][8][9]

## 3. 与 Zen 实际能力对比

以下本地事实取自 `findings/F3.md`，网络机制只作对照，不代替源码证明。

| 能力 | Zen 当前实现证据 | 判断 |
| --- | --- | --- |
| Agent 循环 | `packages/agent-core/src/agent-session.ts:395` 使用 ToolLoopAgent，单 stream 一步，外层循环续跑 | 已有，不重写；外层明确无总步数上限，不能只改 isStepCount 充当 run 预算 |
| 审批 | `packages/agent-core/src/agent-session.ts:427`、`packages/agent-core/src/agent-stream.ts:175`、`apps/desktop/src/main/approval-gate.ts:131` | 已有原生流程、规则和助手闸；需要补风险判断和顺序不变量 |
| schema/结构化结果 | `packages/agent-core/src/agent-tools.ts:104`、`packages/agent-core/src/agent-model.ts:204` | 已有 schema 与 Output.object 修复；不再从零新增 |
| 暂停、取消、插入 | `packages/agent-core/src/agent-session.ts:878`、`:937`、`:1014`、`:1206` | 主链已有；外部请求和辅助摘要取消仍需贯通 |
| 上下文压缩 | `packages/agent-core/src/agent-session.ts:1379`、`:1395`；`packages/agent-core/src/context-overflow.ts:20` | 已按 usage 主动压缩、失败裁剪、超限重试；ChatGPT 方案摘要回退裁剪，不能称全部均为 LLM 摘要 |
| Prompt cache | `packages/agent-core/src/agent-model.ts:86`、`packages/agent-core/src/agent-session.ts:209`、`:1493` | 已有断点和稳定回放；真实网关命中和收益未实测 |
| 多 Agent | `packages/agent-core/src/multi-agent.ts:39`、`:188`、`:322`；`packages/agent-core/src/resource-lock.ts:15` | 已有并发、依赖、重试、父取消、等用户保活和共享锁；不新增一套编排 |
| 历史/文件恢复 | `apps/desktop/src/main/agent-runner.ts:368`、`:444`、`:474`；`apps/desktop/src/main/workspace-db.ts:534` | 已有跨轮消息回放和文件快照；不等于跨进程精确恢复未完成工具或 durable 调度 |
| MCP | `packages/mcp-client/src/base.ts:118`；`apps/desktop/src/main/mcp-ipc.ts:182`；`packages/agent-core/src/agent-tools.ts:757` | 自建 transport；按 run 汇总 enabled 工具，非逐步相关性选择；升级已安装 MCP SDK 不会自动补实际链路 |
| usage/观测 | `packages/agent-core/src/agent-stream.ts:80`；`apps/desktop/src/main/model-usage.ts:53` | 已有主调用 token/cache 统计；摘要和修复计量可补强，不必先引入远程遥测 |

## 4. 优先更新清单

| 顺序 | 更新项 | 收益 / 风险 | 最小范围 | 验收标准 |
| --- | --- | --- | --- | --- |
| P0 | 终端只读判断与审批路径加固 | 安全收益高；可能增加 smart 确认次数 | `packages/agent-core/src/agent-approval.ts`、对应测试及必要调用点 | 副作用参数/重定向/命令替换不误放行；拒绝不 execute；明确显式 ask 与 core allow 优先级；保留 default/full 与明确授权语义 |
| P1-A | 摘要取消传播＋迟到写回守卫 | 可靠性收益高；风险低至中 | `packages/agent-core/src/context-overflow.ts`、`packages/agent-core/src/agent-config.ts`、`packages/agent-core/src/agent-session.ts` 与测试 | 摘要挂起时 pause/cancel 生效；取消或 run 替换后不得写旧状态；失败 fallback、ChatGPT 裁剪保持 |
| P1-B | MCP 单请求取消贯通 | 遗留工作减少；共享连接风险中 | core bridge → desktop → `packages/mcp-client/src/` 与测试 | A 取消不影响 B；pending/timer 清理；迟到结果隔离；兼容时发送取消，但不承诺远端回滚 |
| P2-A | summary/repair usage 与耗时 | 成本可见性提高；风险低 | 复用现有 core usage 与 desktop 聚合，必要时扩 shared 类型 | 每辅助请求只计一次；不与主 step 重复；失败/取消不虚构 token；不记录 prompt/密钥、不新增外传 |
| P2-B | 工具定义成本＋按需暴露试验 | 大 MCP 集可能明显受益；收益未测 | 先测量，后选择 activeTools/工具搜索的版本匹配方案 | 比较误选率、定义 token、P95 延迟和缓存读；用户点名工具、授权和输入校验不丢 |
| 后续 | 图片 part 弃用迁移 | 消除兼容债；需核对媒体协议 | 先定位本轮 AISDK_DEP_IMAGE_CONTENT_PART 警告来源 | 依据已安装 SDK 类型迁移并验证图片输入，不因为警告直接认定视觉已坏 |
| 暂缓 | ai 补丁升级、durable 多 Agent、自由程序化工具、默认硬限步 | 暂无必须升级的具体修复证据；其他项扩大语义/执行面 | 单独提案 | 变更日志、三平台与供应商回归；预算需先定义父子统计和审批等待规则 |

### P0 证据强度

`packages/agent-core/src/agent-approval.ts:12` 的白名单匹配前缀，`:67` 按 shell 分隔符拆段。主线程将该文件内存转译后，仅调用 evaluateApproval：在 smart、remembered:false 下，包含重定向、建分支或 find 写入意图的字符串返回 allow。**未执行这些字符串、未生成探针文件、未进行真实 Git 操作**。这已证明局部策略误判，不等于端到端利用复现；记录见 `findings/F0.md`。

独立复核另确认：`packages/agent-core/src/agent-session.ts:458` 附近先判断 core allow，allow 直接返回，其后才到 desktop gate。因此“显式 ask 不被助手覆盖”只在 gate 内部成立，不能扩展成所有更早判断的保证。实施时先写受控 mock 测试再决定最小修补，不默认更改用户明确授权语义。

### 推荐首批授权

**建议只批准 P0＋P1-A。** 两项集中在 agent-core，可分别测试，无需安装、升级、数据库迁移或 UI 变更。先完成 P0 受控执行链回归再修补，随后补摘要取消。不把 MCP 共享连接变更、工具发现或新框架绑在同一批。

## 5. 自测与验证记录

| 检查 | 实际结果 | 限制 |
| --- | --- | --- |
| agent-core 基线 | 26 个测试文件、213 个测试全部通过，6.91 秒 | 本机 macOS，修改前基线，不是安全完备证明 |
| core 类型检查 | `pnpm --filter @zen/agent-core typecheck` 通过 | 不代表全仓或三平台通过 |
| 审批纯函数探针 | 确认上述 smart 策略误判 | 依赖替身＋内存编译，无真实 shell/工具副作用 |
| 独立复核 | 六子问题有覆盖；13/15 来源；latest 与本地版本复核一致 | 精确发布时间未二次独立重验，部分发布历史/真实收益仍未知 |
| 产品更新 | 未实施 | 用户已选择先确认方案；无改后验收可报告 |

实际测试命令见 `findings/F0.md`。命令虽带若干测试路径，脚本参数透传使 Vitest 实际跑完整 agent-core，统计按真实输出记录，不按命令文字推测。测试中的故意 APICallError 为负向用例日志，测试仍通过；图片 part 警告保留为后续兼容项。

获准实施后必须重跑相关回归和 typecheck，并静态核查 macOS/Windows/Linux 分支；不把未实测的平台写成通过。真实模型/远程 MCP 的付费或副作用验证另行确认。

## 6. 未决问题与反证限制

| 问题 | 原因与处理 |
| --- | --- |
| 哪个新模型最适合 Zen | 未做同任务成功率、延迟、费用、可用权限基准；不据厂商样例或热度自动换默认模型 |
| 7.0.170—177 是否有必须修复 | 本轮未逐份核对 changelog；编号差不能推导具体收益，不先升级 |
| 网页细项在 7.0.169 是否都支持 | 当前网页滚动更新；实施前以安装版本类型/内置文档核实，不能从网页直接写代码 |
| 摘要迟到覆写是否可真实触发 | 有缺少 signal/写回守卫的静态证据，尚无受控交错回归，不夸成已复现数据丢失 |
| 取消能否停止远端写操作 | 客户端取消不等于远端撤销，需服务端支持及业务幂等策略 |
| 动态工具收益是否超过发现开销 | 未测真实工具定义 token、召回和延迟，先试验不默认开启 |
| 是否需要任务级评估体系 | 有行为/协议测试，不等于有固定任务质量数据集；建议后续用现有脱敏回放夹具建设，不新增远程上传 |
| 是否实现 durable workflow | 现有消息恢复不能证明工具精确一次执行；需状态版本、审批快照和副作用去重设计，非小补丁 |

## 7. 产出文件

| 文件 | 用途 |
| --- | --- |
| `research/ai-agent-sdk-update-2026-11/brief.md` | 范围、问题、预算与授权契约 |
| `research/ai-agent-sdk-update-2026-11/findings/F0.md` | 主线程基线、类型检查与安全纯函数核验 |
| `research/ai-agent-sdk-update-2026-11/findings/F1.md` | AI SDK 官方版本、API 和边界证据 |
| `research/ai-agent-sdk-update-2026-11/findings/F2.md` | 官方 Agent、上下文、观测和 MCP 机制证据 |
| `research/ai-agent-sdk-update-2026-11/findings/F3.md` | Zen 源码、调用链、测试定位及候选 |
| `research/ai-agent-sdk-update-2026-11/review.md` | 独立复核、冲突裁决及降级表述 |
| `research/ai-agent-sdk-update-2026-11/REPORT.md` | 本报告与待确认的更新方案 |

## 8. 官方来源

以下来源均在 findings 中有同 URL 的正文证据，访问日均为 **2026-11-19**。除明确包版本记录外，不以访问日充当发布日期。

| 编号 | 标题 / 官方 URL |
| --- | --- |
| [1] | npm ai latest metadata — https://registry.npmjs.org/ai/latest |
| [2] | npm ai versions/time metadata — https://registry.npmjs.org/ai |
| [3] | AI SDK ToolLoopAgent — https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent |
| [4] | AI SDK Tools and Tool Calling — https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling |
| [5] | AI SDK Generating Structured Data — https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data |
| [6] | AI SDK Loop Control — https://ai-sdk.dev/docs/agents/loop-control |
| [7] | Claude Cookbook Context Engineering — https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools |
| [8] | Anthropic Introducing Advanced Tool Use — https://www.anthropic.com/engineering/advanced-tool-use |
| [9] | MCP Tools specification 2026-07-28 — https://modelcontextprotocol.io/specification/2026-07-28/server/tools |
| [10] | OpenAI Agents Python Results — https://openai.github.io/openai-agents-python/results/ |
| [11] | OpenAI Agents Python Tracing — https://openai.github.io/openai-agents-python/tracing/ |
| [12] | OpenAI Agents Python Handoffs — https://openai.github.io/openai-agents-python/handoffs/ |
| [13] | OpenAI Agents Python Overview — https://openai.github.io/openai-agents-python/ |
