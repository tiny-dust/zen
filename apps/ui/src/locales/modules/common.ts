import type { LocaleModule } from "../index";

/** 跨模块通用文案（按钮/状态等）；模块内文案一律放各自 modules/<ns>.ts */
export default {
  "zh-CN": {
    save: "保存",
    cancel: "取消",
    confirm: "确认",
    delete: "删除",
    retry: "重试",
    close: "关闭",
    copy: "复制",
    copied: "已复制",
    loading: "加载中…",
    empty: "暂无内容",
    error: "出错了",
  },
  "en-US": {
    save: "Save",
    cancel: "Cancel",
    confirm: "Confirm",
    delete: "Delete",
    retry: "Retry",
    close: "Close",
    copy: "Copy",
    copied: "Copied",
    loading: "Loading…",
    empty: "Nothing here yet",
    error: "Something went wrong",
  },
} satisfies LocaleModule;
