import type { LocaleModule } from "../index";

/**
 * 会话模式三档（interactive / plan / autopilot）文案。
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
    },
  },
} satisfies LocaleModule;
