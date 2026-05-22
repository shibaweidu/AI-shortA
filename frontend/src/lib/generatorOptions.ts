import type { ModelCatalogOption } from "./modelCatalog";

export type GeneratorOption = {
  value: string;
  label: string;
  description?: string;
  previewKind?: "ratio" | "badge";
  previewLabel?: string;
  previewClassName?: string;
  imageUrl?: string;
  labels?: string[];
  providerName?: string;
  credits?: number;
  providerDisplayName?: string;
  source?: "koala" | "custom";
};

export const IMAGE_RATIO_OPTIONS: GeneratorOption[] = [
  { value: "auto", label: "智能", previewKind: "badge", previewLabel: "AI", previewClassName: "from-cyan-500 to-blue-600" },
  { value: "21:9", label: "21:9", previewKind: "ratio" },
  { value: "16:9", label: "16:9", previewKind: "ratio" },
  { value: "3:2", label: "3:2", previewKind: "ratio" },
  { value: "4:3", label: "4:3", previewKind: "ratio" },
  { value: "1:1", label: "1:1", previewKind: "ratio" },
  { value: "3:4", label: "3:4", previewKind: "ratio" },
  { value: "2:3", label: "2:3", previewKind: "ratio" },
  { value: "9:16", label: "9:16", previewKind: "ratio" },
];

export const VIDEO_RATIO_OPTIONS: GeneratorOption[] = [
  { value: "16:9", label: "16:9", previewKind: "ratio" },
  { value: "9:16", label: "9:16", previewKind: "ratio" },
];

export const IMAGE_RESOLUTION_OPTIONS: GeneratorOption[] = [
  { value: "1k", label: "1K", previewKind: "badge", previewLabel: "1K", previewClassName: "from-sky-500 to-cyan-600" },
  { value: "2k", label: "2K", previewKind: "badge", previewLabel: "2K", previewClassName: "from-sky-500 to-cyan-600" },
  { value: "4k", label: "4K", previewKind: "badge", previewLabel: "4K", previewClassName: "from-violet-500 to-purple-600" },
];

export const IMAGE_OUTPUT_COUNT_OPTIONS: GeneratorOption[] = [
  { value: "1", label: "1 张" },
  { value: "2", label: "2 张" },
  { value: "4", label: "4 张" },
];

export const VIDEO_COUNT_OPTIONS: GeneratorOption[] = [
  { value: "1", label: "1 条" },
  { value: "2", label: "2 条" },
  { value: "4", label: "4 条" },
];

export const VIDEO_DURATION_OPTIONS: GeneratorOption[] = [
  { value: "3s", label: "3s" },
  { value: "5s", label: "5s" },
  { value: "10s", label: "10s" },
];

export const VEO_VIDEO_DURATION_OPTIONS: GeneratorOption[] = [
  { value: "4s", label: "4s" },
  { value: "6s", label: "6s" },
  { value: "8s", label: "8s" },
];

export const SORA_VIDEO_DURATION_OPTIONS: GeneratorOption[] = [
  { value: "4s", label: "4s" },
  { value: "8s", label: "8s" },
  { value: "12s", label: "12s" },
];

export const GROK_VIDEO_DURATION_OPTIONS: GeneratorOption[] = [
  { value: "10s", label: "10s" },
];

export const GEEKAI_GROK_VIDEO_DURATION_OPTIONS: GeneratorOption[] = [
  { value: "6s", label: "6s" },
  { value: "10s", label: "10s" },
];

export function getVideoDurationOptionsForModel(model?: string, label?: string, providerName?: string) {
  const text = `${model ?? ""} ${label ?? ""} ${providerName ?? ""}`.toLowerCase();
  if ((text.includes("geekai") || text.includes("geeknow")) && text.includes("grok-video")) return GEEKAI_GROK_VIDEO_DURATION_OPTIONS;
  if (text.includes("grok-video") || text.includes("grok-imagine-video")) return GROK_VIDEO_DURATION_OPTIONS;
  if (text.includes("sora")) return SORA_VIDEO_DURATION_OPTIONS;
  if (text.includes("veo")) return VEO_VIDEO_DURATION_OPTIONS;
  return VIDEO_DURATION_OPTIONS;
}

export function buildGeneratorModelOptions(options: ModelCatalogOption[]): GeneratorOption[] {
  return options.map((option) => ({
    value: option.value,
    label: option.label,
    description: option.description ?? option.hint,
    imageUrl: option.imageUrl,
    labels: option.labels,
    providerName: option.providerName,
    credits: option.credits,
    providerDisplayName: option.providerName,
    source: option.source,
  }));
}

function resolutionHeight(resolution: string) {
  if (resolution === "4k") return 2160;
  if (resolution === "1k") return 1024;
  if (resolution === "2k") return 1440;
  return 720;
}

export function getImageSizeFromPreset(ratio: string, resolution: string) {
  const normalizedRatio = ratio === "auto" ? "1:1" : ratio;
  const [widthPart, heightPart] = normalizedRatio.split(":").map((part) => Number.parseFloat(part));
  const fallbackHeight = resolutionHeight(resolution);

  if (!widthPart || !heightPart) {
    return `${fallbackHeight}x${fallbackHeight}`;
  }

  if (widthPart >= heightPart) {
    const height = fallbackHeight;
    const width = Math.round((fallbackHeight * widthPart) / heightPart);
    return `${width}x${height}`;
  }

  const width = fallbackHeight;
  const height = Math.round((fallbackHeight * heightPart) / widthPart);
  return `${width}x${height}`;
  }
