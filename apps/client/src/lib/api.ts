import type {
  CreateScheduleInput,
  CreateScheduleResult,
  IntersectionResult,
  JoinScheduleResult,
  ReplaceAvailabilityInput,
  ScheduleView,
  UpdateScheduleSettingsInput,
  UtcRange,
} from "@publicalendar/shared";
import { API_BASE_URL } from "../config/deployment";

interface ApiError {
  error?: string;
}

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

async function request<T>(
  path: string,
  method: HttpMethod,
  data?: unknown,
  token?: string,
): Promise<T> {
  if (!API_BASE_URL) {
    throw new Error("API 地址未配置");
  }
  const url = `${API_BASE_URL}${path}`;
  // WeChat MP: always send a JSON string. Passing a nested object as `data` with
  // application/json can produce a bad Content-Length and hang until timeout.
  const hasBody = data !== undefined && method !== "GET";
  const payload = hasBody ? JSON.stringify(data) : undefined;
  return new Promise<T>((resolve, reject) => {
    uni.request({
      url,
      method: method as UniApp.RequestOptions["method"],
      timeout: 60_000,
      data: payload as unknown as UniApp.RequestOptions["data"],
      header: {
        "content-type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      success(response) {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const body = response.data as ApiError;
          reject(new Error(body?.error ?? `请求失败（${response.statusCode}）`));
          return;
        }
        resolve(response.data as T);
      },
      fail(reason) {
        const message = reason?.errMsg || "网络请求失败";
        const lower = message.toLowerCase();
        if (lower.includes("timeout") || lower === "timeout") {
          reject(
            new Error(
              `请求超时（${method} ${path}）。若加入活动正常，请重新编译后再试创建。`,
            ),
          );
          return;
        }
        if (
          lower.includes("url not in domain list") ||
          lower.includes("域名") ||
          lower.includes("request:fail")
        ) {
          reject(
            new Error(
              "域名未放行。开发阶段请勾选“不校验合法域名”；正式版请将下列域名加入 request 合法域名：\n" +
                API_BASE_URL.replace(/^https?:\/\//, ""),
            ),
          );
          return;
        }
        reject(new Error(message));
      },
    });
  });
}

export const api = {
  create(input: CreateScheduleInput) {
    // Alias path: some WeChat/base-library builds mishandle POST /api/schedules.
    return request<CreateScheduleResult>("/api/schedules/create", "POST", input);
  },
  getSchedule(code: string) {
    return request<ScheduleView>(`/api/schedules/${encodeURIComponent(code)}`, "GET");
  },
  updateSettings(code: string, input: UpdateScheduleSettingsInput, creatorToken: string) {
    return request<ScheduleView>(
      `/api/schedules/${encodeURIComponent(code)}`,
      "PATCH",
      input,
      creatorToken,
    );
  },
  join(code: string, nickname: string) {
    return request<JoinScheduleResult>(
      `/api/schedules/${encodeURIComponent(code)}/participants`,
      "POST",
      { nickname },
    );
  },
  deleteParticipant(code: string, participantId: string, token: string) {
    return request<{ ok: boolean }>(
      `/api/schedules/${encodeURIComponent(code)}/participants/${encodeURIComponent(participantId)}`,
      "DELETE",
      undefined,
      token,
    );
  },
  replaceAvailability(code: string, input: ReplaceAvailabilityInput, token: string) {
    return request<{ ranges: ReplaceAvailabilityInput["ranges"] }>(
      `/api/schedules/${encodeURIComponent(code)}/availability`,
      "PUT",
      input,
      token,
    );
  },
  getAvailability(code: string, token: string) {
    return request<{ participantId: string; submitted: boolean; ranges: UtcRange[] }>(
      `/api/schedules/${encodeURIComponent(code)}/availability`,
      "GET",
      undefined,
      token,
    );
  },
  intersection(code: string) {
    return request<IntersectionResult>(
      `/api/schedules/${encodeURIComponent(code)}/intersection`,
      "GET",
    );
  },
};
