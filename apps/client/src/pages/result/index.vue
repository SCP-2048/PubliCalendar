<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { onLoad, onPullDownRefresh, onShareAppMessage, onShow } from "@dcloudio/uni-app";
import type { IntersectionResult, ScheduleView } from "@publicalendar/shared";
import { api } from "../../lib/api";
import { eventSharePath, eventShareTitle } from "../../lib/share";
import {
  dayPublicTimeSummaries,
  publicBarSegments,
  userBarSegments,
  type BarSegment,
} from "../../lib/day-timeline";
import {
  buildDateColumns,
  clampDateParts,
  dateParts,
  type PickerColumn,
} from "../../lib/loop-picker";
import LoopPickerSheet from "../../components/LoopPickerSheet.vue";
import {
  clearParticipantSession,
  getCreatorToken,
  getParticipantId,
  getParticipantToken,
} from "../../lib/tokens";
import { rememberEvent } from "../../lib/recent-events";
import { navigateTo, showModal } from "../../lib/uni-bridge";

interface CalendarCell {
  key: string;
  day: number | null;
  inRange: boolean;
  selected: boolean;
  timeLines: string[];
}

/** Below this width, calendar cells use compact labels like "8-18". */
const COMPACT_CALENDAR_MAX_WIDTH = 640;

const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
const code = ref("");
const schedule = ref<ScheduleView | null>(null);
const result = ref<IntersectionResult | null>(null);
const loading = ref(false);
const error = ref("");
const monthKey = ref("");
const selectedDate = ref("");
const sheetOpen = ref(false);
const sheetTitle = ref("选择月份");
const sheetColumns = ref<PickerColumn[]>([]);
const sheetValues = ref<string[]>([]);
const isCreator = ref(false);
const myParticipantId = ref("");
const hasParticipantToken = ref(false);
const settingsSaving = ref(false);
const compactCalendarTimes = ref(true);

function refreshCompactCalendarMode() {
  try {
    const width = uni.getSystemInfoSync().windowWidth ?? 375;
    compactCalendarTimes.value = width < COMPACT_CALENDAR_MAX_WIDTH;
  } catch {
    compactCalendarTimes.value = true;
  }
}

const monthLabel = computed(() => {
  if (!monthKey.value) return "";
  const [year, month] = monthKey.value.split("-");
  return `${year} 年 ${Number(month)} 月`;
});

const publicRanges = computed(() =>
  result.value?.complete ? result.value.ranges : [],
);

const calendarDays = computed<CalendarCell[]>(() => {
  if (!monthKey.value || !schedule.value) return [];
  const [yearText, monthText] = monthKey.value.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const leadingDays = (new Date(Date.UTC(year, monthIndex, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const cells: CalendarCell[] = [];
  const summaryOptions = { compact: compactCalendarTimes.value };
  for (let index = 0; index < leadingDays; index += 1) {
    cells.push({ key: `empty-${index}`, day: null, inRange: false, selected: false, timeLines: [] });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = formatDateKey(year, monthIndex + 1, day);
    const inRange = isAllowedDate(key);
    cells.push({
      key,
      day,
      inRange,
      selected: key === selectedDate.value,
      timeLines:
        inRange && result.value?.complete
          ? dayPublicTimeSummaries(
              publicRanges.value,
              key,
              schedule.value.timeZone,
              summaryOptions,
            )
          : [],
    });
  }
  while (cells.length % 7 !== 0) {
    cells.push({
      key: `empty-end-${cells.length}`,
      day: null,
      inRange: false,
      selected: false,
      timeLines: [],
    });
  }
  return cells;
});

const dayRows = computed(() => {
  if (!schedule.value || !result.value || !selectedDate.value) return [];
  return result.value.submittedParticipants.map((participant) => ({
    id: participant.id,
    nickname: participant.nickname,
    segments: userBarSegments(
      participant.ranges,
      publicRanges.value,
      selectedDate.value,
      schedule.value!.timeZone,
    ),
  }));
});

const publicSegments = computed<BarSegment[]>(() => {
  if (!schedule.value || !selectedDate.value) return [];
  return publicBarSegments(publicRanges.value, selectedDate.value, schedule.value.timeZone);
});

onLoad((options) => {
  code.value = typeof options?.code === "string" ? options.code.toUpperCase() : "";
  refreshCompactCalendarMode();
  // #ifdef MP-WEIXIN
  uni.showShareMenu({ menus: ["shareAppMessage"] });
  // #endif
});

onMounted(() => {
  refreshCompactCalendarMode();
  // #ifdef H5
  window.addEventListener("resize", refreshCompactCalendarMode);
  // #endif
});

onUnmounted(() => {
  // #ifdef H5
  window.removeEventListener("resize", refreshCompactCalendarMode);
  // #endif
});

onShow(() => {
  refreshCompactCalendarMode();
  if (code.value) void refresh();
});

onPullDownRefresh(async () => {
  await refresh();
  uni.stopPullDownRefresh();
});

async function refresh() {
  error.value = "";
  loading.value = true;
  try {
    const [scheduleResult, intersectionResult] = await Promise.all([
      api.getSchedule(code.value),
      api.intersection(code.value),
    ]);
    schedule.value = scheduleResult;
    result.value = {
      ...intersectionResult,
      submittedParticipants: intersectionResult.submittedParticipants ?? [],
    };
    isCreator.value = Boolean(getCreatorToken(code.value));
    myParticipantId.value = getParticipantId(code.value);
    hasParticipantToken.value = Boolean(getParticipantToken(code.value));
    rememberEvent(
      scheduleResult,
      isCreator.value ? "creator" : hasParticipantToken.value ? "participant" : "visitor",
    );
    const firstDate = scheduleResult.dateRanges[0]?.startDate ?? scheduleResult.startDate;
    if (!monthKey.value) monthKey.value = firstDate.slice(0, 7);
    if (!selectedDate.value || !isAllowedDate(selectedDate.value)) {
      selectedDate.value = firstDateWithAvailability() ?? firstDate;
    }
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "读取结果失败";
  } finally {
    loading.value = false;
  }
}

function canDeleteParticipant(participantId: string): boolean {
  if (isCreator.value) return true;
  if (!hasParticipantToken.value) return false;
  if (participantId === myParticipantId.value) return true;
  return Boolean(schedule.value?.allowParticipantsDeleteOthers);
}

function deleteAuthToken(): string {
  if (isCreator.value) return getCreatorToken(code.value);
  return getParticipantToken(code.value);
}

async function toggleAllowDeleteOthers(event: unknown) {
  if (!isCreator.value || !schedule.value) return;
  const detail = (event as { detail?: { value?: boolean } }).detail;
  const next = Boolean(detail?.value);
  const creatorToken = getCreatorToken(code.value);
  if (!creatorToken) {
    error.value = "缺少创建者凭证，无法修改设置";
    return;
  }
  settingsSaving.value = true;
  error.value = "";
  try {
    schedule.value = await api.updateSettings(
      code.value,
      { allowParticipantsDeleteOthers: next },
      creatorToken,
    );
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "更新设置失败";
  } finally {
    settingsSaving.value = false;
  }
}

async function removeParticipant(participantId: string, nickname: string) {
  const token = deleteAuthToken();
  if (!token) {
    error.value = "缺少删除凭证";
    return;
  }
  const confirmed = await showModal({
    title: "删除参与者",
    content: `确定删除「${nickname}」的数据吗？`,
  });
  if (!confirmed.confirm) return;
  loading.value = true;
  error.value = "";
  try {
    await api.deleteParticipant(code.value, participantId, token);
    if (participantId === myParticipantId.value) {
      clearParticipantSession(code.value);
      myParticipantId.value = "";
      hasParticipantToken.value = false;
    }
    await refresh();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "删除失败";
  } finally {
    loading.value = false;
  }
}

function firstDateWithAvailability(): string | null {
  if (!schedule.value || !result.value?.complete) return null;
  for (const range of schedule.value.dateRanges) {
    let date = range.startDate;
    while (date <= range.endDate) {
      if (dayPublicTimeSummaries(publicRanges.value, date, schedule.value.timeZone).length > 0) {
        return date;
      }
      date = addDays(date, 1);
    }
  }
  return null;
}

function selectDay(cell: CalendarCell) {
  if (cell.day === null || !cell.inRange) return;
  selectedDate.value = cell.key;
}

function moveMonth(offset: number) {
  if (!schedule.value) return;
  const [yearText, monthText] = monthKey.value.split("-");
  const target = new Date(Date.UTC(Number(yearText), Number(monthText) - 1 + offset, 1));
  const nextMonth = `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}`;
  const firstMonth = schedule.value.startDate.slice(0, 7);
  const lastMonth = schedule.value.endDate.slice(0, 7);
  monthKey.value = nextMonth < firstMonth ? firstMonth : nextMonth > lastMonth ? lastMonth : nextMonth;
}

function openMonthPicker() {
  if (!schedule.value) return;
  const current = selectedDate.value || `${monthKey.value}-01`;
  const clamped = clampDateParts(
    ...dateParts(current),
    schedule.value.startDate,
    schedule.value.endDate,
  );
  sheetColumns.value = buildDateColumns(
    clamped,
    schedule.value.startDate,
    schedule.value.endDate,
  );
  sheetValues.value = dateParts(clamped);
  sheetOpen.value = true;
}

function onSheetChange(values: string[]) {
  if (!schedule.value) return;
  const next = clampDateParts(
    values[0] ?? "2000",
    values[1] ?? "01",
    values[2] ?? "01",
    schedule.value.startDate,
    schedule.value.endDate,
  );
  const parts = dateParts(next);
  const yearMonthChanged =
    parts[0] !== sheetValues.value[0] || parts[1] !== sheetValues.value[1];
  sheetValues.value = parts;
  if (yearMonthChanged) {
    sheetColumns.value = buildDateColumns(
      next,
      schedule.value.startDate,
      schedule.value.endDate,
    );
  }
}

function onSheetConfirm(values: string[]) {
  if (!schedule.value) return;
  const next = clampDateParts(
    values[0] ?? "2000",
    values[1] ?? "01",
    values[2] ?? "01",
    schedule.value.startDate,
    schedule.value.endDate,
  );
  monthKey.value = next.slice(0, 7);
  if (isAllowedDate(next)) selectedDate.value = next;
}

function closeSheet() {
  sheetOpen.value = false;
}

function segmentStyle(segment: BarSegment) {
  return {
    left: `${segment.startPct}%`,
    width: `${Math.max(segment.widthPct, 0.8)}%`,
  };
}

function endpointStyle(pct: number) {
  return {
    left: `${Math.max(0, Math.min(100, pct))}%`,
  };
}

function isAllowedDate(date: string): boolean {
  return Boolean(
    schedule.value?.dateRanges.some(
      (range) => date >= range.startDate && date <= range.endDate,
    ),
  );
}

function formatDateKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function addDays(date: string, amount: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + amount));
  return formatDateKey(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

async function copyInvite() {
  await uni.setClipboardData({ data: code.value });
}

function joinOnThisDevice() {
  void navigateTo({ url: `/pages/join/index?code=${code.value}&mode=join` });
}

function isMyParticipant(participantId: string): boolean {
  return hasParticipantToken.value && participantId === myParticipantId.value;
}

function editMyAvailability() {
  void navigateTo({ url: `/pages/availability/index?code=${code.value}` });
}

onShareAppMessage(() => ({
  title: eventShareTitle(schedule.value?.name),
  path: code.value ? eventSharePath(code.value) : "/pages/index/index",
}));
</script>

<template>
  <view class="page result-page">
    <view class="title">共同可用时间</view>

    <view v-if="schedule" class="card">
      <view>{{ schedule.name }}</view>
      <view class="muted">{{ schedule.startDate }} 至 {{ schedule.endDate }}</view>
      <text class="label">邀请码</text>
      <view class="invite-code">{{ code }}</view>
      <button class="button secondary" @click="copyInvite">复制邀请码</button>
      <!-- #ifdef MP-WEIXIN -->
      <button class="button share-button" open-type="share">分享给微信好友</button>
      <!-- #endif -->
      <button class="button secondary" @click="joinOnThisDevice">在本机以参与者身份加入</button>
    </view>

    <view v-if="schedule" class="card">
      <text class="label">参与者</text>
      <view v-if="schedule.participants.length === 0" class="muted">等待参与者提交可用时间</view>
      <view
        v-for="participant in schedule.participants"
        :key="participant.id"
        class="participant-row"
      >
        <text class="participant-name">{{ participant.nickname }}</text>
        <view class="participant-actions">
          <button
            v-if="isMyParticipant(participant.id)"
            class="edit-button"
            size="mini"
            :disabled="loading"
            @click="editMyAvailability"
          >
            编辑
          </button>
          <button
            v-if="canDeleteParticipant(participant.id)"
            class="delete-button"
            size="mini"
            :disabled="loading"
            @click="removeParticipant(participant.id, participant.nickname)"
          >
            删除
          </button>
        </view>
      </view>
      <view v-if="isCreator" class="settings-row">
        <text class="settings-label">允许参与者删除其他人</text>
        <switch
          :checked="schedule.allowParticipantsDeleteOthers"
          :disabled="settingsSaving"
          @change="toggleAllowDeleteOthers"
        />
      </view>
      <view v-if="isCreator" class="muted settings-hint">
        默认关闭。开启后，任一参与者可删除其他人的数据。创建者始终可删除。
      </view>
    </view>

    <view v-if="result" class="card status-card">
      <view class="muted">已提交 {{ result.submittedCount }} 人</view>
      <view v-if="result.participantCount === 0" class="muted">等待参与者提交可用时间</view>
      <view v-else-if="result.ranges.length === 0" class="muted">大家没有共同可用时间</view>
      <button class="button" :loading="loading" @click="refresh">刷新结果</button>
    </view>

    <view v-if="schedule && result?.complete" class="calendar-card">
      <view class="section-title">共同可用日历</view>
      <view class="section-desc">日期下方显示共同时段：宽屏为完整时间，窄屏为紧凑格式（如 8-18）；超过两段时只显示第一段并以省略号表示其余。点选日期可在下方查看完整起止时间</view>

      <view class="month-navigation">
        <button class="icon-button" @click="moveMonth(-1)">‹</button>
        <view class="month-title" @click="openMonthPicker">{{ monthLabel }}⌄</view>
        <button class="icon-button" @click="moveMonth(1)">›</button>
      </view>

      <view class="calendar-grid weekdays">
        <view v-for="weekday in weekdays" :key="weekday" class="weekday">
          <text>{{ weekday }}</text>
        </view>
      </view>
      <view class="calendar-grid">
        <view
          v-for="cell in calendarDays"
          :key="cell.key"
          class="day-cell"
          :class="{
            disabled: cell.day !== null && !cell.inRange,
            selected: cell.selected,
            empty: cell.day === null,
            'has-times': cell.timeLines.length > 0,
          }"
          @click="selectDay(cell)"
        >
          <text v-if="cell.day !== null" class="day-number">{{ cell.day }}</text>
          <view v-if="cell.timeLines.length > 0" class="day-times">
            <view
              v-for="(line, index) in cell.timeLines"
              :key="`${cell.key}-time-${index}`"
              class="day-time-pill"
              :class="{ ellipsis: line === '…' }"
            >
              <text class="day-time-text">{{ line }}</text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <view v-if="schedule && result?.complete && selectedDate" class="timeline-card">
      <view class="section-title">{{ selectedDate }}</view>
      <view class="section-desc">灰段为个人独有空闲，绿段为共同可用；起止时间标在绿段两端正下方</view>
      <view class="hour-scale">
        <text>0</text>
        <text>6</text>
        <text>12</text>
        <text>18</text>
        <text>24</text>
      </view>

      <view v-if="dayRows.length === 0" class="muted">还没有人提交可用时间</view>
      <view v-for="row in dayRows" :key="row.id" class="bar-row">
        <view class="bar-label">{{ row.nickname }}</view>
        <view class="bar-track">
          <view
            v-for="(segment, index) in row.segments"
            :key="`${row.id}-${index}`"
            class="bar-segment"
            :class="segment.tone"
            :style="segmentStyle(segment)"
          />
        </view>
      </view>

      <view class="bar-row public-row">
        <view class="bar-label">共同</view>
        <view class="public-bar-stack">
          <view class="bar-track">
            <view
              v-for="(segment, index) in publicSegments"
              :key="`public-${index}`"
              class="bar-segment green"
              :style="segmentStyle(segment)"
            />
          </view>
          <view v-if="publicSegments.length > 0" class="public-endpoint-track">
            <template v-for="(segment, index) in publicSegments" :key="`public-ends-${index}`">
              <text
                class="endpoint-label"
                :style="endpointStyle(segment.startPct)"
              >{{ segment.startLabel }}</text>
              <text
                class="endpoint-label"
                :style="endpointStyle(segment.startPct + segment.widthPct)"
              >{{ segment.endLabel }}</text>
            </template>
          </view>
          <view v-else-if="dayRows.length > 0" class="public-times-empty">当天没有共同可用时段</view>
        </view>
      </view>
    </view>

    <view v-if="error" class="error">{{ error }}</view>

    <LoopPickerSheet
      :open="sheetOpen"
      :title="sheetTitle"
      :columns="sheetColumns"
      :model-value="sheetValues"
      @change="onSheetChange"
      @confirm="onSheetConfirm"
      @close="closeSheet"
    />
  </view>
</template>

<style scoped lang="scss">
.result-page {
  padding: 20rpx 12rpx 40rpx;
}

.invite-code {
  margin-bottom: 8rpx;
  font-size: 56rpx;
  font-weight: 700;
  letter-spacing: 8rpx;
}

.share-button {
  margin-top: 16rpx;
  background: #07c160;
  color: #fff;
}

.share-button::after {
  border: 0;
}

.participant-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  margin-top: 12rpx;
}

.participant-name {
  flex: 1;
  color: #1f2a44;
  font-size: 28rpx;
}

.participant-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 12rpx;
}

.edit-button {
  margin: 0;
  background: #07c160;
  color: #fff;
}

.edit-button::after {
  border: 0;
}

.delete-button {
  margin: 0;
  background: #f3e6e4;
  color: #9b2c2c;
}

.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 24rpx;
  gap: 16rpx;
}

.settings-label {
  flex: 1;
  color: #1f2a44;
  font-size: 26rpx;
}

.settings-hint {
  margin-top: 8rpx;
}

.status-card .button {
  margin-top: 20rpx;
}

.calendar-card,
.timeline-card {
  margin-bottom: 20rpx;
  padding: 20rpx 12rpx;
  border-radius: 24rpx;
  background: #fff;
  box-shadow: 0 10rpx 30rpx rgba(35, 54, 91, 0.08);
}

.calendar-card .section-title,
.timeline-card .section-title {
  padding: 0 8rpx;
}

.calendar-card .section-desc,
.timeline-card .section-desc {
  padding: 0 8rpx;
  margin-bottom: 12rpx;
  font-size: 22rpx;
}

.section-title {
  color: #1f2a44;
  font-size: 30rpx;
  font-weight: 700;
}

.section-desc {
  margin-top: 8rpx;
  margin-bottom: 16rpx;
  color: #78849a;
  font-size: 22rpx;
  line-height: 1.45;
}

.month-navigation {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4rpx;
}

.month-title {
  padding: 12rpx 16rpx;
  font-size: 32rpx;
  font-weight: 700;
}

.icon-button {
  width: 64rpx;
  height: 64rpx;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: #315efb;
  font-size: 48rpx;
  line-height: 58rpx;
}

.icon-button::after {
  border: 0;
}

/* WeChat X5/WEBVIEW collapses CSS grid / flex+% cells; use inline-block for H5 + MP. */
.calendar-grid {
  width: 100%;
  font-size: 0;
}

.weekdays {
  margin: 8rpx 0 4rpx;
}

.weekday {
  box-sizing: border-box;
  display: inline-block;
  width: 14.285714%;
  vertical-align: top;
  color: #8893a7;
  font-size: 24rpx;
  text-align: center;
  line-height: 40rpx;
}

.day-cell {
  box-sizing: border-box;
  display: inline-block;
  width: 14.285714%;
  min-width: 0;
  min-height: 132rpx;
  vertical-align: top;
  overflow: hidden;
  padding: 8rpx 2rpx 6rpx;
  border: 2rpx solid transparent;
  border-radius: 12rpx;
  color: #26334d;
  font-size: 28rpx;
  text-align: center;
}

.day-cell.empty {
  min-height: 132rpx;
  opacity: 0;
  pointer-events: none;
}

.day-cell.disabled {
  color: #c8ced9;
}

.day-cell.selected {
  border-color: #315efb;
  background: #f3f6ff;
}

.day-cell.has-times {
  background: #f4fbf6;
}

.day-cell.selected.has-times {
  background: #eef6ff;
}

.day-number {
  font-size: 30rpx;
  font-weight: 700;
  line-height: 1.15;
}

.day-times {
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: stretch;
  gap: 4rpx;
  margin-top: 6rpx;
  padding: 0 2rpx;
}

.day-time-pill {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  padding: 4rpx 2rpx;
  border-radius: 999rpx;
  background: #34c759;
}

.day-time-pill.ellipsis {
  padding: 2rpx 2rpx;
}

.day-time-text {
  display: block;
  overflow: hidden;
  color: #ffffff;
  font-size: 20rpx;
  font-weight: 700;
  line-height: 1.2;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.day-cell.disabled .day-time-pill {
  background: #c5ced9;
}

.day-cell.disabled .day-time-text {
  color: #ffffff;
}

.hour-scale {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12rpx;
  padding-left: 120rpx;
  color: #9aa4b6;
  font-size: 20rpx;
}

.bar-row {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
  margin-top: 16rpx;
}

.bar-label {
  width: 120rpx;
  overflow: hidden;
  padding-top: 2rpx;
  color: #314057;
  font-size: 24rpx;
  font-weight: 600;
  line-height: 28rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bar-track {
  position: relative;
  flex: 1;
  height: 28rpx;
  overflow: hidden;
  border-radius: 999rpx;
  background: #eef2f7;
}

.bar-segment {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 999rpx;
}

.bar-segment.gray {
  background: #9aa4b6;
}

.bar-segment.green {
  background: #34c759;
}

.public-row .bar-label {
  color: #1f7a3a;
}

.public-bar-stack {
  flex: 1;
  min-width: 0;
}

.public-endpoint-track {
  position: relative;
  height: 32rpx;
  margin-top: 6rpx;
}

.endpoint-label {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  color: #1f7a3a;
  font-size: 20rpx;
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
}

.public-times-empty {
  margin-top: 8rpx;
  color: #9aa4b6;
  font-size: 22rpx;
}
</style>
