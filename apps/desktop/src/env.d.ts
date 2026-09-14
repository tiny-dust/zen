/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MAIN_VITE_GITHUB_CLIENT_ID?: string;
  readonly MAIN_VITE_GITHUB_OAUTH_SCOPES?: string;
  readonly VITE_GITHUB_CLIENT_ID?: string;
  readonly GITHUB_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
