import type { ScheduleView } from "@publicalendar/shared";

/** Home shortcuts vs join-page history — deletes are independent. */
export type RecentList = "home" | "join";

const LEGACY_KEY = "publicalendar:recent-events";
const STORAGE_KEYS: Record<RecentList, string> = {
  home: "publicalendar:recent-events:home",
  join: "publicalendar:recent-events:join",
};
const MAX_RECENT = 40;

export type RecentEventRole = "creator" | "participant" | "visitor";

export interface RecentEvent {
  code: string;
  name: string;
  startDate: string;
  endDate: string;
  expiresAt: number;
  role: RecentEventRole;
  savedAt: number;
}

function readRaw(key: string): RecentEvent[] {
  try {
    const raw = uni.getStorageSync(key);
    if (!raw) return [];
    const list = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(list) ? (list as RecentEvent[]) : [];
  } catch {
    return [];
  }
}

function writeRaw(key: string, list: RecentEvent[]): void {
  uni.setStorageSync(key, JSON.stringify(list.slice(0, MAX_RECENT)));
}

/** One-time copy from the old shared key into both independent lists. */
function migrateLegacyIfNeeded(): void {
  const homeKey = STORAGE_KEYS.home;
  const joinKey = STORAGE_KEYS.join;
  const home = readRaw(homeKey);
  const join = readRaw(joinKey);
  if (home.length || join.length) return;

  const legacy = readRaw(LEGACY_KEY);
  if (!legacy.length) return;

  writeRaw(homeKey, legacy);
  writeRaw(joinKey, legacy);
  try {
    uni.removeStorageSync(LEGACY_KEY);
  } catch {
    // ignore
  }
}

function todayKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Expired once the event's own date range has passed, or after backend retention. */
function isExpired(event: RecentEvent, now = Date.now()): boolean {
  if (event.expiresAt && event.expiresAt <= now) return true;
  if (event.endDate && event.endDate < todayKey()) return true;
  return false;
}

function readList(list: RecentList): RecentEvent[] {
  migrateLegacyIfNeeded();
  return readRaw(STORAGE_KEYS[list]);
}

function writeList(list: RecentList, events: RecentEvent[]): void {
  writeRaw(STORAGE_KEYS[list], events);
}

export function getRecentEvents(list: RecentList): RecentEvent[] {
  const active = readList(list).filter((event) => !isExpired(event));
  writeList(list, active);
  return [...active].sort((left, right) => right.savedAt - left.savedAt);
}

function upsertInto(list: RecentList, updated: RecentEvent, role: RecentEventRole): void {
  const events = readList(list);
  const existing = events.find((event) => event.code === updated.code);
  const priority: Record<RecentEventRole, number> = {
    creator: 3,
    participant: 2,
    visitor: 1,
  };
  const nextRole =
    existing && priority[existing.role] > priority[role] ? existing.role : role;
  const next: RecentEvent = { ...updated, role: nextRole };
  writeList(list, [next, ...events.filter((event) => event.code !== updated.code)]);
}

/** Remember on both home and join history (lists stay independent for deletes). */
export function rememberEvent(
  schedule: Pick<ScheduleView, "code" | "name" | "startDate" | "endDate" | "expiresAt">,
  role: RecentEventRole,
): void {
  if (!schedule.code) return;
  const updated: RecentEvent = {
    code: schedule.code,
    name: schedule.name,
    startDate: schedule.startDate,
    endDate: schedule.endDate,
    expiresAt: schedule.expiresAt,
    role,
    savedAt: Date.now(),
  };
  upsertInto("home", updated, role);
  upsertInto("join", updated, role);
}

export function removeRecentEvent(code: string, list: RecentList): void {
  writeList(
    list,
    readList(list).filter((event) => event.code !== code),
  );
}
