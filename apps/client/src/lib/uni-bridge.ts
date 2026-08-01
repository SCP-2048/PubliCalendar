/**
 * Call uni APIs through this module instead of bare `uni.*` in page scripts.
 *
 * WeChat MP builds minify page locals to short names like `e` (also used for
 * `vendor.js`). With mp-weixin `es6: true`, `for (const e of …)` can become a
 * function-scoped `var e`, so later `e.index.showModal` reads a date string and
 * throws: Cannot read property 'showModal' of undefined.
 */
export function showModal(options: UniNamespace.ShowModalOptions) {
  return uni.showModal(options);
}

export function showToast(options: UniNamespace.ShowToastOptions) {
  return uni.showToast(options);
}

export function showLoading(options: UniNamespace.ShowLoadingOptions) {
  return uni.showLoading(options);
}

export function hideLoading() {
  return uni.hideLoading();
}

export function navigateTo(options: UniNamespace.NavigateToOptions) {
  return uni.navigateTo(options);
}

export function redirectTo(options: UniNamespace.RedirectToOptions) {
  return uni.redirectTo(options);
}
