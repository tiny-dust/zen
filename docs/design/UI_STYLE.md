# Zen UI 设计规范（定型版）

> 状态：已定型 · 2026-09-14
> 适用范围：apps/ui 全部界面。新界面/新组件一律遵循本规范；存量代码按此逐步收敛。

## 1. 风格基调

Zen 对齐 **Xiaomi MiMo Desktop** 的视觉语言：极致克制的单色调 + 少量暖橙点缀。

- **中性优先**：界面 95% 由灰阶表面与文字构成，颜色只用于状态与强调。
- **唯一强调色**：`--color-accent`（暖橙 #ff6a2b）只用于「强调点」，不做大面积铺色；发送主按钮用强调色圆形（`--color-accent` + `--color-accent-fg`，与 MiMo 截图同构；空输入禁用态为灰圆），`--color-send` 中性反色保留给其它主按钮。
- **深色为默认主题**：`main.ts` 挂 `.dark`；浅色主题通过同一组 token 支持，不做单独设计。
- **精致细节**：12px 全局圆角、低饱和发丝线（`--color-line`）、克制的双层阴影（composer/menu/pop 三档）。

## 2. Token（唯一样式真源）

所有颜色/圆角/动效/阴影只允许引用 `apps/ui/src/styles.css` 的 CSS 变量，**禁止在组件里写死十六进制色值**（品牌 Logo 预览 `AppIcon.vue` 除外）。

| 类别 | 变量 | 用途 |
| --- | --- | --- |
| 表面 | `--color-bg / -panel / -side / -sunken / -set-card` | 窗口、主区、侧栏、下陷区、设置卡片 |
| 线条 | `--color-line / -line-soft / -line-strong` | 分隔线、卡片描边（1px） |
| 文字 | `--color-txt / -txt-strong / -mut / -dim` | 正文、标题、次要、弱化 |
| 交互 | `--color-menu-hover / -menu-active / -side-sel` | 悬停、选中态背景 |
| 状态 | `--color-ok / -err / -add / -del / -danger-*` | 成功/错误/删除等 |
| 圆角 | `--radius(-sm/-lg/-shell)` | 8 / 12 / 16px，全局只用这四档 |
| 动效 | `--motion-fast/-base/-slow` + `--ease-*` | 0.12s/0.18s/0.2s，只动颜色与位移 |
| 阴影 | `--shadow-composer / -menu / -pop / -tip` | 输入卡、浮层、弹窗、tooltip 四档 |
| 壳体尺寸 | `--titlebar-h / -pad / -lead`、`--panel-head-h`、`--control-h` | 标题栏 38px、上下内边距 5px、窗口按钮预留 72px、栏头行 38px、控件高 28px |
| 图标 | `--icon-stroke` | 图标线宽 1.5（lucide 默认 2 偏粗，全局收细，见第 3 节第 4 条） |
| 层级 | `--z-overlay / -popup / -modal / -toast` | 40 / 50 / 70 / 90；**遮罩必须低于浮层**，reka 浮层由 `[data-reka-popper-content-wrapper]` 统一锁到 `--z-popup` |

字号体系：正文 13–14px，辅助 11–12px，标题 14–18px；等宽场景（模型 ID、路径、设备码）用 `--font-mono`。

## 3. 组件分层（硬性规则）

1. **shadcn-vue（`components/ui/`）是唯一交互原语来源**：按钮、输入框、下拉、对话框、菜单、开关等一律使用现有原语；缺原语时先补原语再使用。
2. **禁止手写裸 `<button>` / `<select>` 交互控件**。业务组件里允许保留的原生元素只有两类：
   - 作为 shadcn `as-child` 触发器的自绘按钮（如 `ModelPicker` 的胶囊触发器、`UserBlock` 的用户行）；
   - 纯导航/列表类 button（侧栏导航项、设置页菜单项、模型行），且必须复用 token 样式。
3. **不新增第二套按钮体系**。统一用 `Button`（variant + size + `cn()` 覆写）；**业务组件禁止直接写原生 `<button>` / `<input>` / `<textarea>` / `<input type="range">`**，一律经由 `components/ui/` 封装（Button / Input(支持 ghost 变体) / Textarea(支持 ghost 变体) / SliderRange / reka Trigger）。仅允许的例外：`<input type="file" class="hidden">` 隐藏文件选择器。图标按钮必须带 `aria-label`；`Input`/`Textarea` 暴露 `focus/blur/select`，ref 取组件实例而非原生元素。
4. **操作图标统一 `@lucide/vue`**，16px 基准；线宽不走组件参数，由 `--icon-stroke`（1.5）在 `styles.css` 里全局覆盖 lucide 的 `stroke-width=2`，组件内不要再逐个传 `stroke-width`。**文件/目录类型图标统一使用 Charmed Icons**，通过 `components/files/FileIcon.vue` / `FileLabel.vue` 展示本地 SVG，保留上游原色，不受 lucide 线宽或 Markdown 图片圆角影响。资源及映射位于 `apps/ui/src/assets/charmed-icons/`，MIT 许可随发行包保留；不再使用通用文件图标加手工颜色模拟语言标识。
5. **浮层（dropdown/dialog/popover）一律走 reka-ui**（shadcn 封装），自带焦点圈、Esc、外点关闭；不要再写 `document.addEventListener("click")` 式手稿浮层。
6. **破坏性操作必须危险色 + 二次确认**（`base/ConfirmDialog.vue` + `base/DangerIconButton.vue`）：
   - 不可撤销的删除，主按钮用 `Button variant="destructive"`，行内删除图标用 `DangerIconButton`（常态即 `--color-del`，悬停提亮为 `--color-danger-fg`，不出现底色）；
   - 点击后一律先过 `ConfirmDialog`：标题写动作（`删除供应商？`），描述写清「删谁 + 删掉什么 + 不可撤销」，确认按钮写具体动作（`删除供应商`）而不是「确定」；取消在左、默认聚焦，取消文案可写 `继续当前会话` 这类明确语义；
   - 只对**会落库**的删除加确认；尚未保存的本地行（如新增供应商表单里的待添加模型）用危险色图标直接移除，不打扰；
   - 清空类动作同样算破坏性：标题栏「新对话」在有消息时才拦一道。
7. **聚焦/选中态只做颜色反馈，禁止粗圈**：`focus-visible` / `aria-invalid` 一律不加 `ring-*` / `outline-*` 描边，只允许边框或底色变化一档（边框走 `focus-visible:border-ring`，`--ring` 即聚焦线色，light `#8a8a85` / dark `#6a6a6a`）；shadcn-vue 原语的 `focus-visible:ring-3` 已全局移除，新增/升级原语时照此收敛。ChatComposer 壳面使用 `--color-composer-surface`（#202020）+ `--shadow-composer`，无边框（拖拽文件悬停时才亮边）。

8. **消息区无气泡（assistant）**：assistant 内容为裸 markdown 直接铺在背板上（无卡片壳、无头像、无角色标签）；user 消息右对齐弱气泡（`--color-side-sel`）。离底 >80px 时 composer 上方出现圆形「回到底部」浮动按钮。composer 底部为居中的「内容由 AI 生成，请注意核实」免责声明行；仓库/分支/上下文用量移入会话信息卡的「环境信息」节。

9. **按钮无聚焦样式；图标按钮 hover 不上底色**：所有 `button` 一律不显示聚焦反馈（`button:focus-visible { outline: none }`，Button 原语也已移除 `focus-visible:border-*`）——聚焦边框只保留给输入类控件（Input/Textarea/Select 触发器）。**图标按钮**（Button 的 `icon-*` 尺寸，以及 `<button>` 自绘的纯图标按钮：标题栏/侧栏图标、会话行 +/置顶/归档/删除、composer +/麦克风、回底按钮等）hover 只高亮图标本身（`hover:text-*`），**不出现任何底色**；Button 原语通过 `compoundVariants` 对 icon 尺寸强制 `hover:bg-transparent!`。行式按钮与菜单项（导航行、列表行、DropdownMenuItem）保留 hover 底色；破坏性图标按钮 hover 用更亮的危险色取代红色底。

## 4. 布局骨架

四列可拖拽布局（`App.vue`）：左栏 180–420 / 中央区（聊天列 + 250px 会话信息卡列，≥1100px 宽时出现信息卡）/ 右工具侧栏 240–窗口 75%。拖拽钳制两侧互斥（`stores/layout.ts`）：任何一侧拉宽都必须给中央区保底 420px（含会话信息卡列时 670px），窗口 resize 后按新边界回收两侧宽度。聊天内容与 composer 共用 860px 居中列。底部终端面板属于中央区（不盖住工具侧栏）。

**窗口 chrome 按列拆分（无全宽标题栏）**——各列自带 38px 头行（`--titlebar-h`），背景即列背景，相互之间只用背景色区分、不画分隔线：

- 左侧栏头行（`AppSidebar`）：交通灯预留 `--titlebar-lead: 72px` + 侧栏开关 + 搜索 + 通知，图标左对齐跟交通灯；
- 中央区头行（`AppTitlebar`）：会话名左对齐于主区左缘；右簇 = 新对话 ｜ 会话信息 → 底部面板（右栏收起时追加右栏开关）；
- 工具侧栏头行（`RightPanel`）：面板开关（展开态自带选中底色）；
- 所有头行均为拖拽区，按钮 `no-drag`；侧栏收起时其控件回退到中央区头行（交通灯预留同步迁移）。

右栏结构（对齐 MiMo）：**会话信息卡**（`SessionInfoPanel`，圆角悬浮卡 `--color-raise`，节头 = 标题 + chevron + 计数徽标；环境信息 / 任务清单 / 产物 / 参考 / 项目文件，节可折叠）+ **工具侧栏**（`RightPanel`，图标 + 文字纵向导航：文件 / Git / 浏览器 / 终端，选中/开启态用 `--color-menu-active` 底色）。

## 5. 密度与去重（硬性规则）

1. **同一信息只写一次**：弹窗标题由设置壳（`SettingsPage` 的 `pane-head`）负责，子面板不再写自己的标题与说明；会话名只在标题栏；面板的说明文案由父级统一提供。
2. **label 与控件同行**：设置里的表单/详情统一用 `.field-row`（左标签 88px 定宽 + 右控件自适应，行高 30px，行间 1px 发丝线），不再用「标签在上、控件在下」的堆叠式 `FieldGroup`。
3. **列表行压成一行**：`.list-row` / 模型行 = 标题 + 等宽次要信息 + 能力摘要（`推理 · 视觉 · 工具 · 128K` 单行文本，不再每行堆四个徽章），行高 30px。
4. **列表常驻**：供应商等主从结构里，左列表在「查看 / 新增 / 编辑」所有模式下都可见可点，绝不因为打开表单而消失；切换列表项一律回到该条目详情。
5. 禁止跨区重复的容器：卡片头里不再重复所属区域已表达的标题。

## 6. 文案

- 界面口吻：直接、动词开头；按钮写「发送 / 保存供应商」，不写「提交」。
- 空态给行动指引：如聊天空态「在下方输入并发送，Agent 将流式回复」。
- 错误信息保留主进程原文（多为供应商返回），外层不再加工。

## 7. 已收敛记录

- 2026-09：删除 `BaseButton`/`IconButton` 双轨按钮层；`ModelPicker` 重建为 DropdownMenu；`InfoPopup` 重建为 Dialog；顶栏图标改 lucide（修复默认 fill 黑块）。
- 2026-09-15（UI 专项治理）：
  - 删除侧栏 Logo 与版本号，`BrandMark.vue` 不再被引用；搜索 / 通知从侧栏移入标题栏左簇；`AppTopbar.vue` 删除，改为全宽 `AppTitlebar.vue`（38px，与窗口按钮同行，上下 5px 一致内边距）。
  - 会话名去重：只保留标题栏一处，「新对话」并入标题栏右簇。
  - 设置弹窗放宽为 `min(1180px, 100vw-48px) × min(820px, 100vh-56px)`；子面板重复标题与说明上移到 `pane-head`。
  - 设置遮罩层级从写死的 `z-index: 60` 改为 `--z-overlay`（40），修复「模型供应的消息协议下拉被弹窗遮住」；其次该下拉在编辑态曾被 `disabled`，现允许修改已存在供应商的协议。
  - 模型供应改为「左列表常驻 + 右详情/表单」，label 与输入同行，模型行单行化。
  - 危险操作危险化：新增 `base/ConfirmDialog.vue`（删除供应商 / 删除模型 / 新对话有消息时）与 `base/DangerIconButton.vue`；删除供应商按钮从 ghost 改 `destructive`，行内模型删除图标常态危险色。
  - 图标线宽全局收细到 `--icon-stroke: 1.5`（`styles.css` 覆盖 lucide 的 `stroke-width=2`）；标题栏左簇宽度跟随左栏，搜索 / 通知 / 侧栏折叠贴左栏右缘。
- 2026-09-16（MiMo 1:1 样式复刻）：
  - 窗口 chrome 按列拆分：删除全宽标题栏，侧栏/中央区/工具侧栏各带 38px 头行（拖拽区），列间只靠背景色（侧栏 #141414 / 其余 #181818）区分、不画分隔线；会话名改为主区左对齐。
  - 恢复侧栏品牌行（Zen + Beta 徽标，推翻 09-15 的删除决策——1:1 对齐 MiMo 侧栏结构）；侧栏导航改图标 + 文字（13.5px），项目节头带 chevron、项目行带 folder 图标与选中底色。
  - 消息区去气泡：assistant 裸 markdown（无壳/无头像），user 右对齐弱气泡；恢复被 preflight 清掉的列表圆点/编号；新增离底 >80px 的圆形回底浮动按钮；修复 `watch(messages)` 浅监听导致 push/流式 delta 不触发自动滚动的存量 bug（改为监听 length/content/reasoning）。
  - Composer：壳面 #202020 无边框（仅拖拽悬停亮边）、发送钮改圆形（30px）、底部改居中 AI 免责声明（git/usage 信息迁入会话信息卡「环境信息」节）。
  - 右栏对齐 MiMo 双列：会话信息卡（圆角悬浮卡 `--color-raise` #191919，节头 + 计数徽标 + 折叠，绿色圆勾任务清单；去掉「调用技能」节）+ 工具侧栏（图标 + 文字纵向导航：文件 / Git / 浏览器 / 终端，头行面板开关带选中底色；去掉横向 tab 行与「xx 面板」footer）。
  - 底部面板终端化：tab 片（终端）+ 发丝线 + mono 占位内容。
- 2026-09-16（聚焦态与 composer 治理）：
  - 移除全部 shadcn 原语（Input/Textarea/Button/Checkbox/Switch/SelectTrigger/Badge/ScrollArea）的 `focus-visible:ring-3` 与 `aria-invalid:ring-*`，聚焦/选中只保留颜色反馈（见第 3 节第 7 条）；`--ring`/`--sidebar-ring` 从 `#151c13`/`#fff` 调为聚焦线灰（light `#8a8a85` / dark `#6a6a6a`）。
  - ChatComposer 壳面对齐 DimAgent：改用 `--color-composer-surface` + `--shadow-composer`（浮起壳面，不再用比背板更暗的 `--color-side`），placeholder 走 `--color-composer-placeholder`；EffortSlider 移到底栏右簇（推理强度/模型/发送，见 zen-002）。
  - 发送按钮对齐 DimAgent：中性圆形改强调色圆角方形（`--color-accent` + 新增 `--color-accent-fg` 前景 token），图标统一 lucide `ArrowUp`；Composer 壳体收紧（px-3.5 / textarea min-h 48）。
  - Composer 壳下新增状态行（仓库 · 分支 + 上下文用量%；非 git 目录时整段 git 信息隐藏）：新增 `agent` `usage` 流事件（agent-core 在 `finish-step` 上报 inputTokens/outputTokens）、`git:info` IPC（repo 取 toplevel basename，branch 取 `--abbrev-ref HEAD`，非 git 返回空串）；`SessionInfoPanel` 的分支从写死 mock 改为真实数据且无分支时隐藏。
- 2026-09-17（面板拖拽 / diff / chat 组件化）：
  - 面板钳制重写（`stores/layout.ts`）：左栏 180–420、右栏 240–窗口 75%，两侧互斥钳制给中央区保底 420px（含会话信息卡列 670px）；`syncViewport` 在窗口 resize 后回收两侧宽度——修复两栏各拉到窗口 75% 把聊天区压没、以及窗口变小后面板溢出的存量问题；左栏最小宽从 220 收到 180。
  - 变更文件 diff 视图：新增 `right/DiffView.vue`（双行号 gutter、增删行着色、hunk 头、meta 行，token 取 `--color-add/-del`），`ChangesPanel` 接入并补「读取中/无变更内容」状态；未跟踪文件由 git store 读文件内容合成纯新增 diff，仅暂存文件回落 staged diff。
  - chat 区组件化（ai-elements-vue，落位 `components/ai-elements/`，新增 shadcn-vue `collapsible`/`hover-card` 原语与 `vue-stream-markdown` 依赖）：思考过程改 `Reasoning`（流式自动展开、结束 1s 后收起、显示时长），正文改 `Response` 流式 markdown（vue-stream-markdown 增量渲染，替代 marked+DOMPurify），空回复 loading 改 `Loader`，用户消息与 composer 附件统一 `Attachment` inline chips（图标按扩展名推断）。
  - 右栏内部布局二轮：文件/变更面板的列表与内容区分割线改 `ResizeHandle line` 模式（常显 1px 线、悬停高亮、可拖拽 18%–66%）；CodeMirror 预览撑满内容区（`.zen-code-viewer`）；变更面板新增「变更/图谱」视图切换，新增 `right/GitGraph.vue`（泳道提交历史，数据走 git store 的 `refreshLog`），删除无引用的死代码 `GitPanel.vue`。
  - 图谱 VS Code 化：提交行点击展开详情块（完整 message、Commit/Parents/Author/Committer/Date、变更文件列表含状态徽标与 +N/-N，按 hash 懒加载缓存）；泳道竖线穿过详情块保持时间轴连贯；新增 `git:commit-detail` IPC（`diff-tree -r --root -m --first-parent` 的 numstat+name-status 合并 + `log -1` 完整信息，hash 入参做十六进制校验），shared 新增 `GitCommitDetail`/`GitCommitFile` 类型。
  - 右栏修复二轮：顶部 tab 是 div 且头部为窗口拖拽区，Electron 下点击被拖拽吞掉无法切换——`[role='tab']` 一并豁免 no-drag；图谱详情文件行可点击展开该文件的 commit patch（新增 `git:commit-diff` IPC，`diff-tree -p -m --first-parent` 限路径，行内 DiffView 渲染，max-h-72 内滚动）。
  - 分批提交：提交面板「提交/提交并推送」在未手填 message 时走 `git:commit-batched`——主进程用模型按变更内容把文件分成 1-6 批并生成各批 message（JSON 计划解析校验 + 模型不可用时按目录确定性兜底），逐批 `add + commit(pathspec 限定)`（不泄漏其它已暂存内容），完成后统一 push；手填 message 仍为单提交；「包含未暂存」关闭时仅对已暂存文件分批。
  - 图谱独立成 tab：从变更面板拆出，成为右栏与文件/浏览器/变更同级的顶级 tab（`RightPanelKind` 增加 `graph`，头行按钮 GitGraph 图标开面板）；GitGraph 自带头行（提交历史 + 计数 + 刷新，watch cwd 自动刷新）；变更面板还原为纯变更视图。注意 RightPanel 内 lucide `GitGraph` 图标与 `GitGraph.vue` 组件重名，组件导入需别名（如 GraphPanel），否则模板解析成图标。
- 2026-09-17（消息列表 / 任务协议 / 文件编辑）：
  - 消息代码高亮：`Response` 接入 `@stream-markdown/code`（Shiki，github-dark/light），`.md-content .shiki` 贴合 Zen code token。
  - 工具调用进时间线：`tool_end` 落 `role=tool` 消息（`ToolCallCard`：按工具名 lucide 图标 + 成败色 + 可展开 args/output）；`updateTasks` 落 `TaskUpdateCard` 快照；工具步骤从 AgentRunStatus 折叠列表移除（避免双写）。
  - 任务清单协议：`session_task_lists` 表持久化 version/items；`session:open` 一并返回并恢复侧栏；模型未调 `updateTasks` 时从正文 `- [ ]` 勾选列表兜底抽取；系统提示词强调必须走工具。
  - 文件编辑：`workspace:write-file` IPC（路径沙箱同 read）；FileViewer 可编辑（history + 脏标记 + 保存/放弃）；Agent `writeFile`/`editFile` 后 `filesRevision` 驱动文件树与预览刷新（本地未保存时不覆盖）。
- 2026-09-17（composer 交互与流式渲染二轮）：
  - Composer 技能选中改 chip：`/` 触发选中技能不再插入正文，改为输入壳上方 tag（悬浮 HoverCard 展示技能名/描述/目录）；发送时以 `/skill:` 前缀注入 agent 消息、正文保持干净并由 `meta.skills` 渲柔回显 tag；`canSend` 计入已选技能。修复选择技能后输入框失焦——`<Textarea ref>` 拿到的是组件实例而非原生元素，`el.focus()` 抛错（改函数 ref 取 `$el`），建议面板按钮补 `@mousedown.prevent`。
  - Composer 权限改下拉：底栏权限按钮从「点击循环」改 DropdownMenu，枚举 `PERMISSION_MODES` 三档并带说明文案，当前档位打勾。
  - 用户消息悬浮操作条：hover 显示发送时间（当日 HH:mm，跨日带日期）+ 复制（剪贴板，1.5s 打勾反馈）+ 编辑（内容放回输入框聚焦重发）；随消息发送的技能 tag 在气泡内回显。
  - 流式渲染修复：`Response`/`ReasoningContent` 关闭 vue-stream-markdown 逐段淡入动画（`enable-animate: false`）——动画 span `backwards` 填充在快速输出下让尾部长时间不可见（表现为底部大片空白、看不到实时内容），关闭后文本随到随显且 DOM 量大幅下降；`Response` 根元素 `size-full` 改 `w-full` 不再强制 height:100%。ChatTimeline 自动滚动加 `overflow-anchor: none` 与贴底策略（`stickToBottom` + ResizeObserver 兜底）——markdown 异步增量渲染的实际高度在 nextTick 之后才增长，仅 watch content 会滞后于真实渲染高度；用户上滚阅读时暂停跟随。
  - 审批与提问上移：`ApprovalCard.vue`（从 AgentRunStatus 拆出，新增「全部允许（本会话）」——shared `ToolApprovalDecision.always`，agent-core `rememberedTools` 会话级记忆放行同类工具）与 `AskUserCard` 固定 sticky 在对话区顶部，方便操作。
  - 运行状态卡下线：删除 `AgentRunStatus.vue`（正在回复/暂停/停止卡片），运行状态直接体现在 Composer 发送按钮位——运行中变「停止」（取消运行）、暂停时变「继续」（恢复运行）；发送按钮态用既有 token（`--color-send-empty/-fg`），不新增色值。
- 2026-09-17（消息流分段与工具可视化）：
  - 消息改为按时间顺序的分段渲染（`ChatMessage.parts`：reasoning / text / tool，main 落库与 ui 渲染共用 `applyStreamToParts`，持久化在 meta_json.parts 读出时提升回顶层）：每次思考独立成折叠面板按序展示（后随正文/工具时默认收起），不再全部并进一个面板；旧消息按「思考 → 正文」合成兼容。
  - 工具调用行内渲染（`ToolCallRow.vue` + `tool-part.ts`）：icon + 动作名（执行终端/写入文件/读取文件/浏览目录/搜索/网络/技能/MCP）+ 高亮目标——文件路径带文件 icon 成 chip，点击在右栏文件面板定位（right-panel 新增 `revealFile`，FilePanel 展开祖先目录并选中）；终端命令以 mono chip 展示；行尾状态（旋转/勾/叉），点击展开结果输出。删除死状态 `activeTool`/`toolHistory`。
  - 思考内容独立弱色：`.reasoning-dim .stream-markdown` 覆盖库根节点的前景色重置（`--color-mut`，1.7 行距），与正文 14px 主色区分。
  - 密度收紧：消息间距 gap-5→gap-4，user 气泡 py-2.5→py-2，Reasoning 去掉 mb-4（由分段 gap 承担），`.md-content` p/pre/ul 外边距 8→6px。
  - 代码高亮：接入 `@stream-markdown/code`（Shiki 4 + `createJavaScriptRegexEngine` 免 wasm），主题对 github-light/dark，Markdown 显式 `:is-dark="true"`（渲染根节点带 `.dark` 激活 `--shiki-dark` 变量）；Response 与 ReasoningContent 共用 `response/extensions.ts`。
  - 提交图谱分支徽标：提交行渲染 %D refs（当前分支 accent 实底、本地分支描边、远端弱化、tag 蓝色，>3 个收进 +N）；泳道算法本就支持多分支（zen 仓库当前 main 完全并入 develop，单轴即真实形态）。
- 2026-09-20（浏览器 / 终端 / 内置字体）：
  - 浏览器改回**方案 1：Electron WebContentsView + CDP**（不再探测系统 Chrome）。主进程 `WebContentsView` 叠在右栏宿主矩形上，bounds 由 `BrowserPanel` 经 `browser:set-bounds` 同步；内核为 Electron 自带 Chromium，随 Zen 应用 `electron-updater` 联网更新。地址栏/选取元素/写入页面结构/控制台/快照；Agent 同一套 `browser*` 工具读写该视图（debugger + executeJavaScript）。
  - 浏览器壳对齐真实浏览器：**新标签页展示历史**（localStorage `zen.browser.history`）；地址栏**联想历史**（↑↓/Enter）；左侧**后退/前进/刷新**；右侧**系统浏览器打开 / 标注 / 截图**。标注与截图结果经 `chat.insertAtComposerCaret` 插入 **AI 输入框光标处**（ComposerEditor `insertAtCaret`）。
  - 浏览器标注 tag 与技能同构：输入框内仅 **地球 icon + 元素名**（源文本 `$el:名称`，前缀 `display:none`），chip 底 + 强调色；悬浮 120ms 后弹出 `composer-el-tooltip` 明细（selector/页面等）。发送时展开 `[页面元素]`。
  - **应用内 http(s) 链接统一进右栏浏览器**：消息 markdown、参考/Git 链接、设置资料页、终端 WebLinks、`app:open-external` / `window.open` 一律打开右侧 BrowserPanel；系统浏览器仅保留面板上显式「在系统浏览器中打开」。
  - **应用内 http(s) 链接统一进右栏浏览器**：消息 markdown、参考/Git/资料、终端 WebLinks、`window.open`、`app:open-external` 一律打开右侧面板；仅浏览器面板上的「在系统浏览器中打开」仍走系统。
  - **应用内 http(s) 链接统一进右栏浏览器**：消息 markdown、参考/Git/资料链接、终端输出链接、`window.open`、`app:open-external` 一律走右侧 BrowserPanel；仅面板上显式「在系统浏览器中打开」仍调系统。全局 click 捕获防主窗口被导航。
  - **应用内 http(s) 链接统一进右栏浏览器**：全局 click 捕获 + `app:open-external`/`window.open` 在 main 侧改走 `BrowserService.open`；消息 markdown、参考、资料、终端链接均打开右侧面板。系统浏览器仅保留面板上的显式「在系统浏览器中打开」。
  - **应用内 http(s) 链接统一进右栏浏览器**：消息 markdown 链接、参考/Git 链接、设置里资料页、终端 WebLinks、`app:open-external` / `window.open` 一律打开右侧 BrowserPanel（`openAppLink` / `BrowserService.open`）；系统浏览器仅保留面板上显式「在系统浏览器中打开」。
  - **应用内 http(s) 链接统一进右栏浏览器**：全局 click 捕获 + `app:open-external`/`window.open` 在 main 侧改走 `BrowserService.open`；消息 markdown、参考、资料、终端链接均打开右侧面板。系统浏览器仅保留面板上的显式「在系统浏览器中打开」。
  - 底部终端落地：`TerminalPanel` = node-pty + xterm，shell 取系统默认（`$SHELL` + `-l` 登录 shell）；头行显示 shell 名，支持重启与「用系统终端打开」。面板高度 `min(42vh,360px)`，保底 180px。
  - 内置字体：`assets/fonts/` 下 MiSans VF（Apache-2.0 子集 woff2）+ Maple Mono（OFL 400–700）；`--font-sans` 首选 MiSans，`--font-mono` 首选 Maple Mono，中文/系统字体作回落，跨机器渲染更稳定。
- 2026-09-21（全量 UI/UX 评审修复 · 控件收口与对比度）：
  - **原生控件清零**（第 3 节第 3 条强化）：业务组件里的原生 `<button>/<input>/<textarea>/<input type="range">` 全量迁移到 `ui/` 封装（session/right/settings/sidebar/chat/bottom 共 40+ 文件）；`Input`/`Textarea` 新增 `variant: default | ghost` 并 `defineExpose({ focus, blur, select })`（ref 一律取组件实例）；range 封装为 `ui/slider/SliderRange.vue`。图标按钮迁移时统一补 `aria-label`。
  - **文本对比度达标 WCAG AA**：`--color-dim` dark `#777`→`#8a8a8a`（3.97→5.1:1）、light `#151c1366`→`#151c13a6`（2.5→5.4:1）；`--color-mut` light `#151c1399`→`#151c13b3`（3.9→6.4:1）；`--color-send-empty` dark `#5a5a5a`→`#6e6e6e`（非文本 ≥3:1）。层级 dim < mut < txt 保持。
  - **弹窗遮罩统一**：`DialogOverlay`/`DialogScrollContent` 的 `bg-black/10`、`bg-black/80` 全部改 `--color-scrim`，z 从写死 50 收敛到 `--z-overlay`（40）；对话框内容保持与 reka 浮层同层（DOM 顺序保证弹窗内下拉在上），`--z-modal` 标注为预留档（勿直接套内容层，否则弹窗内下拉会被盖）。
  - **反馈体系**：新增 `ui/toast`（`toast.ok/err/info`，走 `--z-toast: 90`）并挂载 `App.vue`；git store 的提交/分批提交/推送/切分支/建分支成败镜像到 toast（内联 `feedback` 保留）。
  - **交互修复**：会话信息卡分支触发器不再是裸"—"（由 EnvInfoSection 显示当前分支名）；BranchPicker 本地/远程分支补空态文案；设置页「更新源地址」改为失焦自动保存（与同页其他设置一致，去掉独立「保存」按钮），导航组「通用/常规」去重为「偏好」；用户块副标题统一为 `displaySub`（不再一侧「未登录」一侧「全功能可用」）；ModelPicker 供应商栏 Unicode `◎` 与选中 `✓` 改 lucide 图标。
- 2026-09-21（设置弹窗与左侧会话列表治理）：
  - **模型供应表单回归 `.field-row`**：`ProviderDetail`/`ProviderFields`/`ModelFormDialog` 曾退化为「标签在上、控件在下」的堆叠 FieldGroup（`.field-row` 全仓零引用），现全部改回 label 与控件同行（左标签 88px + 发丝线分隔）；控件高度统一 `h-8`、去掉逐个 `rounded-[10px]` 覆写；协议/端点下拉补 `w-full`；模型表单弹窗能力开关（工具/视觉/推理/媒体）改行式 Switch，删除与 chips 重复的能力徽标（zen-001）。
  - **模型行列表化**：`ProviderModelList` 模型行从逐行描边卡片（44px）回归 30px `.list-row`（标题 + mono ID + 能力摘要 + 行尾 Switch/编辑），选中态用 `--color-menu-active`；搜索框与侧栏同构（图标内嵌 Input）。
  - **「删除此供应商」危险化**：ghost 手工染色改 `variant="destructive"`（对齐 09-15 决策）。
  - **会话行重排（`SessionRow`）**：删除行首常驻空槽（隐藏置顶按钮 28px + 状态占位 20px 曾把标题挤到 ~120px），状态图标与置顶指示改为出现时才内联占位，标题占满整行；置顶/归档/删除收纳行尾操作簇，hover/聚焦时 max-width 折叠展开（不用底色补丁，避免与半透明 hover token 叠加色差）；「需要操作」文字标签去掉，由图标形状 + tooltip 表达。
  - **侧栏「新建工作区」修复**：`sectionLabelCls` 缺 `group/section` 导致 + 按钮除键盘聚焦外永久隐形，补上分组类。
  - 验证：`vue-tsc`、vitest 122 用例、dev server 内 OCR+几何复查（同行字段、30px 行、无横向溢出、无控制台报错）。
- 2026-09-21（第二批 · 悬浮面板 / 会话列表 / 图片 / 终端着色 / sqlite 域）：
  - **悬浮面板「子 Agent」节空态隐藏**：无子 Agent 时整节（含空态文案）不渲染，其余节照常（用户确认仅隐藏节，不隐藏整卡）。
  - **设置弹窗左菜单对齐**：导航项 Button 继承 shadcn `justify-center` 导致每行内容居中、图标/文字左缘随标签宽度漂移，补 `justify-start`；「设置」标题 `px-2`→`px-2.5` 与分组标签、搜索框对齐（图标列 24px / 文字列 48px，几何实测）。
  - **公共区单层化**：删除「公共会话」内层组行，「公共区」节头直接承担分组职责（Globe 图标 + 计数 + hover 新建会话），消除两层重复标签；`groupOpen` 去掉当前组强制展开，修掉「点折叠无反馈」异常（展开分组时经 `setActive` 自动展开）。
  - **会话行操作簇底色**：行尾置顶/归档/删除簇改不透明 `--color-side-chip(-active)`（dark `#262626`/`#313131` = white 8%/12% 叠 `--color-side` 的等价值），盖住跑马灯滚进按钮区的标题，图标不再与文字叠混。
  - **消息图片**：markdown 图片本地引用（路径/file://）在 parser 层改写为 `data:image/svg+xml` 标记（harden 放行 data:image），`uiComponents.Image` 换成 `ResponseImage`——反解标记后经 `workspace:preview-file` 换 data URL，响应式缓存 `local-image-cache.ts`；http(s) 图片原样渲染。
  - **终端输出 ANSI 着色**：`runTerminal` 结果含转义序列时按 SGR 片段着色（`ansi.ts`：16 色 xterm Tango 板、256 色、真彩色、反显、粗/斜/下划线/删除线，剥光标移动/OSC/孤立 CR），与底部终端观感一致；无转义仍走纯文本快路径。
  - **AI 问询卡上移**：`AskUserCard` 从对话区 sticky 顶移到 composer 上方（附件列表之上），回答动作紧邻输入位置；`ApprovalCard` 维持对话区顶部。
  - **文件浏览器图片**：`FileViewer` 图片扩展名走 `preview-file` 渲染 `<img>`（点击在适应面板/原始尺寸间切换），不进 CodeMirror、不可编辑。
  - **独立文件预览面板**：悬浮面板「参考 · 用户上传」点击改为打开 `FilePreviewDialog`（图片缩放/文本只读/二进制提示，reka Dialog），不再走右侧文件浏览器；项目文件仍定位文件面板。
  - **sqlite 落 ~/.zen**：`model-db-connection` 迁到 `~/.zen/db/zen.sqlite`（ADR-004 用户域），旧 `userData/db` 三件套（-wal/-shm）首次启动整体搬迁，跨盘失败回落旧路径不阻塞。
  - **自动会话标题**：首条消息发送即记 `autoTitleSessionId`，run 完成走 `session:auto-title`（main 侧 `completeOnce` 生成 ≤20 字标题，净化引号/换行，模型不可用返回 null），成功后沿用 rename 链路落库；等待期间切会话/手动改名则放弃。
  - 验证：`vue-tsc` / desktop `tsc`、vitest 135 用例（含 ansi 10 例、parser 标记 3 例）、dev server 几何复查（设置导航图标列 25px 齐线、悬浮面板无子 Agent 节）。
