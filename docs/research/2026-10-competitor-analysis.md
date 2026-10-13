# 竞品调研与功能规划存档（2026-10）

> 背景：逆向本机 DimAgent.app 与 Xiaomi MiMo.app（asar 解包至 `~/.zen/cache/`），并行完成 2026 年 AI Agent 桌面端趋势的网络调研。本档为结论存档，用于后续功能规划追溯。

## 结论

Zen 底子已在第一梯队：分支会话 / checkpoint / 审批 / 子 Agent / 任务面板 / 多 Provider / MCP+技能 / Lark 集成为独有优势。

## 缺口与规划（按价值排序）

| 优先级 | 功能 | 依据 | 状态（2026-10-13） |
| --- | --- | --- | --- |
| P0 | 定时/计划任务（RRULE 调度 agent） | 两家竞品都有 + 行业趋势 | ✅ 已实现（scheduled_tasks + 每分钟调度 + headless 执行） |
| P0 | 计划模式显式化（Interactive/Plan/Autopilot 会话级档位） | Copilot App/DimAgent/MiMo 标配 | ✅ 已实现（session mode 三档 + 批准执行） |
| P1 | 运行中转向 steer（不打断插话） | 两家都有，成本低价值高 | ✅ 已实现（agent:steer 复用插入机制） |
| P1 | 会话分享链接 / 手机配对远程接管 | MiMo `share*`、两家 `remote*` | ◐ 已实现单文件 HTML 导出；分享链接/远程接管未做 |
| P1 | CLI / ACP 协议（终端驱动同一 agent） | DimAgent `dim` CLI | ✅ 已实现（zen-cli TCP 行协议） |
| P2 | 语音输入（VAD+ASR）/ TTS | MiMo ten_vad.wasm | ✅ 已实现（三平台分支） |
| P2 | MCP Apps 交互 UI（SEP-1865 已 Final） | 协议层最大增量 | ✅ 已实现（沙箱 iframe + postMessage 桥） |
| P2 | 功能运行时按需分发（OCR/文档等不进主包） | DimAgent catalog 架构（主包 18MB） | ✅ 已实现（FeatureCatalog + probe） |
| P3 | 办公文档编辑+版本回滚（Univer） | DimAgent 集成 | ❌ 明确不做（用户决策） |
| P3 | OCR | 竞品标配 | ✅ 已实现 |
| P3 | CUA 桌面自动化 | 竞品均有 | ✅ 已实现（cua.* 工具 + 权限管控） |
| P3 | 模型自动路由 | 行业趋势（context/engineering 路由） | ✅ 已实现（打分纯函数 + 自动推荐） |

## 竞品技术要点（逆向证据）

- **DimAgent**：主包仅 18MB，功能走 catalog 按需分发；自带 `dim` CLI；集成 Univer 做办公文档编辑与版本回滚。
- **Xiaomi MiMo**：`share*` 系列远程分享、`remote*` 远程接管；语音链路用 ten_vad.wasm 做 VAD；支持手机配对。
- 两家均有：定时任务、计划模式、运行中插话。

## 剩余方向（未排期）

- 会话分享链接（在线托管）与手机远程接管——需要服务端，建议等产品化决策
- ACP（Agent Client Protocol）标准化接入——等待协议生态成熟
- 办公文档编辑——用户明确排除
