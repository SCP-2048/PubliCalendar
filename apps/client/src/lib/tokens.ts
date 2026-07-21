const creatorKey = (code: string) => `publicalendar:creator:${code}`;
const participantKey = (code: string) => `publicalendar:participant:${code}`;
const participantIdKey = (code: string) => `publicalendar:participant-id:${code}`;

export function saveCreatorToken(code: string, token: string): void {
  uni.setStorageSync(creatorKey(code), token);
}

export function getCreatorToken(code: string): string {
  return String(uni.getStorageSync(creatorKey(code)) || "");
}

export function saveParticipantToken(code: string, token: string): void {
  uni.setStorageSync(participantKey(code), token);
}

export function getParticipantToken(code: string): string {
  return String(uni.getStorageSync(participantKey(code)) || "");
}

export function saveParticipantId(code: string, participantId: string): void {
  uni.setStorageSync(participantIdKey(code), participantId);
}

export function getParticipantId(code: string): string {
  return String(uni.getStorageSync(participantIdKey(code)) || "");
}

export function clearParticipantSession(code: string): void {
  uni.removeStorageSync(participantKey(code));
  uni.removeStorageSync(participantIdKey(code));
}
