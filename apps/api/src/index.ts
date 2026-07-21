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
import { Hono } from "hono";
import { cors } from "hono/cors";

export const app = new Hono<{ Bindings: Env }>();
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

app.use(
  "/api/*",
  cors({
    origin: "*",
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);

app.onError((error, c) => {
  console.error(JSON.stringify({ event: "request_error", message: error.message }));
  return c.json({ error: "服务器暂时不可用" }, 500);
});

app.notFound((c) => c.json({ error: "接口不存在" }, 404));

app.on("POST", ["/api/schedules", "/api/schedules/create"], async (c) => {
  const parsed = createScheduleSchema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "请求无效" }, 400);

  const now = Date.now();
  const id = crypto.randomUUID();
  const creatorToken = createToken();
  const creatorTokenHash = await hashToken(creatorToken);
  const dateRanges = mergeDateRanges(parsed.data.dateRanges);
  const startDate = dateRanges[0]!.startDate;
  const endDate = dateRanges[dateRanges.length - 1]!.endDate;
  const retentionAfterEvent =
    Date.parse(`${endDate}T00:00:00Z`) + (RETENTION_DAYS + 1) * 86_400_000;
  const expiresAt = Math.max(now + RETENTION_DAYS * 86_400_000, retentionAfterEvent);
  let code = "";

  for (let attempt = 0; attempt < 6; attempt += 1) {
    code = createInviteCode();
    try {
      await c.env.DB.prepare(
        `INSERT INTO schedules
          (id, code, name, start_date, end_date, time_zone, creator_token_hash, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          code,
          parsed.data.name,
          startDate,
          endDate,
          parsed.data.timeZone,
          creatorTokenHash,
          now,
          expiresAt,
        )
        .run();
      break;
    } catch (error) {
      const isCodeCollision =
        error instanceof Error &&
        error.message.includes("UNIQUE constraint failed: schedules.code");
      if (!isCodeCollision || attempt === 5) throw error;
    }
  }

  const dateRangeChunkSize = 250;
  for (let index = 0; index < dateRanges.length; index += dateRangeChunkSize) {
    await c.env.DB.batch(
      dateRanges.slice(index, index + dateRangeChunkSize).map((range) =>
        c.env.DB.prepare(
          "INSERT INTO schedule_date_ranges (schedule_id, start_date, end_date) VALUES (?, ?, ?)",
        ).bind(id, range.startDate, range.endDate),
      ),
    );
  }
  const schedule: ScheduleView = {
    ...parsed.data,
    dateRanges,
    startDate,
    endDate,
    code,
    expiresAt,
    allowParticipantsDeleteOthers: false,
    participants: [],
  };
  return c.json({ schedule, creatorToken }, 201);
});

app.get("/api/schedules/:code", async (c) => {
  const schedule = await getSchedule(c.env.DB, normalizeCode(c.req.param("code")));
  if (!schedule) return c.json({ error: "日程不存在或已过期" }, 404);
  return c.json(schedule);
});

app.patch("/api/schedules/:code", async (c) => {
  const code = normalizeCode(c.req.param("code"));
  const schedule = await getScheduleRow(c.env.DB, code);
  if (!schedule || schedule.expires_at <= Date.now()) {
    return c.json({ error: "日程不存在或已过期" }, 404);
  }
  const token = bearerToken(c.req.header("Authorization"));
  if (!token || !(await isCreatorToken(c.env.DB, schedule, token))) {
    return c.json({ error: "仅创建者可修改设置" }, 403);
  }
  const parsed = updateScheduleSettingsSchema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "请求无效" }, 400);
  await c.env.DB.prepare(
    "UPDATE schedules SET allow_participants_delete_others = ? WHERE id = ?",
  )
    .bind(parsed.data.allowParticipantsDeleteOthers ? 1 : 0, schedule.id)
    .run();
  const updated = await getSchedule(c.env.DB, code);
  return c.json(updated);
});

app.delete("/api/schedules/:code/participants/:participantId", async (c) => {
  const code = normalizeCode(c.req.param("code"));
  const participantId = c.req.param("participantId");
  const schedule = await getScheduleRow(c.env.DB, code);
  if (!schedule || schedule.expires_at <= Date.now()) {
    return c.json({ error: "日程不存在或已过期" }, 404);
  }
  const token = bearerToken(c.req.header("Authorization"));
  if (!token) return c.json({ error: "缺少凭证" }, 401);

  const target = await c.env.DB.prepare(
    "SELECT id, token_hash FROM participants WHERE id = ? AND schedule_id = ?",
  )
    .bind(participantId, schedule.id)
    .first<{ id: string; token_hash: string }>();
  if (!target) return c.json({ error: "参与者不存在" }, 404);

  const creator = await isCreatorToken(c.env.DB, schedule, token);
  const actor = await getParticipantByToken(c.env.DB, code, token);
  const isSelf = actor?.id === target.id;
  const allowOthers = Boolean(schedule.allow_participants_delete_others);
  if (!creator && !isSelf && !(actor && allowOthers)) {
    return c.json({ error: "无权删除该参与者" }, 403);
  }

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM availability_ranges WHERE participant_id = ?").bind(target.id),
    c.env.DB.prepare("DELETE FROM participants WHERE id = ?").bind(target.id),
  ]);
  return c.json({ ok: true });
});

app.post("/api/schedules/:code/participants", async (c) => {
  const code = normalizeCode(c.req.param("code"));
  const schedule = await getScheduleRow(c.env.DB, code);
  if (!schedule || schedule.expires_at <= Date.now()) {
    return c.json({ error: "日程不存在或已过期" }, 404);
  }
  const parsed = joinScheduleSchema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "请求无效" }, 400);

  const participantToken = createToken();
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO participants (id, schedule_id, nickname, token_hash, submitted_at, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`,
  )
    .bind(id, schedule.id, parsed.data.nickname, await hashToken(participantToken), Date.now())
    .run();

  return c.json(
    {
      participant: { id, nickname: parsed.data.nickname, submitted: false },
      participantToken,
    },
    201,
  );
});

app.get("/api/schedules/:code/availability", async (c) => {
  const code = normalizeCode(c.req.param("code"));
  const token = bearerToken(c.req.header("Authorization"));
  if (!token) return c.json({ error: "缺少参与者凭证" }, 401);
  const participant = await getParticipantByToken(c.env.DB, code, token);
  if (!participant) return c.json({ error: "凭证无效或日程已过期" }, 401);

  const rows = await c.env.DB.prepare(
    `SELECT start_at, end_at FROM availability_ranges
     WHERE participant_id = ? ORDER BY start_at`,
  )
    .bind(participant.id)
    .all<{ start_at: number; end_at: number }>();
  return c.json({
    participantId: participant.id,
    submitted: participant.submitted_at !== null,
    ranges: rows.results.map((row) => ({ start: row.start_at, end: row.end_at })),
  });
});

app.put("/api/schedules/:code/availability", async (c) => {
  const code = normalizeCode(c.req.param("code"));
  const token = bearerToken(c.req.header("Authorization"));
  if (!token) return c.json({ error: "缺少参与者凭证" }, 401);
  const participant = await getParticipantByToken(c.env.DB, code, token);
  if (!participant) return c.json({ error: "凭证无效或日程已过期" }, 401);

  const parsed = replaceAvailabilitySchema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "请求无效" }, 400);
  const ranges = unionRanges(parsed.data.ranges);
  const dateRanges = await getScheduleDateRanges(c.env.DB, participant.schedule_id, participant);
  const outsideSchedule = ranges.some((range) => !isRangeInsideSchedule(range, participant, dateRanges));
  if (outsideSchedule) {
    return c.json({ error: "可用时间必须位于日程日期范围内" }, 400);
  }
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM availability_ranges WHERE participant_id = ?").bind(participant.id),
    c.env.DB.prepare("UPDATE participants SET submitted_at = NULL WHERE id = ?").bind(participant.id),
  ]);
  const chunkSize = 250;
  for (let index = 0; index < ranges.length; index += chunkSize) {
    const statements = ranges.slice(index, index + chunkSize).map((range) =>
      c.env.DB.prepare(
        "INSERT INTO availability_ranges (participant_id, start_at, end_at) VALUES (?, ?, ?)",
      ).bind(participant.id, range.start, range.end),
    );
    await c.env.DB.batch(statements);
  }
  await c.env.DB.prepare("UPDATE participants SET submitted_at = ? WHERE id = ?")
    .bind(Date.now(), participant.id)
    .run();
  return c.json({ ranges });
});

app.get("/api/schedules/:code/intersection", async (c) => {
  const code = normalizeCode(c.req.param("code"));
  const schedule = await getScheduleRow(c.env.DB, code);
  if (!schedule || schedule.expires_at <= Date.now()) {
    return c.json({ error: "日程不存在或已过期" }, 404);
  }

  const rows = await c.env.DB.prepare(
    `SELECT p.id AS participant_id, p.nickname, p.created_at, r.start_at, r.end_at
     FROM participants p
     LEFT JOIN availability_ranges r ON r.participant_id = p.id
     WHERE p.schedule_id = ? AND p.submitted_at IS NOT NULL
     ORDER BY p.created_at, r.start_at`,
  )
    .bind(schedule.id)
    .all<{
      participant_id: string;
      nickname: string;
      created_at: number;
      start_at: number | null;
      end_at: number | null;
    }>();

  const grouped = new Map<string, UtcRange[]>();
  const nicknames = new Map<string, string>();
  const order: string[] = [];
  for (const row of rows.results) {
    if (!grouped.has(row.participant_id)) {
      grouped.set(row.participant_id, []);
      nicknames.set(row.participant_id, row.nickname);
      order.push(row.participant_id);
    }
    const ranges = grouped.get(row.participant_id) ?? [];
    if (row.start_at !== null && row.end_at !== null) {
      ranges.push({ start: row.start_at, end: row.end_at });
    }
    grouped.set(row.participant_id, ranges);
  }
  const submittedParticipants = order.map((id) => ({
    id,
    nickname: nicknames.get(id) ?? "",
    ranges: unionRanges(grouped.get(id) ?? []),
  }));
  const submittedCount = submittedParticipants.length;
  const complete = submittedCount >= 1;
  return c.json({
    participantCount: submittedCount,
    submittedCount,
    pendingCount: 0,
    complete,
    ranges: complete
      ? intersectRangeSets(submittedParticipants.map((participant) => participant.ranges))
      : [],
    submittedParticipants,
  });
});

app.get("/health", (c) => c.json({ ok: true, service: "publicalendar-api" }));

interface ScheduleRow {
  id: string;
  code: string;
  name: string;
  start_date: string;
  end_date: string;
  time_zone: string;
  creator_token_hash: string;
  allow_participants_delete_others: number;
  expires_at: number;
}

async function getScheduleRow(db: D1Database, code: string): Promise<ScheduleRow | null> {
  return db
    .prepare(
      `SELECT id, code, name, start_date, end_date, time_zone, creator_token_hash,
              COALESCE(allow_participants_delete_others, 0) AS allow_participants_delete_others,
              expires_at
       FROM schedules WHERE code = ?`,
    )
    .bind(code)
    .first<ScheduleRow>();
}

async function getSchedule(db: D1Database, code: string): Promise<ScheduleView | null> {
  const schedule = await getScheduleRow(db, code);
  if (!schedule || schedule.expires_at <= Date.now()) return null;
  const participants = await db
    .prepare(
      `SELECT id, nickname, submitted_at
       FROM participants
       WHERE schedule_id = ? AND submitted_at IS NOT NULL
       ORDER BY created_at`,
    )
    .bind(schedule.id)
    .all<{ id: string; nickname: string; submitted_at: number | null }>();
  const dateRanges = await getScheduleDateRanges(db, schedule.id, schedule);
  return {
    code: schedule.code,
    name: schedule.name,
    startDate: schedule.start_date,
    endDate: schedule.end_date,
    dateRanges,
    timeZone: schedule.time_zone,
    expiresAt: schedule.expires_at,
    allowParticipantsDeleteOthers: Boolean(schedule.allow_participants_delete_others),
    participants: participants.results.map((participant) => ({
      id: participant.id,
      nickname: participant.nickname,
      submitted: true,
    })),
  };
}

async function isCreatorToken(
  db: D1Database,
  schedule: ScheduleRow,
  token: string,
): Promise<boolean> {
  return (await hashToken(token)) === schedule.creator_token_hash;
}

async function getParticipantByToken(db: D1Database, code: string, token: string) {
  return db
    .prepare(
      `SELECT p.id, p.submitted_at, s.id AS schedule_id, s.start_date, s.end_date, s.time_zone
       FROM participants p JOIN schedules s ON s.id = p.schedule_id
       WHERE s.code = ? AND s.expires_at > ? AND p.token_hash = ?`,
    )
    .bind(code, Date.now(), await hashToken(token))
    .first<{
      id: string;
      submitted_at: number | null;
      schedule_id: string;
      start_date: string;
      end_date: string;
      time_zone: string;
    }>();
}

async function getScheduleDateRanges(
  db: D1Database,
  scheduleId: string,
  fallback: { start_date: string; end_date: string },
): Promise<DateRange[]> {
  const rows = await db
    .prepare(
      `SELECT start_date, end_date FROM schedule_date_ranges
       WHERE schedule_id = ? ORDER BY start_date`,
    )
    .bind(scheduleId)
    .all<{ start_date: string; end_date: string }>();
  if (rows.results.length === 0) {
    return [{ startDate: fallback.start_date, endDate: fallback.end_date }];
  }
  return mergeDateRanges(
    rows.results.map((row) => ({ startDate: row.start_date, endDate: row.end_date })),
  );
}

export function isRangeInsideSchedule(
  range: UtcRange,
  schedule: { time_zone: string },
  dateRanges: readonly DateRange[],
): boolean {
  const startDate = localDate(range.start, schedule.time_zone);
  const endDate = localDate(range.end - 1, schedule.time_zone);
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

async function readJson(request: Request): Promise<unknown> {
  const maxBytes = 8 * 1024 * 1024;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maxBytes || !request.body) return null;
  try {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    return null;
  }
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function bearerToken(header: string | undefined): string | null {
  const match = header?.match(/^Bearer ([A-Za-z0-9_-]+)$/);
  return match?.[1] ?? null;
}

export function createInviteCode(): string {
  const characters: string[] = [];
  const unbiasedLimit = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length;
  while (characters.length < 8) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    for (const byte of bytes) {
      if (byte >= unbiasedLimit) continue;
      characters.push(CODE_ALPHABET[byte % CODE_ALPHABET.length] ?? "");
      if (characters.length === 8) break;
    }
  }
  return characters.join("");
}

export function createToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToBase64Url(bytes);
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToBase64Url(new Uint8Array(digest));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export default {
  fetch: app.fetch,
  async scheduled(_event, env): Promise<void> {
    const result = await env.DB.prepare("DELETE FROM schedules WHERE expires_at <= ?")
      .bind(Date.now())
      .run();
    console.log(JSON.stringify({ event: "expired_schedules_deleted", changes: result.meta.changes }));
  },
} satisfies ExportedHandler<Env>;
