import { completeOnce } from "./model-api";
import { git } from "./git-exec";

/** 把模型调用异常转成可读原因，用于提交面板的错误提示 */
function describeAiError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "模型调用失败";
}

const AI_DIFF_LIMIT = 12 * 1024;

const MAX_BATCHES = 6;
const BATCH_PLAN_SYSTEM_PROMPT = [
  "你是 git 分批提交规划器，全部输出就是一个 JSON 数组本身。",
  "数组元素形如 {\"message\":\"...\",\"files\":[\"...\"]}：message 为该批次的 commit message，files 为该批次包含的文件路径。",
].join("\n");

/** 按变更内容规划提交批次：优先用模型分组，失败时按目录确定性兜底 */
export async function planBatches(
  workdir: string,
  candidates: string[],
  candidateSet: Set<string>,
): Promise<Array<{ message: string; files: string[] }>> {
  const raw = await buildBatchPlanPrompt(workdir, candidates)
    .then((prompt) => completeOnce(prompt, { maxTokens: 2048, system: BATCH_PLAN_SYSTEM_PROMPT }))
    .catch(() => "");
  const plan = parseBatchPlan(raw, candidateSet);
  if (!plan.length) {
    return fallbackBatches(candidates);
  }
  // 覆盖兜底：模型遗漏的文件补成收尾批次
  const used = new Set(plan.flatMap((batch) => batch.files));
  const leftovers = candidates.filter((file) => !used.has(file));
  if (leftovers.length) {
    plan.push({ message: `chore: 其余 ${leftovers.length} 个变更文件`, files: leftovers });
  }
  return plan.slice(0, MAX_BATCHES);
}

/** 分组规划的输入材料：状态、行数增减与限量 diff */
async function buildBatchPlanPrompt(workdir: string, candidates: string[]): Promise<string> {
  const [status, numstat, diffBody] = await Promise.all([
    git(workdir, ["status", "--porcelain"]).catch(() => ""),
    git(workdir, ["diff", "HEAD", "--numstat"]).catch(() => ""),
    git(workdir, ["diff", "HEAD", "--no-color", "-U1"]).catch(() => ""),
  ]);
  const diff =
    diffBody.length > AI_DIFF_LIMIT ? `${diffBody.slice(0, AI_DIFF_LIMIT)}\n… diff 已截断` : diffBody;
  return [
    "把下面的 git 工作区变更文件按内容相关性分成 1-6 个提交批次，每个批次一条 commit message。",
    "message 用中文 Conventional Commits：type(scope): 主题（主题不超过 50 字），必要时空一行带 1-2 行正文。",
    "分组要求：同一功能、同一模块或同一目的的文件归入同一批次；目的明显不同的（如功能与格式化、代码与文档）拆开。",
    "硬性要求：给出的文件列表必须与候选文件一致，每个文件必须且只能出现在一个批次中，不得遗漏、不得编造列表之外的文件。",
    "未跟踪文件（??）按新文件对待。",
    "只输出 JSON 数组：[{\"message\":\"...\",\"files\":[\"...\"]}]，禁止解释、禁止 markdown 代码块。",
    "",
    "候选文件：",
    candidates.join("\n") || "（无）",
    "",
    "状态与行数增减：",
    [status, numstat].filter(Boolean).join("\n") || "（无）",
    "",
    "变更内容（diff 摘要）：",
    diff || "（无）",
  ].join("\n");
}

/** 解析模型输出的 JSON 批次计划：只保留候选文件、去重、限量 */
function parseBatchPlan(
  raw: string,
  candidateSet: Set<string>,
): Array<{ message: string; files: string[] }> {
  const text = raw.replace(/```(?:json)?/g, "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const used = new Set<string>();
  const batches: Array<{ message: string; files: string[] }> = [];
  for (const item of parsed) {
    const record = item as { message?: unknown; files?: unknown };
    const message =
      typeof record?.message === "string" ? capSubject(record.message.trim().replace(/^["'`]+|["'`]+$/g, "")) : "";
    const files = (
      Array.isArray(record?.files) ? record.files : []
    ).filter((file): file is string => typeof file === "string" && candidateSet.has(file.trim()))
      .map((file) => file.trim())
      .filter((file) => !used.has(file));
    if (!message || !files.length) {
      continue;
    }
    for (const file of files) {
      used.add(file);
    }
    batches.push({ message, files });
    if (batches.length >= MAX_BATCHES) {
      break;
    }
  }
  return batches;
}

/** 无模型时的确定性兜底：按目录（前两级）分组 */
function fallbackBatches(files: string[]): Array<{ message: string; files: string[] }> {
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const segments = file.split("/");
    const group = segments.length > 1 ? segments.slice(0, -1).slice(0, 2).join("/") : "(root)";
    groups.set(group, [...(groups.get(group) ?? []), file]);
  }
  return [...groups.entries()].map(([group, batchFiles]) => ({
    message:
      group === "(root)"
        ? `chore: update ${batchFiles.length} files`
        : `chore: update ${group} files (${batchFiles.length})`,
    files: batchFiles,
  }));
}

const HISTORY_LIMIT = 4 * 1024;
const SUBJECT_LIMIT = 72;
const BODY_LIMIT = 600;
const CONVENTIONAL_RE =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?:\s?\S/i;
const SYSTEM_PROMPT = [
  "你是 Git commit message 生成器，全部输出就是一条 commit message 本身。",
  "第一行为 type(scope): 简短主题（type 从 feat/fix/docs/style/refactor/perf/test/chore 中选，scope 可选），空一行后为 1-3 行正文。",
  "禁止输出思考过程、任务复述、变更分析、解释、markdown 代码块或引号。",
].join("\n");

/** 历史提交大多遵循 Conventional Commits 时返回 true，决定沿用历史风格还是标准模板 */
function historyIsConventional(commits: string[]): boolean {
  const subjects = commits
    .map((block) => (block.split("\n").find((line) => line.trim()) ?? "").trim())
    .filter(Boolean);
  if (!subjects.length) {
    return false;
  }
  const hits = subjects.filter((subject) => CONVENTIONAL_RE.test(subject)).length;
  return hits / subjects.length >= 0.5;
}

/** 正文超长时按行边界截断，避免 commit message 失控 */
function capBody(body: string): string {
  if (body.length <= BODY_LIMIT) {
    return body;
  }
  const cut = body.slice(0, BODY_LIMIT);
  const nl = cut.lastIndexOf("\n");
  return (nl > 0 ? cut.slice(0, nl) : cut).trimEnd();
}

/** 主题截断后去掉残缺的括号/引号，避免以半个「（」结尾 */
function capSubject(subject: string): string {
  if (subject.length <= SUBJECT_LIMIT) {
    return subject;
  }
  return subject
    .slice(0, SUBJECT_LIMIT)
    .replace(/[\s（(【\[{《"'“”]+$/u, "")
    .trimEnd();
}

/** 把模型原始输出净化成 commit message：定位首个符合 Conventional Commits 的行作主题，其后为正文。
 *  找不到合格主题（如模型输出任务分析/思考内容）时返回空串，交给确定性兜底 */
function toCommitMessage(raw: string): string {
  const lines = raw
    .split("\n")
    .filter((line) => !/^\s*```/.test(line))
    .map((line) => line.trimEnd());
  const subjectIndex = lines.findIndex((line) => CONVENTIONAL_RE.test(line.trim()));
  if (subjectIndex < 0) {
    return "";
  }
  const subject = (lines[subjectIndex] ?? "")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  const cappedSubject = capSubject(subject);
  const body = capBody(
    lines
      .slice(subjectIndex + 1)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
  return body ? `${cappedSubject}\n\n${body}` : cappedSubject;
}

export async function generateAiMessage(workdir: string): Promise<string> {
  const [diffStat, numstat, status, diffBody, historyRaw] = await Promise.all([
    git(workdir, ["diff", "HEAD", "--stat"]).catch(() => ""),
    git(workdir, ["diff", "HEAD", "--numstat"]).catch(() => ""),
    git(workdir, ["status", "--porcelain"]).catch(() => ""),
    git(workdir, ["diff", "HEAD", "--no-color", "-U1"]).catch(() => ""),
    git(workdir, ["log", "-n", "5", "--pretty=format:---%n%B"]).catch(() => ""),
  ]);
  const files = status
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 40)
    .join("\n");
  const diff =
    diffBody.length > AI_DIFF_LIMIT
      ? `${diffBody.slice(0, AI_DIFF_LIMIT)}\n… diff 已截断`
      : diffBody;
  const historyRawTrimmed = historyRaw.trim();
  const history =
    historyRawTrimmed.length > HISTORY_LIMIT
      ? `${historyRawTrimmed.slice(0, HISTORY_LIMIT)}\n… 历史已截断`
      : historyRawTrimmed;
  const commits = history
    .split(/^---$/m)
    .map((block) => block.trim())
    .filter(Boolean);
  const styleHint = historyIsConventional(commits)
    ? "最近提交遵循 Conventional Commits：沿用其常用的 type 与 scope 习惯。"
    : "最近提交缺失或不规范：忽略其风格，直接使用标准模板。";
  const prompt = [
    "根据下面的 git 变更，为本次变更写一条中文 commit message。",
    "标准模板：第一行为 type(scope): 简短主题（不超过 50 字），type 从 feat/fix/docs/style/refactor/perf/test/chore 中选，scope 可选；空一行；正文用 1-3 行说明本次变更的动机与要点。",
    styleHint,
    "只输出 commit message 本身，不要输出思考过程、解释、markdown 代码块或引号。",
    "",
    "最近提交（风格参考）：",
    history || "（无）",
    "",
    "变更文件：",
    files || "（无）",
    "",
    "行数增减：",
    numstat || "（无）",
    "",
    "统计摘要：",
    diffStat || "（无变更）",
    "",
    "变更内容（diff）：",
    diff || "（无）",
  ].join("\n");
  return toCommitMessage(await completeOnce(prompt, { maxTokens: 2048, system: SYSTEM_PROMPT }));
}

/** AI 不可用时的确定性兜底 commit message，保证提交链路不会因空 message 失败 */
export async function fallbackCommitMessage(workdir: string): Promise<string> {
  const status = await git(workdir, ["status", "--porcelain"]).catch(() => "");
  const paths = status
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const path = line.slice(3);
      return path.includes(" -> ") ? path.split(" -> ").pop()! : path;
    })
    .filter(Boolean);

  if (!paths.length) {
    return "chore: commit workspace changes";
  }
  if (paths.length === 1) {
    return `chore: update ${paths[0]}`;
  }
  // 按前两级目录聚合，兜底信息至少说明改了哪些区域而不只是文件数量
  const groups = new Map<string, number>();
  for (const path of paths) {
    const segments = path.split("/");
    const area = segments.length > 2 ? segments.slice(0, 2).join("/") : (segments[0] ?? path);
    groups.set(area, (groups.get(area) ?? 0) + 1);
  }
  const areas = [...groups.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([area, count]) => `${area}(${count})`)
    .join("、");
  return `chore: update ${paths.length} files: ${areas}`;
}
