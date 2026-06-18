import type { FlowItem } from "../store/flowStore";

export const IMAGE_GENERATION_TIMEOUT_MS = 10 * 60 * 1000;
export const IMAGE_GENERATION_TIMEOUT_LABEL = formatElapsedTime(IMAGE_GENERATION_TIMEOUT_MS);
export const IMAGE_GENERATION_TIMEOUT_MESSAGE = "图片生成超过 10 分钟，已自动判定为超时失败。";
export const VIDEO_GENERATION_TIMEOUT_MS = 30 * 60 * 1000;
export const VIDEO_GENERATION_TIMEOUT_MESSAGE = "视频生成超过 30 分钟，已自动判定为超时失败。";

export function getGenerationElapsedMs(item: FlowItem, now = Date.now()) {
  return Math.max(0, now - item.createdAt);
}

export function formatElapsedTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function isImageGenerationTimedOut(item: FlowItem, now = Date.now()) {
  return item.type === "image" && item.status === "generating" && getGenerationElapsedMs(item, now) >= IMAGE_GENERATION_TIMEOUT_MS;
}

export function isVideoGenerationTimedOut(item: FlowItem, now = Date.now()) {
  return item.type === "video" && item.status === "generating" && getGenerationElapsedMs(item, now) >= VIDEO_GENERATION_TIMEOUT_MS;
}
