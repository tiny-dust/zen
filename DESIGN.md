---
name: Zen
description: 极致精简、专注编程的 AI Agent 桌面端
colors:
  ember-orange: "#ff6a2b"
  ink-bg: "#181818"
  ink-side: "#141414"
  ink-sunken: "#2e2e2e"
  ink-raise: "#191919"
  ink-popover: "#1a1a1a"
  ink-card: "#282828"
  ink-line: "#2e2e2e"
  ink-line-soft: "#ffffff12"
  ink-text: "#f4f4f5"
  ink-text-strong: "#ffffff"
  ink-muted: "#b8b8b8"
  ink-dim: "#8a8a8a"
  composer-surface: "#202020"
  send-ink: "#ececec"
  send-ink-fg: "#151c13"
  ok-green: "#1a9e5f"
  del-red: "#e5484d"
  danger-fg: "#ff9b7f"
  link-blue: "#3295fb"
typography:
  display:
    fontFamily: "MiSans, system-ui, -apple-system, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.4
  h1:
    fontFamily: "MiSans, system-ui, -apple-system, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "19px"
    fontWeight: 700
    lineHeight: 1.35
  h2:
    fontFamily: "MiSans, system-ui, -apple-system, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.35
  section:
    fontFamily: "MiSans, system-ui, -apple-system, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "16px"
    fontWeight: 650
    lineHeight: 1.35
  subtitle:
    fontFamily: "MiSans, system-ui, -apple-system, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.4
  title:
    fontFamily: "MiSans, system-ui, -apple-system, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "MiSans, system-ui, -apple-system, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: "MiSans, system-ui, -apple-system, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "MiSans, system-ui, -apple-system, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
  micro:
    fontFamily: "MiSans, system-ui, -apple-system, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.4
  mono:
    fontFamily: "Maple Mono, SF Mono, ui-monospace, Menlo, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  hairline: "1px"
  xs: "6px"
  sm: "8px"
  md: "12px"
  shell: "16px"
  pill: "999px"
components:
  button-primary:
    backgroundColor: "{colors.send-ink}"
    textColor: "{colors.send-ink-fg}"
    rounded: "{rounded.md}"
    height: "32px"
  button-send:
    backgroundColor: "{colors.ember-orange}"
    textColor: "{colors.ink-text-strong}"
    rounded: "50%"
    height: "32px"
    width: "32px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-text}"
    rounded: "{rounded.md}"
    height: "32px"
  button-destructive:
    backgroundColor: "{colors.del-red}"
    textColor: "{colors.ink-text-strong}"
    rounded: "{rounded.md}"
    height: "32px"
---

# Design System: Zen

## 1. Overview

**Creative North Star: "静默而有序的工作台" (The Quietly Ordered Workbench)**

Zen 的界面是一张熟悉、克制的工作台面：深色中性灰阶承载一切，唯一的暖橙强调色只出现在「发送」按钮和真正需要引起注意的强调点。它不表演智能、不装饰过程，把全部注意力让给代码、结果和下一步动作。设计的目标是让开发者一眼看清 Agent 做了什么、改了什么、下一步该做什么，而界面本身几乎不可见。

这套视觉系统对齐 Xiaomi MiMo Desktop 的语言：95% 由灰阶表面与文字构成，颜色只服务于状态与强调。层级靠表面明度递进（窗口 `#181818` → 侧栏 `#141414` → 下陷区 `#2e2e2e` → 悬浮卡 `#191919`）和发丝线分隔来建立，不靠大块颜色。密度按开发者习惯收紧：正文 13px、列表行高 30px、控件高 28px，删掉重复标签与无效装饰。

它明确拒绝营销落地页式的英雄区、装饰性渐变、重复卡片网格、无意义动画，以及把工具调用渲染成命令/参数/说明的调试面板。状态不能只靠颜色区分——成功、失败、等待、修改、选中都必须有文字、图标或结构共同表达，用户始终保留对 Agent 动作的接管权。

**Key Characteristics:**

- 深色为默认主题；浅色主题通过同一组 token 支持，不做单独设计。
- 唯一强调色暖橙 `#ff6a2b`，任一屏占比 ≤10%，其余 95% 是灰阶。
- 12px 全局圆角、1.5 图标线宽、克制的双层阴影三档。
- 消息区无气泡：assistant 内容裸 markdown 铺在背板上，user 消息右对齐弱气泡。
- 聚焦/选中只做颜色反馈，禁止粗圈描边。

## 2. Colors

深色灰阶为主体，暖橙为唯一强调色。颜色策略是「克制（Restrained）」：中性色 + 一个强调色 ≤10%。

### Primary

- **Ember Orange** (`#ff6a2b`): 唯一强调色。只用于 composer 发送主按钮（圆形，配白色前景 `#ffffff`）和少数强调点。它的稀缺正是它的意义——出现即意味着「当前可执行的主动作」。

### Neutral

- **Ink Background** (`#181818`): 窗口与主区底色，一切内容的底板。
- **Ink Side** (`#141414`): 侧栏与工具面板底色，比主区更深一级，用明度而非描边区分区域。
- **Ink Sunken** (`#2e2e2e`): 下陷区（终端、内嵌面板），比底板亮一档，暗示「嵌入」。
- **Ink Raise** (`#191919`): 悬浮信息卡（会话信息卡）底色。
- **Ink Popover** (`#1a1a1a`): 下拉/浮层底色。
- **Ink Card** (`#282828`): 设置卡片、可选表面。
- **Ink Line** (`#2e2e2e`): 分隔线与 1px 卡片描边；软线用 `#ffffff12`。
- **Ink Text** (`#f4f4f5`): 正文，对比度 ≥4.5:1。
- **Ink Text Strong** (`#ffffff`): 标题与强调文字。
- **Ink Muted** (`#b8b8b8`): 次要文字。
- **Ink Dim** (`#8a8a8a`): 弱化文字、占位符。
- **Composer Surface** (`#202020`): 输入框壳面，无边框，仅靠明度与阴影抬起。
- **Send Ink** (`#ececec`): 中性反色主按钮（发送以外的其它主操作），前景 `#151c13`。

### Semantic

- **Ok Green** (`#1a9e5f`): 成功、已就绪。
- **Del Red** (`#e5484d`): 删除、破坏性操作；hover 提亮为 `#ff9b7f`。
- **Link Blue** (`#3295fb`): 链接、可点击引用。

### Named Rules

**The One Accent Rule.** 暖橙 `#ff6a2b` 在任何一屏占比 ≤10%。它只标记「当前可执行的主动作」与状态强调点；用它做装饰、铺底色或标记非交互信息都是错的。

**The State-by-Light Rule.** 灰阶表面之间的层级靠明度递进 + 发丝线建立，不靠颜色块。如果一块表面需要颜色才能看出它是「卡片」，说明层级设计失败了。

## 3. Typography

**Body Font:** MiSans（fallback: system-ui, -apple-system, PingFang SC, Microsoft YaHei）
**Label/Mono Font:** Maple Mono（fallback: SF Mono, ui-monospace, Menlo, Consolas）

**Character:** 单一无衬线家族承载标题、按钮、正文、数据，靠字重与字号而非字族对比建立层级。等宽场景（模型 ID、路径、设备码）用 Maple Mono。

### Hierarchy

- **Display** (600, 22px, 1.4): 页面级主标题（评审页/原型主标题）。
- **Heading 1** (700, 19px, 1.35): markdown `h1`。
- **Heading 2** (700, 18px, 1.35): markdown `h2`。
- **Section** (650, 16px, 1.35): markdown `h3`、卡片/格式标题。
- **Subtitle** (600, 15px, 1.4): 弹窗标题（DialogTitle）、设置节标题、设备码。
- **Title** (600, 14px, 1.4): 栏头、节标题、会话名。
- **Body** (400, 13px, 1.5): 正文，行长 ≤75ch；聊天与长文用 `text-wrap: pretty` 减少孤行。
- **Caption** (400, 12px, 1.4): 辅助说明、字段标签、工具步骤、行内代码。
- **Label** (400, 11px, 1.4): 计数徽标、时间戳。
- **Micro** (400, 10px, 1.4): 微型徽标、键盘快捷键提示。
- **Mono** (400, 13px, 1.5): 代码、模型 ID、路径、设备码。

### Named Rules

**The One Family Rule.** 一个无衬线家族承担全部 UI 文字，等宽仅限代码/标识数据。禁止为了「丰富」引入第二个 sans 家族。层级靠字重与字号（≥1.125 比例），不靠换字体。

## 4. Elevation

扁平为主，阴影只作为「抬起」的响应。静态表面（底板、侧栏、卡片）无阴影，靠明度递进表达层级；阴影只出现在浮层（composer 壳、菜单、弹窗、tooltip），且都是克制的双层阴影（一层紧贴的细阴影 + 一层宽松的柔阴影）。

### Shadow Vocabulary

- **Composer** (`0 1px 3px #0006`): 输入框壳面，抬起但贴地。
- **Menu** (`0 8px 30px #0009, 0 1px 3px #0006`): 下拉菜单。
- **Pop** (`0 12px 40px #00000080`): 弹窗。
- **Tip** (`0 2px 8px #0000004d, 0 1px 2px #00000040`): tooltip。
- **Raised** (`0 1px 2px #0006, 0 3px 10px #0008`): 一般抬起态。

### Named Rules

**The Flat-By-Default Rule.** 表面静止时是平的。阴影是对状态的响应，不是默认装饰。凡是「卡片」默认带阴影的冲动，都要先问：它是不是真的浮在别的东西之上？

## 5. Components

### Buttons

- **Shape:** 12px 圆角（`--radius`），图标按钮 8px 起。
- **Primary:** 中性反色 `#ececec` 底 + `#151c13` 字，高 32px（`h-8`）。发送主按钮例外：暖橙圆形 `#ff6a2b` + 白色前景，空输入禁用态为灰圆。
- **Hover / Focus:** hover 降透明（`/90`）；按钮一律无聚焦描边（`button:focus-visible { outline: none }`）。图标按钮 hover 只高亮图标颜色，不出底色。
- **Ghost / Secondary / Outline / Destructive:** ghost 透明底 hover 微底色；secondary 灰底；outline 发丝描边；destructive 危险色（常态 `#e5484d` 微透明底，hover 提亮）。

### Inputs / Fields

- **Style:** 发丝描边（`--color-btn-border`），12px 圆角，底板 `#181818`。
- **Focus:** 仅边框色变化一档（`focus-visible:border-ring`，`--ring` = `#6a6a6a`），禁止 `ring-*`/`outline-*` 粗圈。
- **Error / Disabled:** 错误用 `aria-invalid:border-destructive` 描边 + 文字，不靠红绿单色区分。

### Cards / Containers

- **Corner Style:** 圆角刻度 `1 / 6 / 8 / 12 / 16 / 999`（发丝 1px · 紧凑控件 6px · 常规 8px · 卡片 12px · 悬浮信息卡 16px · 胶囊/徽标/滚动条 999px）。
- **Background:** `#282828`（设置卡片）、`#191919`（悬浮信息卡）、`#1a1a1a`（浮层）。
- **Shadow Strategy:** 静止无阴影；浮层用 Menu/Pop 档（见 Elevation）。
- **Border:** 1px 发丝线 `#2e2e2e`。

### Navigation

- **Style:** 侧栏导航项 + 工具面板图标纵向导航，选中/开启态用 `--color-menu-active` 底色；列表行 hover 用 `--color-menu-hover`。图标按钮 hover 无底色，只高亮图标。

### Signature Component: Chat Composer

暖橙圆形发送按钮（空输入禁用态为灰圆 `#bbbbb6`）、`#202020` 无边框壳面、双层 composer 阴影；下方居中「内容由 AI 生成，请注意核实」免责声明行。这是整套系统唯一允许大面积出现强调色的地方。

## 6. Do's and Don'ts

### Do:

- **Do** 用灰阶表面明度递进 + 发丝线建立层级，颜色只用于状态与强调。
- **Do** 保持 12px 圆角、1.5 图标线宽、32px 行高按钮的全局一致性；同一变体在不同屏幕必须长得一样。
- **Do** 用文字 + 图标 + 结构共同表达状态（成功/失败/等待/选中），不只靠红绿颜色。
- **Do** 聚焦态只用边框/底色变化一档，禁用粗圈描边。
- **Do** 让 assistant 消息裸铺在背板上（无气泡、无头像、无角色标签），把注意力留给内容。

### Don't:

- **Don't** 用营销落地页式的英雄区、装饰性渐变、重复卡片网格、无意义动画。
- **Don't** 把工具调用渲染成命令/参数/说明的调试面板，隐藏真实命令结果、文件代码或具体 diff。
- **Don't** 用 `border-left/right > 1px` 做彩色侧边条强调。
- **Don't** 用 `background-clip: text` 渐变文字。
- **Don't** 给卡片同时加 1px 描边和 ≥16px 模糊宽阴影（ghost-card）；静态表面应无阴影。
- **Don't** 在组件里写死十六进制色值，一律引用 `styles.css` 的 CSS 变量。
- **Don't** 引入第二个 sans 字体家族；层级靠字重字号，不靠换字体。
