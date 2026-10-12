/**
 * 主进程轻量 i18n：用户可见文案（登录/设置/技能市场/更新/飞书网关）按 locale 取词。
 * 纯字典 + 占位符替换，不引第三方库；默认 zh-CN。
 *
 * 注意：currentLocale 通过动态 import 读取 user-ipc 的 loadAppSettings，
 * 避免 i18n 被无 electron 环境的单测静态拉入 electron（读取失败一律回落 zh-CN）。
 */

export type MainLocale = "zh-CN" | "en-US";

const dict: Record<string, { "zh-CN": string; "en-US": string }> = {
  // ---------- 用户/登录/设置（user-ipc.ts） ----------
  "user.sessionExpired": {
    "zh-CN": "登录已超过 3 个月，请重新登录",
    "en-US": "You signed in more than 3 months ago, please sign in again",
  },
  "user.localKeyDecryptFailed": {
    "zh-CN": "本地密钥无法解密已保存的凭据，请重新登录",
    "en-US": "The local key cannot decrypt the saved credentials, please sign in again",
  },
  "user.missingClientId": {
    "zh-CN": "未配置 GITHUB_CLIENT_ID",
    "en-US": "GITHUB_CLIENT_ID is not configured",
  },
  "user.refreshTokenFailed": {
    "zh-CN": "刷新令牌失败",
    "en-US": "Failed to refresh token",
  },
  "user.githubLoginFailed": {
    "zh-CN": "GitHub 登录失败",
    "en-US": "GitHub sign-in failed",
  },
  "user.refreshProfileFailed": {
    "zh-CN": "刷新资料失败",
    "en-US": "Failed to refresh profile",
  },
  "user.authExpired": {
    "zh-CN": "登录态已失效，请重新登录",
    "en-US": "Your session is no longer valid, please sign in again",
  },
  "user.tokenRefreshKept": {
    "zh-CN": "令牌续期未成功（网络或服务波动），已保留登录态",
    "en-US": "Token renewal failed (network or service issue); you remain signed in",
  },
  "user.openExternalUnsupported": {
    "zh-CN": "仅支持 http(s) 在应用内打开",
    "en-US": "Only http(s) links can be opened in the app",
  },
  "user.openSystemUnsupported": {
    "zh-CN": "仅支持 http(s) 链接",
    "en-US": "Only http(s) links are supported",
  },
  "user.openSystemFailed": {
    "zh-CN": "无法打开系统浏览器",
    "en-US": "Failed to open the system browser",
  },

  // ---------- 提示词预设（prompt-presets.ts，设置页展示） ----------
  "preset.zen-default.name": { "zh-CN": "Zen 默认", "en-US": "Zen Default" },
  "preset.zen-default.description": {
    "zh-CN": "Zen 自研：融合各家共性实践的中文骨架",
    "en-US": "Zen original: a Chinese-first skeleton blending common agent practices",
  },
  "preset.codex-style.name": { "zh-CN": "Codex 风格", "en-US": "Codex Style" },
  "preset.codex-style.description": {
    "zh-CN": "自主干到底、AGENTS.md 约定、治本修复",
    "en-US": "Autonomous follow-through, AGENTS.md conventions, root-cause fixes",
  },
  "preset.claude-code-style.name": { "zh-CN": "Claude Code 风格", "en-US": "Claude Code Style" },
  "preset.claude-code-style.description": {
    "zh-CN": "防御性安全、极简输出、专用工具优先",
    "en-US": "Defensive security, minimal output, dedicated tools first",
  },
  "preset.deepseek-style.name": { "zh-CN": "DeepSeek 风格", "en-US": "DeepSeek Style" },
  "preset.deepseek-style.description": {
    "zh-CN": "短、强身份、领域聚焦",
    "en-US": "Short, strong identity, domain-focused",
  },
  "preset.cursor-style.name": { "zh-CN": "Cursor Agent 风格", "en-US": "Cursor Agent Style" },
  "preset.cursor-style.description": {
    "zh-CN": "工具使用纪律：何时用/何时不用",
    "en-US": "Tool discipline: when to use which tool",
  },
  "preset.copilot-style.name": { "zh-CN": "Copilot 风格", "en-US": "Copilot Style" },
  "preset.copilot-style.description": {
    "zh-CN": "身份锁定、编辑工具落地、简短回复",
    "en-US": "Identity lock-in, edits via tools, concise replies",
  },
  "preset.mimo-desktop.name": { "zh-CN": "MIMO Desktop", "en-US": "MIMO Desktop" },
  "preset.mimo-desktop.description": {
    "zh-CN": "小米 MiMo Desktop 完整运行时提示词（base + desktop 环境）；设置页可切换中/英",
    "en-US":
      "Xiaomi MiMo Desktop full runtime prompt (base + desktop environment); switch between Chinese/English in Settings",
  },
  "preset.dimagent-parsed.name": { "zh-CN": "DimAgent", "en-US": "DimAgent" },
  "preset.dimagent-parsed.description": {
    "zh-CN": "本机 DimAgent 运行时行为规则整理版；中/英对照",
    "en-US": "Curated DimAgent runtime behavior rules; Chinese/English side by side",
  },

  // ---------- 技能市场（skills-market.ts） ----------
  "skills.searchFailed": {
    "zh-CN": "skills.sh 搜索失败 HTTP {status}",
    "en-US": "skills.sh search failed: HTTP {status}",
  },
  "skills.installTimeout": {
    "zh-CN": "安装超时：skills CLI 长时间未响应，请检查网络后重试",
    "en-US": "Install timed out: the skills CLI is not responding. Check your network and retry",
  },
  "skills.installFailed": {
    "zh-CN": "安装失败",
    "en-US": "Installation failed",
  },
  "skills.npxNotFound": {
    "zh-CN": "未找到 npx（Node.js）。请安装 Node.js 后重启 Zen 再试。",
    "en-US": "npx (Node.js) not found. Please install Node.js and restart Zen.",
  },
  "skills.installNoSkillMd": {
    "zh-CN": "安装完成但未找到 SKILL.md，请查看 skills CLI 输出",
    "en-US": "Installation finished but SKILL.md was not found; check the skills CLI output",
  },
  "skills.behindCommits": {
    "zh-CN": "上游有 {n} 个新提交",
    "en-US": "{n} new commits upstream",
  },
  "skills.upToDate": {
    "zh-CN": "已是最新",
    "en-US": "Up to date",
  },
  "skills.gitCompareFailed": {
    "zh-CN": "无法比对 git 上游",
    "en-US": "Unable to compare with the git upstream",
  },
  "skills.noUpstreamSkip": {
    "zh-CN": "无上游来源记录（本地技能），跳过比对",
    "en-US": "No upstream record (local skill); skipped",
  },
  "skills.upstreamFetchFailed": {
    "zh-CN": "无法获取上游 SKILL.md（{source}），跳过比对",
    "en-US": "Unable to fetch upstream SKILL.md ({source}); skipped",
  },
  "skills.localSkillMdUnreadable": {
    "zh-CN": "本地 SKILL.md 不可读",
    "en-US": "Local SKILL.md is unreadable",
  },
  "skills.upstreamChanged": {
    "zh-CN": "上游内容有变化，可覆盖安装更新",
    "en-US": "Upstream content has changed; reinstall to update",
  },
  "skills.notUserDirSkip": {
    "zh-CN": "非用户技能目录，跳过",
    "en-US": "Not a user skill directory; skipped",
  },
  "skills.syncBackFailed": {
    "zh-CN": "已更新 {installed}，但同步回 {target} 失败：{error}",
    "en-US": "Updated {installed}, but failed to sync back to {target}: {error}",
  },
  "skills.updateNoUpstream": {
    "zh-CN": "无上游来源记录，无法更新（本地技能请手动维护）",
    "en-US": "No upstream record; cannot update (maintain local skills manually)",
  },
  "skills.notUninstallable": {
    "zh-CN": "该技能不在可卸载的用户技能目录中",
    "en-US": "This skill is not in an uninstallable user skill directory",
  },
  "skills.invalidHit": {
    "zh-CN": "无效的技能条目",
    "en-US": "Invalid skill entry",
  },
  "skills.invalidSkill": {
    "zh-CN": "无效的技能",
    "en-US": "Invalid skill",
  },

  // ---------- 在线更新（updater.ts） ----------
  "update.devModeCheck": {
    "zh-CN": "开发模式不支持在线更新，请使用打包版本",
    "en-US": "Online updates are not supported in dev mode; use a packaged build",
  },
  "update.noFeedUrl": {
    "zh-CN": "请先在设置中配置更新源地址",
    "en-US": "Set an update feed URL in Settings first",
  },
  "update.checkFailed": {
    "zh-CN": "检查更新失败",
    "en-US": "Failed to check for updates",
  },
  "update.devMode": {
    "zh-CN": "开发模式不支持在线更新",
    "en-US": "Online updates are not supported in dev mode",
  },
  "update.downloadFailed": {
    "zh-CN": "下载更新失败",
    "en-US": "Failed to download the update",
  },
  "update.signatureError": {
    "zh-CN":
      "更新包签名校验失败（macOS）：当前安装的版本还是旧签名方案，与更新包不一致。请到发布目录手动安装一次最新版（覆盖拖入「应用程序」），之后即可正常自动更新。原始错误：{message}",
    "en-US":
      "Update package signature check failed (macOS): the installed version still uses the old signing scheme and does not match the update. Manually install the latest build from the release folder once (drag it over the copy in Applications); auto-update will work normally afterwards. Original error: {message}",
  },

  // ---------- MCP（mcp-ipc.ts） ----------
  "mcp.needsAuth": {
    "zh-CN": "需要浏览器授权",
    "en-US": "Browser authorization required",
  },
  "mcp.serverNotFound": {
    "zh-CN": "MCP 服务不存在: {id}",
    "en-US": "MCP server not found: {id}",
  },
  "mcp.stdioNoAuth": {
    "zh-CN": "本地 stdio 服务无需 OAuth 授权",
    "en-US": "Local stdio servers do not need OAuth authorization",
  },
  "mcp.toolServerMissing": {
    "zh-CN": "MCP server 不存在或未启用: {name}",
    "en-US": "MCP server not found or not enabled: {name}",
  },

  // ---------- 飞书网关（lark/gateway.ts）：状态与相对时间 ----------
  "lark.state.idle": { "zh-CN": "空闲", "en-US": "Idle" },
  "lark.state.running": { "zh-CN": "运行中", "en-US": "Running" },
  "lark.state.waitingApproval": { "zh-CN": "等待确认", "en-US": "Awaiting approval" },
  "lark.state.waitingAsk": { "zh-CN": "等待回答", "en-US": "Awaiting answer" },
  "lark.state.paused": { "zh-CN": "已暂停", "en-US": "Paused" },
  "lark.time.justNow": { "zh-CN": "刚刚", "en-US": "just now" },
  "lark.time.minutesAgo": { "zh-CN": "{n} 分钟前", "en-US": "{n} min ago" },
  "lark.time.hoursAgo": { "zh-CN": "{n} 小时前", "en-US": "{n} h ago" },
  "lark.time.daysAgo": { "zh-CN": "{n} 天前", "en-US": "{n} d ago" },

  // ---------- 飞书网关：列表/状态/项目/分支回复 ----------
  "lark.sessions.empty": {
    "zh-CN": "📋 Zen 会话：暂无未归档会话。",
    "en-US": "📋 Zen sessions: no unarchived sessions.",
  },
  "lark.sessions.header": {
    "zh-CN": "📋 Zen 会话（最近更新）",
    "en-US": "📋 Zen sessions (recently updated)",
  },
  "lark.status.empty": {
    "zh-CN": "📊 Zen 状态：当前没有运行中的会话。",
    "en-US": "📊 Zen status: no sessions are currently running.",
  },
  "lark.status.header": {
    "zh-CN": "📊 Zen 运行中的会话",
    "en-US": "📊 Zen running sessions",
  },
  "lark.projects.empty": {
    "zh-CN": "📂 Zen 项目：暂无工作区。",
    "en-US": "📂 Zen projects: no workspaces yet.",
  },
  "lark.projects.header": { "zh-CN": "📂 Zen 项目", "en-US": "📂 Zen Projects" },
  "lark.projects.matchLabel": {
    "zh-CN": "匹配「{query}」的项目",
    "en-US": "projects matching \"{query}\"",
  },
  "lark.projects.notFound": {
    "zh-CN": "未找到{label}。",
    "en-US": "No {label} found.",
  },
  "lark.projects.ambiguous": {
    "zh-CN": "🔍 {label}有多个，请用更精确的名称：",
    "en-US": "🔍 Multiple {label}; use a more specific name:",
  },
  "lark.branches.empty": {
    "zh-CN": "🌿 {name}：没有本地分支。",
    "en-US": "🌿 {name}: no local branches.",
  },
  "lark.branches.header": {
    "zh-CN": "🌿 {name} 的本地分支",
    "en-US": "🌿 Local branches of {name}",
  },
  "lark.branches.current": { "zh-CN": "← 当前", "en-US": "← current" },

  // ---------- 飞书网关：帮助/菜单 ----------
  "lark.help.title": { "zh-CN": "📖 Zen 指令", "en-US": "📖 Zen Commands" },
  "lark.cmd.sessions": {
    "zh-CN": "• 列表 / 会话 / sessions — 最近会话清单",
    "en-US": "• sessions — list recent sessions",
  },
  "lark.cmd.status": {
    "zh-CN": "• 状态 / 进度 / status — 运行中的会话与待答问询",
    "en-US": "• status — running sessions and pending questions",
  },
  "lark.cmd.projects": {
    "zh-CN": "• 项目 / projects — 项目清单",
    "en-US": "• projects — list projects",
  },
  "lark.cmd.chat": {
    "zh-CN": "• 对话 <项目名> <消息> / chat — 在指定项目新建会话并运行",
    "en-US": "• chat <project> <message> — start a new session in a project and run it",
  },
  "lark.cmd.new": {
    "zh-CN": "• 新会话 <消息> / new — 强制新建会话",
    "en-US": "• new <message> — force a new session",
  },
  "lark.cmd.continue": {
    "zh-CN": "• 继续 <消息> / continue — 追加到当前绑定会话",
    "en-US": "• continue <message> — append to the current bound session",
  },
  "lark.cmd.branches": {
    "zh-CN": "• 分支 <项目名> / branches — 查看项目本地分支",
    "en-US": "• branches <project> — list a project's local branches",
  },
  "lark.cmd.checkout": {
    "zh-CN": "• 切换 <项目名> <分支名> / checkout — 切换分支（有未提交变更时拒绝）",
    "en-US": "• checkout <project> <branch> — switch branches (refuses if changes are uncommitted)",
  },
  "lark.cmd.commit": {
    "zh-CN": "• 提交 <项目名> <说明> / commit — 提交项目全部变更",
    "en-US": "• commit <project> <message> — commit all changes in a project",
  },
  "lark.help.last": {
    "zh-CN": "• 菜单 / 功能列表 / 帮助 / help — 本帮助",
    "en-US": "• menu / help — show this help",
  },
  "lark.help.note1": {
    "zh-CN": "直接发送普通文本会继续当前绑定会话；无绑定会话时在公共区新建会话并运行 Agent。",
    "en-US":
      "Plain text continues the current bound session; with no bound session, a new one is created in the common area and the Agent runs.",
  },
  "lark.help.note2": {
    "zh-CN": "收到问询推送时，直接回复文字或选项编号即可写回会话。",
    "en-US": "When you receive a question push, reply with text or an option number to answer it.",
  },
  "lark.menu.title": { "zh-CN": "📖 Zen 指令菜单", "en-US": "📖 Zen Command Menu" },
  "lark.menu.last": {
    "zh-CN": "• 菜单 / 功能列表 / 帮助 / help — 本菜单",
    "en-US": "• menu / help — this menu",
  },
  "lark.menu.footer": {
    "zh-CN":
      "点击按钮或直接发送指令文字；普通文本会继续当前绑定会话，无绑定会话时在公共区新建会话并运行 Agent；回复问询直接发文字或选项编号",
    "en-US":
      "Tap buttons or send commands as text; plain text continues the current bound session, or starts a new one in the common area and runs the Agent; answer questions by replying with text or option numbers",
  },
  "lark.menu.statusBtn": { "zh-CN": "📊 状态", "en-US": "📊 Status" },
  "lark.menu.sessionsBtn": { "zh-CN": "📋 列表", "en-US": "📋 Sessions" },
  "lark.menu.projectsBtn": { "zh-CN": "📂 项目", "en-US": "📂 Projects" },
  "lark.cmdWord.status": { "zh-CN": "状态", "en-US": "status" },
  "lark.cmdWord.sessions": { "zh-CN": "列表", "en-US": "sessions" },
  "lark.cmdWord.projects": { "zh-CN": "项目", "en-US": "projects" },
  "lark.quick.header": {
    "zh-CN": "⚡ 自定义快捷命令（发送「快捷命令」管理）",
    "en-US": "⚡ Custom quick commands (send \\\"quick\\\" to manage)",
  },
  "lark.cmd.quick": {
    "zh-CN": "• 快捷命令 / quick — 查看、添加、删除自定义快捷命令",
    "en-US": "• quick — view, add, and remove custom quick commands",
  },

  // ---------- 飞书网关：指令用法 ----------
  "lark.usage.chat": {
    "zh-CN": "用法：对话 <项目名> <消息>（如：对话 zen 修复登录 bug）",
    "en-US": "Usage: chat <project> <message> (e.g., chat zen fix the login bug)",
  },
  "lark.usage.branches": {
    "zh-CN": "用法：分支 <项目名>",
    "en-US": "Usage: branches <project>",
  },
  "lark.usage.checkout": {
    "zh-CN": "用法：切换 <项目名> <分支名>",
    "en-US": "Usage: checkout <project> <branch>",
  },
  "lark.usage.commit": {
    "zh-CN": "用法：提交 <项目名> <说明>",
    "en-US": "Usage: commit <project> <message>",
  },
  "lark.usage.new": {
    "zh-CN": "用法：新会话 <消息>（强制在公共区新建会话）",
    "en-US": "Usage: new <message> (always creates a new session in the common area)",
  },
  "lark.usage.continue": {
    "zh-CN": "用法：继续 <消息>（追加到当前绑定会话）",
    "en-US": "Usage: continue <message> (append to the current bound session)",
  },

  // ---------- 飞书网关：问询推送与回答 ----------
  "lark.sessionFallback": { "zh-CN": "Zen 会话", "en-US": "Zen session" },
  "lark.ask.title": {
    "zh-CN": "🔔 Zen 问询 · {title}",
    "en-US": "🔔 Zen question · {title}",
  },
  "lark.ask.from": { "zh-CN": "来自 {name}", "en-US": "From {name}" },
  "lark.ask.cardFrom": { "zh-CN": "**来自** {name}", "en-US": "**From** {name}" },
  "lark.ask.multiSelectHint": {
    "zh-CN": "（可多选：回复「1,2」这样的编号组合）",
    "en-US": "(Multi-select: reply with option numbers like \"1,2\")",
  },
  "lark.ask.multiPendingTail": {
    "zh-CN": "多个问询待回答：回复 #序号 开头，如 #{seq} <答案>",
    "en-US": "Multiple questions pending: start your reply with #number, e.g. #{seq} <answer>",
  },
  "lark.ask.directReplyTail": {
    "zh-CN": "直接回复文字或选项编号即可",
    "en-US": "Just reply with text or an option number",
  },
  "lark.ask.selectPlaceholderMulti": {
    "zh-CN": "请选择（可多选）",
    "en-US": "Select (multiple allowed)",
  },
  "lark.ask.submit": { "zh-CN": "提交", "en-US": "Submit" },
  "lark.ask.confirmLabel": { "zh-CN": "确认", "en-US": "Confirm" },
  "lark.ask.cancelLabel": { "zh-CN": "取消", "en-US": "Cancel" },
  "lark.ask.textOptionalPlaceholder": {
    "zh-CN": "补充说明（可选，会与所选选项一并提交）",
    "en-US": "Notes (optional, submitted with the selection)",
  },
  "lark.ask.textRequiredPlaceholder": {
    "zh-CN": "请输入答案",
    "en-US": "Type your answer",
  },
  "lark.ask.cardNote": {
    "zh-CN": "选择/输入后点击「确认」提交；也可以直接回复文字或选项编号",
    "en-US": "Pick or type, then press Confirm; you can also reply with plain text or option numbers",
  },
  "lark.ask.cancelledTitle": { "zh-CN": "🔕 已取消 · {title}", "en-US": "🔕 Cancelled · {title}" },
  "lark.ask.cancelledNote": {
    "zh-CN": "已取消在飞书回答；该问询仍可在 Zen 中回答",
    "en-US": "Cancelled on Feishu; the question can still be answered in Zen",
  },
  "lark.ask.cancelledPick": {
    "zh-CN": "**本次回答已取消**",
    "en-US": "**This answer was cancelled**",
  },
  "lark.ask.cancelledReply": {
    "zh-CN": "🔕 已取消回答「{question}」，可在 Zen 中继续回答",
    "en-US": "🔕 Cancelled answering \"{question}\"; you can still answer in Zen",
  },
  "lark.ask.emptyReply": {
    "zh-CN": "⚠️「{question}」还没有选择或输入内容，请补全后点「确认」",
    "en-US": "⚠️ \"{question}\" has no selection or text yet; fill it in and press Confirm",
  },
  "lark.ask.emptyReplyBare": {
    "zh-CN": "⚠️ 还没有选择或输入内容，请补全后点「确认」",
    "en-US": "⚠️ No selection or text yet; fill it in and press Confirm",
  },
  "lark.quick.cardTitle": { "zh-CN": "⚡ 快捷命令", "en-US": "⚡ Quick Commands" },
  "lark.quick.cardEmpty": {
    "zh-CN": "还没有快捷命令，用下面的指令添加一个吧",
    "en-US": "No quick commands yet; add one with the commands below",
  },
  "lark.quick.usageAdd": {
    "zh-CN": "• 添加快捷命令 <别名> <提示词>（已存在则更新）",
    "en-US": "• 添加快捷命令 <alias> <prompt> (updates if exists)",
  },
  "lark.quick.usageDel": {
    "zh-CN": "• 删除快捷命令 <别名>",
    "en-US": "• 删除快捷命令 <alias>",
  },
  "lark.quick.cardFooter": {
    "zh-CN": "点击按钮可直接执行；也可发送 /别名 触发",
    "en-US": "Tap a button to run it; sending /alias also works",
  },
  "lark.quick.added": { "zh-CN": "✅ 已添加快捷命令 /{alias}", "en-US": "✅ Added quick command /{alias}" },
  "lark.quick.updated": { "zh-CN": "✅ 已更新快捷命令 /{alias}", "en-US": "✅ Updated quick command /{alias}" },
  "lark.quick.deleted": { "zh-CN": "🗑 已删除快捷命令 /{alias}", "en-US": "🗑 Removed quick command /{alias}" },
  "lark.quick.notFound": { "zh-CN": "未找到快捷命令 /{alias}", "en-US": "Quick command /{alias} not found" },
  "lark.quick.invalidAlias": {
    "zh-CN": "别名 /{alias} 不合法：不能包含空格或斜杠",
    "en-US": "Alias /{alias} is invalid: no spaces or slashes",
  },
  "lark.quick.saveFailed": {
    "zh-CN": "❌ 保存快捷命令失败：{error}",
    "en-US": "❌ Failed to save quick command: {error}",
  },
  "lark.ask.selectPlaceholder": { "zh-CN": "请选择", "en-US": "Select an option" },
  "lark.ask.cardNoteMulti": {
    "zh-CN": "点击按钮，或直接回复选项编号 / 文字；多个问询待回答时以 #序号 开头，如 #{seq} <答案>",
    "en-US":
      "Tap a button, or reply with an option number / text; with multiple questions pending, start with #number, e.g. #{seq} <answer>",
  },
  "lark.ask.answeredTitle": {
    "zh-CN": "✅ Zen 问询 · {title}",
    "en-US": "✅ Zen question · {title}",
  },
  "lark.ask.answeredPick": {
    "zh-CN": "**已选择：** {answer}",
    "en-US": "**Selected:** {answer}",
  },
  "lark.ask.answeredNote": {
    "zh-CN": "已写回会话",
    "en-US": "Written back to the session",
  },
  "lark.reply.noPending": {
    "zh-CN": "当前没有待回答的问询。",
    "en-US": "No questions are waiting for an answer right now.",
  },
  "lark.reply.multiPending": {
    "zh-CN": "当前有 {count} 个问询待回答，请以 #序号 开头回复，如：#2 <答案>",
    "en-US": "{count} questions are waiting; reply starting with #number, e.g. #2 <answer>",
  },
  "lark.reply.unknownSeq": {
    "zh-CN": "#{seq} 不是当前待答问询。当前待答：",
    "en-US": "#{seq} is not a pending question. Pending:",
  },
  "lark.reply.answered": {
    "zh-CN": "✅ 已回答：{question}",
    "en-US": "✅ Answered: {question}",
  },
  "lark.reply.invalid": {
    "zh-CN": "该问询已失效（可能已在 Zen 内回答或已取消）：{question}",
    "en-US":
      "This question is no longer active (it may have been answered in Zen or cancelled): {question}",
  },
  "lark.reply.invalidBare": {
    "zh-CN": "该问询已失效（可能已在 Zen 内回答或已取消）",
    "en-US": "This question is no longer active (it may have been answered in Zen or cancelled)",
  },
  "lark.answer.okBare": { "zh-CN": "✅ 已回答", "en-US": "✅ Answered" },
  "lark.ask.resolvedElsewhere": {
    "zh-CN": "ℹ️ 该问询已在 Zen 内回答",
    "en-US": "ℹ️ This question was answered in Zen",
  },
  "lark.cmd.pendingReminder": {
    "zh-CN": "⚠️ 还有 {count} 个问询未回答，回复 #序号 可回答",
    "en-US": "⚠️ {count} question(s) still unanswered; reply with #number to answer",
  },

  // ---------- 飞书网关：会话完成 ----------
  "lark.session.doneTitle": { "zh-CN": "✅ {title} 已完成", "en-US": "✅ {title} finished" },
  "lark.session.donePush": {
    "zh-CN": "✅ {title} 已完成\n{reply}",
    "en-US": "✅ {title} finished\n{reply}",
  },
  "lark.session.doneNote": {
    "zh-CN": "发送「状态」查看运行中的会话，「帮助」查看全部指令",
    "en-US": "Send \"status\" to view running sessions, or \"help\" for all commands",
  },
  "lark.session.noReply": { "zh-CN": "（无文本回复）", "en-US": "(no text reply)" },

  // ---------- 飞书网关：会话启动/续聊 ----------
  "lark.chat.continued": {
    "zh-CN": "💬 已继续会话「{title}」：{message}\n{progress}",
    "en-US": "💬 Continued session \"{title}\": {message}\n{progress}",
  },
  "lark.chat.progressNote": {
    "zh-CN": "运行期间可发送「状态」查看进度。",
    "en-US": "Send \"status\" anytime to check progress.",
  },
  "lark.chat.continueFailed": { "zh-CN": "续聊失败", "en-US": "Failed to continue the session" },
  "lark.chat.noStartChat": {
    "zh-CN": "网关未装配会话启动能力。",
    "en-US": "The gateway has no session-start capability wired.",
  },
  "lark.chat.newHint": {
    "zh-CN": "发送「新会话 <内容>」可另起会话",
    "en-US": "Send \"new <message>\" to start a separate session",
  },
  "lark.chat.started": {
    "zh-CN": "🚀 已在公共区开始新会话：{message}",
    "en-US": "🚀 New session started in the common area: {message}",
  },
  "lark.chat.startedInProject": {
    "zh-CN": "🚀 已在「{name}」开始新会话：{message}",
    "en-US": "🚀 New session started in \"{name}\": {message}",
  },
  "lark.chat.startFailed": {
    "zh-CN": "❌ 会话启动失败：{error}",
    "en-US": "❌ Failed to start the session: {error}",
  },
  "lark.continue.noBinding": {
    "zh-CN": "当前没有绑定的会话，发送普通消息可新建，或用「新会话 <消息>」明确新建。",
    "en-US":
      "No session is currently bound; send a plain message to start one, or \"new <message>\" to explicitly create one.",
  },

  // ---------- 飞书网关：项目/分支/提交执行 ----------
  "lark.project.notFound": {
    "zh-CN": "未找到匹配「{query}」的项目。\n\n{list}",
    "en-US": "No project matching \"{query}\" was found.\n\n{list}",
  },
  "lark.project.noPath": {
    "zh-CN": "项目「{name}」没有本地路径。",
    "en-US": "Project \"{name}\" has no local path.",
  },
  "lark.branch.fetchFailed": {
    "zh-CN": "🌿 获取分支失败：{error}",
    "en-US": "🌿 Failed to list branches: {error}",
  },
  "lark.checkout.ok": {
    "zh-CN": "✅ 已切换到分支 {branch}（{project}）",
    "en-US": "✅ Switched to branch {branch} ({project})",
  },
  "lark.checkout.dirty1": {
    "zh-CN": "⚠️ {name} 有未提交变更，已拒绝切换分支。",
    "en-US": "⚠️ {name} has uncommitted changes; branch switch refused.",
  },
  "lark.checkout.dirty2": {
    "zh-CN": "请先发送「提交 {project} <说明>」保存代码，再切换分支。",
    "en-US": "Commit first with \"commit {project} <message>\" before switching branches.",
  },
  "lark.checkout.failed": {
    "zh-CN": "❌ 切换失败：{error}",
    "en-US": "❌ Switch failed: {error}",
  },
  "lark.commit.default": { "zh-CN": "Zen 飞书提交", "en-US": "Zen Lark commit" },
  "lark.commit.ok": {
    "zh-CN": "✅ 已提交（{project}）\n{summary}",
    "en-US": "✅ Committed ({project})\n{summary}",
  },
  "lark.commit.clean": {
    "zh-CN": "📭 {name} 没有可提交的变更。",
    "en-US": "📭 {name} has no changes to commit.",
  },
  "lark.commit.failed": {
    "zh-CN": "❌ 提交失败：{error}",
    "en-US": "❌ Commit failed: {error}",
  },

  // ---------- 飞书网关：网关错误/鉴权/发送 ----------
  "lark.unauthorized": {
    "zh-CN": "⛔ 无权限：仅绑定的飞书用户可操控 Zen。",
    "en-US": "⛔ Not authorized: only the linked Lark user can control Zen.",
  },
  "lark.lockOccupied": {
    "zh-CN":
      "飞书桥接已被另一个 Zen 实例占用（PID {pid}），本次未启动事件监听；请退出另一实例或关闭其飞书桥接",
    "en-US":
      "The Lark bridge is already held by another Zen instance (PID {pid}); event listening was not started. Quit the other instance or disable its Lark bridge",
  },
  "lark.lockUnknownPid": { "zh-CN": "未知", "en-US": "unknown" },
  "lark.err.cliNotFound": {
    "zh-CN": "未找到 lark-cli 可执行文件，请先安装并登录 @larksuite/cli",
    "en-US": "lark-cli executable not found; install and sign in to @larksuite/cli first",
  },
  "lark.err.cliUnavailable": {
    "zh-CN": "lark-cli 不可用：{reason}",
    "en-US": "lark-cli unavailable: {reason}",
  },
  "lark.err.unknownReason": { "zh-CN": "未知原因", "en-US": "unknown reason" },
  "lark.err.botNotReady": {
    "zh-CN": "lark-cli bot 身份未就绪，请先运行 lark-cli auth login",
    "en-US": "lark-cli bot identity is not ready; run lark-cli auth login first",
  },
  "lark.err.killedBySignal": {
    "zh-CN": "进程被信号终止（{signal}）",
    "en-US": "process killed by signal ({signal})",
  },
  "lark.err.exited": {
    "zh-CN": "进程异常退出（code={code}）",
    "en-US": "process exited unexpectedly (code={code})",
  },
  "lark.err.consecutiveFailures": {
    "zh-CN": "飞书事件监听连续 {count} 次异常退出（{reason}）",
    "en-US": "Lark event listener exited unexpectedly {count} times in a row ({reason})",
  },
  "lark.err.restartDelay": {
    "zh-CN": "事件监听退出（{reason}），{seconds}s 后重试",
    "en-US": "Event listener exited ({reason}); retrying in {seconds}s",
  },
  "lark.err.notSubscribed": {
    "zh-CN":
      "事件 {eventKey} 未在飞书开放平台订阅回调：请到开放平台应用后台「事件与回调」订阅后，重新启用飞书桥接",
    "en-US":
      "Event {eventKey} callbacks are not subscribed on the Lark Open Platform: subscribe to it under \"Events & Callbacks\" in the app console, then re-enable the Lark bridge",
  },
  "lark.err.truncated": { "zh-CN": "…（已截断）", "en-US": "…(truncated)" },
  "lark.err.sendFailed": { "zh-CN": "发送失败", "en-US": "Failed to send" },
  "lark.send.prevFailed": {
    "zh-CN": "⚠️ 上一条消息发送失败：{notice}",
    "en-US": "⚠️ The previous message failed to send: {notice}",
  },
  "lark.send.noRecipient": {
    "zh-CN": "未配置允许操控 zen 的飞书用户",
    "en-US": "No Lark user allowed to control Zen is configured",
  },
  "lark.quick.unknown": {
    "zh-CN": "❓ 未识别的快捷命令 /{alias}。可用：{known}",
    "en-US": "❓ Unknown quick command /{alias}. Available: {known}",
  },
  "lark.quick.noneConfigured": {
    "zh-CN": "❓ 未识别的快捷命令 /{alias}（尚未配置快捷命令，在 Zen 设置 → 飞书桥接 配置）",
    "en-US":
      "❓ Unknown quick command /{alias} (no quick commands configured yet; set them up in Zen Settings → Lark Bridge)",
  },

  // ---------- 飞书网关：测试卡片 ----------
  "lark.test.notEnabled": {
    "zh-CN": "请先启用飞书桥接并绑定操控者",
    "en-US": "Enable the Lark bridge and link a controller first",
  },
  "lark.test.title": { "zh-CN": "测试问询", "en-US": "Test question" },
  "lark.test.question": {
    "zh-CN": "这是一条测试问询卡片：点击按钮或回复选项编号，验证卡片交互是否生效。",
    "en-US":
      "This is a test question card: tap a button or reply with an option number to verify card interactions.",
  },
  "lark.test.optionA": { "zh-CN": "选项 A", "en-US": "Option A" },
  "lark.test.optionB": { "zh-CN": "选项 B", "en-US": "Option B" },

  // ---------- 飞书桥接 IPC（lark/ipc.ts） ----------
  "lark.ipc.noStartChat": {
    "zh-CN": "未装配会话启动能力",
    "en-US": "Session-start capability is not wired",
  },
  "lark.ipc.noContinueChat": {
    "zh-CN": "未装配会话续聊能力",
    "en-US": "Session-continue capability is not wired",
  },
  "lark.ipc.npmNotFound": {
    "zh-CN": "未找到 npm，请先安装 Node.js 或将 npm 加入 PATH",
    "en-US": "npm not found; install Node.js or add npm to PATH first",
  },
  "lark.ipc.cliStillMissing": {
    "zh-CN": "安装完成，但未在本机找到 lark-cli，请点击重新检查",
    "en-US": "Installation finished, but lark-cli was not found on this machine; click re-check",
  },
  "lark.ipc.installFailed": {
    "zh-CN": "安装 lark-cli 失败：{detail}",
    "en-US": "Failed to install lark-cli: {detail}",
  },
  "lark.ipc.gatewayNotReady": {
    "zh-CN": "飞书网关未初始化",
    "en-US": "The Lark gateway is not initialized",
  },
};

/** 按 locale 取词并替换 {name} 占位符；缺 key 回落 zh-CN，再缺返回 key 本身 */
export function mainT(
  locale: MainLocale,
  key: string,
  params?: Record<string, string | number>,
): string {
  const entry = dict[key];
  let text = entry ? entry[locale] ?? entry["zh-CN"] : key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}

/** 当前界面语言：读 AppSettings.locale；读取失败（含无 electron 环境）回落 zh-CN */
export async function currentLocale(): Promise<MainLocale> {
  try {
    const { loadAppSettings } = await import("./user-ipc");
    const settings = await loadAppSettings();
    return settings.locale === "en-US" ? "en-US" : "zh-CN";
  } catch {
    return "zh-CN";
  }
}
