import { createHash } from "node:crypto";
import { join } from "node:path";

import { BrowserWindow, screen } from "electron";

export interface PetTraySession {
  id: string;
  name: string;
  status: "running" | "needs_action" | "done" | "error";
  runId?: string;
  approval?: { approvalId: string; toolName: string; prompt: string; input?: unknown };
  questions?: Array<{
    askId: string;
    question: string;
    options: Array<string | { label: string; priority: "strong" | "recommended" | "neutral" | "avoid" }>;
    multiSelect?: boolean;
    allowFreeText: boolean;
    agentName?: string;
  }>;
}

export type PetTrayAction =
  | { type: "stop"; sessionId: string; runId: string }
  | { type: "approval"; sessionId: string; runId: string; approvalId: string; approved: boolean; always?: boolean }
  | { type: "answer"; sessionId: string; runId: string; askId: string; answer: string };

const WIDTH = 360;
const HEIGHT = 520;
const GAP = 10;

const STYLE = `
:root{color-scheme:dark;--bg:#1a1a1a;--line:#343434;--text:#f4f4f5;--muted:#b8b8b8;--dim:#8a8a8a;--hover:#303030;--ok:#53bf8a;--danger:#ff9b7f;--accent:#ff6a2b}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;color:var(--text);font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
#panel{height:100%;overflow:hidden;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 40px #0008}
header{display:flex;align-items:center;justify-content:space-between;min-height:42px;padding:0 12px;border-bottom:1px solid var(--line)}
header strong{font-size:14px}header button{font-size:18px;line-height:1;-webkit-app-region:no-drag}
#list{flex:1;min-height:0;overflow-y:auto;scrollbar-color:#505050 transparent;scrollbar-width:thin;padding:4px 8px 8px}
article{padding:10px 6px;border-bottom:1px solid var(--line)}.top{display:flex;align-items:center;gap:8px}.name{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;font-weight:600}.status{font-size:11px;color:var(--muted);white-space:nowrap}.status[data-status=needs_action]{color:var(--accent)}.status[data-status=error]{color:var(--danger)}.status[data-status=done]{color:var(--ok)}
button{border:0;background:transparent;color:var(--text);font:inherit;cursor:pointer;border-radius:8px;padding:5px 8px}button:hover{background:var(--hover)}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:1px solid var(--muted);outline-offset:1px}button:disabled{opacity:.5;cursor:not-allowed}.stop,.reject{color:var(--danger)}.actions{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}.primary{background:#ececec;color:#151c13}.primary:hover{background:#d2d2d2}.detail{padding:7px 8px;margin-top:8px;border-radius:8px;background:#242424}.detail p{margin:3px 0 8px;white-space:pre-wrap;overflow-wrap:anywhere}.detail small{color:var(--muted)}.detail pre{margin:4px 0 8px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:90px;overflow:auto;color:var(--muted);font:11px/1.45 ui-monospace,monospace}.choice{display:flex;align-items:flex-start;gap:6px;padding:4px 0;cursor:pointer;overflow-wrap:anywhere}.choice input{accent-color:var(--accent);margin-top:3px}.choice em{font-size:11px;color:var(--muted);font-style:normal}textarea{width:100%;min-height:48px;max-height:120px;resize:vertical;padding:7px;margin:5px 0;background:#202020;border:1px solid var(--line);border-radius:8px;color:var(--text);font:inherit}textarea::placeholder{color:var(--dim)}.feedback{min-height:17px;margin-top:4px;color:var(--muted);font-size:11px}.feedback.error{color:var(--danger)}
`;

const SCRIPT = `
const list = document.getElementById('list');
const states = { running:'运行中', needs_action:'待处理', done:'已完成', error:'异常' };
const priorities = { strong:'强烈推荐', recommended:'推荐', neutral:'一般', avoid:'不推荐' };
const drafts = new Map();
const pending = new Set();
const feedback = new Map();
let sessions = [];
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text, className, onClick) {
  const node = element('button', className, text);
  node.type = 'button'; node.addEventListener('click', onClick);
  return node;
}
function key(session, id) { return session.id + ':' + (session.runId || '') + ':' + id; }
async function send(action, id) {
  const marker = key({ id:action.sessionId, runId:action.runId }, id);
  if (pending.has(marker)) return;
  pending.add(marker); feedback.delete(marker); render();
  try {
    await window.zen.petTray.control(action);
    feedback.set(marker, { text:'已提交，等待更新', error:false });
  } catch (error) {
    feedback.set(marker, { text:'操作失败：' + (error instanceof Error ? error.message : String(error)), error:true });
  } finally {
    pending.delete(marker); render();
  }
}
function actionBlock(session, id, content, action) {
  const marker = key(session, id);
  content.classList.add('detail');
  const controls = element('div', 'actions');
  const note = element('div', 'feedback');
  const state = feedback.get(marker);
  if (state) { note.textContent = state.text; if (state.error) note.classList.add('error'); }
  content.append(controls, note);
  content.dataset.actionId = id;
  content.dataset.pending = String(pending.has(marker));
  return { controls, note, marker };
}
function render() {
  const scrollTop = list.scrollTop;
  list.replaceChildren();
  for (const session of sessions.slice(0,20)) {
    const row = element('article');
    const top = element('div','top');
    const name = button(session.name,'name', () => window.zen.petTray.openSession(session.id));
    name.title = session.name;
    const status = element('span','status', states[session.status] || '未知');
    status.dataset.status = session.status;
    top.append(name,status);
    if (session.runId && (session.status === 'running' || session.status === 'needs_action')) {
      const stopId = 'stop';
      const stop = button('停止','stop', () => send({ type:'stop',sessionId:session.id,runId:session.runId },stopId,row));
      stop.disabled = pending.has(key(session,stopId)) || feedback.get(key(session,stopId))?.error === false;
      stop.setAttribute('aria-label','停止 ' + session.name);
      top.append(stop);
    }
    row.append(top);
    const stopState = feedback.get(key(session,'stop'));
    if (stopState) row.append(element('div',stopState.error ? 'feedback error' : 'feedback',stopState.text));
    if (session.runId && session.approval) {
      const approval = session.approval;
      const id = 'approval:' + approval.approvalId;
      const detail = element('section');
      detail.append(element('small','', '审批 · ' + approval.toolName), element('p','',approval.prompt));
      if (approval.input !== undefined) {
        let display;
        try { display = JSON.stringify(approval.input,null,2); } catch { display = '无法显示参数'; }
        detail.append(element('pre','',display));
      }
      const { controls, marker } = actionBlock(session,id,detail);
      for (const [label, approved, always] of [['批准',true,false],['拒绝',false,false],['本会话全部允许',true,true]]) {
        const choice = button(label,approved ? 'primary' : 'reject', () => send({ type:'approval',sessionId:session.id,runId:session.runId,approvalId:approval.approvalId,approved,always },id,detail));
        choice.disabled = pending.has(marker) || feedback.get(marker)?.error === false;
        controls.append(choice);
      }
      row.append(detail);
    }
    for (const question of session.questions || []) {
      if (!session.runId) continue;
      const runId = session.runId;
      const id = 'ask:' + question.askId;
      const marker = key(session,id);
      const detail = element('section');
      detail.append(element('small','',question.agentName ? question.agentName + ' · 提问' : '提问'), element('p','',question.question));
      const draft = drafts.get(marker) || { selected:[], free:'' };
      const optionLabels = question.options.map(option => typeof option === 'string' ? option : option.label);
      question.options.forEach((option,index) => {
        const label = optionLabels[index];
        const line = element('label','choice');
        const input = element('input');
        input.type = question.multiSelect ? 'checkbox' : 'radio';
        input.name = marker;
        input.checked = draft.selected.includes(label);
        input.disabled = pending.has(marker) || feedback.get(marker)?.error === false;
        input.addEventListener('change', () => {
          draft.selected = question.multiSelect ? (input.checked ? [...new Set([...draft.selected,label])] : draft.selected.filter(value => value !== label)) : [label];
          drafts.set(marker,draft);
          if (!question.multiSelect) send({ type:'answer',sessionId:session.id,runId,askId:question.askId,answer:label },id);
        });
        line.append(input,element('span','',label));
        if (typeof option !== 'string' && priorities[option.priority]) line.append(element('em','',priorities[option.priority]));
        detail.append(line);
      });
      let free;
      if (question.allowFreeText) {
        free = element('textarea'); free.placeholder = '输入回答'; free.setAttribute('aria-label','回答：' + question.question);
        free.value = draft.free;
        free.disabled = pending.has(marker) || feedback.get(marker)?.error === false;
        free.addEventListener('input', () => { draft.free = free.value; drafts.set(marker,draft); });
        detail.append(free);
      }
      const { controls } = actionBlock(session,id,detail);
      const submit = button('回答','primary', () => {
        const answer = draft.free.trim() || draft.selected.join('、');
        if (answer) send({ type:'answer',sessionId:session.id,runId,askId:question.askId,answer },id,detail);
      });
      submit.disabled = pending.has(marker) || feedback.get(marker)?.error === false;
      controls.append(submit);
      row.append(detail);
    }
    list.append(row);
  }
  list.scrollTop = scrollTop;
}
window.__zenPetTrayUpdate = function (next) {
  sessions = Array.isArray(next) ? next.slice(0,20) : [];
  const active = new Set();
  for (const session of sessions) {
    if (session.approval) active.add(key(session,'approval:' + session.approval.approvalId));
    for (const question of session.questions || []) active.add(key(session,'ask:' + question.askId));
    if (session.status === 'running' || session.status === 'needs_action') active.add(key(session,'stop'));
  }
  for (const marker of drafts.keys()) if (!active.has(marker)) drafts.delete(marker);
  for (const marker of feedback.keys()) if (!active.has(marker)) feedback.delete(marker);
  render();
};
document.getElementById('close').addEventListener('click', () => window.zen.petTray.hide());
`;

function hash(source: string): string {
  return `'sha256-${createHash("sha256").update(source).digest("base64")}'`;
}

const HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${hash(SCRIPT)}; style-src ${hash(STYLE)}; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>${STYLE}</style></head><body><div id="panel"><header><strong>活动会话</strong><button id="close" type="button" aria-label="隐藏活动面板" title="隐藏活动面板">×</button></header><main id="list" aria-label="活动会话列表"></main></div><script>${SCRIPT}</script></body></html>`;

const trayWindows = new WeakSet<BrowserWindow>();

export function isPetTrayWindow(window: BrowserWindow | null): boolean {
  return window !== null && trayWindows.has(window);
}

export class PetTrayWindow {
  readonly window: BrowserWindow;
  private sessions: PetTraySession[] = [];
  private loaded = false;
  private anchor: { x: number; y: number; width: number; height: number } | null = null;

  constructor() {
    const window = new BrowserWindow({
      width: WIDTH, height: HEIGHT, frame: false, transparent: true, alwaysOnTop: true,
      skipTaskbar: true, show: false, resizable: false, fullscreenable: false,
      webPreferences: {
        preload: join(__dirname, "../preload/pet-tray-guest.js"),
        sandbox: true, contextIsolation: true, nodeIntegration: false,
      },
    });
    this.window = window;
    trayWindows.add(window);
    window.setMenuBarVisibility(false);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.on("did-finish-load", () => {
      this.loaded = true;
      this.sendUpdate();
    });
    window.on("closed", () => {
      this.loaded = false;
      trayWindows.delete(window);
    });
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`).catch(() => undefined);
  }

  update(sessions: PetTraySession[]): void {
    this.sessions = sessions.slice(0,20);
    if (this.window.isDestroyed()) return;
    if (!this.sessions.length) this.hide();
    else if (this.anchor && this.window.isVisible()) this.show(this.anchor);
    this.sendUpdate();
  }

  show(anchor: { x: number; y: number; width: number; height: number }): void {
    if (this.window.isDestroyed() || !this.sessions.length) return;
    this.anchor = anchor;
    const area = screen.getDisplayNearestPoint({ x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 }).workArea;
    const width = Math.min(WIDTH, area.width);
    const estimated = 54 + this.sessions.reduce((total, session) => total + 52
      + (session.approval ? 148 : 0)
      + (session.questions ?? []).reduce((sum, question) => sum + 92
        + question.options.length * 32 + (question.allowFreeText ? 58 : 0), 0), 0);
    const height = Math.min(HEIGHT, Math.max(100, estimated), Math.max(1, area.height - 16));
    this.window.setContentSize(width, height);
    const above = anchor.y - area.y;
    const below = area.y + area.height - (anchor.y + anchor.height);
    const preferredY = above >= height + GAP || above >= below
      ? anchor.y - height - GAP : anchor.y + anchor.height + GAP;
    const clamp = (value: number, low: number, size: number, available: number) => Math.round(Math.max(low, Math.min(value, low + Math.max(0, available - size))));
    this.window.setPosition(
      clamp(anchor.x + (anchor.width - width) / 2, area.x, width, area.width),
      clamp(preferredY, area.y, height, area.height),
    );
    this.window.showInactive();
  }

  hide(): void {
    if (!this.window.isDestroyed() && this.window.isVisible()) this.window.hide();
  }

  private sendUpdate(): void {
    if (!this.loaded || this.window.isDestroyed()) return;
    void this.window.webContents.executeJavaScript(`window.__zenPetTrayUpdate(${JSON.stringify(this.sessions)})`).catch(() => undefined);
  }
}
