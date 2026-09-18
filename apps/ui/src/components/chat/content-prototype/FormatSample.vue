<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { BookOpen, Check, ChevronDown, CircleAlert, Clock, FileCode, FileText, Globe, Image, ListChecks, LoaderCircle, Paperclip, Play, Search, ShieldCheck, Sparkles, Terminal, Wrench, X } from '@lucide/vue'
import { Response } from '@/components/ai-elements/response'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { sampleMarkdown } from './sample-markdown'
import ToolCallCard from '@/components/chat/ToolCallCard.vue'

const props = defineProps<{ id: string }>()
const toolSamples = {
  directory: { icon: BookOpen, action: '浏览目录', target: 'apps/ui/src/components/', status: '5 个条目', output: '演示目录结果：\nchat/\nai-elements/\nsettings/\nMessageBubble.vue\nbase/\n未读取实际目录。' },
  write: { icon: FileCode, action: '写入文件', target: 'docs/design/content-review-demo.md', status: '拟议新增', output: '演示：拟写入 24 行。\n这不是实际 diff，文件没有被创建。' },
  read: { icon: BookOpen, action: '读取文件', target: 'apps/ui/src/components/chat/ChatTimeline.vue', status: '已读取', output: '演示结果：读取第 1–48 行。\n消息列表按 parts 顺序展示正文与工具调用。' },
  search: { icon: Search, action: '搜索代码', target: 'Response · apps/ui/src/components/', status: '找到 2 处', output: '演示匹配：\nMessageBubble.vue：正文组件引用\nSettingsGeneral.vue：代码主题预览' },
  terminal: { icon: Terminal, action: '执行终端', target: 'pnpm --filter @zen/ui typecheck', status: '退出码 0', output: '演示日志，命令未执行：\n> vue-tsc --noEmit\n类型检查结束，无诊断信息。' },
  edit: { icon: FileCode, action: '编辑文件', target: 'apps/ui/src/components/chat/content-prototype/FormatSample.vue', status: '拟议变更', output: '演示差异摘要：+12 / -3\n新增目标路径换行规则；保留动作和状态列。\n不会写入文件。' },
  web: { icon: Globe, action: '查阅网页', target: 'vuejs.org · 响应式基础', status: '已提取', output: '演示摘要：computed 根据响应式依赖缓存计算结果。\n未发起网络请求；来源条目仅用于评审排版。' },
  skill: { icon: Sparkles, action: '加载技能', target: 'coder · Vue 组件规范', status: '已加载', output: '演示规则：\n1. 复用现有组件。\n2. 变更范围最小化。\n3. 验证直接影响的行为。\n未执行技能调用。' },
  mcp: { icon: Wrench, action: '调用 MCP', target: 'codebase-memory · search_graph', status: '返回 3 项', output: '演示结构化结果：\nResponse → Markdown\nMessageBubble → Response\nChatTimeline → MessageBubble\n未连接外部服务。' },
}
const tool = computed(() => toolSamples[props.id as keyof typeof toolSamples])
const markdown = computed(() => sampleMarkdown[props.id])
const approval = ref('')
const selected = ref(false)
const answer = ref('')
const submitted = ref('')
const streamText = ref('')
const streaming = ref(false)
const boundaryStream = '## 流式片段\n\n内容逐步到达，先渲染**关键结论**。\n\n```ts\nconst ready = true;\nconsole.log(ready);\n```\n\n| 格式 | 状态 |\n| --- | --- |\n| 正文 | 已收到 |\n| 表格 | 已补齐 |'
let streamTimer: ReturnType<typeof setInterval> | undefined
function replayStream() {
  if (streamTimer) clearInterval(streamTimer)
  streamText.value = ''
  streaming.value = true
  streamTimer = setInterval(() => {
    streamText.value = boundaryStream.slice(0, streamText.value.length + 7)
    if (streamText.value.length >= boundaryStream.length) {
      clearInterval(streamTimer)
      streamTimer = undefined
      streaming.value = false
    }
  }, 80)
}
onUnmounted(() => { if (streamTimer) clearInterval(streamTimer) })
const states = [
  { text: '准备参数', detail: '参数片段尚未完成', icon: Clock },
  { text: '待审批', detail: '等待用户决定', icon: ShieldCheck },
  { text: '已拒绝', detail: '未获得执行授权', icon: X },
  { text: '排队中', detail: '等待前一步完成', icon: Clock },
  { text: '运行中', detail: '正在读取目标文件', icon: LoaderCircle },
  { text: '已完成', detail: '返回 48 行内容', icon: Check },
  { text: '失败', detail: '目标路径不存在', icon: X },
  { text: '已取消', detail: '用户停止本次调用', icon: CircleAlert },
]
function submitAnswer() {
  const text = [selected.value ? '仅调整内容区' : '', answer.value.trim()].filter(Boolean).join('；')
  if (text) submitted.value = text
}
</script>

<template>
  <div class="format-sample">
    <template v-if="markdown">
      <Response :content="markdown" class="md-content sample-prose" />
      <p v-if="id === 'math' || id === 'mermaid'" class="sample-note">扩展能力待接入；上方为当前渲染器的实际输出。</p>
      <p v-if="id === 'html'" class="sample-note">仅静态 strong / kbd 样本，无脚本或事件属性；是否渲染以当前实现为准。</p>
    </template>

    <div v-else-if="id === 'user'" class="sample-user">
      请检查 Zen 的消息内容区，保留现有聊天逻辑，只展示不同格式的评审样本。
      <span class="sample-note">演示用户消息 · 14:32</span>
    </div>

    <figure v-else-if="id === 'image'" class="sample-figure">
      <img src="./stream-review-sample.png" alt="用户提供的当前 Zen 内容区截图，展示密集工具记录与正文的现有样式" loading="lazy">
      <figcaption class="sample-note">图片样本 · 本次评审提供的现状截图，仅存于本地原型。</figcaption>
    </figure>

    <div v-else-if="id === 'attachments'" class="sample-stack">
      <div class="sample-line"><Paperclip :size="16" /><strong>UI_STYLE.md</strong><span class="sample-note">文档 · 18 KB</span></div>
      <div class="sample-line"><Image :size="16" /><strong>stream-review-sample.png</strong><span class="sample-note">图片 · 960 × 540</span></div>
      <p class="sample-note">附件展示演示；不会上传、打开或下载文件。</p>
    </div>

    <Collapsible v-else-if="id === 'reasoning'" class="sample-stack">
      <CollapsibleTrigger as-child><Button variant="ghost" size="sm"><Sparkles data-icon="inline-start" />思考摘要 · 演示 3 秒<ChevronDown data-icon="inline-end" /></Button></CollapsibleTrigger>
      <CollapsibleContent><p class="sample-note">先确认正文和工具结果的视觉层级，再检查文件路径换行。此段为人工编写的思考摘要占位，不代表真实模型内部推理。</p></CollapsibleContent>
    </Collapsible>

    <div v-else-if="id === 'running'" class="sample-stack">
      <div class="sample-line"><LoaderCircle :size="16" /><span>正在整理内容样本…</span><span class="sample-note">演示运行中</span></div>
      <p>已确认正文入口，下一步检查工具结果与审批区域。</p>
      <p class="sample-note">静态流式片段，不会启动任务。</p>
    </div>

    <Collapsible v-else-if="tool" class="sample-stack">
      <div class="sample-tool-row"><span class="sample-action"><component :is="tool.icon" :size="16" />{{ tool.action }}</span><code>{{ tool.target }}</code><span class="sample-status">{{ tool.status }}</span></div>
      <CollapsibleTrigger as-child><Button variant="ghost" size="sm"><ChevronDown data-icon="inline-start" />查看演示详情</Button></CollapsibleTrigger>
      <CollapsibleContent><pre class="sample-output">{{ tool.output }}</pre></CollapsibleContent>
      <p class="sample-note">工具呈现演示，未执行真实调用。</p>
    </Collapsible>

    <div v-else-if="id === 'tool-states'" class="sample-stack">
      <div v-for="state in states" :key="state.text" class="sample-tool-row"><span class="sample-action"><component :is="state.icon" :size="16" />读取文件</span><span>{{ state.detail }}</span><span class="sample-status">{{ state.text }}</span></div>
      <p class="sample-note">独立状态设计样本。当前 part 只保留运行、成功、失败；准备参数被合并，审批为旁路，排队/取消需补协议。</p>
    </div>

    <div v-else-if="id === 'tool-output'" class="sample-stack">
      <div class="sample-line"><Terminal :size="16" /><strong>类型检查输出</strong><span class="sample-note">演示 · 6 行</span></div>
      <pre class="sample-output">$ pnpm --filter @zen/ui typecheck
&gt; vue-tsc --noEmit

检查范围：apps/ui/src
诊断：0 项
退出码：0（演示，未运行命令）</pre>
      <Collapsible><CollapsibleTrigger as-child><Button variant="ghost" size="sm"><ChevronDown data-icon="inline-start" />查看结构化结果</Button></CollapsibleTrigger><CollapsibleContent><pre class="sample-output">{ "状态": "演示成功", "诊断数": 0 }</pre></CollapsibleContent></Collapsible>
    </div>

    <div v-else-if="id === 'approval'" class="sample-stack">
      <div class="sample-line"><ShieldCheck :size="16" /><strong>允许编辑示例文件？</strong></div>
      <p><code>apps/ui/src/components/chat/content-prototype/FormatSample.vue</code></p>
      <p class="sample-note">审批演示：仅改变下方本地状态，不授予权限，不写入磁盘。</p>
      <div class="sample-line"><Button variant="outline" size="sm" @click="approval = '已拒绝（演示）'">拒绝</Button><Button size="sm" @click="approval = '已允许一次（演示）'">允许一次</Button></div>
      <p role="status">{{ approval || '等待选择（演示）' }}</p>
    </div>

    <form v-else-if="id === 'question'" class="sample-stack" @submit.prevent="submitAnswer">
      <p><strong>本轮评审范围是什么？</strong></p>
      <label class="sample-line"><Checkbox v-model="selected" aria-label="仅调整内容区（演示）" /><span>仅调整内容区</span></label>
      <Input v-model="answer" aria-label="补充评审范围（演示）" placeholder="补充范围，例如保留工具详情折叠" />
      <div><Button type="submit" size="sm" :disabled="!selected && !answer.trim()">确认演示回答</Button></div>
      <p class="sample-note">本地交互演示，不向 Agent 或服务发送回答。</p>
      <p v-if="submitted" role="status">演示已记录：{{ submitted }}</p>
    </form>

    <div v-else-if="id === 'tasks'" class="sample-stack">
      <div class="sample-line"><ListChecks :size="16" /><strong>内容区评审</strong><span class="sample-note">演示 · 1 / 3</span></div>
      <div class="sample-line"><Check :size="16" /><span>整理 Markdown 样本</span><span class="sample-status">已完成</span></div>
      <div class="sample-line"><LoaderCircle :size="16" /><span>核对工具详情布局</span><span class="sample-status">进行中</span></div>
      <div class="sample-line"><Clock :size="16" /><span>检查窄屏和主题</span><span class="sample-status">待处理</span></div>
      <p class="sample-note">静态任务快照，不修改真实任务列表。</p>
    </div>

    <div v-else-if="id === 'references'" class="sample-stack">
      <div class="sample-line"><BookOpen :size="16" /><strong>参考资料</strong></div>
      <p>01 · <code>docs/design/UI_STYLE.md</code> · 消息区与主题规范</p>
      <p>02 · <code>apps/ui/src/components/ai-elements/response/Response.vue</code> · Markdown 渲染入口</p>
      <p class="sample-note">引用呈现演示，文件定位交互未接入。</p>
    </div>

    <div v-else-if="id === 'notice'" class="sample-stack" role="note">
      <div class="sample-line"><CircleAlert :size="16" /><strong>需要留意</strong></div>
      <p>数学公式和流程图扩展尚未接入，此页保留当前渲染效果用于比较。</p>
      <p class="sample-note">提示样式演示，不是运行警告。</p>
    </div>

    <div v-else-if="id === 'error'" class="sample-stack">
      <div class="sample-line sample-error"><X :size="16" /><strong>读取失败 · 演示</strong></div>
      <pre class="sample-output">文件不存在：apps/ui/src/components/chat/ReviewDraft.vue</pre>
      <p>检查路径后再重试。错误保留在对应步骤，不覆盖前面的正文。</p>
      <Button variant="outline" size="sm" disabled>重试（拟议能力）</Button>
    </div>

    <div v-else-if="id === 'completion'" class="sample-stack">
      <div class="sample-line sample-success"><Check :size="16" /><strong>本轮已完成 · 演示</strong></div>
      <p>已整理正文、工具及交互样本；未修改正式聊天流程。</p>
      <p class="sample-note">拟议终态：耗时 12 秒 · 读取 3 个文件 · 修改 0 个文件。此处为假数据，不代表实际执行结果。</p>
    </div>

    <div v-else-if="id === 'artifacts'" class="sample-stack">
      <div class="sample-line"><FileText :size="16" /><strong>内容区评审记录.md</strong><span class="sample-note">拟议产物 · Markdown</span></div>
      <p>汇总格式覆盖、交互边界与待验收项。</p>
      <div><Button variant="outline" size="sm" disabled><FileText data-icon="inline-start" />打开产物（演示）</Button></div>
      <p class="sample-note">产物条目仅作设计样本，未生成或保存文件。</p>
    </div>

    <div v-else-if="id === 'media'" class="sample-stack">
      <div class="sample-line"><Play :size="16" /><strong>内容区滚动演示.mp4</strong><span class="sample-note">视频 · 00:18</span></div>
      <div class="sample-media"><Play :size="24" /><span>媒体预览占位</span></div>
      <div><Button variant="outline" size="sm" disabled><Play data-icon="inline-start" />播放（拟议能力）</Button></div>
      <p class="sample-note">媒体展示演示，没有视频源，不播放或请求媒体。</p>
    </div>
    <div v-else-if="id === 'legacy-tool'" class="sample-stack">
      <ToolCallCard :meta="{ toolName: 'readFile', ok: true, summary: '旧版工具消息 · 演示', args: { path: 'README.md' }, output: '这是 role=tool 的历史卡片，不是新流式工具行。' }" />
      <p class="sample-note">直接复用旧组件，便于检查两种工具展示的不一致。</p>
    </div>

    <div v-else-if="id === 'lifecycle'" class="sample-stack">
      <div class="sample-line"><Clock :size="16" /><strong>已暂停</strong><span class="sample-note">保留已有输出，等待继续</span></div>
      <div class="sample-line"><CircleAlert :size="16" /><strong>已取消</strong><span class="sample-note">用户停止，不显示为成功</span></div>
      <div class="sample-line sample-error"><X :size="16" /><strong>运行失败</strong><span>保留原始错误与所属步骤</span></div>
      <div class="sample-line"><Clock :size="16" /><strong>达到步骤上限</strong><span class="sample-note">尚未完成，不用成功勾选</span></div>
      <p class="sample-note">拟议终态显示；不触发暂停、继续或重试。</p>
    </div>

    <div v-else-if="id === 'usage'" class="sample-stack">
      <div class="sample-line"><span>第 4 步</span><span class="sample-note">输入 12,480 tokens</span><span class="sample-note">输出 1,260 tokens</span></div>
      <p class="sample-note">模拟元数据。当前主要消费 inputTokens；步骤号与输出 token 尚无此时间线展示。</p>
    </div>

    <div v-else-if="id === 'subagent'" class="sample-stack">
      <div class="sample-tool-row"><span class="sample-action"><Wrench :size="16" />只读审计</span><span>核对渲染格式</span><span class="sample-status">已完成</span></div>
      <div class="sample-tool-row"><span class="sample-action"><Wrench :size="16" />独立验证</span><span>检查窄栏与流式片段</span><span class="sample-status">进行中</span></div>
      <p class="sample-note">拟议并行任务摘要；当前 Zen 事件协议没有独立子任务 part，未启动任何子任务。</p>
    </div>

    <div v-else-if="id === 'streaming'" class="sample-stack">
      <div><Button variant="outline" size="sm" :disabled="streaming" @click="replayStream"><Play data-icon="inline-start" />{{ streaming ? '正在回放片段' : '回放增量 Markdown' }}</Button></div>
      <Response :content="streamText || '等待回放。'" class="md-content sample-prose" />
      <p class="sample-note">本地逐片段追加：标题、未闭合强调、未闭合代码围栏、半张表格。不会请求模型。</p>
    </div>
    <p v-else class="sample-note">未定义的评审样本：{{ id }}</p>
  </div>
</template>

<style scoped>
.format-sample { min-width: 0; font-size: 13px; line-height: 1.7; color: var(--color-txt); overflow-wrap: anywhere; }
.sample-stack { display: flex; flex-direction: column; align-items: stretch; gap: 10px; }
.sample-stack p, .sample-note, .sample-figure { margin: 0; }
.sample-line, .sample-action { display: flex; align-items: center; gap: 8px; }
.sample-line { flex-wrap: wrap; }
.sample-line > svg, .sample-action > svg { flex-shrink: 0; }
.sample-note { color: var(--color-mut); font-size: 12px; }
.sample-status { font-size: 12px; color: var(--color-mut); }
.sample-tool-row { display: grid; grid-template-columns: 106px minmax(0, 1fr) 82px; align-items: start; gap: 12px; }
.sample-tool-row code { min-width: 0; }
.sample-action { color: var(--color-txt-strong); }
.sample-output { margin: 0; padding: 12px; max-height: 260px; overflow: auto; font-size: 12px; line-height: 1.7; border: 1px solid var(--color-line); border-radius: var(--radius-sm); background: var(--color-sunken); color: var(--color-txt); white-space: pre-wrap; overflow-wrap: anywhere; }
.sample-user { margin-left: auto; max-width: 85%; padding: 10px 14px; border-radius: var(--radius-sm); background: var(--color-side-sel); font-size: 14px; }
.sample-user .sample-note { display: block; margin-top: 6px; }
.sample-figure img { display: block; max-width: 100%; max-height: 320px; object-fit: contain; object-position: left top; height: auto; border-radius: var(--radius-sm); }
.sample-figure figcaption { margin-top: 8px; }
.sample-media { min-height: 120px; display: flex; align-items: center; justify-content: center; gap: 10px; background: var(--color-sunken); border-radius: var(--radius-sm); color: var(--color-mut); }
.sample-error { color: var(--color-err); }
.sample-success { color: var(--color-ok); }
.sample-prose { min-width: 0; overflow-wrap: anywhere; }
.sample-prose :deep(pre) { max-width: 100%; overflow-x: auto; }
.sample-prose :deep(table) { display: block; width: 100%; max-width: 100%; overflow-x: auto; white-space: nowrap; }
@media (max-width: 600px) {
  .sample-tool-row { grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; }
  .sample-tool-row > :nth-child(2) { grid-column: 1 / -1; grid-row: 2; }
  .sample-user { max-width: 95%; }
}
</style>
