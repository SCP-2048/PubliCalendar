<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { mergeDateRanges, type DateRange } from "@publicalendar/shared";
import LoopPickerSheet from "../../components/LoopPickerSheet.vue";
import { api } from "../../lib/api";
import {
  buildDateColumns,
  clampDateParts,
  dateParts,
  type PickerColumn,
} from "../../lib/loop-picker";
import { saveCreatorToken } from "../../lib/tokens";
import { rememberEvent } from "../../lib/recent-events";

interface CalendarCell {
  key: string;
  day: number | null;
  selected: boolean;
  inRange: boolean;
  disabled: boolean;
}

interface EditableDateRange extends DateRange {
  id: number;
}

type SheetTarget =
  | { type: "timezone" }
  | { type: "month" }
  | { type: "picker"; field: "startDate" | "endDate" }
  | { type: "range"; index: number; field: "startDate" | "endDate" };

const timeZones = [
  { label: "UTC−12 · International Date Line", value: "Etc/GMT+12" },
  { label: "UTC−11 · Pago Pago", value: "Pacific/Pago_Pago" },
  { label: "UTC−10 · Honolulu", value: "Pacific/Honolulu" },
  { label: "UTC−09 · Anchorage", value: "America/Anchorage" },
  { label: "UTC−08 · Los Angeles", value: "America/Los_Angeles" },
  { label: "UTC−07 · Denver", value: "America/Denver" },
  { label: "UTC−06 · Chicago", value: "America/Chicago" },
  { label: "UTC−05 · New York", value: "America/New_York" },
  { label: "UTC−04 · Halifax", value: "America/Halifax" },
  { label: "UTC−03 · São Paulo", value: "America/Sao_Paulo" },
  { label: "UTC−02 · South Georgia", value: "Atlantic/South_Georgia" },
  { label: "UTC−01 · Azores", value: "Atlantic/Azores" },
  { label: "UTC±00 · London", value: "Europe/London" },
  { label: "UTC+01 · Paris", value: "Europe/Paris" },
  { label: "UTC+02 · Athens", value: "Europe/Athens" },
  { label: "UTC+03 · Moscow", value: "Europe/Moscow" },
  { label: "UTC+04 · Dubai", value: "Asia/Dubai" },
  { label: "UTC+05 · Karachi", value: "Asia/Karachi" },
  { label: "UTC+06 · Dhaka", value: "Asia/Dhaka" },
  { label: "UTC+07 · Bangkok", value: "Asia/Bangkok" },
  { label: "UTC+08 · Shanghai", value: "Asia/Shanghai" },
  { label: "UTC+09 · Tokyo", value: "Asia/Tokyo" },
  { label: "UTC+10 · Sydney", value: "Australia/Sydney" },
  { label: "UTC+11 · Nouméa", value: "Pacific/Noumea" },
] as const;

const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
const eventCounterKey = "publicalendar:next-event-number";
const storedEventNumber = Number(uni.getStorageSync(eventCounterKey));
const eventNumber = ref(
  Number.isSafeInteger(storedEventNumber) && storedEventNumber > 0 ? storedEventNumber : 1,
);
const today = new Date();
const todayKey = dateText(today);
const defaultEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 6);
const detectedZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const detectedZoneIndex = timeZones.findIndex((zone) => zone.value === detectedZone);
const fallbackZoneIndex = timeZones.findIndex((zone) => zone.value === "Asia/Shanghai");
const timeZoneIndex = ref(detectedZoneIndex >= 0 ? detectedZoneIndex : fallbackZoneIndex);
const form = reactive({
  name: "",
  timeZone: timeZones[timeZoneIndex.value]?.value ?? "Asia/Shanghai",
});
const dateRanges = ref<EditableDateRange[]>([]);
const pickerRange = reactive({
  startDate: todayKey,
  endDate: dateText(defaultEnd),
});
const monthKey = ref(pickerRange.startDate.slice(0, 7));
const pendingDate = ref("");
const focusedRangeId = ref<number | null>(null);
const notice = ref("");
const loading = ref(false);
const error = ref("");
const calendarPickerStart = todayKey;
const calendarPickerEnd = `${today.getFullYear() + 100}-12-31`;
const sheetOpen = ref(false);
const sheetTitle = ref("");
const sheetColumns = ref<PickerColumn[]>([]);
const sheetValues = ref<string[]>([]);
const sheetTarget = ref<SheetTarget | null>(null);
let nextRangeId = 1;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

const selectedTimeZoneLabel = computed(
  () => timeZones[timeZoneIndex.value]?.label ?? timeZones[fallbackZoneIndex]?.label,
);
const defaultEventName = computed(() => `Event ${eventNumber.value}`);

const monthLabel = computed(() => {
  const [year, month] = monthKey.value.split("-");
  return `${year} 年 ${Number(month)} 月`;
});

const calendarHint = computed(() => {
  if (pendingDate.value) {
    return `已选择 ${pendingDate.value}，请再点结束日期；点击日历外可取消`;
  }
  return "连续点击开始日期和结束日期";
});

const calendarDays = computed<CalendarCell[]>(() => {
  const [yearText, monthText] = monthKey.value.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const leadingDays = (new Date(Date.UTC(year, monthIndex, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const cells: CalendarCell[] = [];
  for (let index = 0; index < leadingDays; index += 1) {
    cells.push({
      key: `empty-${index}`,
      day: null,
      selected: false,
      inRange: false,
      disabled: false,
    });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = formatDateKey(year, monthIndex + 1, day);
    cells.push({
      key,
      day,
      selected: key === pendingDate.value,
      inRange: dateRanges.value.some(
        (range) => key >= range.startDate && key <= range.endDate,
      ),
      disabled: key < todayKey,
    });
  }
  while (cells.length % 7 !== 0) {
    cells.push({
      key: `empty-end-${cells.length}`,
      day: null,
      selected: false,
      inRange: false,
      disabled: false,
    });
  }
  return cells;
});

function selectDate(cell: CalendarCell) {
  if (cell.day === null || cell.disabled) return;
  if (!pendingDate.value) {
    pendingDate.value = cell.key;
    return;
  }
  addDateRange({
    startDate: pendingDate.value < cell.key ? pendingDate.value : cell.key,
    endDate: pendingDate.value < cell.key ? cell.key : pendingDate.value,
  });
  pendingDate.value = "";
}

function addPickerRange() {
  const startDate = pickerRange.startDate <= pickerRange.endDate
    ? pickerRange.startDate
    : pickerRange.endDate;
  const endDate = pickerRange.startDate <= pickerRange.endDate
    ? pickerRange.endDate
    : pickerRange.startDate;
  if (!addDateRange({ startDate, endDate })) return;
  monthKey.value = (startDate < todayKey ? todayKey : startDate).slice(0, 7);
}

function addDateRange(range: DateRange): boolean {
  const normalized = normalizeRange(range);
  if (normalized.endDate < todayKey) {
    error.value = "不能选择今天之前的日期";
    void uni.showToast({ title: error.value, icon: "none" });
    return false;
  }
  const clamped: DateRange = {
    startDate: normalized.startDate < todayKey ? todayKey : normalized.startDate,
    endDate: normalized.endDate,
  };
  error.value = "";
  const beforeCount = dateRanges.value.length;
  replaceRanges([...dateRanges.value, { id: nextRangeId, ...clamped }]);
  nextRangeId += 1;
  if (dateRanges.value.length < beforeCount + 1) {
    showNotice("已合并重叠或相邻的日期范围");
  }
  return true;
}

function applyDateRangeEdit(index: number, field: "startDate" | "endDate", value: string) {
  const current = dateRanges.value[index];
  if (!current) return;
  const next = {
    ...current,
    [field]: value < todayKey ? todayKey : value,
  };
  const normalized = { ...next, ...normalizeRange(next) };
  if (normalized.endDate < todayKey) {
    error.value = "不能选择今天之前的日期";
    void uni.showToast({ title: error.value, icon: "none" });
    return;
  }
  const clamped = {
    ...normalized,
    startDate: normalized.startDate < todayKey ? todayKey : normalized.startDate,
  };
  const beforeCount = dateRanges.value.length;
  const draft = dateRanges.value.map((range, rangeIndex) =>
    rangeIndex === index ? { ...current, ...clamped } : range,
  );
  replaceRanges(draft);
  focusedRangeId.value = null;
  monthKey.value = clamped.startDate.slice(0, 7);
  if (dateRanges.value.length < beforeCount) {
    showNotice("已合并重叠或相邻的日期范围");
  }
}

function removeDateRange(index: number) {
  dateRanges.value.splice(index, 1);
  focusedRangeId.value = null;
}

function focusRange(range: EditableDateRange) {
  focusedRangeId.value = range.id;
  monthKey.value = range.startDate.slice(0, 7);
}

function replaceRanges(ranges: EditableDateRange[]) {
  const merged = mergeDateRanges(ranges.map(({ startDate, endDate }) => ({ startDate, endDate })));
  const usedIds = new Set<number>();
  dateRanges.value = merged.map((range) => {
    const exact = ranges.find(
      (item) =>
        !usedIds.has(item.id) &&
        item.startDate === range.startDate &&
        item.endDate === range.endDate,
    );
    if (exact) {
      usedIds.add(exact.id);
      return { id: exact.id, ...range };
    }
    const overlapping = ranges.find(
      (item) =>
        !usedIds.has(item.id) &&
        item.startDate <= range.endDate &&
        item.endDate >= range.startDate,
    );
    if (overlapping) {
      usedIds.add(overlapping.id);
      return { id: overlapping.id, ...range };
    }
    const id = nextRangeId;
    nextRangeId += 1;
    return { id, ...range };
  });
}

function normalizeRange(range: DateRange): DateRange {
  if (range.startDate <= range.endDate) return range;
  return { startDate: range.endDate, endDate: range.startDate };
}

function showNotice(message: string) {
  notice.value = message;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    notice.value = "";
  }, 2200);
}

function cancelPending() {
  pendingDate.value = "";
}

function moveMonth(offset: number) {
  const [yearText, monthText] = monthKey.value.split("-");
  const target = new Date(Date.UTC(Number(yearText), Number(monthText) - 1 + offset, 1));
  const nextMonth = `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}`;
  const earliestMonth = todayKey.slice(0, 7);
  monthKey.value = nextMonth < earliestMonth ? earliestMonth : nextMonth;
}

function openTimezonePicker() {
  sheetTarget.value = { type: "timezone" };
  sheetTitle.value = "选择时区";
  sheetColumns.value = [{
    options: timeZones.map((zone) => ({ value: zone.value, label: zone.label })),
  }];
  sheetValues.value = [form.timeZone];
  sheetOpen.value = true;
}

function openDateSheet(
  target: Exclude<SheetTarget, { type: "timezone" }>,
  title: string,
  current: string,
) {
  sheetTarget.value = target;
  sheetTitle.value = title;
  const clamped = clampDateParts(
    ...dateParts(current),
    calendarPickerStart,
    calendarPickerEnd,
  );
  sheetColumns.value = buildDateColumns(clamped, calendarPickerStart, calendarPickerEnd);
  sheetValues.value = dateParts(clamped);
  sheetOpen.value = true;
}

function openMonthPicker() {
  openDateSheet({ type: "month" }, "选择月份", `${monthKey.value}-01`);
}

function openPickerRange(field: "startDate" | "endDate") {
  openDateSheet(
    { type: "picker", field },
    field === "startDate" ? "选择开始日期" : "选择结束日期",
    pickerRange[field],
  );
}

function openRangeEditor(index: number, field: "startDate" | "endDate") {
  const range = dateRanges.value[index];
  if (!range) return;
  openDateSheet(
    { type: "range", index, field },
    field === "startDate" ? "修改开始日期" : "修改结束日期",
    range[field],
  );
}

function onSheetChange(values: string[]) {
  if (!sheetTarget.value || sheetTarget.value.type === "timezone") return;
  const next = clampDateParts(
    values[0] ?? "2000",
    values[1] ?? "01",
    values[2] ?? "01",
    calendarPickerStart,
    calendarPickerEnd,
  );
  const parts = dateParts(next);
  const yearMonthChanged =
    parts[0] !== sheetValues.value[0] || parts[1] !== sheetValues.value[1];
  sheetValues.value = parts;
  if (yearMonthChanged) {
    sheetColumns.value = buildDateColumns(next, calendarPickerStart, calendarPickerEnd);
  }
}

function onSheetConfirm(values: string[]) {
  const target = sheetTarget.value;
  if (!target) return;
  if (target.type === "timezone") {
    const index = timeZones.findIndex((zone) => zone.value === values[0]);
    const option = timeZones[index];
    if (option) {
      timeZoneIndex.value = index;
      form.timeZone = option.value;
    }
    return;
  }
  const next = clampDateParts(
    values[0] ?? "2000",
    values[1] ?? "01",
    values[2] ?? "01",
    calendarPickerStart,
    calendarPickerEnd,
  );
  if (target.type === "month") {
    monthKey.value = next.slice(0, 7);
    return;
  }
  if (target.type === "picker") {
    pickerRange[target.field] = next;
    return;
  }
  applyDateRangeEdit(target.index, target.field, next);
}

function closeSheet() {
  sheetOpen.value = false;
  sheetTarget.value = null;
}

async function submit() {
  if (loading.value) return;
  error.value = "";
  if (dateRanges.value.length === 0) {
    error.value = "请先添加至少一个日期范围";
    void uni.showToast({ title: error.value, icon: "none" });
    return;
  }

  // Do not run Zod/Intl on the client — WeChat MP can freeze on timeZone checks,
  // which looks like “no response” and never reaches showModal.
  const payload = {
    name: form.name.trim() || defaultEventName.value,
    timeZone: form.timeZone || "Asia/Shanghai",
    dateRanges: dateRanges.value.map(({ startDate, endDate }) => ({ startDate, endDate })),
  };

  loading.value = true;
  void uni.showLoading({ title: "创建中…", mask: true });
  try {
    const result = await api.create(payload);
    saveCreatorToken(result.schedule.code, result.creatorToken);
    rememberEvent(result.schedule, "creator");
    eventNumber.value += 1;
    uni.setStorageSync(eventCounterKey, eventNumber.value);
    form.name = "";
    uni.hideLoading();
    await uni.navigateTo({ url: `/pages/result/index?code=${result.schedule.code}` });
  } catch (reason) {
    uni.hideLoading();
    error.value = reason instanceof Error ? reason.message : "创建失败";
    void uni.showModal({
      title: "创建失败",
      content: error.value,
      showCancel: false,
    });
  } finally {
    loading.value = false;
    try {
      uni.hideLoading();
    } catch {
      // ignore
    }
  }
}

function dateText(date: Date): string {
  return formatDateKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function formatDateKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
</script>

<template>
  <view class="page" @click="cancelPending">
    <view class="title">创建活动</view>

    <view class="card">
      <text class="label">活动名称</text>
      <input
        v-model="form.name"
        class="input"
        maxlength="80"
        :placeholder="defaultEventName"
      />

      <text class="label">时区</text>
      <view class="select-field" @click="openTimezonePicker">
        <text>{{ selectedTimeZoneLabel }}</text>
        <text class="select-arrow">⌄</text>
      </view>
    </view>

    <view class="section-card" @click.stop>
      <view class="section-heading">
        <text class="section-title">已添加的日期范围</text>
        <text v-if="dateRanges.length" class="section-count">{{ dateRanges.length }}</text>
      </view>

      <view v-if="dateRanges.length" class="range-list">
        <view
          v-for="(range, index) in dateRanges"
          :key="range.id"
          class="range-item"
          :class="{ focused: focusedRangeId === range.id }"
          @click="focusRange(range)"
        >
          <view class="range-editors">
            <view class="date-picker-field compact" @click.stop="openRangeEditor(index, 'startDate')">
              {{ range.startDate }}
            </view>
            <text class="summary-divider">至</text>
            <view class="date-picker-field compact" @click.stop="openRangeEditor(index, 'endDate')">
              {{ range.endDate }}
            </view>
          </view>
          <button class="range-remove-button" @click.stop="removeDateRange(index)">删除</button>
        </view>
      </view>
      <view v-else class="empty-ranges">
        还没有日期范围。请用下面的日历或日期选择器添加。
      </view>
      <view v-if="notice" class="notice">{{ notice }}</view>
    </view>

    <view class="section-card primary-method" @click.stop>
      <view class="section-heading">
        <text class="section-title">在日历上选择</text>
      </view>
      <view class="section-desc">{{ calendarHint }}</view>
      <view class="section-note">整体最长可跨 100 年；重叠或相邻范围会自动合并</view>

      <view class="month-navigation">
        <button class="icon-button" @click="moveMonth(-1)">‹</button>
        <view class="month-title" @click="openMonthPicker">{{ monthLabel }}⌄</view>
        <button class="icon-button" @click="moveMonth(1)">›</button>
      </view>

      <view class="calendar-grid weekdays">
        <view v-for="weekday in weekdays" :key="weekday" class="weekday">{{ weekday }}</view>
      </view>
      <view class="calendar-grid">
        <view
          v-for="cell in calendarDays"
          :key="cell.key"
          class="day-cell"
          :class="{
            selected: cell.selected,
            'in-range': cell.inRange,
            disabled: cell.disabled,
            empty: cell.day === null,
          }"
          @click="selectDate(cell)"
        >
          <text v-if="cell.day !== null">{{ cell.day }}</text>
        </view>
      </view>
    </view>

    <view class="section-card secondary-method" @click.stop>
      <view class="section-heading">
        <text class="section-title">或者，用日期选择器添加</text>
      </view>
      <view class="section-desc">适合跨月、跨年，或精确输入起止日期</view>

      <view class="picker-range-row">
        <view class="date-picker-field" @click="openPickerRange('startDate')">
          {{ pickerRange.startDate }}
        </view>
        <text class="summary-divider">至</text>
        <view class="date-picker-field" @click="openPickerRange('endDate')">
          {{ pickerRange.endDate }}
        </view>
        <button class="range-add-button" @click="addPickerRange">添加</button>
      </view>
    </view>

    <view v-if="error" class="error">{{ error }}</view>
    <button class="button" :loading="loading" :disabled="loading" @click="submit">创建活动</button>

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
.select-field {
  box-sizing: border-box;
  display: flex;
  width: 100%;
  min-height: 88rpx;
  align-items: center;
  justify-content: space-between;
  padding: 0 24rpx;
  border: 2rpx solid #dce3ef;
  border-radius: 16rpx;
  background: #fff;
  color: #26334d;
}

.select-arrow {
  color: #78849a;
  font-size: 30rpx;
}

.section-card {
  margin-bottom: 24rpx;
  padding: 28rpx;
  border-radius: 24rpx;
  background: #fff;
  box-shadow: 0 10rpx 30rpx rgba(35, 54, 91, 0.08);
}

.primary-method {
  border: 2rpx solid #d7e2ff;
}

.secondary-method {
  background: #f8fafc;
  box-shadow: none;
  border: 2rpx dashed #d5deeb;
}

.section-heading {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.section-title {
  color: #1f2a44;
  font-size: 30rpx;
  font-weight: 700;
}

.section-count {
  min-width: 40rpx;
  padding: 2rpx 12rpx;
  border-radius: 999rpx;
  background: #e8efff;
  color: #315efb;
  font-size: 22rpx;
  font-weight: 700;
  text-align: center;
}

.section-desc {
  margin-top: 10rpx;
  color: #5d6b84;
  font-size: 24rpx;
  line-height: 1.5;
}

.section-note {
  margin-top: 6rpx;
  margin-bottom: 8rpx;
  color: #8a95a8;
  font-size: 22rpx;
}

.picker-range-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-top: 18rpx;
}

.date-picker-field {
  padding: 16rpx;
  border: 2rpx solid #dce3ef;
  border-radius: 12rpx;
  background: #fff;
  color: #26334d;
  font-size: 24rpx;
  font-weight: 700;
}

.date-picker-field.compact {
  padding: 12rpx 14rpx;
  font-size: 22rpx;
}

.summary-divider {
  color: #8291ae;
}

.range-add-button,
.range-remove-button {
  margin: 0;
  border: 0;
}

.range-add-button {
  padding: 0 18rpx;
  background: #315efb;
  color: #fff;
  font-size: 24rpx;
}

.range-add-button::after,
.range-remove-button::after {
  border: 0;
}

.month-navigation {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8rpx;
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
  margin: 12rpx 0 8rpx;
}

.weekday {
  color: #8893a7;
  font-size: 24rpx;
  text-align: center;
}

.day-cell {
  box-sizing: border-box;
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

.day-cell.in-range {
  border-radius: 10rpx;
  background: #edf2ff;
  color: #2347c5;
}

.day-cell.selected {
  border-color: #315efb;
  border-radius: 10rpx;
  background: #315efb;
  color: #fff;
  font-weight: 700;
}

.day-cell.disabled.in-range,
.day-cell.disabled.selected {
  border-color: transparent;
  background: #eef1f6;
  color: #c8ced9;
  font-weight: 400;
}

.range-list {
  margin-top: 18rpx;
}

.range-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  margin-top: 12rpx;
  padding: 14rpx 16rpx;
  border: 2rpx solid transparent;
  border-radius: 14rpx;
  background: #f4f7ff;
  transition: border-color 160ms ease, background-color 160ms ease;
}

.range-item.focused {
  border-color: #315efb;
  background: #eaf0ff;
}

.range-editors {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 10rpx;
}

.range-remove-button {
  padding: 0 14rpx;
  background: #fff0f2;
  color: #c52b3c;
  font-size: 22rpx;
}

.empty-ranges {
  margin-top: 18rpx;
  color: #9aa4b6;
  font-size: 24rpx;
  line-height: 1.5;
}

.notice {
  margin-top: 14rpx;
  color: #315efb;
  font-size: 22rpx;
}
</style>
