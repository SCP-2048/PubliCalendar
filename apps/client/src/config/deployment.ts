export const DEPLOYMENT_TARGET =
  import.meta.env.VITE_DEPLOYMENT_TARGET === "tencent" ? "tencent" : "cloudflare";

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
export const CLOUDBASE_ENV_ID = import.meta.env.VITE_CLOUDBASE_ENV_ID ?? "";
export const CLOUDBASE_FUNCTION_NAME =
  import.meta.env.VITE_CLOUDBASE_FUNCTION_NAME ?? "publicalendar";

export const usesCloudBaseFunction = DEPLOYMENT_TARGET === "tencent";
