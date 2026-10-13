import type { LocaleModule } from "../index";

/**
 * 会话模式三档（interactive / plan / autopilot）与运行中转向（steer）文案。
 * 键：sessionMode.*（命名空间即文件名 session-mode）。
 */
export default {
  "zh-CN": {
    sessionMode: {
      label: "会话模式",
      pickerAria: "选择会话模式",
      pickerTitle: "会话模式：{label}",
      modes: {
        interactive: {
          label: "互动",
          description: "正常对话执行，需要时向你确认",
        },
        plan: {
          label: "计划",
          description: "先产出计划清单等你批准，再开始执行；批准后自动回到互动模式",
        },
        autopilot: {
          label: "自动",
          description: "减少确认，尽可能自主完成（权限审批仍按权限模式生效）",
        },
      },
      plan: {
        approve: "批准执行",
        approveTitle: "批准当前计划并开始执行，会话将回到互动模式",
      },
      steer: {
        badge: "转向",
        badgeTitle: "该消息在任务执行过程中转向：Agent 已按新指示调整方向并继续原任务",
        running: "按新指示转向中…",
        resumed: "已按新指示调整，继续任务…",
        failed: "转向失败",
        placeholder: "Agent 运行中：输入内容按 Enter 直接转向当前任务",
      },
    },
  },
  "en-US": {
    sessionMode: {
      label: "Session mode",
      pickerAria: "Select session mode",
      pickerTitle: "Session mode: {label}",
      modes: {
        interactive: {
          label: "Interactive",
          description: "Normal chat and execution, confirms with you when needed",
        },
        plan: {
          label: "Plan",
          description: "Produces a plan for approval before executing; switches back to interactive once approved",
        },
        autopilot: {
          label: "Autopilot",
          description: "Fewer confirmations, completes autonomously (tool approvals still follow the permission mode)",
        },
      },
      plan: {
        approve: "Approve plan",
        approveTitle: "Approve the plan and start executing; the session returns to interactive",
      },
      steer: {
        badge: "Steer",
        badgeTitle: "This message steered the running task: the agent adjusted direction and continued",
        running: "Steering with the new instruction…",
        resumed: "Direction adjusted, continuing the task…",
        failed: "Steer failed",
        placeholder: "Agent is running: press Enter to steer the current task",
      },
    },
  },
} satisfies LocaleModule;
