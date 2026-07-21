import { createHash, randomBytes, randomUUID } from "node:crypto";
import * as cloudbase from "@cloudbase/node-sdk";
import {
  RETENTION_DAYS,
  createScheduleSchema,
  intersectRangeSets,
  joinScheduleSchema,
  mergeDateRanges,
  replaceAvailabilitySchema,
  unionRanges,
  updateScheduleSettingsSchema,
  type DateRange,
  type ScheduleView,
  type UtcRange,
} from "@publicalendar/shared";

type Db = any;

interface FunctionEvent {
  path?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  data?: unknown;
  token?: string;
  action?: "cleanup";
  httpMethod?: string;
  body?: string;
  headers?: Record<string, string | undefined>;
}

interface ScheduleDoc {
  id: string;
  code: string;
  name: string;
  startDate: string;
  endDate: string;
  timeZone: string;
  creatorTokenHash: string;
  allowParticipantsDeleteOthers?: boolean;
  createdAt: number;
  expiresAt: number;
}

interface ParticipantDoc {
  id: string;
  scheduleId: string;
  nickname: string;
  tokenHash: string;
  submittedAt?: number;
  createdAt: number;
}

interface AvailabilityDoc {
  participantId: string;
  start: number;
  end: number;
}

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const app = cloudbase.init({ env: cloudbase.SYMBOL_DEFAULT_ENV });
const db = app.database() as Db;

export async function main(event: FunctionEvent): Promise<unknown> {
  if (event.action === "cleanup") {
    const deleted = await cleanupExpiredSchedules();
    return { statusCode: 200, body: { deleted } };
  }

  const request = normalizeRequest(event);
  try {
    const body = await handle(request.path, request.method, request.data, request.token);
    return request.http ? httpResponse(200, body) : { statusCode: 200, body };
  } catch (error) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : "服务器暂时不可用";
    const body = { error: message };
    return request.http ? httpResponse(statusCode, body) : { statusCode, error: message, body };
  }
}

function normalizeRequest(event: FunctionEvent) {
  if (event.httpMethod) {
    const url = event.path ?? "";
    const rawPath = url.includes("?") ? url.slice(0, url.indexOf("?")) : url;
    const body = event.body ? JSON.parse(event.body) : undefined;
    const auth = event.headers?.authorization ?? event.headers?.Authorization;
    return {
      http: true,
      path: normalizeApiPath(rawPath),
      method: event.httpMethod as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
      data: body,
      token: bearerToken(auth),
    };
  }
  return {
    http: false,
    path: normalizeApiPath(event.path ?? ""),
    method: event.method ?? "GET",
    data: event.data,
    token: event.token,
  };
}

/** CloudBase HTTP gateway may strip the `/api` service prefix. */
function normalizeApiPath(path: string): string {
  if (!path || path === "/") return "/api";
  if (path.startsWith("/api/") || path === "/api") return path;
  return path.startsWith("/") ? `/api${path}` : `/api/${path}`;
}

async function handle(
  path: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  data: unknown,
  token?: string,
): Promise<unknown> {
  if (method === "POST" && (path === "/api/schedules" || path === "/api/schedules/create")) {
    return createSchedule(data);
  }

  const match = path.match(
    /^\/api\/schedules\/([^/]+)(?:\/(participants|availability|intersection)(?:\/([^/]+))?)?$/,
  );
  if (!match) throw new ApiError(404, "接口不存在");
  const code = normalizeCode(decodeURIComponent(match[1] ?? ""));
  const resource = match[2];
  const resourceId = match[3] ? decodeURIComponent(match[3]) : undefined;

  if (!resource && method === "GET") return getScheduleView(code);
  if (!resource && method === "PATCH") return updateScheduleSettings(code, data, token);
  if (resource === "participants" && method === "POST") return joinSchedule(code, data);
  if (resource === "participants" && method === "DELETE" && resourceId) {
    return deleteParticipant(code, resourceId, token);
  }
  if (resource === "availability" && method === "GET") return getAvailability(code, token);
  if (resource === "availability" && method === "PUT") return replaceAvailability(code, token, data);
  if (resource === "intersection" && method === "GET") return getIntersection(code);
  throw new ApiError(404, "接口不存在");
}

async function createSchedule(data: unknown) {
  const parsed = createScheduleSchema.safeParse(data);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "请求无效");

  const dateRanges = mergeDateRanges(parsed.data.dateRanges);
  const startDate = dateRanges[0]?.startDate;
  const endDate = dateRanges[dateRanges.length - 1]?.endDate;
  if (!startDate || !endDate) throw new ApiError(400, "日期范围无效");

  const now = Date.now();
  const expiresAt = Math.max(
    now + RETENTION_DAYS * 86_400_000,
    Date.parse(`${endDate}T00:00:00Z`) + (RETENTION_DAYS + 1) * 86_400_000,
  );
  const code = await createUniqueInviteCode();
  const creatorToken = createToken();
  const schedule: ScheduleDoc = {
    id: randomUUID(),
    code,
    name: parsed.data.name,
    startDate,
    endDate,
    timeZone: parsed.data.timeZone,
    creatorTokenHash: hashToken(creatorToken),
    allowParticipantsDeleteOthers: false,
    createdAt: now,
    expiresAt,
  };
  await db.collection("schedules").add(schedule);
  await Promise.all(
    dateRanges.map((range) =>
      db.collection("schedule_date_ranges").add({
        scheduleId: schedule.id,
        startDate: range.startDate,
        endDate: range.endDate,
      }),
    ),
  );

  return {
    schedule: scheduleToView(schedule, dateRanges, []),
    creatorToken,
  };
}

async function getScheduleView(code: string): Promise<ScheduleView> {
  const schedule = await requireSchedule(code);
  const [dateRanges, participants] = await Promise.all([
    getScheduleDateRanges(schedule),
    getSubmittedParticipants(schedule.id),
  ]);
  return scheduleToView(schedule, dateRanges, participants);
}

async function updateScheduleSettings(code: string, data: unknown, token?: string) {
  const schedule = await requireSchedule(code);
  if (!token || !isCreatorToken(schedule, token)) {
    throw new ApiError(403, "仅创建者可修改设置");
  }
  const parsed = updateScheduleSettingsSchema.safeParse(data);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "请求无效");

  await db
    .collection("schedules")
    .where({ id: schedule.id })
    .update({ allowParticipantsDeleteOthers: parsed.data.allowParticipantsDeleteOthers });

  return getScheduleView(code);
}

async function deleteParticipant(code: string, participantId: string, token?: string) {
  const schedule = await requireSchedule(code);
  if (!token) throw new ApiError(401, "缺少凭证");

  const found = await db
    .collection("participants")
    .where({ id: participantId, scheduleId: schedule.id })
    .get();
  const target = found.data?.[0] as ParticipantDoc | undefined;
  if (!target) throw new ApiError(404, "参与者不存在");

  const creator = isCreatorToken(schedule, token);
  let actor: ParticipantDoc | undefined;
  try {
    actor = await requireParticipant(code, token);
  } catch {
    actor = undefined;
  }
  const isSelf = actor?.id === target.id;
  const allowOthers = Boolean(schedule.allowParticipantsDeleteOthers);
  if (!creator && !isSelf && !(actor && allowOthers)) {
    throw new ApiError(403, "无权删除该参与者");
  }

  await db.collection("availability_ranges").where({ participantId: target.id }).remove();
  await db.collection("participants").where({ id: target.id }).remove();
  return { ok: true };
}

async function joinSchedule(code: string, data: unknown) {
  const schedule = await requireSchedule(code);
  const parsed = joinScheduleSchema.safeParse(data);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "请求无效");

  const participantToken = createToken();
  const participant: ParticipantDoc = {
    id: randomUUID(),
    scheduleId: schedule.id,
    nickname: parsed.data.nickname,
    tokenHash: hashToken(participantToken),
    createdAt: Date.now(),
  };
  await db.collection("participants").add(participant);
  return {
    participant: { id: participant.id, nickname: participant.nickname, submitted: false },
    participantToken,
  };
}

async function getAvailability(code: string, token?: string) {
  const participant = await requireParticipant(code, token);
  const ranges = await getParticipantRanges(participant.id);
  return {
    participantId: participant.id,
    submitted: Boolean(participant.submittedAt),
    ranges,
  };
}

async function replaceAvailability(code: string, token: string | undefined, data: unknown) {
  const participant = await requireParticipant(code, token);
  const schedule = await requireSchedule(code);
  const parsed = replaceAvailabilitySchema.safeParse(data);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "请求无效");

  const dateRanges = await getScheduleDateRanges(schedule);
  const ranges = unionRanges(parsed.data.ranges);
  if (ranges.some((range) => !isRangeInsideSchedule(range, schedule.timeZone, dateRanges))) {
    throw new ApiError(400, "可用时间必须位于活动日期范围内");
  }

  await db.collection("availability_ranges").where({ participantId: participant.id }).remove();
  if (ranges.length) {
    await Promise.all(
      ranges.map((range) =>
        db.collection("availability_ranges").add({
          participantId: participant.id,
          start: range.start,
          end: range.end,
        }),
      ),
    );
  }
  await db.collection("participants").where({ id: participant.id }).update({ submittedAt: Date.now() });
  return { ranges };
}

async function getIntersection(code: string) {
  const schedule = await requireSchedule(code);
  const participants = await getSubmittedParticipants(schedule.id);
  const submittedParticipants = [];
  for (const participant of participants) {
    submittedParticipants.push({
      id: participant.id,
      nickname: participant.nickname,
      ranges: await getParticipantRanges(participant.id),
    });
  }
  const submittedCount = submittedParticipants.length;
  const complete = submittedCount >= 1;
  return {
    participantCount: submittedCount,
    submittedCount,
    pendingCount: 0,
    complete,
    ranges: complete
      ? intersectRangeSets(submittedParticipants.map((participant) => participant.ranges))
      : [],
    submittedParticipants,
  };
}

async function requireSchedule(code: string): Promise<ScheduleDoc> {
  const found = await db.collection("schedules").where({ code }).get();
  const schedule = found.data?.[0] as ScheduleDoc | undefined;
  if (!schedule || schedule.expiresAt <= Date.now()) throw new ApiError(404, "活动不存在或已过期");
  return schedule;
}

function isCreatorToken(schedule: ScheduleDoc, token: string): boolean {
  return hashToken(token) === schedule.creatorTokenHash;
}

async function requireParticipant(code: string, token?: string): Promise<ParticipantDoc> {
  if (!token) throw new ApiError(401, "缺少参与者凭证");
  const schedule = await requireSchedule(code);
  const found = await db
    .collection("participants")
    .where({ scheduleId: schedule.id, tokenHash: hashToken(token) })
    .get();
  const participant = found.data?.[0] as ParticipantDoc | undefined;
  if (!participant) throw new ApiError(401, "凭证无效或活动已过期");
  return participant;
}

async function getScheduleDateRanges(schedule: ScheduleDoc): Promise<DateRange[]> {
  const found = await db.collection("schedule_date_ranges").where({ scheduleId: schedule.id }).get();
  const ranges = (found.data ?? []).map((range: { startDate: string; endDate: string }) => ({
    startDate: range.startDate,
    endDate: range.endDate,
  }));
  return ranges.length ? mergeDateRanges(ranges) : [{ startDate: schedule.startDate, endDate: schedule.endDate }];
}

async function getParticipants(scheduleId: string): Promise<ParticipantDoc[]> {
  const found = await db.collection("participants").where({ scheduleId }).get();
  return [...(found.data ?? [])].sort(
    (left: ParticipantDoc, right: ParticipantDoc) => left.createdAt - right.createdAt,
  );
}

async function getSubmittedParticipants(scheduleId: string): Promise<ParticipantDoc[]> {
  const participants = await getParticipants(scheduleId);
  return participants.filter((participant) => Boolean(participant.submittedAt));
}

async function getParticipantRanges(participantId: string): Promise<UtcRange[]> {
  const found = await db.collection("availability_ranges").where({ participantId }).get();
  return unionRanges(
    (found.data ?? []).map((range: AvailabilityDoc) => ({ start: range.start, end: range.end })),
  );
}

function scheduleToView(
  schedule: ScheduleDoc,
  dateRanges: DateRange[],
  participants: ParticipantDoc[],
): ScheduleView {
  return {
    code: schedule.code,
    name: schedule.name,
    startDate: schedule.startDate,
    endDate: schedule.endDate,
    dateRanges,
    timeZone: schedule.timeZone,
    expiresAt: schedule.expiresAt,
    allowParticipantsDeleteOthers: Boolean(schedule.allowParticipantsDeleteOthers),
    participants: participants.map((participant) => ({
      id: participant.id,
      nickname: participant.nickname,
      submitted: true,
    })),
  };
}

async function createUniqueInviteCode(): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = createInviteCode();
    const existing = await db.collection("schedules").where({ code }).get();
    if (!(existing.data?.length)) return code;
  }
  throw new ApiError(500, "邀请码生成失败，请重试");
}

async function cleanupExpiredSchedules(): Promise<number> {
  const now = Date.now();
  const command = db.command;
  const found = await db.collection("schedules").where({ expiresAt: command.lte(now) }).get();
  const schedules = (found.data ?? []) as ScheduleDoc[];
  for (const schedule of schedules) {
    const participants = await getParticipants(schedule.id);
    await Promise.all(
      participants.map((participant) =>
        db.collection("availability_ranges").where({ participantId: participant.id }).remove(),
      ),
    );
    await db.collection("participants").where({ scheduleId: schedule.id }).remove();
    await db.collection("schedule_date_ranges").where({ scheduleId: schedule.id }).remove();
    await db.collection("schedules").where({ id: schedule.id }).remove();
  }
  return schedules.length;
}

function isRangeInsideSchedule(range: UtcRange, timeZone: string, dateRanges: readonly DateRange[]): boolean {
  const startDate = localDate(range.start, timeZone);
  const endDate = localDate(range.end - 1, timeZone);
  return dateRanges.some(
    (allowed) => startDate >= allowed.startDate && endDate <= allowed.endDate,
  );
}

function localDate(timestamp: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function createInviteCode(): string {
  const bytes = randomBytes(16);
  const characters: string[] = [];
  const unbiasedLimit = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length;
  for (const byte of bytes) {
    if (byte >= unbiasedLimit) continue;
    characters.push(CODE_ALPHABET[byte % CODE_ALPHABET.length] ?? "");
    if (characters.length === 8) return characters.join("");
  }
  return createInviteCode();
}

function createToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function bearerToken(header?: string): string | undefined {
  return header?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1];
}

function httpResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  };
}

class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
