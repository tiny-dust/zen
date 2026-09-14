import { defineStore } from "pinia";
import { ref } from "vue";

import type { AuthState } from "@zen/shared";

export const useUserStore = defineStore("user", () => {
  const auth = ref<AuthState>({ loggedIn: false, user: null });
  const loading = ref(false);

  function bootstrap(): () => void {
    const zen = window.zen;
    if (!zen) {
      return () => undefined;
    }

    void zen.auth.state().then((state) => {
      auth.value = state;
    });

    return zen.auth.onChanged((state) => {
      auth.value = state;
    });
  }

  async function login() {
    const zen = window.zen;
    if (!zen || loading.value) {
      return;
    }
    loading.value = true;
    try {
      auth.value = await zen.auth.login();
    } finally {
      loading.value = false;
    }
  }

  async function logout() {
    const zen = window.zen;
    if (!zen) {
      return;
    }
    auth.value = await zen.auth.logout();
  }

  return {
    auth,
    loading,
    bootstrap,
    login,
    logout,
  };
});
