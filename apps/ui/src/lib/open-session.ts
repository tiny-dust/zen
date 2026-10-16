import { useChatStore } from "@/stores/chat";
import { useWorkspaceStore } from "@/stores/workspace";

/**
 * 按会话 id 跳转：刷新侧栏数据后在所属工作区定位会话并切换。
 * App.vue 的 CLI open 请求与计划任务「查看运行」共用同一条路径。
 * @returns 是否找到并切换了目标会话（找不到返回 false，调用方自行提示）
 */
export async function openSessionById(sessionId: string): Promise<boolean> {
  const workspaceStore = useWorkspaceStore();
  const chatStore = useChatStore();
  await workspaceStore.refresh();
  for (const group of workspaceStore.groups) {
    const record = group.sessions.find((item) => item.id === sessionId);
    if (record) {
      workspaceStore.setActive(group.id);
      await chatStore.loadSession(record);
      return true;
    }
  }
  return false;
}
