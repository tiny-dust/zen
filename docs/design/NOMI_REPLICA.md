# nomi-ai 复刻规范（Phase 1：设计底座）

> 参照：`Cookieboty/nomi-ai`（MIT，`packages/ui/src/tokens.css` 与 `packages/ui/src/styles/*`）。
> 定位：本文是**视觉与尺度的唯一依据**；`apps/ui/src/styles.css` 末尾的「nomi-ai 复刻层」是唯一数值落地处。
> 边界：只复刻布局、视觉与交互表现；Zen 的业务功能、权限边界、状态语义不因复刻删减。

## 1. 色彩

nomi 共四套主题：`light`（默认）、`sunset`、`cream`、`mist`、`ink`、`graphite`。Zen 采用：

| Zen 主题 | nomi 对应 | 说明 |
|---|---|---|
| 浅色（`:root`） | `light` | 暖白画布 `#faf9f6` + 陶土红强调 `#9d3f29` |
| 深色（`.dark`） | `graphite` | 冷灰画布 `#13161b` + 靛蓝强调 `#7887f5` |
| 可选强调色 | `data-accent-color` | 保留 Zen 既有六色，其中 `orange` 仍为原暖橙 `#ff6a2b` |

| 语义 | 变量 | light | graphite |
|---|---|---|---|
| 画布 | `--color-bg / --color-panel` | `#faf9f6` | `#13161b` |
| 侧栏 | `--color-side` | `#f2f0eb` | `#191d23` |
| 下陷 | `--color-sunken` | `#f7f5f1` | `#191d23` |
| 抬升卡 | `--color-raise` | `#ffffff` | `#282e38` |
| 悬停 | `--color-side-hover` | `#f2eee6` | `#303845` |
| 选中 | `--color-side-sel / -active` | `#f2dcd1` | `#292d49` |
| 描边 | `--color-line` | `#e5e0d7` | `#343b46` |
| 描边（弱/强） | `--color-line-soft / -strong` | `#efebe4` / `#93867a` | `#282e37` / `#414b5a` |
| 正文 | `--color-txt` | `#211d19` | `#f0f2f6` |
| 次要/弱化 | `--color-mut / --color-dim` | `#625951` / `#685e55` | `#c9cfd9` / `#969fad` |
| 强调 | `--color-accent` | `#9d3f29` | `#7887f5` |
| 强调前景 | `--color-accent-fg` | `#ffffff` | `#101321` |
| 成功 | `--agent-success` | `#24684c` | `#6cc59a` |
| 警告 | `--agent-approval` | `#7c4a00` | `#e5b567` |
| 危险 | `--agent-danger` | `#a33130` | `#f29a8e` |

规则（沿用 nomi）：

- **强调色是实底时，其前景必须满足 AA**；正文/图标上的强调一律用 `--color-accent`，不再派生第三档。
- 状态不能只靠颜色：成功/失败/等待/修改需文字或图标共同表达。
- 组件内禁止写死十六进制色值（品牌 Logo 预览除外）。

## 2. 尺度

| 类别 | 档位 | 变量 |
|---|---|---|
| 圆角 | 6 / 8 / 10 / 14 / 20 / 9999 | `--radius-xs/sm/md/lg/shell` |
| 间距 | 2 / 4 / 6 / 8 / 12 / 16 / 20 / 24 / 32 | `--space-*` |
| 控件高 | 20 / 24 / 28 / 32 / 36 / 40 | `--control-h-2xs/xs/sm/ms/md/lg` |
| 字号 | 12 / 13 / 14 / 16 / 18 / 22 | `--font-size-xs/sm/md/lg/xl/2xl` |
| 字重 | 400 / 500 / 600 | 正文 / 标签 / 标题 |
| 图标 | 16px 基准，线宽 1.5 | `--icon-stroke` |

同排控件必须同档：工具栏与对话头部用 `ms(32)`，设置表单与对话框按钮用 `sm(28)`，卡片内小按钮用 `xs(24)`，标签栏小关闭钮用 `2xs(20)`。

## 3. 表面与阴影

- 层级靠**表面明度递进**：画布 → 侧栏 → 下陷 → 抬升；静态表面无阴影。
- 阴影只给浮层：`--shadow-composer`（输入壳）、`--shadow-menu`（菜单/下拉）、`--shadow-pop`（弹窗）。
- 分栏之间用 1px 发丝线或背景差，不用彩色分隔条。

## 4. 组件规则（沿用 Zen 既有契约，数值按本文）

1. 交互一律走 `components/ui/` 原语；不新增第二套按钮体系，不手写裸控件。
2. 焦点只用 1px 边框色变化；不加 `ring-*` / `outline-*` 粗圈。
3. 图标按钮 hover 只变图标色，不加底色；行式按钮保留 hover 底色。
4. 破坏性操作用危险色 + `ConfirmDialog` 二次确认。
5. 浮层一律 reka-ui（Dialog/DropdownMenu/Popover），不手写 document 监听。

## 5. 与旧规范的冲突裁决

| 冲突项 | 旧值（MiMo 期） | 现值（nomi） |
|---|---|---|
| 强调色 | 暖橙 `#ff6a2b` 为唯一强调 | 靛蓝 `#7887f5`（深色）/ 陶土红 `#9d3f29`（浅色）；橙色降级为可选主题 |
| 圆角 | 4 / 6 / 6 / 8 | 6 / 8 / 10 / 14 / 20 |
| 正文 | 13px | 14px（次要 13px，标签 12px） |
| 控件高 | 28px | 32px（`ms`），其余档位见 §2 |
| 画布 | `#181818` 中性深灰 | `#13161b` 冷灰 |

## 6. 分阶段状态

| 阶段 | 内容 | 状态 |
|---|---|---|
| Phase 1 | token 覆盖层、字体与字号基准、本文档 | 已完成（`styles.css` 末尾「nomi-ai 复刻层」） |
| Phase 2 | 默认强调色 `nomi`（浅陶土红/深靛蓝）、Button/Input/Textarea/Select/Dialog/Popover/Dropdown 的圆角与控件高对齐变量、SectionHeader 字号 | 已完成（`styles.nomi.test.ts` 锁住 token 与选择器顺序） |
| Phase 3 | 应用骨架：标题栏横跨整窗（44px）、52px 导航轨道 + 可收起会话面板、左栏改按总宽（312/232/472）计、窗口级工作区卡片、聊天内容列 768px、信息列断点上调 1360 | 已完成（`layout.test.ts` 与 `AppSidebar.zones.test.ts` 已按新结构重写） |
| Phase 4 | 结构收口：断点常量统一导出（`WIDE_BREAKPOINT`）、收起侧栏仍计 52px 轨道、轨道内保留账户/设置入口、圆角只保留一处定义 | 已完成（`layout.test.ts` 19 条、侧栏 88 条） |
| Phase 5 | 运行时验证（构建产物实测）：控制台零报错、轨道 52px、侧栏 311px、深色 `#13161b`/靛蓝 `#7887f5`、浅色 `#faf9f6`/陶土红 `#9d3f29`、空会话垂直居中（偏移 −11px） | 已完成（截图见 `~/.zen/cache/screenshots/`） |
| Phase 6b | 空会话「欢迎区 + 输入框」整体居中（`ChatTimeline` 新增 `empty`，`App.vue` 按真实消息/审批状态派生并居中整组）；`DESIGN.md` 旧 MiMo 配色/圆角/唯一暖橙规则被直接替换 | 已完成（实测组合中心偏移 0；`ChatTimeline.test.ts` 11 条） |
| Phase 7 | 外壳重排（对齐 nomi）：外层画布 + 顶栏三段（系统信息 / 会话名下拉与操作 / 右栏标签条）+ 52px 分类轨道（账户与设置固定在底部）+ 一块左上圆角 20px 的工作区包住「会话面板 + 中央区 + 右栏」；分类入口改为内容区整页（`stores/workbench-page.ts` + `layout/WorkbenchPages.vue`），不再弹窗 | 已完成（`AppRail`/`RightPanelTabs` 新组件；ui typecheck、982 用例、build 通过；实机走查骨架几何：轨道 52 / 顶栏 44 / 工作区圆角 20 且背景 `--color-panel`） |
| Phase 8 | 会话信息新增「运行轨迹」：`lib/trace/*` 文档构建 + `components/trace/*` 工作台（KPI 条、轨迹图/时间线/思考脉络/模型分析/网关请求/子进程收发/原始事件七视图、搜索与过滤、右侧检查器与耗时构成），入口在会话信息首行并按七视图 tab 挂到右栏 | 已完成（19 条纯函数用例 + 3 条组件用例；实机用真实会话验证 KPI 31 轮 / 229 思考 / 316 工具、轨迹图节点与检查器参数、时间线、思考脉络、模型分析空态、原始事件 JSON） |
| Phase 10 | 第三方 agent 一等化：轨道厂商图标直接开 `external` 面板，列表 + 完整记录 + **在原厂商会话续聊**（Claude `--resume <id> -p`、Codex `exec resume`、Gemini 需 `--help` 里确有 `--resume`；DSH/Grok 明确不支持），能力表 + 90s 无输出看门狗；侧边对话独立落库（`side_chats` 表 + 隐藏会话执行，关闭标签不删、重启可续）；Git 对齐 VS Code Source Control 第一阶段（已暂存/更改/合并冲突分组、逐文件暂存与取消暂存、只提交已暂存、分侧 diff） | 已完成（shared 122 / desktop 841+6 skipped / ui 1034 用例，全仓 typecheck 与 ui build 通过；实机验证续聊能力表与看门狗报错、侧聊流式与跨重启恢复、临时仓库 stagedOnly 提交语义） |
| Phase 14 | 运行轨迹性能：轨迹图改为视口裁剪（只挂载相交节点/连线，布局坐标完整，定位与聚簇仍可达）；拖动按 rAF 合并、只在换会话时自动适应画布；文档构建按消息缓存 + 稳定节点 id（流式只重建变化的那一轮）；搜索输入 150ms 防抖（回车先落地）；时间线/思考脉络按视口懒挂载；高亮无搜索词时直出文本；原始事件只渲染前 256KB、完整 JSON 走「复制全部」 | 已完成（真实长会话 50 轮 / 2285 节点 / 12MB：打开 1323→722ms、拖动 26→4ms/帧、搜索 380→47ms/键、时间线 757→259ms、思考 2903→247ms、原始事件 6603→307ms、文档重建 45.7→2.6ms） |
| Phase 13 | 会话侧栏对齐 nomi：行首状态点（运行转圈 / 完成绿点 / 失败红点），行尾只留置顶与「更多」，行内三个图标按钮收进菜单；新增会话操作菜单（右键与「更多」共用：重命名 / 分叉 / 置顶 / 导出 / 归档 / 删除）；新增悬停详情卡（完整标题、相对时间、状态、所属工作区，点标题就地改名）；侧栏新增「已归档」分区，归档会话与归档工作区可查看、恢复、经确认后删除 | 已完成（实机：详情卡、菜单 6 项、右键同菜单、归档 → 归档区 → 恢复全链路，typecheck / 1078 条 UI 用例 / 构建通过） |
| Phase 12 | 分栏可拖与消息列加宽：定位到「store→panel 回写」与 reka 拖拽回调互相覆盖导致宽度被钉回原值（左栏拖不动），用刚下发的尺寸做回声过滤；手柄命中区 1px→9px（可见线仍 1px）；`--chat-content-w` 768→960；信息列断点上调到 1644、右栏默认宽度封顶 480，1440 窗口下消息列 353→582；工具行改单行 + 路径截断，不再把状态徽标挤到第二行 | 已完成（1440 窗口实测：拖左/右分隔线各 ±80px 生效、消息列 582px、手柄 9px 命中区、全仓 typecheck 与 1067 条 UI 用例通过） |
| Phase 11 | 视觉与结构对齐：轨道 52px / 18px 图标 / 分类与第三方 Agent 间分隔线；内容区顶栏标题靠左、操作组靠右；任务弹窗 720px（`data-large-panel` 才是真正放开 `sm:max-w-sm` 的开关）并分四组；技能/MCP 改列表优先（添加/编辑/扫描目录进子弹窗）；记忆扩成五页签（对话摘要、事实、用户档案、设备与习惯、设置导出），补 `memory-conversations.ts`（原子写、模型提取、事实近重复去重、词法召回 + 档案注入、自动摘要节流），自动摘要/提取/召回默认关闭 | 已完成（shared 122 / desktop 865+6 skipped / ui 1055 用例，全仓 typecheck 与 ui build 通过；实机核对轨道 52px+分隔线、顶栏左右边界 312/1084、任务弹窗 720px、记忆五页签与设置读写） |
| Phase 9 | 轨道加宽到 64px、外部客户端改厂商标识；设置从弹窗改为内容区整页（深链接/快捷键/轨道入口同一处，对话子树保活不丢草稿）；「计划任务」升级为 Nomi 式任务体系：新契约 `packages/shared/src/types/task.ts` + 纯状态机 `utils/task-machine.ts`，主进程 `main/tasks/{store,runtime,service}.ts` 三表持久化、队列并发 2、重试退避、启动恢复、验收/退回、归档/还原，IPC 16 通道 + `tasks:event`，任务页含列表/看板/详情/新建授权卡与旧计划任务分组 | 已完成（shared 122 / desktop 794 / ui 1002 用例，全仓 typecheck 与 ui build 通过；实机走通「通知任务 → 已完成」与「Agent 任务 → 待验收 → 验收 → 归档 → 删除」） |
| Phase 6 | 设置/模型/看板/素材库/账本按本文数值收敛：字号统一 14/13/12、导航项圆角回到 8px、模型行密度、看板栏头、账本层级、素材库缩略图与可聚焦删除按钮 | 已完成（按规范推导，无截图对照） |

## 7. 许可

nomi-ai 为 MIT。本轮只复刻设计数值与结构，不复制其组件代码、品牌素材、字体文件与图标资源；Zen 继续使用仓库内置 MiSans / Maple Mono。

## 8. 功能对齐记录

| 日期 | nomi 行为（源码依据） | Zen 落地 | 验证 |
|---|---|---|---|
| 2026-11-27 | 会话详细程度 Transcript view：`packages/ai-chat/src/services/transcriptView.ts`，四档 minimal/normal/thinking/verbose，全局默认 + 会话级覆盖，localStorage 持久化，最多 500 条会话覆盖 | 新增 `apps/ui/src/stores/transcript-view.ts`（同四档、同分层、同上限）；顶栏 `TranscriptViewMenu.vue`；`MessageBubble` 按档过滤思考块；`ToolCallGroup` 在「详细」档默认展开 | 单测 6 条 + 组件 2 条；构建产物实测：菜单 5 项、选择「精简」写入 `sessions[sessionId]`、触发按钮出现覆盖圆点 |

## 9. 外部会话与看板

| 项 | 实现 | 验证 |
|---|---|---|
| 读取层 | `apps/desktop/src/main/external-sessions.ts`：五客户端目录、按字节限量读（截断退回整行）、轨迹最多 300 条 | 15 条单测（含读取上限与截断） |
| 状态可信度 | 仅 DSH 的 `session.lock` 在 90s 内刷新过才标「运行中」，其余一律「状态未确认」 | 单测 + 本机真实扫描 |
| 读取失败 | `ExternalSessionTrace.error` 传回界面，不把失败显示成「没有轨迹」 | store 单测 |
| 侧栏浮层 | `CollapsedSessionPeek.vue`：受控浮层（点击/回车开、Esc 关、点外部关），Teleport 到 body 避免轨道裁切 | 2 条组件测试 + 构建产物实测（left=56、Esc 关闭） |
| 端点筛选 | `ExternalEndpointRail.vue`：五客户端、未安装禁用并说明、再点回「全部」 | 3 条组件测试 |
| 看板 | `FleetPage.vue` 只替换中央工作区，顶栏/轨道/右标签栏保留 | 构建产物实测 |


## 10. 图标与多主题

| 项 | 实现 | 验证 |
|---|---|---|
| 图标来源 | 新增 `@tabler/icons-vue`（MIT，与 nomi 同源）；统一入口 `apps/ui/src/components/icon/AppIcon.vue`（nav 18 / inline 16 / empty 22，线宽 1.75，默认 aria-hidden） | 2 条组件测试 |
| 图标收细 | `--icon-stroke: 1.75`，同时覆盖 `svg.lucide` 与 `svg.tabler-icon` | 构建产物实测计算值 1.75px |
| 主题预设 | 七套：light / dark / mist / graphite / ink / cream / sunset + system；`data-theme` 驱动，深色预设同时带 `.dark` 类 | 7 套实测面板色与文字色 |
| 原生外观 | `nativeTheme.themeSource` 按预设基底映射（system 交给系统） | 类型检查 + 构建 |
| 默认主题 | 新安装默认 light；已存设置原样保留（`normalizeTheme` 只认合法值） | 5 条预设测试 |
| 设置页 | 主题改为色卡网格（aria radiogroup，选中态有勾选与边框） | 构建通过；未做截图比对 |

未完成：图片主题、自定义主题（编辑/导入/导出）、其余页面的图标迁移。

## 11. 图片主题

| 项 | 实现 | 验证 |
|---|---|---|
| 选图与校验 | `apps/desktop/src/main/theme-image.ts`：系统弹窗（经 `showOpenDialogSafe`）→ 文件头判定真实格式（PNG/JPEG/WebP）→ 12MB 上限 → 复制到 `userData/theme-images/<随机名>.<ext>` | 格式与大小分支在代码中显式返回错误码 |
| 安全读取 | IPC 只接受白名单文件名（`/^[a-z0-9]{8,64}\.(png\|jpg\|jpeg\|webp)$/`），返回 data URL；不暴露任意路径，不加载远程 URL | 4 条 unit test（路径穿越、URL、错误扩展名全部拒绝） |
| 持久化 | `settings.json` 只存 `id / enabled / blur / dim`；启动时读回并校验文件是否存在，缺失则清引用并回退 | `normalizeThemeImage` 夹紧范围、无图强制关闭 |
| 背景层 | `apps/ui/src/components/chat/ChatBackground.vue`：底图 + 单层遮罩，`pointer-events-none`，只作用于聊天内容区 | 2 条组件测试 + 1 条 normalize 测试 |
| 设置面板 | 外观页新增图片卡片：缩略图、启用开关、换图/移除、模糊 0-40、遮罩 0-90% | 类型检查 + 构建；卡片未做截图比对 |

## 12. 自定义主题与主题包

| 项 | 实现 | 验证 |
|---|---|---|
| 模型 | `packages/shared/src/theme/custom.ts`：四个种子色（accent/background/surface/text）、明暗基底、可选另一套明暗、白名单 token 覆盖 | shared 7 条测试 |
| 推导 | `deriveZenTokens` 映射到 Zen 的 `--color-*`；正文/次级文字按 WCAG 4.5:1 自动微调；只产出白名单变量 | 含「浅底浅字」坏输入用例 |
| 应用 | `useAppTheme` 用 `style.setProperty` 写 `:root`，切回预设时逐条移除；指向不存在的主题整体回退默认预设 | ui 2 条测试 |
| 存储 | 主题定义存在 `settings.json`（`customThemes`，上限 50、每个 ≤64KB）；背景图复用 `theme-images` 受控目录 | store 4 条测试 |
| 导入/导出 | `apps/desktop/src/main/theme-pack.ts`：JSON（`.nomitheme.json`）与 ZIP（`.nomitheme`，theme.json + background.*），最小 ZIP 读写用 `node:zlib` 手写，无新增依赖 | desktop 4 条测试（含目录穿越、多余文件、坏 JSON） |
| 限制 | 包 ≤8MB、theme.json ≤64KB、背景图 ≤12MB、条目 ≤4 个、条目名不得含 `/`、`\`、`..` | 同上 |
| 图片替换安全 | 选图只写新文件，**设置保存成功后**才按引用清理旧图；`pruneThemeImages` 只删白名单命名的孤儿 | 代码路径核对；实机未点验 |
| 编辑器 | 名称、基底、四色、可选另一套明暗、可选背景图；删除用两步确认 | 构建与类型检查通过；界面未截图比对 |

## 13. 收尾轮：数据安全、主题包互通、图标迁移

| 项 | 变更 | 验证 |
|---|---|---|
| 图片生命周期 | 删除目录级清理与启动清理，改为「按显式 id 删除」；只有旧设置引用、新设置不再引用的图才会被删；`theme-image:clear` 在主进程校验是否仍被引用 | store 2 条新测试（保存失败回滚、并发读图） |
| 选图失败回滚 | 设置保存未成功时删掉刚写入的新文件并恢复原设置，错误码 `pick-failed` | 同上 |
| 读图并发 | 请求序号守卫：慢响应回来时若已切换，丢弃结果 | 同上 |
| ZIP 正确性 | 写入补 CRC32、DOS 时间、UTF-8 标志位；读取校验 CRC、条目范围，解压用 `maxOutputLength` 在**过程**中限流 | desktop 6 条测试（含 CRC 篡改、目录穿越、多余文件、坏 JSON） |
| Nomi 互通 | 导入 `packFromNomi`：`--cd-*` token → Zen token、`background.image/opacity` → `id/dim`；导出 `packToNomi`：反向映射 + `format: 2` + `image/opacity` | shared 2 条映射测试 + desktop nomi 样本导入测试 |
| 原生外观 | 带另一套明暗的自定义主题交给系统（`themeSource = "system"`） | 类型检查（实机未点验） |
| 自定义主题背景 | `ChatBackground` 优先用当前自定义主题自带的图，其次图片主题；切换时重读并丢弃过期结果 | 未单独加测试 |
| 图标迁移 | 87 处 lucide 导入改为 Tabler（保持本地别名，模板零改动）；构建产物里 `svg.tabler-icon` 35 个、残留 `svg.lucide` 2 个（shadcn 原生控件内部） | 全量测试 + 构建产物实测，线宽 1.75 |

**未迁移**：`components/ui/*`（shadcn 上游模板）、`ai-elements/*`、`lib/tool-meta.ts`、`session/ReferencesSection.vue`（多行导入且含 Tabler 没有对应图标的名称）。

