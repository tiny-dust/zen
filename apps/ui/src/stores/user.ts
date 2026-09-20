import { defineStore } from "pinia";
import { ref } from "vue";

import type { AuthState, DeviceCodeInfo } from "@zen/shared";

export const useUserStore = defineStore("user", () => {
  const auth = ref<AuthState>({ loggedIn: false, user: null, error: null });
  const loading = ref(false);
  const loginError = ref<string | null>(null);
  const deviceCode = ref<DeviceCodeInfo | null>(null);
  /** 设备码是否已复制到剪贴板（自动复制失败时可在 UI 点按重试） */
  const codeCopied = ref(false);
  const refreshing = ref(false);

  /** 复制设备码到剪贴板，方便在 GitHub 授权页直接粘贴 */
  async function copyUserCode(): Promise<void> {
    const code = deviceCode.value?.userCode;
    if (!code) {
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      codeCopied.value = true;
    } catch {
      codeCopied.value = false;
    }
  }

  function bootstrap(): () => void {
    const zen = window.zen;
    if (!zen) {
      return () => undefined;
    }

    void zen.auth.state().then((state) => {
      auth.value = state;
      // 启动时补拉一次资料：历史登录可能缺 avatarUrl
      if (state.loggedIn) {
        void refreshProfile();
      }
    });

    const offChanged = zen.auth.onChanged((state) => {
      auth.value = state;
      if (!state.error) {
        loginError.value = null;
      }
    });

    const offDeviceCode = zen.auth.onDeviceCode((info) => {
      deviceCode.value = info;
      // 设备码一到即自动复制，用户在浏览器授权页直接粘贴
      void copyUserCode();
    });

    return () => {
      offChanged();
      offDeviceCode();
    };
  }

  async function login() {
    const zen = window.zen;
    if (!zen || loading.value) {
      return;
    }
    loading.value = true;
    loginError.value = null;
    deviceCode.value = null;
    codeCopied.value = false;
    try {
      const next = await zen.auth.login();
      auth.value = next;
      loginError.value = next.error ?? null;
      if (next.loggedIn) {
        deviceCode.value = null;
      }
    } catch (error) {
      loginError.value = error instanceof Error ? error.message : "GitHub 登录失败";
    } finally {
      loading.value = false;
      deviceCode.value = null;
    }
  }

  async function logout() {
    const zen = window.zen;
    if (!zen) {
      return;
    }
    loginError.value = null;
    deviceCode.value = null;
    auth.value = await zen.auth.logout();
  }

  async function refreshProfile() {
    const zen = window.zen;
    if (!zen || refreshing.value || loading.value || !auth.value.loggedIn) {
      return;
    }
    refreshing.value = true;
    try {
      const next = await zen.auth.refreshProfile();
      auth.value = next;
      if (next.error) {
        loginError.value = next.error;
      }
    } catch (error) {
      loginError.value = error instanceof Error ? error.message : "刷新资料失败";
    } finally {
      refreshing.value = false;
    }
  }

  async function openExternal(url: string) {
    // http(s) 优先右栏浏览器；其余走系统
    const { openAppLink } = await import("@/lib/open-link");
    await openAppLink(url);
  }

  return {
    auth,
    loading,
    loginError,
    deviceCode,
    codeCopied,
    copyUserCode,
    refreshing,
    bootstrap,
    login,
    logout,
    refreshProfile,
    openExternal,
  };
});
