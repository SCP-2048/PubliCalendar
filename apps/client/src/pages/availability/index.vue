<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { onLoad, onShareAppMessage, onUnload } from "@dcloudio/uni-app";
import { type ScheduleView, type UtcRange } from "@publicalendar/shared";
import LoopPickerSheet from "../../components/LoopPickerSheet.vue";
import { api } from "../../lib/api";
import { eventSharePath, eventShareTitle } from "../../lib/share";
import {
  buildDateColumns,
  buildTimeColumns,
  clampDateParts,
  dateParts,
  timeParts,
  type PickerColumn,
} from "../../lib/loop-picker";
import { unionRanges } from "../../lib/ranges";
import {
  clearParticipantSession,
  getParticipantId,
  getParticipantToken,
  saveParticipantId,
} from "../../lib/tokens";
import { rememberEvent } from "../../lib/recent-events";

interface TimeRange {
  id: number;
  start: string;
  end: string;
}

interface DayAvailability {
  ranges: TimeRange[];
}

interface CalendarCell {
  key: string;
  day: number | null;
  inRange: boolean;
  selected: boolean;
  pending: boolean;
  configured: boolean;
}

type SheetTarget =
  | { type: "time"; rangeIndex: number; field: "start" | "end" }
  | { type: "batch-time"; field: "start" | "end" }
  | { type: "month" };

const DEFAULT_START = "09:00";
const DEFAULT_END = "18:00";

const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
const code = ref("");
const schedule = ref<ScheduleView | null>(null);
const monthKey = ref("");
const selectedDate = ref("");
const availability = reactive<Record<string, DayAvailability>>({});
const loading = ref(false);
const error = ref("");
const sheetOpen = ref(false);
const sheetTitle = ref("");
const sheetColumns = ref<PickerColumn[]>([]);
const sheetValues = ref<string[]>([]);
const sheetTarget = ref<SheetTarget | null>(null);
const batchMode = ref(false);
const batchDeleteMode = ref(false);
const batchTimeStart = ref(DEFAULT_START);
const batchTimeEnd = ref(DEFAULT_END);
const pendingBatchDate = ref("");
const hasSubmitted = ref(false);
const participantId = ref("");
let nextRangeId = 1;
let discardingUnsubmitted = false;

const anyBatchMode = computed(() => batchMode.value || batchDeleteMode.value);

const monthLabel = computed(() => {
  if (!monthKey.value) return "";
  const [year, month] = monthKey.value.split("-");
  return `${year} 年 ${Number(month)} 月`;
});

const selectedEntry = computed(() => availability[selectedDate.value]);
const configuredCount = computed(
  () => Object.values(availability).filter((entry) => entry.ranges.length > 0).length,
);

const batchHint = computed(() => {
  if (batchDeleteMode.value) {
    if (pendingBatchDate.value) {
      return `已选择 ${pendingBatchDate.value}，请再点结束日期；范围内每天的全部时段都会清除（整日不可用）`;
    }
    return "连续点击开始日期和结束日期；所选日期的全部时段都会清除（整日不可用）";
  }
  if (!batchMode.value) return "可逐日编辑，或开启批量添加 / 批量删除";
  if (pendingBatchDate.value) {
    return `已选择 ${pendingBatchDate.value}，请再点结束日期；所选日期都会设为 ${batchTimeStart.value}–${batchTimeEnd.value}`;
  }
  return `先确认时间 ${batchTimeStart.value}–${batchTimeEnd.value}，再连续点击开始日期和结束日期`;
});

const calendarDays = computed<CalendarCell[]>(() => {
  if (!monthKey.value || !schedule.value) return [];
  const [yearText, monthText] = monthKey.value.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const firstDay = new Date(Date.UTC(year, monthIndex, 1));
  const leadingDays = (firstDay.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const cells: CalendarCell[] = [];

  for (let index = 0; index < leadingDays; index += 1) {
    cells.push({
      key: `empty-${index}`,
      day: null,
      inRange: false,
      selected: false,
      pending: false,
      configured: false,
    });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = formatDateKey(year, monthIndex + 1, day);
    cells.push({
      key,
      day,
      inRange: isAllowedDate(key, schedule.value),
      selected: !anyBatchMode.value && key === selectedDate.value,
      pending: anyBatchMode.value && key === pendingBatchDate.value,
      configured: Boolean(availability[key]?.ranges.length),
    });
  }
  while (cells.length % 7 !== 0) {
    cells.push({
      key: `empty-end-${cells.length}`,
      day: null,
      inRange: false,
      selected: false,
      pending: false,
      configured: false,
    });
  }
  return cells;
});

onLoad((options) => {
  code.value = typeof options?.code === "string" ? options.code.toUpperCase() : "";
  // #ifdef MP-WEIXIN
  uni.showShareMenu({ menus: ["shareAppMessage"] });
  // #endif
  void load();
});

onUnload(() => {
  void discardIfUnsubmitted();
});

async function discardIfUnsubmitted() {
  if (hasSubmitted.value || discardingUnsubmitted || !code.value) return;
  const token = getParticipantToken(code.value);
  const id = participantId.value || getParticipantId(code.value);
  if (!token || !id) {
    clearParticipantSession(code.value);
    return;
  }
  discardingUnsubmitted = true;
  try {
    await api.deleteParticipant(code.value, id, token);
  } catch {
    // Best-effort cleanup when leaving without submit.
  } finally {
    clearParticipantSession(code.value);
  }
}

async function load() {
  const token = getParticipantToken(code.value);
  if (!code.value || !token) {
    error.value = "参与者凭证不存在，请重新加入日程";
    return;
  }
  loading.value = true;
  try {
    const [scheduleResult, saved] = await Promise.all([
      api.getSchedule(code.value),
      api.getAvailability(code.value, token),
    ]);
    schedule.value = scheduleResult;
    rememberEvent(scheduleResult, "participant");
    participantId.value = saved.participantId || getParticipantId(code.value);
    if (saved.participantId) saveParticipantId(code.value, saved.participantId);
    hasSubmitted.value = Boolean(saved.submitted);
    const firstDate = scheduleResult.dateRanges[0]?.startDate ?? scheduleResult.startDate;
    monthKey.value = firstDate.slice(0, 7);
    selectedDate.value = firstDate;
    importRanges(saved.ranges, scheduleResult);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "读取日程失败";
  } finally {
    loading.value = false;
  }
}

function onDayClick(cell: CalendarCell) {
  if (cell.day === null || !cell.inRange) return;
  if (batchMode.value) {
    selectBatchAddDate(cell.key);
    return;
  }
  if (batchDeleteMode.value) {
    selectBatchDeleteDate(cell.key);
    return;
  }
  selectedDate.value = cell.key;
}

function selectBatchAddDate(date: string) {
  error.value = "";
  if (!batchTimeStart.value || !batchTimeEnd.value) {
    error.value = "请先选择批量时间段";
    return;
  }
  if (batchTimeStart.value >= batchTimeEnd.value) {
    error.value = "批量开始时间必须早于结束时间";
    return;
  }
  if (!pendingBatchDate.value) {
    pendingBatchDate.value = date;
    selectedDate.value = date;
    return;
  }
  const startDate = pendingBatchDate.value < date ? pendingBatchDate.value : date;
  const endDate = pendingBatchDate.value < date ? date : pendingBatchDate.value;
  applyBatchTimeToDateRange(startDate, endDate);
  pendingBatchDate.value = "";
  selectedDate.value = startDate;
}

function selectBatchDeleteDate(date: string) {
  error.value = "";
  if (!pendingBatchDate.value) {
    pendingBatchDate.value = date;
    selectedDate.value = date;
    return;
  }
  const startDate = pendingBatchDate.value < date ? pendingBatchDate.value : date;
  const endDate = pendingBatchDate.value < date ? date : pendingBatchDate.value;
  applyBatchDeleteToDateRange(startDate, endDate);
  pendingBatchDate.value = "";
  selectedDate.value = startDate;
}

function applyBatchTimeToDateRange(startDate: string, endDate: string) {
  if (!schedule.value) return;
  let date = startDate;
  while (date <= endDate) {
    if (isAllowedDate(date, schedule.value)) {
      availability[date] = {
        ranges: [{ id: nextRangeId, start: batchTimeStart.value, end: batchTimeEnd.value }],
      };
      nextRangeId += 1;
    }
    date = addDays(date, 1);
  }
}

function applyBatchDeleteToDateRange(startDate: string, endDate: string) {
  if (!schedule.value) return;
  let date = startDate;
  while (date <= endDate) {
    if (isAllowedDate(date, schedule.value)) {
      delete availability[date];
    }
    date = addDays(date, 1);
  }
}

function toggleBatchMode() {
  const next = !batchMode.value;
  batchMode.value = next;
  if (next) {
    batchDeleteMode.value = false;
    batchTimeStart.value = DEFAULT_START;
    batchTimeEnd.value = DEFAULT_END;
  }
  pendingBatchDate.value = "";
}

function toggleBatchDeleteMode() {
  const next = !batchDeleteMode.value;
  batchDeleteMode.value = next;
  if (next) batchMode.value = false;
  pendingBatchDate.value = "";
}

function addRange() {
  if (!selectedDate.value) return;
  const entry = availability[selectedDate.value] ?? { ranges: [] };
  const isFirstRange = entry.ranges.length === 0;
  entry.ranges.push({
    id: nextRangeId,
    start: isFirstRange ? DEFAULT_START : "",
    end: isFirstRange ? DEFAULT_END : "",
  });
  nextRangeId += 1;
  availability[selectedDate.value] = entry;
}

function openTimePicker(index: number, field: "start" | "end") {
  const range = availability[selectedDate.value]?.ranges[index];
  if (!range) return;
  sheetTarget.value = { type: "time", rangeIndex: index, field };
  sheetTitle.value = field === "start" ? "选择开始时间" : "选择结束时间";
  sheetColumns.value = buildTimeColumns();
  sheetValues.value = timeParts(
    range[field] || (field === "start" ? DEFAULT_START : DEFAULT_END),
  );
  sheetOpen.value = true;
}

function openBatchTimePicker(field: "start" | "end") {
  sheetTarget.value = { type: "batch-time", field };
  sheetTitle.value = field === "start" ? "选择批量开始时间" : "选择批量结束时间";
  sheetColumns.value = buildTimeColumns();
  sheetValues.value = timeParts(
    field === "start" ? batchTimeStart.value : batchTimeEnd.value,
  );
  sheetOpen.value = true;
}

function openMonthPicker() {
  if (!schedule.value) return;
  const current = selectedDate.value || `${monthKey.value}-01`;
  sheetTarget.value = { type: "month" };
  sheetTitle.value = "选择月份";
  sheetColumns.value = buildDateColumns(current, schedule.value.startDate, schedule.value.endDate);
  sheetValues.value = dateParts(clampDateParts(
    ...dateParts(current),
    schedule.value.startDate,
    schedule.value.endDate,
  ));
  sheetOpen.value = true;
}

function onSheetChange(values: string[]) {
  if (sheetTarget.value?.type !== "month" || !schedule.value) return;
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
    sheetColumns.value = buildDateColumns(next, schedule.value.startDate, schedule.value.endDate);
  }
}

function onSheetConfirm(values: string[]) {
  const target = sheetTarget.value;
  if (!target) return;
  if (target.type === "time") {
    const range = availability[selectedDate.value]?.ranges[target.rangeIndex];
    if (!range) return;
    range[target.field] = `${values[0]}:${values[1]}`;
    return;
  }
  if (target.type === "batch-time") {
    const next = `${values[0]}:${values[1]}`;
    if (target.field === "start") batchTimeStart.value = next;
    else batchTimeEnd.value = next;
    return;
  }
  if (!schedule.value) return;
  const next = clampDateParts(
    values[0] ?? "2000",
    values[1] ?? "01",
    values[2] ?? "01",
    schedule.value.startDate,
    schedule.value.endDate,
  );
  monthKey.value = next.slice(0, 7);
  if (isAllowedDate(next, schedule.value)) selectedDate.value = next;
}

function closeSheet() {
  sheetOpen.value = false;
  sheetTarget.value = null;
}

function removeRange(index: number) {
  const entry = availability[selectedDate.value];
  if (!entry) return;
  entry.ranges.splice(index, 1);
  if (entry.ranges.length === 0) delete availability[selectedDate.value];
}

function rangeWarning(range: TimeRange): string {
  if (!range.start && !range.end) return "";
  if (!range.start || !range.end) return "请同时设置开始时间和结束时间";
  if (range.start >= range.end) return "开始时间必须早于结束时间";
  return "";
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

async function submit() {
  if (!schedule.value) return;
  error.value = "";
  try {
    const ranges: UtcRange[] = [];
    let ignoredCount = 0;
    for (const date of Object.keys(availability).sort()) {
      const entry = availability[date];
      if (!entry || !isAllowedDate(date, schedule.value)) continue;
      for (const range of entry.ranges) {
        if (rangeWarning(range)) {
          ignoredCount += 1;
          continue;
        }
        const start = zonedDateTimeToUtc(date, range.start, schedule.value.timeZone);
        const end = zonedDateTimeToUtc(date, range.end, schedule.value.timeZone);
        if (end <= start) {
          ignoredCount += 1;
          continue;
        }
        ranges.push({ start, end });
      }
    }
    const mergedRanges = unionRanges(ranges);
    loading.value = true;
    await api.replaceAvailability(
      code.value,
      { ranges: mergedRanges },
      getParticipantToken(code.value),
    );
    hasSubmitted.value = true;
    await uni.showModal({
      title: "已保存",
      content: ignoredCount > 0
        ? `已保存 ${mergedRanges.length} 个合法时间段，忽略了 ${ignoredCount} 个非法时间段。`
        : `已保存 ${mergedRanges.length} 个时间段。`,
      showCancel: false,
    });
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "提交失败";
  } finally {
    loading.value = false;
  }
}

function viewResult() {
  if (!hasSubmitted.value) {
    error.value = "请先提交可用时间";
    return;
  }
  void uni.navigateTo({ url: `/pages/result/index?code=${code.value}` });
}

onShareAppMessage(() => ({
  title: eventShareTitle(schedule.value?.name),
  path: code.value ? eventSharePath(code.value) : "/pages/index/index",
}));

function importRanges(ranges: UtcRange[], currentSchedule: ScheduleView) {
  for (const range of ranges) {
    let date = localParts(range.start, currentSchedule.timeZone).date;
    const finalDate = localParts(range.end - 1, currentSchedule.timeZone).date;
    while (date <= finalDate) {
      const dayStart = zonedDateTimeToUtc(date, "00:00", currentSchedule.timeZone);
      const dayEnd = zonedDateTimeToUtc(addDays(date, 1), "00:00", currentSchedule.timeZone);
      const start = Math.max(range.start, dayStart);
      const end = Math.min(range.end, dayEnd);
      if (
        start < end &&
        isAllowedDate(date, currentSchedule)
      ) {
        const entry = availability[date] ?? { ranges: [] };
        entry.ranges.push({
          id: nextRangeId,
          start: start === dayStart
            ? "00:00"
            : localParts(start, currentSchedule.timeZone).time,
          end: end === dayEnd
            ? "23:59"
            : localParts(end, currentSchedule.timeZone).time,
        });
        nextRangeId += 1;
        availability[date] = entry;
      }
      date = addDays(date, 1);
    }
  }
}

function zonedDateTimeToUtc(date: string, time: string, timeZone: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0);
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = localParts(guess, timeZone);
    const displayedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const adjustment = target - displayedAsUtc;
    guess += adjustment;
    if (adjustment === 0) break;
  }
  return guess;
}

function localParts(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  return {
    year,
    month,
    day,
    hour,
    minute,
    date: formatDateKey(year, month, day),
    time: `${pad(hour)}:${pad(minute)}`,
  };
}

function addDays(date: string, amount: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + amount));
  return formatDateKey(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
}

function isAllowedDate(date: string, currentSchedule: ScheduleView): boolean {
  return currentSchedule.dateRanges.some(
    (range) => date >= range.startDate && date <= range.endDate,
  );
}

function formatDateKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
</script>

<template>
  <view class="page">
    <view class="page-heading">
      <view class="title">选择可用时间</view>
      <view v-if="schedule" class="muted">
        {{ schedule.name }} · {{ schedule.startDate }} 至 {{ schedule.endDate }}
      </view>
    </view>

    <view v-if="schedule" class="calendar-card">
      <view class="batch-bar">
        <view class="mode-row">
          <button
            class="batch-button mode-button danger"
            :class="{ active: batchDeleteMode }"
            @click="toggleBatchDeleteMode"
          >
            {{ batchDeleteMode ? "退出批量删除" : "批量删除" }}
          </button>
          <button
            class="batch-button mode-button"
            :class="{ active: batchMode }"
            @click="toggleBatchMode"
          >
            {{ batchMode ? "退出批量添加" : "批量添加" }}
          </button>
        </view>
        <view v-if="batchMode" class="batch-time-row">
          <view
            class="time-picker"
            @click="openBatchTimePicker('start')"
          >
            {{ batchTimeStart }}
          </view>
          <text class="time-separator">至</text>
          <view
            class="time-picker"
            @click="openBatchTimePicker('end')"
          >
            {{ batchTimeEnd }}
          </view>
        </view>
        <view class="batch-hint">{{ batchHint }}</view>
      </view>

      <view class="month-navigation">
        <button class="icon-button" @click="moveMonth(-1)">‹</button>
        <view class="month-title" @click="openMonthPicker">{{ monthLabel }}⌄</view>
        <button class="icon-button" @click="moveMonth(1)">›</button>
      </view>

      <view class="calendar-grid weekdays">
        <view v-for="weekday in weekdays" :key="weekday" class="weekday">{{ weekday }}</view>
      </view>
      <view class="calendar-grid" :class="{ 'batch-active': anyBatchMode }">
        <view
          v-for="cell in calendarDays"
          :key="cell.key"
          class="day-cell"
          :class="{
            disabled: cell.day !== null && !cell.inRange,
            selected: cell.selected,
            pending: cell.pending,
            configured: cell.configured,
            empty: cell.day === null,
          }"
          @click="onDayClick(cell)"
        >
          <text v-if="cell.day !== null">{{ cell.day }}</text>
          <view v-if="cell.configured" class="availability-dot" />
        </view>
      </view>
    </view>

    <view v-if="schedule && selectedDate && !anyBatchMode" class="editor-card">
      <view class="editor-heading">
        <view class="editor-date">{{ selectedDate }}</view>
      </view>
      <view v-if="!selectedEntry?.ranges.length" class="selection-note">
        这一天还没有时间段。
      </view>
      <view
        v-for="(range, index) in selectedEntry?.ranges ?? []"
        :key="range.id"
        class="range-block"
      >
        <view class="time-row">
          <view
            class="time-picker"
            :class="{ placeholder: !range.start }"
            @click="openTimePicker(index, 'start')"
          >
            {{ range.start || "开始时间" }}
          </view>
          <text class="time-separator">至</text>
          <view
            class="time-picker"
            :class="{ placeholder: !range.end }"
            @click="openTimePicker(index, 'end')"
          >
            {{ range.end || "结束时间" }}
          </view>
          <button class="remove-button" @click="removeRange(index)">×</button>
        </view>
        <view v-if="rangeWarning(range)" class="range-warning">{{ rangeWarning(range) }}</view>
      </view>
      <button class="add-range-button" @click="addRange">＋</button>
    </view>

    <view v-if="error" class="error">{{ error }}</view>
    <view class="footer-actions">
      <view class="muted">已选择 {{ configuredCount }} 天</view>
      <button class="button" :loading="loading" :disabled="loading || !schedule" @click="submit">
        保存我的时间
      </button>
      <button class="button secondary" @click="viewResult">查看共同时间</button>
      <!-- #ifdef MP-WEIXIN -->
      <button class="button share-button" open-type="share">分享给微信好友</button>
      <!-- #endif -->
    </view>

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
.page-heading {
  margin-bottom: 28rpx;
}

.calendar-card,
.editor-card,
.footer-actions {
  margin-bottom: 24rpx;
  padding: 28rpx;
  border-radius: 24rpx;
  background: #fff;
  box-shadow: 0 10rpx 30rpx rgba(35, 54, 91, 0.08);
}

.batch-bar {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  margin-bottom: 18rpx;
}

.mode-row {
  display: flex;
  gap: 12rpx;
}

.mode-button {
  flex: 1;
}

.batch-button {
  width: 100%;
  margin: 0;
  border: 2rpx solid #d7e2ff;
  border-radius: 14rpx;
  background: #f4f7ff;
  color: #315efb;
  font-size: 28rpx;
  font-weight: 700;
}

.batch-button.active {
  border-color: #315efb;
  background: #315efb;
  color: #fff;
}

.batch-button.danger {
  border-color: #f3d0d6;
  background: #fff5f6;
  color: #c52b3c;
}

.batch-button.danger.active {
  border-color: #c52b3c;
  background: #c52b3c;
  color: #fff;
}

.batch-button::after {
  border: 0;
}

.batch-hint {
  color: #78849a;
  font-size: 22rpx;
  line-height: 1.45;
}

.batch-time-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.batch-time-row .time-picker {
  flex: 1;
}

.month-navigation {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.month-title {
  padding: 16rpx 28rpx;
  font-size: 32rpx;
  font-weight: 700;
}

.icon-button {
  width: 72rpx;
  height: 64rpx;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: #315efb;
  font-size: 52rpx;
  line-height: 58rpx;
}

.icon-button::after {
  border: 0;
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
}

.weekdays {
  margin: 14rpx 0 8rpx;
}

.weekday {
  color: #8893a7;
  font-size: 24rpx;
  text-align: center;
}

.calendar-grid.batch-active {
  user-select: none;
}

.day-cell {
  box-sizing: border-box;
  position: relative;
  display: flex;
  height: 76rpx;
  align-items: center;
  justify-content: center;
  border: 2rpx solid transparent;
  border-radius: 10rpx;
  color: #26334d;
  font-size: 28rpx;
  transition: border-color 160ms ease, background-color 160ms ease, color 160ms ease;
}

.day-cell:not(.empty):not(.disabled):hover {
  border-color: #315efb;
}

.day-cell.disabled {
  color: #c8ced9;
}

.day-cell.selected,
.day-cell.pending {
  border-color: #315efb;
  background: #315efb;
  color: #fff;
  font-weight: 700;
}

.day-cell.configured:not(.selected):not(.pending) {
  background: #e9efff;
  color: #2347c5;
  font-weight: 700;
}

.availability-dot {
  position: absolute;
  bottom: 8rpx;
  width: 8rpx;
  height: 8rpx;
  border-radius: 50%;
  background: currentColor;
}

.editor-date {
  font-size: 32rpx;
  font-weight: 700;
}

.editor-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}

.selection-note {
  margin-top: 24rpx;
  color: #52617a;
}

.range-block {
  margin-top: 22rpx;
}

.time-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.time-picker {
  min-width: 140rpx;
  padding: 22rpx 18rpx;
  border: 2rpx solid #dce3ef;
  border-radius: 14rpx;
  background: #f9fbff;
  font-size: 30rpx;
  font-weight: 700;
  text-align: center;
}

.time-picker.placeholder {
  color: #9aa4b6;
  font-size: 26rpx;
  font-weight: 400;
}

.time-separator {
  color: #7d899d;
}

.remove-button {
  width: 58rpx;
  height: 58rpx;
  margin: 0 0 0 auto;
  padding: 0;
  border: 0;
  background: #fff0f2;
  color: #c52b3c;
  font-size: 34rpx;
  line-height: 58rpx;
}

.remove-button::after,
.add-range-button::after {
  border: 0;
}

.range-warning {
  margin-top: 10rpx;
  color: #c52b3c;
  font-size: 24rpx;
}

.add-range-button {
  width: 100%;
  margin: 24rpx 0 0;
  border: 2rpx dashed #b9c6e5;
  border-radius: 14rpx;
  background: #fff;
  color: #315efb;
  font-size: 34rpx;
}

.footer-actions {
  padding-top: 20rpx;
}

.share-button {
  margin-top: 16rpx;
  background: #07c160;
  color: #fff;
}

.share-button::after {
  border: 0;
}
</style>
