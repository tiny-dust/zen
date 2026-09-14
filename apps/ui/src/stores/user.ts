import { defineStore } from "pinia";
import { ref } from "vue";

import type { AuthState, DeviceCodeInfo } from "@zen/shared";

export const useUserStore = defineStore("user", () => {
  const auth = ref<AuthState>({ loggedIn: false, user: null, error: null });
  const loading = ref(false);
  const loginError = ref<string | null>(null);
  const deviceCode = ref<DeviceCodeInfo | null>(null);
  const refreshing = ref(false);

  function bootstrap(): () => void {
    const zen = window.zen;
    if (!zen) {
      return () => undefined;
    }

    void zen.auth.state().then((state) => {
      auth.value = state;
    });

    const offChanged = zen.auth.onChanged((state) => {
      auth.value = state;
      if (!state.error) {
        loginError.value = null;
      }
    });

    const offDeviceCode = zen.auth.onDeviceCode((info) => {
      deviceCode.value = info;
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
    const zen = window.zen;
    if (!zen) {
      return;
    }
    await zen.app.openExternal(url);
  }

  return {
    auth,
    loading,
    loginError,
    deviceCode,
    refreshing,
    bootstrap,
    login,
    logout,
    refreshProfile,
    openExternal,
  };
});
