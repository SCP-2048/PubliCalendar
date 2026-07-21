/** Mini-program share entry: open join with code, then fill availability (no manual invite typing). */
export function eventSharePath(code: string): string {
  const normalized = code.trim().toUpperCase();
  return `/pages/join/index?code=${encodeURIComponent(normalized)}&mode=join`;
}

export function eventShareTitle(name?: string): string {
  const trimmed = name?.trim();
  return trimmed ? `邀请你填写「${trimmed}」的可用时间` : "邀请你填写可用时间";
}
