import { createSSRApp } from "vue";
import App from "./App.vue";
import { CLOUDBASE_ENV_ID, usesCloudBaseFunction } from "./config/deployment";

function initializeCloudBase(): void {
  if (!usesCloudBaseFunction || !CLOUDBASE_ENV_ID) return;
  const cloud = (globalThis as typeof globalThis & {
    wx?: { cloud?: { init(options: { env: string; traceUser?: boolean }): void } };
  }).wx?.cloud;
  cloud?.init({ env: CLOUDBASE_ENV_ID, traceUser: true });
}

export function createApp() {
  initializeCloudBase();
  const app = createSSRApp(App);
  return { app };
}
