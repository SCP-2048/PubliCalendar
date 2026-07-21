<script setup lang="ts">
import { ref } from "vue";
import { onLoad, onShareAppMessage, onShow } from "@dcloudio/uni-app";
import type { ScheduleView } from "@publicalendar/shared";
import { api } from "../../lib/api";
import { getParticipantToken, saveParticipantId, saveParticipantToken } from "../../lib/tokens";
import {
  getRecentEvents,
  rememberEvent,
  removeRecentEvent,
  type RecentEvent,
} from "../../lib/recent-events";
import { eventSharePath, eventShareTitle } from "../../lib/share";

const code = ref("");
const nickname = ref("");
const defaultNickname = ref("User 1");
const schedule = ref<ScheduleView | null>(null);
const loading = ref(false);
const error = ref("");
/** Stay on this page to fill nickname (share link / result “join” entry). */
const joinOnly = ref(false);
const recentEvents = ref<RecentEvent[]>([]);

const roleLabels: Record<RecentEvent["role"], string> = {
  creator: "我创建的",
  participant: "我加入的",
  visitor: "我看过的",
};

onLoad((options) => {
  joinOnly.value = options?.mode === "join" || options?.from === "share";
  if (typeof options?.code === "string") {
    code.value = options.code.toUpperCase();
    const existingToken = getParticipantToken(code.value);
    if (existingToken && joinOnly.value) {
      void uni.redirectTo({ url: `/pages/availability/index?code=${code.value}` });
      return;
    }
    void lookup({ openResult: !joinOnly.value });
  }
});

onShow(() => {
  recentEvents.value = getRecentEvents("join");
});

onShareAppMessage(() => ({
  title: eventShareTitle(schedule.value?.name),
  path: code.value ? eventSharePath(code.value) : "/pages/index/index",
}));

async function lookup(options?: { openResult?: boolean }) {
  error.value = "";
  schedule.value = null;
  const normalized = code.value.trim().toUpperCase();
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(normalized)) {
    error.value = "请输入 8 位邀请码";
    return;
  }
  const openResult = options?.openResult ?? !joinOnly.value;
  loading.value = true;
  try {
    const foundSchedule = await api.getSchedule(normalized);
    schedule.value = foundSchedule;
    code.value = normalized;
    defaultNickname.value = `User ${foundSchedule.participants.length + 1}`;
    rememberEvent(foundSchedule, "visitor");
    recentEvents.value = getRecentEvents("join");
    if (openResult) {
      await uni.redirectTo({ url: `/pages/result/index?code=${normalized}` });
    }
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "查询失败";
  } finally {
    loading.value = false;
  }
}

async function join() {
  if (!schedule.value) return;
  const submittedNickname = nickname.value.trim() || defaultNickname.value;
  loading.value = true;
  try {
    const result = await api.join(code.value, submittedNickname);
    saveParticipantToken(code.value, result.participantToken);
    saveParticipantId(code.value, result.participant.id);
    await uni.redirectTo({ url: `/pages/availability/index?code=${code.value}` });
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "加入失败";
  } finally {
    loading.value = false;
  }
}

function viewResult() {
  if (!schedule.value) return;
  void uni.navigateTo({ url: `/pages/result/index?code=${code.value}` });
}

function formatDate(value: string): string {
  const [, month, day] = value.split("-");
  if (!month || !day) return value;
  return `${Number(month)}月${Number(day)}日`;
}

function dateRangeText(event: RecentEvent): string {
  if (!event.startDate || !event.endDate) return "";
  if (event.startDate === event.endDate) return formatDate(event.startDate);
  return `${formatDate(event.startDate)} - ${formatDate(event.endDate)}`;
}

function openRecentEvent(event: RecentEvent) {
  code.value = event.code;
  void lookup({ openResult: true });
}

function removeRecent(event: RecentEvent) {
  removeRecentEvent(event.code, "join");
  recentEvents.value = getRecentEvents("join");
}
</script>

<template>
  <view class="page">
    <view class="title">{{ joinOnly ? "加入并填写时间" : "查询 / 加入日程" }}</view>
    <view class="card">
      <template v-if="!joinOnly">
        <text class="label">8 位邀请码</text>
        <input v-model="code" class="input" maxlength="8" placeholder="例如：8K2M7QXP" />
        <button class="button secondary" :loading="loading" @click="lookup()">
          查询并查看结果
        </button>
      </template>

      <view v-if="schedule && joinOnly">
        <text class="label">活动</text>
        <view class="event-name">{{ schedule.name }}</view>
        <view class="muted">
          {{ schedule.startDate }} 至 {{ schedule.endDate }} · {{ schedule.timeZone }}
        </view>
        <view class="muted invite-hint">邀请码 {{ code }}（好友分享进入，无需手输）</view>
        <button class="button secondary" :disabled="loading" @click="viewResult">
          查看共同可用时间
        </button>
        <text class="label">你的昵称</text>
        <input
          v-model="nickname"
          class="input"
          maxlength="40"
          :placeholder="defaultNickname"
        />
        <button class="button" :loading="loading" @click="join">加入并填写时间</button>
      </view>

      <view v-else-if="schedule && !joinOnly">
        <text class="label">{{ schedule.name }}</text>
        <view class="muted">
          {{ schedule.startDate }} 至 {{ schedule.endDate }} · {{ schedule.timeZone }}
        </view>
      </view>

      <view v-if="error" class="error">{{ error }}</view>
    </view>

    <view v-if="!joinOnly && recentEvents.length" class="card recent-card">
      <text class="label">我访问或创建过的活动</text>
      <view class="muted recent-hint">点选即可查看，无需再输入邀请码</view>
      <view
        v-for="event in recentEvents"
        :key="event.code"
        class="recent-row"
        @click="openRecentEvent(event)"
      >
        <view class="recent-main">
          <view class="recent-name">{{ event.name || "未命名活动" }}</view>
          <view class="recent-meta">
            <text class="recent-role">{{ roleLabels[event.role] }}</text>
            <text v-if="dateRangeText(event)" class="recent-date">{{ dateRangeText(event) }}</text>
          </view>
        </view>
        <view class="recent-remove" @click.stop="removeRecent(event)">删除</view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.event-name {
  margin-bottom: 8rpx;
  font-size: 36rpx;
  font-weight: 700;
}

.invite-hint {
  margin: 12rpx 0 8rpx;
}

.recent-card {
  margin-top: 8rpx;
}

.recent-hint {
  margin-bottom: 8rpx;
}

.recent-row {
  display: flex;
  align-items: center;
  padding: 22rpx 0;
  border-top: 2rpx solid #eef2f8;
}

.recent-row:first-of-type {
  border-top: 0;
}

.recent-main {
  flex: 1;
  min-width: 0;
}

.recent-name {
  overflow: hidden;
  color: #172033;
  font-size: 30rpx;
  font-weight: 700;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.recent-meta {
  display: flex;
  align-items: center;
  margin-top: 10rpx;
  gap: 12rpx;
}

.recent-role {
  padding: 2rpx 12rpx;
  border-radius: 999rpx;
  background: #eef2ff;
  color: #2347c5;
  font-size: 20rpx;
}

.recent-date {
  color: #66728a;
  font-size: 22rpx;
}

.recent-remove {
  flex-shrink: 0;
  margin-left: 16rpx;
  padding: 10rpx 16rpx;
  color: #b23b5a;
  font-size: 24rpx;
}
</style>
