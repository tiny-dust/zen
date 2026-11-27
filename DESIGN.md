---
name: Zen
description: 极致精简、专注编程的 AI Agent 桌面端
colors:
  canvas: "#13161b"
  side: "#191d23"
  sunken: "#191d23"
  raise: "#282e38"
  popover: "#282e38"
  card: "#282e38"
  line: "#343b46"
  line-soft: "#282e37"
  text: "#f0f2f6"
  text-strong: "#f7f9fc"
  muted: "#c9cfd9"
  dim: "#969fad"
  composer-surface: "#20252d"
  send-ink: "#f0f2f6"
  send-ink-fg: "#13161b"
  accent: "#7887f5"
  accent-strong: "#96a1ff"
  accent-fg: "#101321"
  ok-green: "#6cc59a"
  warn-amber: "#e5b567"
  danger-soft: "#f29a8e"
  link-blue: "#94bfd3"
  canvas-light: "#faf9f6"
  side-light: "#f2f0eb"
  text-light: "#211d19"
  accent-light: "#9d3f29"
  legacy-ember: "#ff6a2b"
typography:
  display:
    fontFamily: "MiSans, system-ui, -apple-system, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.4
  h1:
    fontFamily: "MiSans, system-ui, -apple-system, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.35
  h2:
    fontFamily: "MiSans, system-ui, -apple-system, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.35
  section:
    fontFamily: "MiSans, system-ui, -apple-system, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.35
  subtitle:
    fontFamily: "MiSans, system-ui, -apple-system, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.4
  title:
    fontFamily: "MiSans, system-ui, -apple-system, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "MiSans, system-ui, -apple-system, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  caption:
    fontFamily: "MiSans, system-ui, -apple-system, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "MiSans, system-ui, -apple-system, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  micro:
    fontFamily: "MiSans, system-ui, -apple-system, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
  mono:
    fontFamily: "Maple Mono, SF Mono, ui-monospace, Menlo, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  hairline: "1px"
  window: "0px"
  xs: "6px"
  sm: "8px"
  md: "10px"
  lg: "14px"
  shell: "20px"
  pill: "999px"
components:
  button-primary:
    backgroundColor: "{colors.send-ink}"
    textColor: "{colors.send-ink-fg}"
    rounded: "{rounded.md}"
    height: "32px"
  button-send:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-fg}"
    rounded: "50%"
    height: "32px"
    width: "32px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    height: "32px"
  button-destructive:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.md}"
    height: "32px"
---

# Design System: Zen

## 1. Overview

**Creative North Star: "静默而有序的工作台" (The Quietly Ordered Workbench)**

Zen 的界面是一张克制的工作台面：中性表面承载一切，强调色只在真正需要引起注意的地方出现。它不表演智能、不装饰过程，把注意力让给代码、结果和下一步动作。

视觉语言取自 **nomi-ai**（MIT）：层级靠表面明度递进与 1px 发丝线建立，不靠大块颜色；圆角分 6 / 8 / 10 / 14 / 20 五档；正文 14px、次要 13px、标签 12px；控件高 20–40 六档，工具栏与对话头部统一 32px。深色是默认主题（nomi `graphite`），浅色走同一组 token（nomi `light`），不做单独设计。

它明确拒绝营销落地页式的英雄区、装饰性渐变、重复卡片网格、无意义动画，以及把工具调用渲染成命令/参数/说明的调试面板。状态不能只靠颜色：成功、失败、等待、修改必须同时有文字或图标表达。

**Key Characteristics:**

- 深色默认：画布 `#13161b`，侧栏 `#191d23`，抬升面 `#282e38`。
- 强调色随主题：深色靛蓝 `#7887f5`，浅色陶土红 `#9d3f29`；任屏占比 ≤10%。
- 暖橙 `#ff6a2b` 仅作为可选强调色（`data-accent-color="orange"`），不再默认。
- 消息区无气泡：助手内容裸 markdown 铺在背板上，用户消息右对齐弱气泡。
- 聚焦/选中只做颜色或 1px 边框变化，禁止粗圈描边。

## 2. Colors

语义变量是唯一来源（`apps/ui/src/styles.css`）；组件内禁止写死十六进制。

### Surfaces（深色 / 浅色）

| Token | 深色 | 浅色 | 用途 |
|---|---|---|---|
| `--color-bg` / `--color-panel` | `#13161b` | `#faf9f6` | 画布、工作区卡片 |
| `--color-side` | `#191d23` | `#f2f0eb` | 导航轨道、会话面板 |
| `--color-sunken` | `#191d23` | `#f7f5f1` | 下陷区 |
| `--color-raise` / `--color-set-card` | `#282e38` | `#ffffff` | 抬升卡、设置卡片 |
| `--color-popover` | `#282e38` | `#ffffff` | 浮层 |
| `--color-composer-surface` | `#20252d` | `#ffffff` | 输入壳 |
| `--color-line` / `--color-line-soft` | `#343b46` / `#282e37` | `#e5e0d7` / `#efebe4` | 发丝描边 |

### Text 与 Accent

| Token | 深色 | 浅色 |
|---|---|---|
| `--color-txt` | `#f0f2f6` | `#211d19` |
| `--color-mut` | `#c9cfd9` | `#625951` |
| `--color-dim` | `#969fad` | `#685e55` |
| `--color-accent` | `#7887f5` | `#9d3f29` |
| `--color-accent-fg` | `#101321` | `#ffffff` |
| `--agent-success` | `#6cc59a` | `#24684c` |
| `--agent-approval` | `#e5b567` | `#7c4a00` |
| `--agent-danger` | `#f29a8e` | `#a33130` |

### Named Rules

**The One Accent Rule.** 强调色只标记「当前可执行的主动作」与状态强调，任屏占比 ≤10%。铺底色、装饰、标记非交互信息都是错的。

**The Theme-Paired Accent Rule.** 强调色与主题成对：深色用 `#7887f5`，浅色用 `#9d3f29`，由 `:root[data-accent-color="nomi"]` 与 `:root.dark[...]` 分别给出，不写死单值。

**The State-by-Light Rule.** 表面层级靠明度递进 + 发丝线，不靠颜色块。需要颜色才能看出是卡片，说明层级设计失败。

## 3. Typography

**Body Font:** MiSans（fallback: system-ui, -apple-system, PingFang SC, Microsoft YaHei）
**Label/Mono Font:** Maple Mono（fallback: SF Mono, ui-monospace, Menlo, Consolas）

单一无衬线家族承担全部 UI 文字，靠字重与字号建立层级；等宽仅用于代码、模型 ID、路径、设备码。

| 层级 | 字号 / 字重 | 用途 |
|---|---|---|
| Display | 22 / 600 | 页面级主标题 |
| H1 / H2 / Section | 18 / 16 / 16，600 | markdown 标题、卡片标题 |
| Subtitle | 15 / 500 | 弹窗标题、节标题 |
| Title | 14 / 600 | 栏头、会话名 |
| Body | 14 / 400，行高 1.55 | 正文、消息 |
| Caption | 13 / 400 | 辅助说明、字段标签、工具步骤 |
| Label | 12 / 400 | 计数、时间戳、微标签 |
| Micro | 11 / 400 | 微型徽标、快捷键提示 |
| Mono | 13 / 400 | 代码、ID、路径 |

**The One Family Rule.** 不引入第二个 sans 家族；层级靠字重字号，不靠换字体。

## 4. Elevation

静态表面无阴影，靠明度递进；阴影只给浮层：

- `--shadow-composer`：输入壳
- `--shadow-menu`：菜单、下拉
- `--shadow-pop`：弹窗、浮层
- `--shadow-tip`：tooltip

**The Flat-By-Default Rule.** 表面静止时是平的；阴影是状态响应，不是默认装饰。

## 5. Layout

| 区域 | 尺寸 |
|---|---|
| 标题栏 | 44px，横跨整窗，`-webkit-app-region: drag` |
| 导航轨道 | 52px，常驻；会话面板收起后入口仍可达 |
| 会话面板 | 默认 260px（左栏总宽 312，范围 232–472） |
| 聊天内容列 | 768px（消息、附件、审批卡、输入框共用） |
| 信息列 | 350px，窗口 ≥1360px 才显示 |
| 右栏 | 最小 240px，默认窗口 50%，上限 75% |
| 底部终端 | 默认收起，展开 42vh（≤360px） |

**空会话**：欢迎区与输入框作为一整块在对话列垂直居中；发送后消息立即出现，回到「滚动区 + 底部输入框」。

## 6. Components

### Buttons

- 圆角 `--radius-md`（10px）；高度走 `--control-h-*`：默认 32，`sm` 28，`xs` 24，`icon` 与默认同档。
- Primary：反色 `--color-send` 底 + `--color-send-fg` 字。发送按钮用 `--color-accent` 圆形，空输入为禁用灰。
- Hover 降一档透明度；键盘聚焦只做 1px 边框色变化；图标按钮 hover 只变图标色。

### Inputs

- 圆角 `--radius-md`，高度 32，底色 `--color-input-bg`，描边 `--color-input-border`。
- 聚焦仅边框色变化；错误用 `aria-invalid` 描边 + 文案。

### Cards / Overlays

- 卡片 `--radius-lg`（14px）+ `--color-set-card`，静止无阴影。
- 弹窗 `--radius-lg` + `--shadow-pop`；菜单/下拉 `--radius-md` + `--shadow-menu`。

### Signature Component: Chat Composer

`--color-composer-surface` 壳面 + `--shadow-composer` + 发送强调圆钮；下方居中「内容由 AI 生成，请注意核实」。这是唯一允许大面积出现强调色的地方。

## 7. Do's and Don'ts

### Do

- 用语义变量取色，用 `--radius-*`、`--control-h-*`、`--font-size-*` 取尺度。
- 同排控件同档；同一变体在不同屏幕长得一样。
- 状态用文字 + 图标 + 结构共同表达。
- 聚焦只做 1px 边框或底色一档变化。
- 助手消息裸铺在背板上（无气泡、无头像、无角色标签）。

### Don't

- 用营销式英雄区、装饰渐变、重复卡片网格、无意义动画。
- 把工具调用渲染成只有命令/参数的调试面板，隐藏真实结果或 diff。
- 用 `border-left/right > 1px` 做彩色侧边条。
- 用 `background-clip: text` 渐变文字。
- 给静止卡片同时加 1px 描边和 ≥16px 模糊大阴影。
- 在组件里写死十六进制色值。
- 引入第二个 sans 字体家族。
- 把暖橙 `#ff6a2b` 当默认强调色（它只是可选主题）。
