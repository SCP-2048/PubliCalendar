<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  centerIndex,
  expandOptions,
  resolveBaseIndex,
  type PickerColumn,
} from "../lib/loop-picker";

const props = defineProps<{
  open: boolean;
  title: string;
  columns: PickerColumn[];
  modelValue: string[];
}>();

const emit = defineEmits<{
  close: [];
  confirm: [values: string[]];
  change: [values: string[]];
}>();

const pickerValue = ref<number[]>([]);
const draftValues = ref<string[]>([]);
const expandedColumns = computed(() =>
  props.columns.map((column) => expandOptions(column.options)),
);

watch(
  () => props.open,
  (open) => {
    if (open) syncFromModel(props.modelValue);
  },
  { immediate: true },
);

watch(
  () => props.columns.map((column) => column.options.map((option) => option.value).join("|")).join("||"),
  () => {
    if (!props.open) return;
    clampDraftToColumns();
  },
);

function syncFromModel(values: string[]) {
  draftValues.value = props.columns.map((column, index) => {
    const fallback = column.options[0]?.value ?? "";
    const current = values[index];
    return column.options.some((option) => option.value === current) ? (current as string) : fallback;
  });
  pickerValue.value = indexesForDraft();
}

function clampDraftToColumns() {
  draftValues.value = props.columns.map((column, index) => {
    const fallback = column.options[0]?.value ?? "";
    const current = draftValues.value[index];
    return column.options.some((option) => option.value === current) ? (current as string) : fallback;
  });
  pickerValue.value = indexesForDraft();
}

function indexesForDraft(): number[] {
  return props.columns.map((column, index) => {
    const selected = draftValues.value[index] ?? "";
    const selectedIndex = Math.max(
      0,
      column.options.findIndex((option) => option.value === selected),
    );
    return centerIndex(column.options.length, selectedIndex);
  });
}

function valuesFromIndexes(indexes: number[]): string[] {
  return props.columns.map((column, columnIndex) => {
    const baseIndex = resolveBaseIndex(indexes[columnIndex] ?? 0, column.options.length);
    return column.options[baseIndex]?.value ?? "";
  });
}

function onChange(event: { detail: { value: number[] } }) {
  const indexes = event.detail.value.map((value) => Number(value));
  pickerValue.value = indexes;
  const next = valuesFromIndexes(indexes);
  draftValues.value = next;
  emit("change", next);
}

function onPickEnd() {
  void nextTick(() => {
    pickerValue.value = indexesForDraft();
  });
}

function confirm() {
  emit("confirm", [...draftValues.value]);
  emit("close");
}

function cancel() {
  emit("close");
}

function optionTone(columnIndex: number, optionIndex: number): "selected" | "same-loop" | "other-loop" {
  const selectedIndex = pickerValue.value[columnIndex] ?? 0;
  if (optionIndex === selectedIndex) return "selected";
  const length = props.columns[columnIndex]?.options.length ?? 0;
  if (length <= 0) return "other-loop";
  // Same repeated cycle as the selected value (e.g. 57/58 with 59);
  // the wrapped side (00/01) belongs to the adjacent cycle.
  if (Math.floor(optionIndex / length) === Math.floor(selectedIndex / length)) {
    return "same-loop";
  }
  return "other-loop";
}
</script>

<template>
  <view v-if="open" class="sheet-root" @click.stop>
    <view class="sheet-mask" @click="cancel" />
    <view class="sheet-panel">
      <view class="sheet-toolbar">
        <text class="sheet-action" @click="cancel">取消</text>
        <text class="sheet-title">{{ title }}</text>
        <text class="sheet-action confirm" @click="confirm">确定</text>
      </view>
      <picker-view
        class="sheet-picker"
        :value="pickerValue"
        indicator-style="height: 44px;"
        mask-style="background-image: linear-gradient(180deg, rgba(255,255,255,0.96), rgba(255,255,255,0.55)), linear-gradient(0deg, rgba(255,255,255,0.96), rgba(255,255,255,0.55));"
        @change="onChange"
        @pickend="onPickEnd"
      >
        <picker-view-column v-for="(column, columnIndex) in expandedColumns" :key="columnIndex">
          <view
            v-for="(option, optionIndex) in column"
            :key="`${columnIndex}-${optionIndex}-${option.value}`"
            class="sheet-option"
            :class="optionTone(columnIndex, optionIndex)"
          >
            {{ option.label }}
          </view>
        </picker-view-column>
      </picker-view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.sheet-root {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48rpx;
  box-sizing: border-box;
}

.sheet-mask {
  position: absolute;
  inset: 0;
  background: rgba(17, 24, 39, 0.45);
}

.sheet-panel {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 640rpx;
  border-radius: 28rpx;
  background: #fff;
  box-shadow: 0 20rpx 60rpx rgba(23, 32, 51, 0.22);
}

.sheet-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 28rpx;
  border-bottom: 2rpx solid #eef2f8;
}

.sheet-title {
  color: #1f2a44;
  font-size: 30rpx;
  font-weight: 700;
}

.sheet-action {
  min-width: 80rpx;
  color: #78849a;
  font-size: 28rpx;
}

.sheet-action.confirm {
  color: #315efb;
  font-weight: 700;
  text-align: right;
}

.sheet-picker {
  width: 100%;
  height: 440rpx;
}

.sheet-option {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 44px;
  transition: color 120ms ease, opacity 120ms ease, font-size 120ms ease;
}

.sheet-option.other-loop {
  color: #7f8a9c;
  font-size: 28rpx;
  opacity: 0.68;
}

.sheet-option.same-loop {
  color: #5a6578;
  font-size: 30rpx;
  font-weight: 600;
  opacity: 0.82;
}

.sheet-option.selected {
  color: #121a2b;
  font-size: 36rpx;
  font-weight: 700;
  opacity: 1;
}
</style>
