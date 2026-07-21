<script setup lang="ts">
import { ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import {
  getRecentEvents,
  removeRecentEvent,
  type RecentEvent,
} from "../../lib/recent-events";

const recentEvents = ref<RecentEvent[]>([]);

const roleLabels: Record<RecentEvent["role"], string> = {
  creator: "我创建的",
  participant: "我加入的",
  visitor: "我看过的",
};

onShow(() => {
  recentEvents.value = getRecentEvents("home");
});

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

function openEvent(event: RecentEvent) {
  void uni.navigateTo({ url: `/pages/result/index?code=${event.code}` });
}

function removeEvent(event: RecentEvent) {
  removeRecentEvent(event.code, "home");
  recentEvents.value = getRecentEvents("home");
}

function createEvent() {
  void uni.navigateTo({ url: "/pages/create/index" });
}

function joinEvent() {
  void uni.navigateTo({ url: "/pages/join/index" });
}
</script>

<template>
  <view :class="['home', recentEvents.length ? 'has-events' : 'is-empty']">
    <view class="intro">
      <view class="brand">PubliCalendar</view>
      <view class="tagline">找到大家都有空的时间</view>
    </view>

    <scroll-view v-if="recentEvents.length" class="events" scroll-y>
      <view class="events-title">我的活动</view>
      <view
        v-for="event in recentEvents"
        :key="event.code"
        class="event-card"
        @click="openEvent(event)"
      >
        <view class="event-main">
          <view class="event-name">{{ event.name || "未命名活动" }}</view>
          <view class="event-meta">
            <text class="event-role">{{ roleLabels[event.role] }}</text>
            <text v-if="dateRangeText(event)" class="event-date">{{ dateRangeText(event) }}</text>
          </view>
        </view>
        <view class="event-remove" @click.stop="removeEvent(event)">删除</view>
      </view>
    </scroll-view>

    <view class="actions">
      <button class="home-button primary" @click="createEvent">创建活动</button>
      <button class="home-button secondary" @click="joinEvent">加入活动</button>
    </view>
  </view>
</template>

<style scoped lang="scss">
.home {
  box-sizing: border-box;
  display: flex;
  position: relative;
  width: 100%;
  max-width: 760px;
  height: 100vh;
  margin: 0 auto;
  flex-direction: column;
  padding: 96rpx 48rpx 24rpx;
  background: linear-gradient(160deg, #f8faff 0%, #edf2ff 100%);
}

.intro {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

/* Empty: pin brand to the vertical center of the screen (above the action buttons). */
.home.is-empty .intro {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 0;
  padding-bottom: 280rpx;
  pointer-events: none;
}

.home.is-empty .actions {
  position: relative;
  z-index: 1;
  margin-top: auto;
}

.home.has-events .intro {
  flex: 0 0 auto;
}

.brand {
  color: #172033;
  font-size: 64rpx;
  font-weight: 800;
  letter-spacing: -2rpx;
}

.tagline {
  margin-top: 18rpx;
  color: #66728a;
  font-size: 30rpx;
}

.events {
  flex: 1;
  margin-top: 48rpx;
  overflow: hidden;
}

.events-title {
  margin-bottom: 20rpx;
  color: #3a4560;
  font-size: 28rpx;
  font-weight: 700;
}

.event-card {
  display: flex;
  align-items: center;
  margin-bottom: 20rpx;
  padding: 28rpx 28rpx;
  border-radius: 24rpx;
  background: #fff;
  box-shadow: 0 12rpx 32rpx rgba(49, 94, 251, 0.08);
}

.event-main {
  flex: 1;
  min-width: 0;
}

.event-name {
  overflow: hidden;
  color: #172033;
  font-size: 32rpx;
  font-weight: 700;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.event-meta {
  display: flex;
  align-items: center;
  margin-top: 12rpx;
  gap: 16rpx;
}

.event-role {
  padding: 4rpx 16rpx;
  border-radius: 999rpx;
  background: #eef2ff;
  color: #2347c5;
  font-size: 22rpx;
}

.event-date {
  color: #66728a;
  font-size: 24rpx;
}

.event-remove {
  flex-shrink: 0;
  margin-left: 20rpx;
  padding: 12rpx 20rpx;
  color: #b23b5a;
  font-size: 24rpx;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
  padding-top: 24rpx;
}

.home-button {
  width: 100%;
  height: 104rpx;
  border: 0;
  border-radius: 24rpx;
  font-size: 32rpx;
  font-weight: 700;
  line-height: 104rpx;
}

.home-button::after {
  border: 0;
}

.primary {
  background: #315efb;
  color: #fff;
  box-shadow: 0 18rpx 40rpx rgba(49, 94, 251, 0.24);
}

.secondary {
  border: 2rpx solid #cbd6f2;
  background: #fff;
  color: #2347c5;
}
</style>
