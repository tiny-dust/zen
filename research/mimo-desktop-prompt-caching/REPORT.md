# 调研报告：Xiaomi MiMo Desktop 的提示词缓存（prompt caching）工程实现

调研日期：2026-10-22｜档位：默认档｜源码基准：XiaomiMiMo/MiMo-Code@e0636e7b（main, 2026-10-22）

## 结论先行

1. 「Mimo desktop」已唯一确认：小米 **MiMo Desktop**（2026-09-08 邀请制 Beta 桌面 AI agent）。其 Electron UI 层闭源，但**核心引擎是开源的 MiMo Code**（XiaomiMiMo/MiMo-Code，MIT，OpenCode fork），因此缓存工程实现可以在源码层面完整审计 [1][2]。
2. 官方宣称「同会话缓存命中率最高 99%、跨会话 95%」，归因于模型分级路由 + 局部原位编辑 + 高缓存命中优化三件套；引擎源码与第三方实测（97%）方向一致，但 99%/95% 为官方口径、未见第三方系统复现 [1][5][6]。
3. 缓存命中工程上分两条路径：**Anthropic 系**用 `cache_control` 断点（最后一个 system 消息 + 最后两条消息的「rolling double buffer」，最多 3 个断点）；**OpenAI 系**用 `prompt_cache_key = sessionID`（openai/xai/azure/openrouter/venice 等）。而**小米自研 MiMo 模型被钉死在 OpenAI 兼容 Chat Completions 协议，客户端不发任何缓存标记字段**——其命中完全依赖小米 API 平台服务端的前缀缓存行为（该服务端机制无公开文档）[7][8][9]。
4. 前缀稳定性的核心手段不是「发什么字段」，而是**字节级冻结前缀**：`SessionPrefixSnapshot` 把 system 前缀 + 工具 schema 快照按 profile 哈希 pin 进 SQLite，跨请求/跨会话直接复用 `prebuiltSystem`；动态内容（git 状态、环境信息）默认不进 system，即使开启也把时间锚定到 session 创建时刻，保证前缀逐字节一致 [10][11][12]。
5. cached_tokens 的读取与展示是内建能力：引擎从各 provider 响应归一化 `cacheRead/cacheWrite`（OpenAI `cached_tokens`、Anthropic `cacheCreationInputTokens` 等），落库为消息 part、按 Anthropic 式口径分别计价，并发布 `writer.cache_perf`（含 `cache_hit_rate`）结构化事件；桌面端自身在部分界面暴露命中率，第三方扩展经 CDP 读同源数据实测 97% [4][5][6][13][14]。

## 分主题论据

### A. 产品指向与可审计面

- MiMo Desktop：多模态输入 → 任务拆解 → 工具调用 → 交付可编辑产物（PPT/网页/3D/Office），内置「Smart」调度（模型路由 + Harness/Agent/Skill 路由 + 多会话协作），浏览器与（海外版）电脑控制 [1]。
- 「The desktop app is powered by MiMo Code as its core engine」——桌面 = UI 壳（闭源 Electron）+ MiMo Code 引擎（开源 MIT）[2]。第三方工具证实 Electron 结构（`Xiaomi MiMo.exe`、单实例锁、`mimo-node` 运行时）[5]。
- 默认模型：Beta 期 MiMo-X-Pro/Flash-Preview，量产 MiMo-V2.6-Pro/Flash；经小米 MiMo API 开放平台 OAuth 授权（`api.xiaomimimo.com/v1`），支持按量付费与 Token Plan 订阅 [1][3]。

### B. 请求组织：如何稳定前缀

| 手段 | 实现 | 来源 |
|---|---|---|
| 断点布局（Anthropic 系） | 最后一个 system 消息 + 最后两条消息共 3 个断点；「rolling double buffer」：本轮 [-2]/[-1] 下轮变成 [-2]/[-1]，旧断点读命中、新断点为下轮写；双断点兜底「尾消息被删（重试/Ctrl-C/编辑）」与「单轮追加 >20 blocks 超出回看窗口」两种失效 | [8] |
| 工具定义 | `tools()` 给最后一个 tool 挂同样的缓存标记，工具段落在缓存前缀内且注册顺序稳定 | [15] |
| system 组装顺序 | env →（structured-output 提示）→ skills → AGENTS.md/CLAUDE.md 指令，顺序固定 | [11] |
| 前缀快照 | `SessionPrefixSnapshot`：profileKey = sha256(provider/model/agent/agentID/harness/systemMode/system/permission)，工具另算 toolsHash；frozen 命中时 `additions: []` + `prebuiltSystem` 原样复用；工具集变化才 rotate 重建 | [10] |
| 尾部防御 | 永不以删消息的方式修尾（trailing assistant residue 追加 "Continue." 续写），保住历史前缀 | [16] |

### C. 服务商缓存机制与字段

| Provider | 字段 | 策略 |
|---|---|---|
| Anthropic / Vertex-Anthropic | `cacheControl: {type:"ephemeral"(, ttl)}` | 见 B；`cachePromptTTL` 可配 5m/1h（1h 写入 2 倍价） |
| OpenRouter | `cacheControl`（同 Anthropic 形状）或顶层 `prompt_cache_key = sessionID` | 多模型 provider 仅 claude/anthropic 模型发标记 |
| OpenAI / xAI / Azure / Venice / opencode | `promptCacheKey = sessionID`（Azure 另设 `store:true`，其余 openai 系默认 `store:false`） | 用会话 ID 引导服务端缓存路由 |
| Bedrock | `cachePoint: {type:"default"}`（Converse API） | — |
| GitHub Copilot | `copilot_cache_control` | — |
| Alibaba | `cacheControl` | — |
| `@ai-sdk/gateway` | `gateway: {caching: "auto"}` | — |
| 自定义 OpenAI 兼容 provider | 可配 `setCacheKey` 开关（默认 false） | — |
| **小米 MiMo 自家模型** | **无任何缓存字段**（钉死 `@ai-sdk/openai-compatible`，且不在 supportsCacheMarkers 白名单） | 依赖服务端缓存 |

来源：[7][8][9][15]；标记是否下发由 `supportsCacheMarkers` 白名单判定，明确防「Claude 模型走 OpenAI 兼容代理时字段被静默丢弃」[8]。

### D. 消息历史与动态内容位置

- 历史按存储消息原序全量传递（append-only；「LLM must see the full msgs list…never a reason to slice the main request history」），上下文超限走 compaction/checkpoint 重建而非原地改写 [11]。
- 动态内容位置：
  - 工作目录/平台/shell/git status+branch+commits 快照等环境块是 system prompt 的 **opt-in**（`MIMOCODE_ENABLE_DYNAMIC_SYSTEM_PROMPT` 默认 false）[12]。
  - 开启时，环境日期**锚定 session.time.created** 而非当前时间，「so the captured prefix is byte-identical to the runLoop's … preserving Anthropic cache parity」[12]。
  - git 状态块本身声明「snapshot in time, will not update during the conversation」，不会逐轮变化 [12]。
  - 已知风险点自文档化：vision 模型列表按调用惰性解析，会话中 provider 列表变化会 break cached system prefix，实践假设会话内配置稳定 [12]。

### E. cached_tokens 读取与展示

- 归一化（`getUsage`）：cacheRead = `inputTokenDetails.cacheReadTokens ?? cachedInputTokens`；cacheWrite 兼容 Anthropic `cacheCreationInputTokens`、Vertex、Bedrock、Venice 的 metadata 字段；计费 input = 总 input − cacheRead − cacheWrite，cache read/write 分档计价，>200K 触发 `experimentalOver200K` 价格分层（Anthropic 长上下文计价口径）[13]。
- 持久化与事件：每步 usage 落库为 step-finish part；`writer.cache_perf` 事件携带 `cache_read_tokens / cache_write_tokens / cache_hit_rate / num_llm_calls`，注释明言目的是「so prefix-cache reuse is empirically observable」[14]。
- 展示：TUI 的上下文水位把 cache.read/write 计入 token 总量；桌面端自身在部分界面暴露会话命中率与 Token Plan 余量（`window.mimo.getUserUsage()`）；两个第三方 CDP 扩展读取引擎同源数据，命中率口径 `cacheRead / max(cacheRead+cacheWrite+input, 1)`（会话累计），实测 97%（25.22M input / 249 tool calls 长会话）[5][6]。
- `mimo serve` 协议把内部 usage 映射回 OpenAI 形状（`prompt_tokens_details.cached_tokens`）供下游消费 [17]。

### F. 换轮失效点与规避

| 失效原因 | 规避手段 | 来源 |
|---|---|---|
| 尾消息被删（工具重试/中断/用户编辑） | 双断点 rolling buffer：next-to-last 断点兜底，最坏退化为只重算被删消息 | [8] |
| 单轮追加 >20 blocks（工具密集轮）把上一写挤出回看窗口 | 同上双断点 | [8] |
| system/工具定义漂移 | SessionPrefixSnapshot 冻结前缀 + toolsHash 校验，变化才 rotate | [10] |
| 逐轮变化的日期/时间戳 | 时间锚定 session 创建时刻；环境块默认关闭 | [12] |
| 上下文超限 | compaction/checkpoint 重建（checkpoint tail 折叠为 activity log），主请求历史不被切片 | [11][10] |
| prompt_cache_key 会话隔离（OpenAI） | key 只是路由提示，前缀仍需内容匹配；跨会话命中主要靠冻结前缀 + 服务端内容寻址 | [9][10] |

### G. 服务端（小米 API 平台）侧

- **未找到公开文档**说明小米 MiMo API 平台是否/如何实现上下文缓存、cached tokens 的计费口径（site 检索 platform.xiaomimimo.com / mimo.mi.com 无结果）[18]。
- 间接证据：引擎能从 MiMo 模型响应读到 cacheRead 并在 UI 呈现 96-97% 命中率（第三方实测），说明平台在 usage 中回传了缓存 token 数；XiaomiMiMo 组织 fork 了 vLLM（组织仓库列表可见），vLLM 默认支持 automatic prefix caching——但「平台用该 fork 服务且开启 APC」属[推测]，无直接证据 [5][6][19]。

## 冲突与不确定性

- 99%/95% 官方数字 vs 97% 第三方单例实测：方向一致，无矛盾，但官方数字无可复现口径 [1][5]。
- 「小米平台服务端自动前缀缓存」：仅有间接证据（usage 回传 cached tokens、vllm fork），标注[推测]。
- 桌面 UI 层（闭源）是否在引擎之上追加缓存相关请求字段：未知，引擎层证据显示 MiMo 模型路径不带缓存字段。

## Open questions

1. 小米 API 平台的服务端缓存机制（是否 vLLM APC、KV 块粒度、TTL、缓存 token 计费折扣）——无公开文档，需平台方披露或抓包验证。
2. 桌面端闭源 UI 层对引擎行为的覆盖/增强点（如 Smart 调度切换模型对缓存的打断策略）——引擎源码有 model 归因统计，但路由触发时是否牺牲命中无文档。
3. 跨会话 95% 的准确技术路径（SessionPrefixSnapshot 只保证前缀字节一致，命中仍取决于服务端缓存的内容寻址与容量）——只能部分从源码推出。

## 来源清单

- [1] Xiaomi MiMo for Desktop — Beta Access Is Live｜https://mimo.mi.com/docs/en-US/news/latest/mimo-desktop｜2026-10-22
- [2] XiaomiMiMo/MiMo-Code（README：desktop powered by MiMo Code）｜https://github.com/XiaomiMiMo/MiMo-Code｜2026-10-22
- [3] MiMo Code Configuration（Token Plan / OAuth）｜https://mimo.mi.com/docs/en-US/tokenplan/integration/mimo-code｜2026-10-22
- [4] XiaomiMiMo/MiMo-Code 源码（本地浅克隆 @e0636e7b，2026-10-22 main HEAD）｜https://github.com/XiaomiMiMo/MiMo-Code｜2026-10-22
- [5] miniongk/mimo-desktop-statusbar（引擎落库数据实测）｜https://github.com/miniongk/mimo-desktop-statusbar/blob/main/README.md｜2026-10-22
- [6] ethanweave/mimo-composer-token-status（桌面命中率 UI 同源数据）｜https://github.com/ethanweave/mimo-composer-token-status｜2026-10-22
- [7] provider.ts（MiMo 模型钉死 OpenAI 兼容协议）｜https://github.com/XiaomiMiMo/MiMo-Code/blob/main/packages/cli/src/provider/provider.ts#L1139-L1145｜2026-10-22
- [8] transform.ts（applyCaching / supportsCacheMarkers / cacheMarkerOptions）｜https://github.com/XiaomiMiMo/MiMo-Code/blob/main/packages/cli/src/provider/transform.ts#L265-L289 及 #L522-L618｜2026-10-22
- [9] transform.ts options()（promptCacheKey/store/caching:auto）｜https://github.com/XiaomiMiMo/MiMo-Code/blob/main/packages/cli/src/provider/transform.ts#L1657-L1793｜2026-10-22
- [10] prefix-snapshot.ts + prompt.ts（SessionPrefixSnapshot/冻结前缀）｜https://github.com/XiaomiMiMo/MiMo-Code/blob/main/packages/cli/src/session/prefix-snapshot.ts#L66-L90 与 blob/main/packages/cli/src/session/prompt.ts#L5871-L5945｜2026-10-22
- [11] prompt.ts（system 组装顺序、append-only 历史）｜https://github.com/XiaomiMiMo/MiMo-Code/blob/main/packages/cli/src/session/prompt.ts#L5888-L5905｜2026-10-22
- [12] system.ts + flag.ts + prompt.ts:735（动态环境块、时间锚定）｜https://github.com/XiaomiMiMo/MiMo-Code/blob/main/packages/cli/src/session/system.ts 与 blob/main/packages/cli/src/flag/flag.ts#L315-L323｜2026-10-22
- [13] session.ts getUsage（cached tokens 归一化与计价）｜https://github.com/XiaomiMiMo/MiMo-Code/blob/main/packages/cli/src/session/session.ts#L392-L455｜2026-10-22
- [14] events.ts + checkpoint.ts（writer.cache_perf）｜https://github.com/XiaomiMiMo/MiMo-Code/blob/main/packages/cli/src/actor/events.ts#L54-L66｜2026-10-22
- [15] transform.ts tools() 标记（#L1135-L1162）｜https://github.com/XiaomiMiMo/MiMo-Code/blob/main/packages/cli/src/provider/transform.ts#L1135-L1162｜2026-10-22
- [16] transform.ts 尾部防御（#L300-L354）｜https://github.com/XiaomiMiMo/MiMo-Code/blob/main/packages/cli/src/provider/transform.ts#L300-L354｜2026-10-22
- [17] protocol.ts usage 映射（#L330-L345）｜https://github.com/XiaomiMiMo/MiMo-Code/blob/main/packages/cli/src/llm-server/protocol.ts#L330-L345｜2026-10-22
- [18] 检索记录：site:platform.xiaomimimo.com / mimo.mi.com "context caching" 无结果（Bing/DDG，2026-10-22）
- [19] XiaomiMiMo 组织仓库列表（含 vllm fork）｜https://github.com/XiaomiMiMo｜2026-10-22
