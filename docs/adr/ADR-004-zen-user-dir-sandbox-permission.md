# ADR-004: 用户数据目录切分（~/.zen + userData）

- 状态: Accepted
- 日期: 2026-09-17

## 背景

需求：用户数据关联（登录 + 配置云同步）、技能/MCP 加载、项目隔离区。需要一个存放「用户可见、可手动编辑、跨版本保留」内容的目录。

现有 userData 路径（`~/Library/Application Support/@zen/desktop`）是 OS 语义重、路径不可预测的应用内部目录，不适合作为用户手工维护的配置根。业界惯例（codex `~/.codex`、claude `~/.claude`、agents 标准 `~/.agents`）都在用户根目录使用点目录存放用户域配置。

## 决策

**需要 `~/.zen` 目录**，与 userData 按域切分：

```
~/.zen/                       用户域（可手编、可同步、可备份）
├── config.json               agent 设置（权限/隔离区/技能路径/提示词/同步）
├── mcp.json                  MCP 服务器配置
├── skills/                   用户技能（SKILL.md）
├── sandbox/                  项目隔离区根目录
└── cache/                    可随时删除的缓存

userData（@zen/desktop）       应用域（OS 管理，含敏感数据）
├── auth.json                 GitHub token（safeStorage 密文）
├── settings.json             外观/快捷键
├── zen.db                    会话/模型库
└── logs/
```

边界规则：**token/密钥只进 userData 的 safeStorage，永不进 `~/.zen`**（`~/.zen` 天然有被同步/备份的需求，不能带密钥）。

技能系统目录：`~/.zen/skills`（自有）、`~/.claude/skills`（Claude Code 兼容）、`~/.agents/skills`（Agent Skills 通用目录），外加设置页配置的多路径。

## 后果

- 用户可手编 config.json/mcp.json，崩溃时也有可读的现场。
- 云同步只导出 `~/.zen` 域的内容（providers 模型配置等），API Key 通过 safeStorage 读取后**不上传**。

## 附：权限模型决策

三档权限（需求指定）：`default` / `smart` / `full`，运行时落在 agent-core 的 `toolApproval` 策略上：

| 风险 | default 默认权限 | smart 智能权限 | full 完全访问 |
|------|-----------------|---------------|--------------|
| read（读文件/搜索） | 自动 | 自动 | 自动 |
| write（写文件） | 确认 | 工作区内自动，越界确认 | 自动 |
| exec（终端/git commit） | 确认 | 危险模式确认，其余确认 | 自动 |
| network（MCP/webfetch） | 确认 | 会话级确认（记住） | 自动 |

- 危险命令检测：`rm -rf`、`sudo`、`mkfs`、`dd`、`chmod -R 777 /`、改盘符/格式化、`curl | sh` 等模式。
- smart 档 network「会话级确认」：同一会话内同类工具确认一次后记住。
- full 档在设置页有明确警示文案。

## 附：隔离区决策

- 模式二选一（全局设置）：`direct` 直接在项目目录操作；`isolated` 把项目复制进 `~/.zen/sandbox/<项目名>/` 后，agent 的 workspaceRoot 指向隔离副本。
- 复制排除 `node_modules/.git/dist/out/build/.venv/__pycache__` 等生成物；已有隔离副本时复用（不覆盖），提供「重建」动作。
- 会话侧 git 面板与文件树同样以解析后的目录为准（main 统一解析，renderer 不传路径）。
