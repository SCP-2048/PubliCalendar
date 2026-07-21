<script setup lang="ts">
import { onLaunch } from "@dcloudio/uni-app";

onLaunch(() => {
  console.info("PubliCalendar ready");
});
</script>

<style lang="scss">
page {
  height: 100%;
  min-height: 100%;
  background: #f4f7fb;
  color: #172033;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.page {
  box-sizing: border-box;
  max-width: 760px;
  min-height: 100vh;
  margin: 0 auto;
  padding: 32rpx;
}

.card {
  margin-bottom: 24rpx;
  padding: 32rpx;
  border-radius: 24rpx;
  background: #fff;
  box-shadow: 0 10rpx 30rpx rgba(35, 54, 91, 0.08);
}

.title {
  margin: 12rpx 0 32rpx;
  font-size: 48rpx;
  font-weight: 700;
}

.label {
  display: block;
  margin: 22rpx 0 10rpx;
  color: #536078;
  font-size: 26rpx;
}

.input {
  box-sizing: border-box;
  width: 100%;
  height: 88rpx;
  padding: 0 24rpx;
  border: 2rpx solid #dce3ef;
  border-radius: 16rpx;
  background: #fff;
}

.button {
  margin-top: 28rpx;
  border: 0;
  border-radius: 16rpx;
  background: #315efb;
  color: #fff;
}

.button.secondary {
  background: #e9efff;
  color: #2347c5;
}

.muted {
  color: #78849a;
  font-size: 26rpx;
}

.error {
  margin-top: 18rpx;
  color: #c52b3c;
}
</style>
