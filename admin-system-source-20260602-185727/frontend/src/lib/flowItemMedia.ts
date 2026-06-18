import type { FlowItem } from "../store/flowStore";

const DEFAULT_ASPECT_WIDTH = 16;
const DEFAULT_ASPECT_HEIGHT = 9;

function parseAspectRatio(value?: string) {
  const match = value?.match(/^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/);
  if (!match) return { width: DEFAULT_ASPECT_WIDTH, height: DEFAULT_ASPECT_HEIGHT };

  const width = Number.parseFloat(match[1]);
  const height = Number.parseFloat(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: DEFAULT_ASPECT_WIDTH, height: DEFAULT_ASPECT_HEIGHT };
  }

  return { width, height };
}

export function getFlowItemAspectDimensions(item: FlowItem) {
  return parseAspectRatio(item.parameters.aspectRatio);
}

export function getFlowItemAspectRatioValue(item: FlowItem) {
  const { width, height } = getFlowItemAspectDimensions(item);
  return `${width} / ${height}`;
}

export function isFlowItemPortrait(item: FlowItem) {
  const { width, height } = getFlowItemAspectDimensions(item);
  return height > width;
}
