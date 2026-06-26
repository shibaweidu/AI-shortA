import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import { Check, ChevronDown, Image as ImageIcon, Loader2, Palette, Pencil, Trash2, Upload, Video, Wand2, X, Search, Send } from "lucide-react";
import { LocalAssetImage } from "../../components/LocalAssetImage";
import { cn, getDisplayAssetUrl } from "../../lib/utils";
import { getDataUrlFromPersistedAssetFile } from "../../services/localFiles";
import { resolveReferenceImageDataUrl } from "../../services/referenceImages";
import { createCustomStylePreset, deleteCustomStylePreset, fetchStyleLibrary, updateCustomStylePreset, uploadStyleImage, type StyleCategory, type StylePreset } from "../../services/styleLibrary";
import type { GeneratorOption } from "../../lib/generatorOptions";
import type { FlowItem, FlowItemType, FlowProject, FlowReferenceRole } from "../../store/flowStore";
import { useAgentStore } from "../../store/agentStore";
import { useSettingsStore, type ProviderConfig } from "../../store/settingsStore";
import { useUserModelStore } from "../../store/userModelStore";
import { parseProviderModelValue, parseSourcedProviderModelValue } from "../../lib/providerModels";
import { classifyReferenceImage, fetchReferenceSettings, type ReferenceSettings } from "../../services/referenceSettings";
import { shouldUseVideoDurationSlider } from "../../lib/generatorOptions";

const creativeTypes: Array<{
  value: FlowItemType;
  label: string;
  icon: typeof Wand2;
  disabled?: boolean;
}> = [
  { value: "image", label: "图片生成", icon: ImageIcon },
  { value: "video", label: "视频生成", icon: Video },
];

const imageResolutionChoices = [
  { value: "1k", label: "标准 1K" },
  { value: "2k", label: "高清 2K" },
  { value: "4k", label: "超清 4K+" },
] as const;

const videoResolutionChoices = [
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
] as const;

const generationCountOptions = [1, 2, 3, 4] as const;
const referenceRoleOptions: Array<{ value: FlowReferenceRole; label: string }> = [
  { value: "character", label: "角色" },
  { value: "scene", label: "场景" },
  { value: "object", label: "物品" },
  { value: "general", label: "通用" },
];
const DEFAULT_REFERENCE_ROLE: FlowReferenceRole = "character";
type VideoReferenceCapability = { max: number; visibleSlots?: number; labels: string[] };

function getReferenceRoleLabel(role?: FlowReferenceRole) {
  return referenceRoleOptions.find((option) => option.value === role)?.label ?? "角色";
}

function getVideoReferenceCapability(model?: string, label?: string): VideoReferenceCapability {
  const text = `${model ?? ""} ${label ?? ""}`.toLowerCase();
  if (text.includes("grok-video") || text.includes("grok-imagine-video")) return { max: 1, labels: ["首帧"] };
  if (text.includes("sora-vip3") || text.includes("sora-vip3-pro")) {
    return { max: 9, visibleSlots: 1, labels: ["参考图"] };
  }
  if (text.includes("sora-v3") || text.includes("seedance")) {
    return { max: 4, visibleSlots: 1, labels: ["参考图"] };
  }
  if (text.includes("sora")) return { max: 1, labels: ["首帧"] };
  if (text.includes("veo") && text.includes("ref")) return { max: 3, labels: ["参考图1", "参考图2", "参考图3"] };
  if (text.includes("veo")) return { max: 2, labels: ["首帧", "尾帧"] };
  return { max: 2, labels: ["首帧", "尾帧"] };
}

function resolveReferenceVisionModel(
  value: string,
  systemProviders: ProviderConfig[],
  customProviders: ProviderConfig[]
) {
  const sourced = parseSourcedProviderModelValue(value);
  const plain = sourced ? null : parseProviderModelValue(value);
  const source = sourced?.source;
  const providerId = sourced?.providerId ?? plain?.providerId;
  const modelId = sourced?.modelId ?? plain?.modelId;
  if (!providerId || !modelId) return null;
  const providers = source === "custom" ? customProviders : source === "koala" ? systemProviders : [...systemProviders, ...customProviders];
  const provider = providers.find((item) => item.id === providerId);
  if (!provider) return null;
  return { provider, modelId };
}

function getRatioPreviewClass(value: string) {
  if (value === "21:9") return "h-[4px] w-[15px]";
  if (value === "16:9") return "h-[6px] w-[15px]";
  if (value === "3:2") return "h-[7px] w-[13px]";
  if (value === "4:3") return "h-[8px] w-[13px]";
  if (value === "1:1") return "h-[10px] w-[10px]";
  if (value === "3:4") return "h-[13px] w-[9px]";
  if (value === "2:3") return "h-[14px] w-[8px]";
  if (value === "9:16") return "h-[16px] w-[8px]";
  return "h-[10px] w-[10px]";
}

function appendUniqueUrls(current: string[], incoming: string[]) {
  return [...current, ...incoming].filter((value, index, list) => Boolean(value) && list.indexOf(value) === index);
}

function makeStyleNameFromDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `风格${year}${month}${day}`;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Failed to read reference image"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read reference image"));
    reader.readAsDataURL(file);
  });
}

async function readReferenceImageAsPngDataUrl(file: File) {
  const dataUrl = await readFileAsDataUrl(file);
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Failed to decode reference image"));
  });
  image.src = dataUrl;
  await loaded;

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Failed to prepare reference image");

  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  return canvas.toDataURL("image/png");
}

interface FlowGeneratorBarProps {
  generatorRef: RefObject<HTMLDivElement | null>;
  prompt: string;
  onPromptChange: (value: string) => void;
  onPromptKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  type: FlowItemType;
  onTypeChange: (value: FlowItemType) => void;
  model: string;
  onModelChange: (value: string) => void;
  aspectRatio: string;
  onAspectRatioChange: (value: string) => void;
  resolution: string;
  onResolutionChange: (value: string) => void;
  duration: string;
  onDurationChange: (value: string) => void;
  generationCount: number;
  onGenerationCountChange: (value: number) => void;
  referenceImages: string[];
  onReferenceImagesChange: Dispatch<SetStateAction<string[]>>;
  externalReferenceImages: string[];
  onExternalReferenceImagesChange: Dispatch<SetStateAction<string[]>>;
  referenceImageRoles?: Record<string, FlowReferenceRole>;
  onReferenceImageRolesChange?: Dispatch<SetStateAction<Record<string, FlowReferenceRole>>>;
  selectedStyle?: SelectedStyleReference | null;
  onSelectedStyleChange?: (value: SelectedStyleReference | null) => void;
  currentModelOptions: GeneratorOption[];
  ratioOptions: GeneratorOption[];
  durationOptions: GeneratorOption[];
  canGenerate: boolean;
  isGenerating?: boolean;
  openGeneratorPanel: "type" | "model" | "ratio" | "count" | "assets" | "styles" | null;
  onOpenGeneratorPanelChange: (value: "type" | "model" | "ratio" | "count" | "assets" | "styles" | null) => void;
  onGenerate: () => void;
  imageDimensions: { width: string; height: string };
  promptPlaceholder?: string;
  hideTypeSelector?: boolean;
  projects?: FlowProject[];
  assets?: FlowItem[];
  currentProjectId?: string;
  variant?: "default" | "home";
  estimatedCredits?: number;
}

export interface SelectedStyleReference {
  id: string;
  name: string;
  imageUrl?: string;
  prompt?: string;
  strength?: number;
  custom?: boolean;
}

type AssetMentionState = {
  open: boolean;
  query: string;
  start: number;
  end: number;
};

type PromptReferencePreview = {
  index: number;
  image: string;
  left: number;
  top: number;
};

const closedAssetMention: AssetMentionState = {
  open: false,
  query: "",
  start: 0,
  end: 0,
};

function getAssetMentionState(value: string, caret: number): AssetMentionState | null {
  const beforeCaret = value.slice(0, caret);
  const match = beforeCaret.match(/@([^\s@]*)$/);
  if (!match) return null;
  const query = match[1] ?? "";
  // Don't trigger asset search after an inserted @imageN reference token.
  if (/^image\d+/i.test(query)) return null;
  return {
    open: true,
    query,
    start: caret - query.length - 1,
    end: caret,
  };
}

function reindexPromptReferencesAfterRemoval(value: string, removedIndexes: number[]) {
  if (!removedIndexes.length) return value;
  const sorted = [...new Set(removedIndexes)].sort((a, b) => a - b);
  return value.replace(/@image(\d+)/gi, (_token, rawIndex) => {
    const index = Number.parseInt(rawIndex, 10) - 1;
    if (sorted.includes(index)) return "";
    const shift = sorted.filter((removedIndex) => removedIndex < index).length;
    return `@image${index - shift + 1}`;
  });
}

function promptIncludesReferenceIndex(value: string, index: number) {
  return new RegExp(`@image${index + 1}(?!\\d)`, "i").test(value);
}

function buildPromptWithReferenceToken(input: { value: string; start: number; end: number; token: string }) {
  const before = input.value.slice(0, input.start);
  const after = input.value.slice(input.end).replace(/^\s+/, "");
  const leading = before && !/\s$/.test(before) ? " " : "";
  const trailing = " ";
  const nextValue = `${before}${leading}${input.token}${trailing}${after}`;
  const caret = before.length + leading.length + input.token.length + trailing.length;
  return { value: nextValue, caret };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPromptEditorHtml(value: string, referenceImages: string[]) {
  if (!value) return "";
  let html = "";
  let lastIndex = 0;

  // Helper to convert text with proper space handling
  const convertText = (text: string, afterToken: boolean) => {
    let result = text.replace(/\n/g, "<br>");
    // Keep the caret in a real text position after a non-editable @image token.
    if (afterToken && result.startsWith(" ")) {
      result = result.replace(/^ +/, (spaces) => `${"&nbsp;".repeat(spaces.length)}&#8203;`);
    }
    return result;
  };

  for (const match of value.matchAll(/@image(\d+)/gi)) {
    const tokenStart = match.index ?? 0;
    const token = match[0];
    const referenceIndex = Number.parseInt(match[1] ?? "", 10) - 1;
    const referenceImage = referenceImages[referenceIndex];
    html += convertText(escapeHtml(value.slice(lastIndex, tokenStart)), false);
    if (referenceIndex >= 0 && referenceImage) {
      const displayUrl = getDisplayAssetUrl(referenceImage) ?? "";
      html += `<span contenteditable="false" data-ref-index="${referenceIndex}" data-token="@image${referenceIndex + 1}" class="mx-0.5 inline-flex h-7 max-w-[180px] translate-y-[6px] cursor-pointer items-center gap-1.5 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-1.5 text-xs font-medium text-cyan-50 align-baseline transition hover:border-cyan-200/45 hover:bg-cyan-300/15"><img src="${escapeHtml(displayUrl)}" alt="" class="h-5 w-5 shrink-0 rounded-full object-cover" /><span>@image${referenceIndex + 1}</span></span>`;
    } else {
      html += escapeHtml(token);
    }
    lastIndex = tokenStart + token.length;
  }
  html += convertText(escapeHtml(value.slice(lastIndex)), lastIndex > 0);
  return html;
}

function readPromptEditorValue(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\u00a0/g, " ").replace(/\u200b/g, "");
  if (node.nodeName === "BR") return "\n";
  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return "";

  const element = node as HTMLElement;
  const referenceIndex = element.dataset?.refIndex;
  if (referenceIndex !== undefined) return `@image${Number(referenceIndex) + 1}`;

  let value = "";
  node.childNodes.forEach((child) => {
    value += readPromptEditorValue(child);
  });
  return value;
}

function getPromptEditorSelectionOffsets(editor: HTMLElement, fallback: number) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return { start: fallback, end: fallback };
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
    return { start: fallback, end: fallback };
  }

  const startRange = range.cloneRange();
  startRange.selectNodeContents(editor);
  startRange.setEnd(range.startContainer, range.startOffset);
  const endRange = range.cloneRange();
  endRange.selectNodeContents(editor);
  endRange.setEnd(range.endContainer, range.endOffset);
  return {
    start: readPromptEditorValue(startRange.cloneContents()).length,
    end: readPromptEditorValue(endRange.cloneContents()).length,
  };
}

function setPromptEditorCaretOffset(editor: HTMLElement, offset: number) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  let currentOffset = 0;
  let placed = false;

  const getTextLogicalLength = (text: string) => text.replace(/\u200b/g, "").length;
  const getDomOffsetForLogicalOffset = (text: string, logicalOffset: number) => {
    if (logicalOffset <= 0) return 0;
    let logicalCount = 0;
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === "\u200b") continue;
      logicalCount += 1;
      if (logicalCount >= logicalOffset) {
        let domOffset = index + 1;
        while (text[domOffset] === "\u200b") domOffset += 1;
        return domOffset;
      }
    }
    return text.length;
  };

  const placeInNode = (node: Node) => {
    if (placed) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      const logicalLength = getTextLogicalLength(text);
      if (currentOffset + logicalLength >= offset) {
        range.setStart(node, getDomOffsetForLogicalOffset(text, Math.max(0, offset - currentOffset)));
        range.collapse(true);
        placed = true;
        return;
      }
      currentOffset += logicalLength;
      return;
    }
    if (node.nodeName === "BR") {
      currentOffset += 1;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    const referenceIndex = element.dataset?.refIndex;
    if (referenceIndex !== undefined) {
      const tokenLength = `@image${Number(referenceIndex) + 1}`.length;
      if (currentOffset + tokenLength >= offset) {
        range.setStartAfter(element);
        range.collapse(true);
        placed = true;
        return;
      }
      currentOffset += tokenLength;
      return;
    }
    node.childNodes.forEach(placeInNode);
  };

  editor.childNodes.forEach(placeInNode);
  if (!placed) {
    range.selectNodeContents(editor);
    range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

export function FlowGeneratorBar({
  generatorRef,
  prompt,
  onPromptChange,
  onPromptKeyDown,
  type,
  onTypeChange,
  model,
  onModelChange,
  aspectRatio,
  onAspectRatioChange,
  resolution,
  onResolutionChange,
  duration,
  onDurationChange,
  generationCount,
  onGenerationCountChange,
  referenceImages,
  onReferenceImagesChange,
  externalReferenceImages,
  onExternalReferenceImagesChange,
  referenceImageRoles = {},
  onReferenceImageRolesChange,
  selectedStyle,
  onSelectedStyleChange,
  currentModelOptions,
  ratioOptions,
  durationOptions,
  canGenerate,
  isGenerating = false,
  openGeneratorPanel,
  onOpenGeneratorPanelChange,
  onGenerate,
  imageDimensions,
  promptPlaceholder,
  hideTypeSelector = false,
  projects = [],
  assets = [],
  currentProjectId,
  variant = "default",
  estimatedCredits,
}: FlowGeneratorBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptEditorRef = useRef<HTMLDivElement>(null);
  const promptInsertOffsetRef = useRef<number | null>(null);
  const styleFileInputRef = useRef<HTMLInputElement>(null);
  const referenceTrayCloseTimeoutRef = useRef<number | null>(null);
  const styleTrayCloseTimeoutRef = useRef<number | null>(null);
  const promptReferencePreviewCloseTimeoutRef = useRef<number | null>(null);
  const recommendedReferenceImagesRef = useRef<Set<string>>(new Set());
  const [assetProjectId, setAssetProjectId] = useState<string | "all">(currentProjectId ?? "all");
  const [assetSort, setAssetSort] = useState<"newest" | "oldest">("newest");
  const [assetSearch, setAssetSearch] = useState("");
  const [activeReferenceIndex, setActiveReferenceIndex] = useState(0);
  const [assetPreviewUrl, setAssetPreviewUrl] = useState<string | null>(null);
  const [assetMention, setAssetMention] = useState<AssetMentionState>(closedAssetMention);
  const [promptReferencePreview, setPromptReferencePreview] = useState<PromptReferencePreview | null>(null);
  const [resolvedAssetReferenceUrls, setResolvedAssetReferenceUrls] = useState<Record<string, string>>({});
  const [referenceTrayOpen, setReferenceTrayOpen] = useState(false);
  const [activeVideoPreviewIndex, setActiveVideoPreviewIndex] = useState<number | null>(null);
  const [videoReferenceTargetIndex, setVideoReferenceTargetIndex] = useState(0);
  const [styleTrayOpen, setStyleTrayOpen] = useState(false);
  const [styleCategories, setStyleCategories] = useState<StyleCategory[]>([]);
  const [stylePresets, setStylePresets] = useState<StylePreset[]>([]);
  const [styleCategoryId, setStyleCategoryId] = useState("all");
  const [styleLoading, setStyleLoading] = useState(false);
  const [styleError, setStyleError] = useState("");
  const [referenceSettings, setReferenceSettings] = useState<ReferenceSettings | null>(null);
  const { openSidebar, closeSidebar, isSidebarOpen, agents } = useAgentStore();
  const { providers: systemProviders } = useSettingsStore();
  const { providers: customProviders } = useUserModelStore();

  const selectedModelOption = currentModelOptions.find((option) => option.value === model);
  const selectedRatioOption = ratioOptions.find((option) => option.value === aspectRatio);
  const selectedResolutionChoice =
    imageResolutionChoices.find((option) => option.value === resolution) ?? imageResolutionChoices[0];
  const selectedVideoResolutionChoice =
    videoResolutionChoices.find((option) => option.value === resolution) ?? videoResolutionChoices[0];
  const selectedDurationOption = durationOptions.find((option) => option.value === duration);
  const videoReferenceCapability = getVideoReferenceCapability(model, selectedModelOption?.label);
  const visibleVideoReferenceSlots = videoReferenceCapability.visibleSlots ?? videoReferenceCapability.max;
  const useDurationSlider = shouldUseVideoDurationSlider(model, selectedModelOption?.label, selectedModelOption?.providerName);
  const durationValues = durationOptions.map((option) => Number.parseFloat(option.value)).filter(Number.isFinite);
  const minDurationSeconds = durationValues.length ? Math.min(...durationValues) : 4;
  const maxDurationSeconds = durationValues.length ? Math.max(...durationValues) : 15;
  const durationSeconds = Math.max(minDurationSeconds, Math.min(maxDurationSeconds, Math.round(Number.parseFloat(duration) || 10)));
  const getVideoReferenceLabel = (index: number) => videoReferenceCapability.labels[index] ?? `参考图${index + 1}`;
  const videoReferenceSlots = Array.from({ length: visibleVideoReferenceSlots }, (_, index) => ({
    index,
    label: getVideoReferenceLabel(index),
    image: referenceImages[index],
  }));
  const activeCreativeType = creativeTypes.find((option) => option.value === type) ?? creativeTypes[0];
  const ActiveTypeIcon = activeCreativeType.icon;
  const isHome = variant === "home";
  const visibleReferenceImages = type === "video" ? referenceImages : externalReferenceImages;
  const activeReferenceImage = visibleReferenceImages[activeReferenceIndex] ?? visibleReferenceImages[0] ?? null;
  const stackedReferenceImages = visibleReferenceImages.slice(0, 3);
  const visibleReferenceSet = useMemo(() => new Set(visibleReferenceImages), [visibleReferenceImages]);
  const uninsertedReferenceIndexes = referenceImages
    .map((image, index) => ({ image, index }))
    .filter(({ image, index }) => !visibleReferenceSet.has(image) && !promptIncludesReferenceIndex(prompt, index))
    .map(({ index }) => index);

  const placeholderText = promptPlaceholder ?? "";

  const filteredAssets = useMemo(() => {
    let list = assets.filter((item) => item.type === "image" && !!item.url);
    if (assetProjectId !== "all") {
      list = list.filter((item) => item.projectId === assetProjectId);
    }

    const query = assetSearch.trim().toLowerCase();
    if (query) {
      list = list.filter((item) => (item.prompt ?? "").toLowerCase().includes(query));
    }

    return [...list].sort((a, b) =>
      assetSort === "newest" ? b.createdAt - a.createdAt : a.createdAt - b.createdAt
    );
  }, [assets, assetProjectId, assetSearch, assetSort]);

  const referenceMentionOptions = useMemo(() => {
    const query = assetMention.query.trim().toLowerCase();
    return referenceImages
      .map((image, index) => ({ image, index, label: `image${index + 1}` }))
      .filter((item) => !query || item.label.toLowerCase().includes(query));
  }, [assetMention.query, referenceImages]);

  useEffect(() => {
    if (referenceImages.length === 0) {
      setActiveReferenceIndex(0);
      return;
    }

    if (activeReferenceIndex > referenceImages.length - 1) {
      setActiveReferenceIndex(referenceImages.length - 1);
    }
  }, [activeReferenceIndex, referenceImages]);

  useEffect(() => {
    if (type !== "video") return;
    if (!videoResolutionChoices.some((option) => option.value === resolution)) {
      onResolutionChange(videoResolutionChoices[0].value);
    }
  }, [onResolutionChange, resolution, type]);

  useEffect(() => {
    if (type !== "video" || referenceImages.length <= videoReferenceCapability.max) return;
    const nextReferences = referenceImages.slice(0, videoReferenceCapability.max);
    onReferenceImagesChange(nextReferences);
    onReferenceImageRolesChange?.((roles) =>
      Object.fromEntries(Object.entries(roles).filter(([image]) => nextReferences.includes(image)))
    );
    setActiveReferenceIndex((current) => Math.min(current, Math.max(0, nextReferences.length - 1)));
  }, [onReferenceImageRolesChange, onReferenceImagesChange, referenceImages, type, videoReferenceCapability.max]);

  useEffect(() => {
    if (openGeneratorPanel !== "assets") {
      setAssetPreviewUrl(null);
      return;
    }

    setAssetPreviewUrl((current) => current ?? activeReferenceImage ?? filteredAssets[0]?.url ?? null);
  }, [activeReferenceImage, filteredAssets, openGeneratorPanel]);

  useEffect(() => {
    return () => {
      if (referenceTrayCloseTimeoutRef.current !== null) {
        window.clearTimeout(referenceTrayCloseTimeoutRef.current);
      }
      if (styleTrayCloseTimeoutRef.current !== null) {
        window.clearTimeout(styleTrayCloseTimeoutRef.current);
      }
      if (promptReferencePreviewCloseTimeoutRef.current !== null) {
        window.clearTimeout(promptReferencePreviewCloseTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const editor = promptEditorRef.current;
    if (!editor) return;
    const currentValue = readPromptEditorValue(editor);
    if (currentValue === prompt) return;
    const active = document.activeElement === editor;
    const caret = active ? getPromptEditorSelectionOffsets(editor, promptInsertOffsetRef.current ?? prompt.length).start : null;
    editor.innerHTML = renderPromptEditorHtml(prompt, referenceImages);
    if (active && caret !== null) {
      window.setTimeout(() => setPromptEditorCaretOffset(editor, Math.min(caret, prompt.length)), 0);
    }
  }, [prompt, referenceImages]);

  const openReferenceTray = () => {
    if (referenceTrayCloseTimeoutRef.current !== null) {
      window.clearTimeout(referenceTrayCloseTimeoutRef.current);
      referenceTrayCloseTimeoutRef.current = null;
    }
    setReferenceTrayOpen(true);
  };

  const closeReferenceTrayWithDelay = () => {
    if (referenceTrayCloseTimeoutRef.current !== null) {
      window.clearTimeout(referenceTrayCloseTimeoutRef.current);
    }
    referenceTrayCloseTimeoutRef.current = window.setTimeout(() => {
      setReferenceTrayOpen(false);
      setActiveVideoPreviewIndex(null);
      referenceTrayCloseTimeoutRef.current = null;
    }, 280);
  };

  const openStyleTray = () => {
    if (!selectedStyle?.imageUrl) return;
    if (styleTrayCloseTimeoutRef.current !== null) {
      window.clearTimeout(styleTrayCloseTimeoutRef.current);
      styleTrayCloseTimeoutRef.current = null;
    }
    setStyleTrayOpen(true);
  };

  const closeStyleTrayWithDelay = () => {
    if (styleTrayCloseTimeoutRef.current !== null) {
      window.clearTimeout(styleTrayCloseTimeoutRef.current);
    }
    styleTrayCloseTimeoutRef.current = window.setTimeout(() => {
      setStyleTrayOpen(false);
      styleTrayCloseTimeoutRef.current = null;
    }, 120);
  };

  const openPromptReferencePreview = (index: number, anchor: HTMLElement) => {
    const image = referenceImages[index];
    if (!image) return;
    if (promptReferencePreviewCloseTimeoutRef.current !== null) {
      window.clearTimeout(promptReferencePreviewCloseTimeoutRef.current);
      promptReferencePreviewCloseTimeoutRef.current = null;
    }
    const rect = anchor.getBoundingClientRect();
    setPromptReferencePreview({
      index,
      image,
      left: rect.left,
      top: rect.top - 10,
    });
  };

  const closePromptReferencePreviewWithDelay = () => {
    if (promptReferencePreviewCloseTimeoutRef.current !== null) {
      window.clearTimeout(promptReferencePreviewCloseTimeoutRef.current);
    }
    promptReferencePreviewCloseTimeoutRef.current = window.setTimeout(() => {
      setPromptReferencePreview(null);
      promptReferencePreviewCloseTimeoutRef.current = null;
    }, 700);
  };

  const closeReferenceAssetPanel = () => {
    setReferenceTrayOpen(false);
    setActiveVideoPreviewIndex(null);
    setAssetPreviewUrl(null);
    onOpenGeneratorPanelChange(null);
  };

  const addReferenceImages = (images: string[], targetIndex?: number) => {
    if (!images.length) return;

    if (type === "video") {
      if (visibleVideoReferenceSlots === 1) {
        onReferenceImagesChange((current) => {
          const incomingImages = images.slice(0, Math.max(0, videoReferenceCapability.max - current.length));
          const next = appendUniqueUrls(current, incomingImages).slice(0, videoReferenceCapability.max);
          setActiveReferenceIndex(Math.max(0, next.length - 1));
          return next;
        });
      } else {
        const slotIndex = Math.max(0, Math.min(targetIndex ?? videoReferenceTargetIndex, videoReferenceCapability.max - 1));
        const image = images[0];
        onReferenceImagesChange((current) => {
          const next = current.slice(0, videoReferenceCapability.max);
          next[slotIndex] = image;
          return next.filter(Boolean);
        });
        setActiveReferenceIndex(slotIndex);
      }
      return;
    }

    onReferenceImagesChange((current) => {
      const next = appendUniqueUrls(current, images);
      setActiveReferenceIndex(Math.max(0, Math.min(next.length - 1, current.length)));
      return next;
    });
    onExternalReferenceImagesChange((current) => appendUniqueUrls(current, images));
  };

  const handleReferenceChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (!files.length) return;

    const uploadedImages = await Promise.all(files.map((file) => readReferenceImageAsPngDataUrl(file)));
    addReferenceImages(uploadedImages);
    onReferenceImageRolesChange?.((current) => {
      const next = { ...current };
      for (const image of uploadedImages) next[image] ??= DEFAULT_REFERENCE_ROLE;
      return next;
    });
    void recommendReferenceRoles(uploadedImages);
    closeReferenceAssetPanel();
  };

  const handleRemoveVideoReferenceSlot = (slotIndex: number) => {
    const image = referenceImages[slotIndex];
    const nextPrompt = reindexPromptReferencesAfterRemoval(prompt, [slotIndex]).replace(/\s{2,}/g, " ");
    onPromptChange(nextPrompt);
    onReferenceImagesChange((current) => current.filter((_, index) => index !== slotIndex));
    if (image) {
      onReferenceImageRolesChange?.((roles) => {
        const updated = { ...roles };
        delete updated[image];
        return updated;
      });
    }
    setActiveReferenceIndex((current) => Math.min(current, Math.max(0, referenceImages.length - 2)));
  };

  const getAssetReferenceUrl = async (asset: FlowItem) => {
    if (!asset.url) return;
    const cached = resolvedAssetReferenceUrls[asset.id];
    if (cached) return cached;

    let referenceUrl = asset.url;
    if (asset.savedFileName) {
      referenceUrl = (await getDataUrlFromPersistedAssetFile(asset.id).catch(() => null)) ?? asset.url;
    } else {
      referenceUrl = await resolveReferenceImageDataUrl(asset.url);
    }

    if (referenceUrl !== asset.url) {
      setResolvedAssetReferenceUrls((current) =>
        current[asset.id] === referenceUrl ? current : { ...current, [asset.id]: referenceUrl }
      );
    }

    return referenceUrl;
  };

  const getAssetReferenceIndex = (asset: FlowItem, referenceUrl?: string) => {
    const candidates = [asset.url, referenceUrl].filter((value, index, list): value is string => Boolean(value) && list.indexOf(value) === index);
    return visibleReferenceImages.findIndex((image) => candidates.includes(image));
  };

  const savePromptCaretOffset = () => {
    const editor = promptEditorRef.current;
    if (!editor) return;
    promptInsertOffsetRef.current = getPromptEditorSelectionOffsets(editor, promptInsertOffsetRef.current ?? prompt.length).start;
  };

  const handlePromptInput = (event: FormEvent<HTMLDivElement>) => {
    const editor = event.currentTarget;
    const nextPrompt = readPromptEditorValue(editor);
    onPromptChange(nextPrompt);
    const caret = getPromptEditorSelectionOffsets(editor, nextPrompt.length).start;
    promptInsertOffsetRef.current = caret;
    const nextMention = getAssetMentionState(nextPrompt, caret);
    setAssetMention(nextMention ?? closedAssetMention);
  };

  const handleInsertPromptReference = (index: number) => {
    const token = `@image${index + 1}`;
    const editor = promptEditorRef.current;
    const selectionOffsets = editor
      ? getPromptEditorSelectionOffsets(editor, promptInsertOffsetRef.current ?? prompt.length)
      : { start: promptInsertOffsetRef.current ?? prompt.length, end: promptInsertOffsetRef.current ?? prompt.length };
    const start = selectionOffsets.start;
    const end = selectionOffsets.end;
    const nextPrompt = buildPromptWithReferenceToken({ value: prompt, start, end, token });
    onPromptChange(nextPrompt.value);
    window.setTimeout(() => {
      promptEditorRef.current?.focus();
      if (promptEditorRef.current) setPromptEditorCaretOffset(promptEditorRef.current, nextPrompt.caret);
      promptInsertOffsetRef.current = nextPrompt.caret;
    }, 0);
  };

  const applyPromptDeletion = (direction: "backward" | "forward") => {
    const editor = promptEditorRef.current;
    if (!editor) return false;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;

    const range = selection.getRangeAt(0);
    if (!range.collapsed) return false;

    const currentPrompt = readPromptEditorValue(editor);
    const offsets = getPromptEditorSelectionOffsets(editor, currentPrompt.length);
    const caretPos = direction === "backward" ? offsets.start : offsets.end;

    let tokenStart = -1;
    let tokenEnd = -1;
    let nextCaret = caretPos;

    if (direction === "backward") {
      const beforeCaret = currentPrompt.slice(0, caretPos);
      const afterCaret = currentPrompt.slice(caretPos);
      const tokenMatch = beforeCaret.match(/@image\d+\s?$/);
      if (tokenMatch) {
        tokenStart = caretPos - tokenMatch[0].length;
        tokenEnd = caretPos;
        nextCaret = tokenStart;
      } else {
        const nextPromptAfterCharacterDelete = beforeCaret.slice(0, -1) + afterCaret;
        if (
          beforeCaret.length > 0 &&
          afterCaret.length === 0 &&
          !/\s/.test(beforeCaret.slice(-1)) &&
          /@image\d+\s+\S*$/i.test(beforeCaret)
        ) {
          onPromptChange(nextPromptAfterCharacterDelete);
          window.setTimeout(() => {
            if (promptEditorRef.current) {
              setPromptEditorCaretOffset(promptEditorRef.current, nextPromptAfterCharacterDelete.length);
              promptInsertOffsetRef.current = nextPromptAfterCharacterDelete.length;
            }
          }, 0);
          return true;
        }
      }
    } else {
      const beforeCaret = currentPrompt.slice(0, caretPos);
      const afterCaret = currentPrompt.slice(caretPos);
      const tokenMatch = afterCaret.match(/^@image\d+\s?/);
      if (tokenMatch) {
        tokenStart = caretPos;
        tokenEnd = caretPos + tokenMatch[0].length;
        nextCaret = tokenStart;
      } else if (beforeCaret.match(/@image\d+\s?$/) && afterCaret.length === 0) {
        return true;
      }
    }

    if (tokenStart < 0 || tokenEnd < 0) return false;

    const nextPrompt = (currentPrompt.slice(0, tokenStart) + currentPrompt.slice(tokenEnd)).replace(/\s{2,}/g, " ");
    onPromptChange(nextPrompt);
    window.setTimeout(() => {
      if (promptEditorRef.current) {
        setPromptEditorCaretOffset(promptEditorRef.current, nextCaret);
        promptInsertOffsetRef.current = nextCaret;
      }
    }, 0);
    return true;
  };

  const handlePromptBeforeInput = (event: FormEvent<HTMLDivElement>) => {
    const inputType = (event.nativeEvent as InputEvent).inputType;
    if (inputType !== "deleteContentBackward" && inputType !== "deleteContentForward") return;
    if (applyPromptDeletion(inputType === "deleteContentBackward" ? "backward" : "forward")) {
      event.preventDefault();
    }
  };

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (assetMention.open && event.key === "Escape") {
      event.preventDefault();
      setAssetMention(closedAssetMention);
      return;
    }

    // Handle Backspace/Delete to remove entire @imageN token
    if (event.key === "Backspace" || event.key === "Delete") {
      if (applyPromptDeletion(event.key === "Backspace" ? "backward" : "forward")) {
        event.preventDefault();
        return;
      }
    }

    onPromptKeyDown(event);
  };

  const handleReferenceMentionSelect = (index: number) => {
    const token = `@image${index + 1}`;
    const replaceStart = assetMention.open ? assetMention.start : promptInsertOffsetRef.current ?? prompt.length;
    const replaceEnd = assetMention.open ? assetMention.end : replaceStart;
    const nextPrompt = buildPromptWithReferenceToken({ value: prompt, start: replaceStart, end: replaceEnd, token });
    onPromptChange(nextPrompt.value);
    setAssetMention(closedAssetMention);
    setActiveReferenceIndex(index);
    window.setTimeout(() => {
      promptEditorRef.current?.focus();
      if (promptEditorRef.current) setPromptEditorCaretOffset(promptEditorRef.current, nextPrompt.caret);
      promptInsertOffsetRef.current = nextPrompt.caret;
    }, 0);
  };

  const handleToggleAsset = async (asset: FlowItem) => {
    const referenceUrl = await getAssetReferenceUrl(asset);
    if (!asset.url || !referenceUrl) return;
    const existingIndex = getAssetReferenceIndex(asset, referenceUrl);

    if (existingIndex >= 0) {
      setActiveReferenceIndex(existingIndex);
      setAssetPreviewUrl(referenceUrl);
      closeReferenceAssetPanel();
      return;
    }

    if (type === "video" && referenceImages.length >= videoReferenceCapability.max) return;

    onReferenceImagesChange((current) => {
      if (type !== "video") {
        const candidates = [asset.url, referenceUrl].filter((value, index, list): value is string => Boolean(value) && list.indexOf(value) === index);
        if (current.some((image) => candidates.includes(image))) return current;
        const next = [...current, referenceUrl];
        setActiveReferenceIndex(next.length - 1);
        return next;
      }
      if (visibleVideoReferenceSlots === 1) {
        const candidates = [asset.url, referenceUrl].filter((value, index, list): value is string => Boolean(value) && list.indexOf(value) === index);
        if (current.some((image) => candidates.includes(image))) return current;
        const next = [...current, referenceUrl].slice(0, videoReferenceCapability.max);
        setActiveReferenceIndex(next.length - 1);
        return next;
      }
      const next = current.slice(0, videoReferenceCapability.max);
      const slotIndex = Math.max(0, Math.min(videoReferenceTargetIndex, videoReferenceCapability.max - 1));
      next[slotIndex] = referenceUrl;
      setActiveReferenceIndex(slotIndex);
      return next.filter(Boolean);
    });
    if (type !== "video") {
      onExternalReferenceImagesChange((current) => {
        const candidates = [asset.url, referenceUrl].filter((value, index, list): value is string => Boolean(value) && list.indexOf(value) === index);
        if (current.some((image) => candidates.includes(image))) return current;
        return [...current, referenceUrl];
      });
    }
    onReferenceImageRolesChange?.((roles) => ({ ...roles, [referenceUrl]: roles[referenceUrl] ?? DEFAULT_REFERENCE_ROLE }));
    setAssetPreviewUrl(referenceUrl);
    void recommendReferenceRoles([referenceUrl]);
    closeReferenceAssetPanel();
  };

  const handleRemoveReference = (index: number) => {
    const imageToRemove = externalReferenceImages[index];
    if (!imageToRemove) return;

    // Remove from external references
    onExternalReferenceImagesChange((current) => current.filter((_, currentIndex) => currentIndex !== index));

    // Remove from all references
    onReferenceImagesChange((current) => {
      const updated = current.filter((img) => img !== imageToRemove);
      if (imageToRemove) {
        onReferenceImageRolesChange?.((roles) => {
          const updatedRoles = { ...roles };
          delete updatedRoles[imageToRemove];
          return updatedRoles;
        });
      }
      return updated;
    });
  };

  const handleReferenceRoleChange = (image: string, role: FlowReferenceRole) => {
    onReferenceImageRolesChange?.((current) => ({ ...current, [image]: role }));
  };

  const handleRemovePromptReference = (index: number) => {
    const tokenPattern = new RegExp(`@image${index + 1}(?!\\d)\\s?`, "gi");
    const nextPrompt = prompt.replace(tokenPattern, "").replace(/\s{2,}/g, " ");
    onPromptChange(nextPrompt);
  };

  const handlePromptEditorMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    const deleteTarget = (event.target as HTMLElement).closest("[data-ref-delete-index]") as HTMLElement | null;
    if (!deleteTarget) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const handlePromptEditorClick = (event: MouseEvent<HTMLDivElement>) => {
    const deleteTarget = (event.target as HTMLElement).closest("[data-ref-delete-index]") as HTMLElement | null;
    if (!deleteTarget) return;
    event.preventDefault();
    event.stopPropagation();
    const index = Number.parseInt(deleteTarget.dataset.refDeleteIndex ?? "", 10);
    if (Number.isInteger(index) && index >= 0) {
      handleRemovePromptReference(index);
    }
  };

  const handlePromptEditorMouseOver = (event: MouseEvent<HTMLDivElement>) => {
    const refTarget = (event.target as HTMLElement).closest("[data-ref-index]") as HTMLElement | null;
    if (!refTarget || !event.currentTarget.contains(refTarget)) return;
    const index = Number.parseInt(refTarget.dataset.refIndex ?? "", 10);
    if (Number.isInteger(index) && index >= 0) {
      openPromptReferencePreview(index, refTarget);
    }
  };

  const handlePromptEditorMouseOut = (event: MouseEvent<HTMLDivElement>) => {
    const refTarget = (event.target as HTMLElement).closest("[data-ref-index]") as HTMLElement | null;
    if (!refTarget) return;
    const relatedTarget = event.relatedTarget as Node | null;
    if (relatedTarget && refTarget.contains(relatedTarget)) return;
    closePromptReferencePreviewWithDelay();
  };

  const previewUrl = assetPreviewUrl ?? activeReferenceImage ?? filteredAssets[0]?.url ?? null;
  const koalaModelOptions = currentModelOptions.filter((option) => option.source !== "custom");
  const customModelOptions = currentModelOptions.filter((option) => option.source === "custom");
  const filteredStyles = useMemo(() => {
    if (styleCategoryId === "all") return stylePresets;
    if (styleCategoryId === "my") return stylePresets.filter((style) => style.source === "custom");
    return stylePresets.filter((style) => style.categoryIds.includes(styleCategoryId));
  }, [styleCategoryId, stylePresets]);

  useEffect(() => {
    if (openGeneratorPanel !== "styles") return;
    let cancelled = false;
    setStyleLoading(true);
    setStyleError("");
    fetchStyleLibrary()
      .then((library) => {
        if (cancelled) return;
        setStyleCategories(library.categories);
        setStylePresets(library.styles);
      })
      .catch((error) => {
        if (!cancelled) setStyleError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setStyleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [openGeneratorPanel]);

  useEffect(() => {
    let cancelled = false;
    fetchReferenceSettings().then((settings) => {
      if (!cancelled) setReferenceSettings(settings);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const recommendReferenceRoles = useCallback(async (images: string[]) => {
    if (type !== "image") return;
    const visionModelValue = referenceSettings?.visionModelValue;
    if (!visionModelValue || !images.length) return;
    const resolved = resolveReferenceVisionModel(visionModelValue, systemProviders, customProviders);
    if (!resolved?.provider.key || !resolved.provider.baseUrl) return;
    await Promise.all(images.map(async (image) => {
      try {
        const result = await classifyReferenceImage({
          imageUrl: image,
          modelId: resolved.modelId,
          provider: {
            id: resolved.provider.id,
            name: resolved.provider.name,
            baseUrl: resolved.provider.baseUrl,
            key: resolved.provider.key,
            logAccessToken: resolved.provider.logAccessToken,
          },
        });
        onReferenceImageRolesChange?.((current) => ({ ...current, [image]: result.role }));
      } catch {
        // Keep the manual default when automatic recommendation fails.
      }
    }));
  }, [customProviders, onReferenceImageRolesChange, referenceSettings?.visionModelValue, systemProviders, type]);

  useEffect(() => {
    if (type !== "image") return;
    if (!referenceSettings?.visionModelValue || !referenceImages.length) return;
    const missingRoleImages = referenceImages.filter((image) => {
      if (referenceImageRoles[image]) return false;
      if (recommendedReferenceImagesRef.current.has(image)) return false;
      return true;
    });
    if (!missingRoleImages.length) return;

    for (const image of missingRoleImages) {
      recommendedReferenceImagesRef.current.add(image);
    }
    void recommendReferenceRoles(missingRoleImages);
  }, [recommendReferenceRoles, referenceImageRoles, referenceImages, referenceSettings?.visionModelValue, type]);

  const handleStyleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setStyleLoading(true);
    setStyleError("");
    try {
      const imageUrl = await uploadStyleImage(file);
      const styleName = makeStyleNameFromDate();
      const style = await createCustomStylePreset({
        name: styleName,
        coverImageUrl: imageUrl,
        sampleImageUrls: [imageUrl],
        categoryIds: ["my"],
        prompt: "custom uploaded style reference",
        strength: 0.65,
      });
      setStylePresets((current) => [style, ...current.filter((item) => item.id !== style.id)]);
      setStyleCategoryId("my");
      onSelectedStyleChange?.({
        id: style.id,
        name: style.name,
        imageUrl: style.coverImageUrl,
        prompt: style.prompt,
        strength: style.strength,
        custom: true,
      });
    } catch (error) {
      setStyleError(error instanceof Error ? error.message : String(error));
    } finally {
      setStyleLoading(false);
    }
  };

  const handleRenameStyle = async (style: StylePreset) => {
    const nextName = window.prompt("修改风格名称", style.name)?.trim();
    if (!nextName || nextName === style.name) return;
    setStyleLoading(true);
    setStyleError("");
    try {
      const updated = await updateCustomStylePreset(style.id, { name: nextName });
      setStylePresets((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      if (selectedStyle?.id === updated.id) {
        onSelectedStyleChange?.({
          id: updated.id,
          name: updated.name,
          imageUrl: updated.coverImageUrl,
          prompt: updated.prompt,
          strength: updated.strength,
          custom: true,
        });
      }
    } catch (error) {
      setStyleError(error instanceof Error ? error.message : String(error));
    } finally {
      setStyleLoading(false);
    }
  };

  const handleDeleteStyle = async (style: StylePreset) => {
    if (style.source !== "custom") return;
    const confirmed = window.confirm(`删除自定义风格「${style.name}」？`);
    if (!confirmed) return;
    setStyleLoading(true);
    setStyleError("");
    try {
      await deleteCustomStylePreset(style.id);
      setStylePresets((current) => current.filter((item) => item.id !== style.id));
      if (selectedStyle?.id === style.id) {
        onSelectedStyleChange?.(null);
        setStyleTrayOpen(false);
      }
    } catch (error) {
      setStyleError(error instanceof Error ? error.message : String(error));
    } finally {
      setStyleLoading(false);
    }
  };

  return (
    <div
      ref={generatorRef}
      className={cn(
        "relative mx-auto w-full max-w-[860px] rounded-[22px] border border-white/[0.05] bg-[#181a20] shadow-[0_30px_80px_rgba(0,0,0,0.52)] md:rounded-[28px]",
        isHome && "max-w-none rounded-[30px] border-white/[0.08] bg-[#17191f] shadow-[0_22px_60px_rgba(0,0,0,0.32)]"
      )}
    >
      <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleReferenceChange} />
      <input ref={styleFileInputRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp" className="hidden" onChange={handleStyleUpload} />

      <div className={cn("px-3 pb-3 pt-3 sm:px-5 md:px-4 md:pb-4 md:pt-4", isHome && "px-4 pb-4 pt-4 sm:px-6 md:px-5 md:pb-5 md:pt-5")}>
        <div className="flex items-start gap-2 md:gap-3">
          {type === "image" ? (
            <div
              className="relative shrink-0"
              onMouseEnter={openStyleTray}
              onMouseLeave={closeStyleTrayWithDelay}
            >
              <button
                type="button"
                onClick={() => onOpenGeneratorPanelChange(openGeneratorPanel === "styles" ? null : "styles")}
                className={cn(
                  "group relative flex h-[76px] w-[58px] shrink-0 items-center justify-center overflow-hidden rounded-[14px] border border-dashed border-white/[0.12] bg-[#23262d] text-[#8791a4] transition hover:border-cyan-400/30 hover:bg-[#272b33] hover:text-white",
                  isHome && "h-[80px] w-[58px] rounded-[16px] bg-[#20242b]",
                  selectedStyle && "border-white/[0.08] border-solid bg-[#13161d] text-white"
                )}
                title="风格库"
              >
                {selectedStyle?.imageUrl ? (
                  <>
                    <img
                      src={getDisplayAssetUrl(selectedStyle.imageUrl)}
                      alt={selectedStyle.name}
                      className="absolute inset-x-1 top-1 h-[58px] rounded-[10px] object-cover transition duration-300 group-hover:scale-[1.03]"
                    />
                    <span className="absolute bottom-1 left-1 right-1 truncate text-center text-[10px] font-medium text-white">
                      {selectedStyle.name}
                    </span>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center">
                    <Palette className="h-5 w-5 text-white" />
                    <span className="mt-1 text-[10px]">风格</span>
                  </div>
                )}
              </button>

              {selectedStyle?.imageUrl ? (
                <div
                  className={cn(
                    "absolute left-[calc(100%+8px)] z-20 hidden transition duration-200 md:block",
                    isHome ? "top-0" : "bottom-0",
                    styleTrayOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
                  )}
                  onMouseEnter={openStyleTray}
                  onMouseLeave={closeStyleTrayWithDelay}
                >
                  <div className="group/thumb relative w-[250px] overflow-hidden rounded-[20px] border border-cyan-400/40 bg-[#111318] shadow-[0_18px_40px_rgba(0,0,0,0.4)]">
                    <div className="aspect-[9/16]">
                      <img src={getDisplayAssetUrl(selectedStyle.imageUrl)} alt={selectedStyle.name} className="h-full w-full object-cover" />
                    </div>
                    <div className="border-t border-white/[0.08] px-3 py-2 text-sm font-medium text-white">{selectedStyle.name}</div>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectedStyleChange?.(null);
                        setStyleTrayOpen(false);
                      }}
                      className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition group-hover/thumb:opacity-100"
                      title="移除风格"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {type === "video" ? (
            <div
              className="flex shrink-0 gap-2"
              onMouseLeave={closeReferenceTrayWithDelay}
            >
              {videoReferenceSlots.map((slot) => (
                <div
                  key={slot.index}
                  className="group/thumb relative"
                  onMouseEnter={
                    slot.image
                      ? () => {
                          setActiveVideoPreviewIndex(slot.index);
                          openReferenceTray();
                        }
                      : undefined
                  }
                >
                  <button
                    type="button"
                    onClick={() => {
                      setVideoReferenceTargetIndex(slot.index);
                      setAssetMention(closedAssetMention);
                      onOpenGeneratorPanelChange(openGeneratorPanel === "assets" ? null : "assets");
                    }}
                    className={cn(
                      "relative flex h-[76px] w-[58px] items-center justify-center overflow-hidden rounded-[14px] border border-dashed border-white/[0.12] bg-[#23262d] transition hover:border-cyan-400/30 hover:bg-[#272b33]",
                      isHome && "h-[80px] w-[58px] rounded-[16px] bg-[#20242b]",
                      slot.image && "border-white/[0.08] border-solid bg-[#13161d]"
                    )}
                    title={`上传${slot.label}`}
                  >
                    {slot.image ? (
                      <>
                        {visibleVideoReferenceSlots === 1 && referenceImages.length > 1 ? (
                          stackedReferenceImages.map((image, index) => {
                            const reverseIndex = stackedReferenceImages.length - index - 1;
                            const offsetX = reverseIndex * 4;
                            const offsetY = reverseIndex * 4;
                            const rotation = reverseIndex === 2 ? -10 : reverseIndex === 1 ? -4 : 3;
                            return (
                              <img
                                key={`${image}-${index}`}
                                src={getDisplayAssetUrl(image)}
                                alt={`参考图 ${index + 1}`}
                                className="absolute h-[56px] w-[40px] rounded-[10px] border border-white/10 object-cover shadow-[0_10px_24px_rgba(0,0,0,0.35)] transition duration-200"
                                style={{
                                  transform: `translate(${offsetX}px, ${offsetY}px) rotate(${rotation}deg)`,
                                  zIndex: index + 1,
                                }}
                              />
                            );
                          })
                        ) : (
                          <img src={getDisplayAssetUrl(slot.image)} alt={slot.label} className="absolute inset-0 h-full w-full object-cover" />
                        )}
                        <div className="pointer-events-none absolute bottom-1 left-1 right-1 truncate rounded-full bg-black/65 px-1.5 py-0.5 text-center text-[10px] text-white">
                          {visibleVideoReferenceSlots === 1 && referenceImages.length > 1 ? `${referenceImages.length}/${videoReferenceCapability.max}` : slot.label}
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center text-[#8791a4]">
                        <span className="text-[24px] leading-none text-white">+</span>
                        <span className="mt-1 text-[10px]">{slot.label}</span>
                      </div>
                    )}
                  </button>
                  {slot.image ? (
                    <div
                      className={cn(
                        "absolute left-0 z-20 hidden transition duration-200 md:block",
                        isHome ? "top-[calc(100%+10px)]" : "bottom-[calc(100%+10px)]",
                        referenceTrayOpen && activeVideoPreviewIndex === slot.index ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
                      )}
                      onMouseEnter={openReferenceTray}
                      onMouseLeave={closeReferenceTrayWithDelay}
                    >
                      {visibleVideoReferenceSlots === 1 ? (
                        <div className="flex gap-2">
                          {referenceImages.map((image, index) => (
                            <div
                              key={`${image}-${index}`}
                              className="group/video-ref relative h-[300px] w-[250px] overflow-hidden rounded-[20px] border border-cyan-400/40 bg-[#111318] shadow-[0_18px_40px_rgba(0,0,0,0.4)]"
                            >
                              <img src={getDisplayAssetUrl(image)} alt={`参考图 ${index + 1}`} className="h-full w-full object-cover" />
                              <div className="absolute left-2 top-2 rounded-full border border-white/10 bg-black/70 px-2.5 py-1.5 text-xs text-white">
                                参考图{index + 1}
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemoveVideoReferenceSlot(index)}
                                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition group-hover/video-ref:opacity-100"
                                title="移除参考图"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="relative h-[300px] w-[250px] overflow-hidden rounded-[20px] border border-cyan-400/40 bg-[#111318] shadow-[0_18px_40px_rgba(0,0,0,0.4)]">
                          <img src={getDisplayAssetUrl(slot.image)} alt={slot.label} className="h-full w-full object-cover" />
                          <div className="absolute left-2 top-2 rounded-full border border-white/10 bg-black/70 px-2.5 py-1.5 text-xs text-white">
                            {slot.label}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveVideoReferenceSlot(slot.index)}
                            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition group-hover/thumb:opacity-100"
                            title="移除参考图"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
          <div
            className="relative shrink-0"
            onMouseEnter={openReferenceTray}
            onMouseLeave={closeReferenceTrayWithDelay}
          >
            <button
              type="button"
              onClick={() => {
                setAssetMention(closedAssetMention);
                onOpenGeneratorPanelChange(openGeneratorPanel === "assets" ? null : "assets");
              }}
              className={cn(
                "relative flex h-[76px] w-[58px] items-center justify-center overflow-hidden rounded-[14px] border border-dashed border-white/[0.12] bg-[#23262d] transition hover:border-cyan-400/30 hover:bg-[#272b33]",
                isHome && "h-[80px] w-[58px] rounded-[16px] bg-[#20242b]",
                externalReferenceImages.length > 0 && "border-white/[0.08] border-solid bg-[#13161d]"
              )}
              title="上传参考图"
            >
              {externalReferenceImages.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-[#8791a4]">
                  <span className="text-[24px] leading-none text-white">+</span>
                  <span className="mt-1 text-[10px]">参考图</span>
                </div>
              ) : (
                <>
                  {stackedReferenceImages.map((image, index) => {
                    const reverseIndex = stackedReferenceImages.length - index - 1;
                    const offsetX = reverseIndex * 4;
                    const offsetY = reverseIndex * 4;
                    const rotation = reverseIndex === 2 ? -10 : reverseIndex === 1 ? -4 : 3;
                    return (
                      <img
                        key={`${image}-${index}`}
                        src={getDisplayAssetUrl(image)}
                        alt={`参考图 ${index + 1}`}
                        className="absolute h-[56px] w-[40px] rounded-[10px] border border-white/10 object-cover shadow-[0_10px_24px_rgba(0,0,0,0.35)] transition duration-200"
                        style={{
                          transform: `translate(${offsetX}px, ${offsetY}px) rotate(${rotation}deg)`,
                          zIndex: index + 1,
                        }}
                      />
                    );
                  })}
                  {externalReferenceImages.length > 1 ? (
                    <div className="pointer-events-none absolute bottom-1 right-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
                      {externalReferenceImages.length}
                    </div>
                  ) : externalReferenceImages[0] ? (
                    <div className="pointer-events-none absolute bottom-1 left-1 right-1 truncate rounded-full bg-black/65 px-1.5 py-0.5 text-center text-[10px] text-white">
                      {getReferenceRoleLabel(referenceImageRoles[externalReferenceImages[0]])}
                    </div>
                  ) : null}
                </>
              )}
            </button>

            {externalReferenceImages.length > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setAssetMention(closedAssetMention);
                    onOpenGeneratorPanelChange("assets");
                  }}
                  className="absolute -bottom-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-[#0f1116] text-sm text-white transition hover:border-cyan-400/30 hover:text-cyan-200"
                  title="继续添加参考图"
                >
                  +
                </button>

                <div
                  className={cn(
                    "absolute left-[calc(100%+8px)] z-20 hidden gap-2 transition duration-200 md:flex",
                    isHome ? "top-0" : "bottom-0",
                    referenceTrayOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
                  )}
                  onMouseEnter={openReferenceTray}
                  onMouseLeave={closeReferenceTrayWithDelay}
                >
                  {externalReferenceImages.map((image, index) => {
                    const selected = index === activeReferenceIndex;
                    const role = referenceImageRoles[image] ?? DEFAULT_REFERENCE_ROLE;
                    return (
                      <div
                        key={`${image}-${index}`}
                        className={cn(
                          "group/thumb relative h-[300px] w-[250px] overflow-hidden rounded-[20px] border bg-[#111318] shadow-[0_18px_40px_rgba(0,0,0,0.4)]",
                          selected ? "border-cyan-400/40" : "border-white/[0.08]"
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => setActiveReferenceIndex(index)}
                          className="h-full w-full"
                          title={`参考图 ${index + 1}`}
                        >
                          <img src={getDisplayAssetUrl(image)} alt={`参考图 ${index + 1}`} className="h-full w-full object-cover" />
                        </button>
                        <select
                          value={role}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => handleReferenceRoleChange(image, event.target.value as FlowReferenceRole)}
                          className="absolute left-2 top-2 h-8 rounded-full border border-white/10 bg-black/70 px-2 text-xs text-white outline-none"
                          title="选择参考类型"
                        >
                          {referenceRoleOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}参考
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => handleRemoveReference(index)}
                           className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition group-hover/thumb:opacity-100"
                          title="删除参考图"
                        >
                           <X className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}
          </div>
          )}

          <div className="relative min-w-0 flex-1 text-left">
            {uninsertedReferenceIndexes.length > 0 ? (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {uninsertedReferenceIndexes.map((index) => {
                  const image = referenceImages[index];
                  if (!image) return null;
                  return (
                    <div key={`${image}-${index}`} className="group/mention-token relative">
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => handleInsertPromptReference(index)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          handleInsertPromptReference(index);
                        }}
                        className="inline-flex h-7 max-w-[180px] cursor-text items-center gap-1.5 rounded-full border border-cyan-300/25 bg-cyan-300/10 pl-1 pr-7 text-xs text-cyan-50 transition hover:border-cyan-200/45 hover:bg-cyan-300/15"
                        title={`插入 @image${index + 1}`}
                      >
                        <img src={getDisplayAssetUrl(image)} alt={`@image${index + 1}`} className="h-5 w-5 shrink-0 rounded-full object-cover" />
                        <span>@image{index + 1}</span>
                      </div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          handleRemovePromptReference(index);
                        }}
                        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition group-hover/mention-token:opacity-100"
                        title="删除素材引用"
                      >
                        <X className="h-3 w-3" />
                      </button>
                      <div className="pointer-events-none absolute left-0 z-50 hidden w-[220px] rounded-xl border border-white/10 bg-[#101319] p-2 shadow-[0_20px_44px_rgba(0,0,0,0.55)] group-hover/mention-token:block [bottom:calc(100%+8px)]">
                        <img src={getDisplayAssetUrl(image)} alt={`@image${index + 1} 预览`} className="max-h-[260px] w-full rounded-lg object-contain" />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <div className="relative">
              {!prompt ? (
                <div
                  className={cn(
                    "pointer-events-none absolute left-0 top-0 text-left text-[15px] leading-6 text-[#5f6778] md:leading-7",
                    isHome && "text-[16px] leading-7 text-[#6d7688] md:leading-8"
                  )}
                >
                  {placeholderText}
                </div>
              ) : null}
              <div
                ref={promptEditorRef}
                contentEditable
                suppressContentEditableWarning
                onBeforeInput={handlePromptBeforeInput}
                onInput={handlePromptInput}
                onKeyDown={handlePromptKeyDown}
                onMouseDown={handlePromptEditorMouseDown}
                onClick={handlePromptEditorClick}
                onMouseOver={handlePromptEditorMouseOver}
                onMouseOut={handlePromptEditorMouseOut}
                onKeyUp={savePromptCaretOffset}
                onMouseUp={savePromptCaretOffset}
                onFocus={savePromptCaretOffset}
                className={cn(
                  "min-h-[64px] w-full overflow-visible whitespace-pre-wrap break-words border-0 bg-transparent px-0 py-0 text-left text-[15px] leading-6 text-white shadow-none outline-none ring-0 ring-offset-0 empty:before:content-[''] focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 md:min-h-[84px] md:leading-7",
                  isHome && "min-h-[72px] text-[16px] leading-7 md:min-h-[92px] md:leading-8"
                )}
              />
              {assetMention.open ? (
                <div className="absolute left-0 top-full z-40 mt-2 w-[260px] overflow-hidden rounded-xl border border-white/8 bg-[#1b1e25] p-1.5 shadow-[0_18px_42px_rgba(0,0,0,0.45)]">
                  {referenceMentionOptions.length ? (
                    referenceMentionOptions.map((item) => (
                      <button
                        key={`${item.image}-${item.index}`}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleReferenceMentionSelect(item.index)}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[#d5d9e2] transition hover:bg-white/[0.06] hover:text-white"
                      >
                        <img src={getDisplayAssetUrl(item.image)} alt={`@${item.label}`} className="h-8 w-8 shrink-0 rounded-md object-cover" />
                        <span className="text-sm">@{item.label}</span>
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-xs text-[#7a8295]">没有已上传参考图</div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "flex flex-nowrap items-center gap-1.5 overflow-x-auto overscroll-x-contain border-t border-white/[0.045] px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2.5 [scrollbar-width:none] sm:px-5 md:flex-wrap md:overflow-visible md:px-4 md:pb-4 md:pt-3 [&::-webkit-scrollbar]:hidden",
          isHome && "border-white/[0.06] px-5 pb-5 pt-4 sm:px-6"
        )}
      >
        {!hideTypeSelector ? (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => onOpenGeneratorPanelChange(openGeneratorPanel === "type" ? null : "type")}
              className={cn(
                "inline-flex h-[38px] min-w-max shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] border border-white/8 bg-[#2a2d35] px-3 text-[14px] font-medium text-white transition hover:border-white/14",
                isHome && "h-10 rounded-[14px] bg-[#22262f]"
              )}
            >
              <ActiveTypeIcon className="h-4 w-4 text-white/80" />
              <span>{activeCreativeType.label}</span>
              <ChevronDown className={cn("h-3.5 w-3.5 text-[#687183] transition", openGeneratorPanel === "type" && "rotate-180")} />
            </button>

            {openGeneratorPanel === "type" && !hideTypeSelector ? (
              <div className={cn("fixed inset-x-3 bottom-[calc(116px+env(safe-area-inset-bottom))] z-30 w-auto rounded-2xl border border-white/8 bg-[#1b1e25] p-2 shadow-[0_24px_50px_rgba(0,0,0,0.45)] md:absolute md:inset-x-auto md:left-0 md:w-[198px]", isHome ? "md:top-[calc(100%+10px)] md:bottom-auto" : "md:bottom-[calc(100%+10px)]")}>
                <div className="px-2 pb-2 pt-1 text-xs text-[#687183]">创作类型</div>
                <div className="space-y-1">
                  {creativeTypes.map((option) => {
                    const Icon = option.icon;
                    const selected = option.value === type;
                    
                    return (
                      <button
                        key={option.value}
                        type="button"
                        disabled={option.disabled}
                        onClick={() => {
                          if (option.disabled) return;
                          onTypeChange(option.value);
                          onOpenGeneratorPanelChange(null);
                        }}
                        className={cn(
                          "flex h-9 w-full items-center gap-2 rounded-xl px-3 text-left text-sm transition",
                          option.disabled
                            ? "cursor-not-allowed text-[#555d6c]"
                            : selected
                              ? "bg-[#2d313b] text-white"
                              : "text-[#e4e9f1] hover:bg-[#262a33]"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="flex-1">{option.label}</span>
                        {selected ? <Check className="h-4 w-4 text-white" /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => onOpenGeneratorPanelChange(openGeneratorPanel === "model" ? null : "model")}
            className={cn(
              "inline-flex h-[38px] min-w-max shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[10px] border border-white/8 bg-[#1f2229] px-3 text-[14px] font-medium text-white transition hover:border-white/14 md:max-w-[220px]",
              isHome && "h-10 rounded-[14px] bg-[#1f232b]"
            )}
          >
            {selectedModelOption?.imageUrl ? (
              <img src={selectedModelOption.imageUrl} alt={selectedModelOption.label} className="h-5 w-5 rounded-md object-contain" />
            ) : (
              <Wand2 className="h-4 w-4 text-white/80" />
            )}
            <span className="whitespace-nowrap md:truncate">{selectedModelOption?.label ?? "选择模型"}</span>
            {estimatedCredits !== undefined && estimatedCredits > 0 ? <span className="shrink-0 text-[11px] text-cyan-300">{estimatedCredits}</span> : null}
          </button>

          {openGeneratorPanel === "model" ? (
            <div
              className={cn(
                "fixed inset-x-3 bottom-[calc(116px+env(safe-area-inset-bottom))] z-30 max-h-[62dvh] w-auto overflow-hidden rounded-[16px] bg-[#1C1C1E] shadow-[0_24px_50px_rgba(0,0,0,0.45)] md:absolute md:inset-x-auto md:bottom-auto md:left-0 md:max-h-none md:w-[800px] md:rounded-[10px]",
                isHome ? "md:top-[calc(100%+10px)]" : "md:bottom-[calc(100%+10px)]"
              )}
            >
              <div className="relative flex max-h-[78dvh] flex-col rounded-[10px] pb-3 md:max-h-none md:pb-6">
                <div className="sticky top-0 z-10 p-3 text-[16px] font-[500] text-[#ffffff80] md:p-6 md:text-[18px]">选择模型</div>
                <div className="h-[54dvh] overflow-y-auto md:h-[470px]">
                  <div className="grid grid-cols-1 gap-3 px-3 md:grid-cols-2 md:gap-4 md:px-6">
                    {[
                      { title: "考拉AI模型", options: koalaModelOptions },
                      { title: "自定义模型", options: customModelOptions },
                    ].map((group) => (
                      <div key={group.title} className="col-span-full">
                        <div className="mb-3 mt-1 text-xs font-medium uppercase tracking-[0.18em] text-[#7d8596]">{group.title}</div>
                        {group.options.length ? (
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
                            {group.options.map((option) => {
                      const selected = option.value === model;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => {
                            onModelChange(option.value);
                            onOpenGeneratorPanelChange(null);
                          }}
                          className={cn(
                            "group grid min-h-[102px] grid-cols-[64px_minmax(0,1fr)] gap-3 rounded-[12px] border border-[rgba(255,255,255,0.08)] px-[10px] py-3 text-left transition-all",
                            selected
                              ? "border-sky-300/35 bg-sky-300/16 shadow-[0_0_0_1px_rgba(125,211,252,0.12)]"
                              : "hover:bg-[rgba(255,255,255,0.05)] active:border-[#217EFD]"
                          )}
                        >
                          <div className="flex h-full min-h-[64px] w-[64px] shrink-0 items-center justify-center overflow-hidden rounded-[16px]">
                            {option.imageUrl ? (
                              <img
                                src={option.imageUrl}
                                alt={option.label}
                                className={cn("h-11 w-11 rounded-[12px] object-contain transition-all duration-300", selected ? "scale-[1.08]" : "group-hover:scale-[1.08]")}
                              />
                            ) : (
                              <Wand2 className="h-7 w-7 text-white/70" />
                            )}
                          </div>
                          <div className="flex min-w-0 flex-1 flex-col items-start gap-[6px]">
                            <div className="flex w-full min-w-0 items-center gap-2">
                              <div className="truncate text-[16px] font-[500] text-[#fff]">{option.label}</div>
                              <div className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-[500]", option.source === "custom" ? "bg-violet-400/10 text-violet-200" : "bg-cyan-400/10 text-cyan-200")}>
                                {option.source === "custom" ? "自定义" : "考拉AI"}
                              </div>
                            </div>
                            <div className="flex w-full min-w-0 flex-wrap items-center gap-[6px]">
                              <div className="truncate text-[12px] text-[#99A0AE]">{option.providerName}</div>
                              {option.labels?.map((label) => (
                                <div key={label} className="whitespace-nowrap rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-[500] text-white/70 group-hover:bg-white/20 group-hover:text-white">
                                  {label}
                                </div>
                              ))}
                            </div>
                            {option.description ? <div className="line-clamp-2 w-full text-[12px] leading-5 text-[#b2bac8]">{option.description}</div> : null}
                          </div>
                        </button>
                      );
                            })}
                          </div>
                        ) : (
                          <div className="rounded-xl border border-dashed border-white/[0.08] px-3 py-4 text-sm text-[#687183]">
                            {group.title === "自定义模型" ? "还没有自定义模型，可到设置中添加。" : "当前类型暂无可用模型。"}
                          </div>
                        )}
                      </div>
                    ))}
                    {currentModelOptions.length === 0 ? (
                      <div className="col-span-full px-3 py-6 text-center text-xs text-[#687183]">当前类型暂无可用模型</div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => onOpenGeneratorPanelChange(openGeneratorPanel === "count" ? null : "count")}
            className={cn(
              "inline-flex h-[38px] min-w-max shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] border border-white/8 bg-[#2a2d35] px-3 text-[14px] font-medium text-white transition hover:border-white/14",
              isHome && "h-10 rounded-[14px] bg-[#22262f]"
            )}
            title="生成数量"
          >
            <span className="text-white/60">数量</span>
            <span>{generationCount}</span>
          </button>

          {openGeneratorPanel === "count" ? (
            <div
              className={cn(
                "fixed inset-x-3 bottom-[calc(116px+env(safe-area-inset-bottom))] z-30 w-auto rounded-2xl border border-white/8 bg-[#1b1e25] p-3 shadow-[0_24px_50px_rgba(0,0,0,0.45)] md:absolute md:inset-x-auto md:left-0 md:w-[220px]",
                isHome ? "md:top-[calc(100%+12px)] md:bottom-auto" : "md:bottom-[calc(100%+12px)]"
              )}
            >
              <div className="mb-3 text-sm text-[#7d8596]">生成数量</div>
              <div className="grid grid-cols-4 gap-2 rounded-2xl bg-[#262a33] p-2">
                {generationCountOptions.map((option) => {
                  const selected = option === generationCount;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => {
                        onGenerationCountChange(option);
                        onOpenGeneratorPanelChange(null);
                      }}
                      className={cn(
                        "h-9 rounded-xl text-sm transition",
                        selected ? "bg-white text-[#111318]" : "text-white/75 hover:bg-white/10 hover:text-white"
                      )}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => onOpenGeneratorPanelChange(openGeneratorPanel === "ratio" ? null : "ratio")}
            className={cn(
              "inline-flex h-[38px] min-w-max shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] border border-white/8 bg-[#2a2d35] px-3 text-[14px] font-medium text-white transition hover:border-white/14",
              isHome && "h-10 rounded-[14px] bg-[#22262f]"
            )}
          >
            <span
              className={cn(
                "rounded-[3px] border border-white/90 bg-white/5",
                getRatioPreviewClass(selectedRatioOption?.value ?? aspectRatio)
              )}
            />
            <span>{selectedRatioOption?.label ?? aspectRatio}</span>
            {type === "image" ? <span className="text-white/50">· {selectedResolutionChoice.label}</span> : null}
            {type === "video" ? <span className="text-white/50">· {selectedDurationOption?.label ?? duration} · {selectedVideoResolutionChoice.label}</span> : null}
          </button>

          {openGeneratorPanel === "ratio" ? (
            <div
              className={cn(
                "fixed inset-x-3 bottom-[calc(116px+env(safe-area-inset-bottom))] z-30 w-auto max-h-[62dvh] overflow-y-auto rounded-3xl border border-white/8 bg-[#1b1e25] p-4 shadow-[0_28px_60px_rgba(0,0,0,0.5)] md:absolute md:inset-x-auto md:left-0 md:w-[min(100vw-32px,434px)] md:max-h-none md:overflow-visible",
                isHome ? "md:top-[calc(100%+18px)] md:bottom-auto" : "md:bottom-[calc(100%+18px)]"
              )}
            >
              <div className="space-y-6">
                <div>
                  <div className="mb-3 text-sm text-[#7d8596]">选择比例</div>
                  <div className="grid grid-cols-3 gap-2 rounded-2xl bg-[#262a33] p-2 sm:grid-cols-4">
                    {ratioOptions.map((option) => {
                      const selected = option.value === aspectRatio;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => onAspectRatioChange(option.value)}
                          className={cn(
                            "flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm transition",
                            selected ? "bg-white text-[#111318]" : "text-white/75 hover:bg-white/10 hover:text-white"
                          )}
                        >
                          {option.previewKind === "badge" ? (
                            <span
                              className={cn(
                                "inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-gradient-to-br px-1 text-[10px] font-semibold text-white",
                                option.previewClassName ?? "from-cyan-500 to-blue-600"
                              )}
                            >
                              {option.previewLabel ?? option.label}
                            </span>
                          ) : option.previewKind === "ratio" ? (
                            <span
                              className={cn(
                                "rounded-[3px] border transition",
                                selected ? "border-[#111318]/80 bg-[#111318]/10" : "border-white/80 bg-white/5",
                                getRatioPreviewClass(option.value)
                              )}
                            />
                          ) : null}
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {type === "image" ? (
                  <div>
                    <div className="mb-3 text-sm text-[#7d8596]">输出清晰度</div>
                    <div className="grid grid-cols-3 gap-2 rounded-2xl bg-[#262a33] p-2">
                      {imageResolutionChoices.map((option) => {
                        const selected = option.value === resolution;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => onResolutionChange(option.value)}
                            className={cn(
                              "rounded-xl px-3 py-2 text-sm transition",
                              selected ? "bg-white text-[#111318]" : "text-white/75 hover:bg-white/10 hover:text-white"
                            )}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {type === "video" ? (
                  <div>
                    <div className="mb-3 text-sm text-[#7d8596]">视频时长</div>
                    {useDurationSlider ? (
                      <div className="rounded-2xl bg-[#262a33] px-4 py-3">
                        <div className="mb-2 flex items-center justify-between text-sm">
                          <span className="text-white/75">{minDurationSeconds}s</span>
                          <span className="font-semibold text-white">{durationSeconds}s</span>
                          <span className="text-white/75">{maxDurationSeconds}s</span>
                        </div>
                        <input
                          type="range"
                          min={minDurationSeconds}
                          max={maxDurationSeconds}
                          step={1}
                          value={durationSeconds}
                          onChange={(event) => onDurationChange(`${event.currentTarget.value}s`)}
                          className="h-2 w-full accent-cyan-400"
                        />
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2 rounded-2xl bg-[#262a33] p-2">
                        {durationOptions.map((option) => {
                          const selected = option.value === duration;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => onDurationChange(option.value)}
                              className={cn(
                                "rounded-xl px-3 py-2 text-sm transition",
                                selected ? "bg-white text-[#111318]" : "text-white/75 hover:bg-white/10 hover:text-white"
                              )}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : null}

                {type === "video" ? (
                  <div>
                    <div className="mb-3 text-sm text-[#7d8596]">视频清晰度</div>
                    <div className="grid grid-cols-2 gap-2 rounded-2xl bg-[#262a33] p-2">
                      {videoResolutionChoices.map((option) => {
                        const selected = option.value === resolution;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => onResolutionChange(option.value)}
                            className={cn(
                              "rounded-xl px-3 py-2 text-sm transition",
                              selected ? "bg-white text-[#111318]" : "text-white/75 hover:bg-white/10 hover:text-white"
                            )}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-xs text-[#7d8596]">
                  当前尺寸预估: {imageDimensions.width} x {imageDimensions.height}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="static shrink-0">
          {openGeneratorPanel === "assets" ? (
            <div
              className={cn(
                "fixed inset-x-3 bottom-[calc(116px+env(safe-area-inset-bottom))] z-40 flex max-h-[62dvh] w-auto flex-col overflow-hidden rounded-2xl border border-white/8 bg-[#1b1e25] shadow-[0_28px_60px_rgba(0,0,0,0.55)] md:absolute md:inset-x-auto md:left-1/2 md:max-h-none md:w-[960px] md:max-w-[calc(100vw-32px)] md:-translate-x-1/2 md:flex-row",
                isHome ? "md:top-[calc(100%+10px)] md:bottom-auto" : "md:bottom-[calc(100%+10px)]"
              )}
            >
              <div className="flex min-h-0 w-full shrink flex-col md:w-[480px] md:shrink-0">
                <div className="grid grid-cols-2 gap-2 border-b border-white/[0.06] px-3 py-2 md:flex md:items-center">
                  <select
                    value={assetProjectId}
                    onChange={(event) => setAssetProjectId(event.target.value as typeof assetProjectId)}
                    className="h-8 rounded-md bg-[#262a33] px-2 text-xs text-white outline-none"
                  >
                    <option value="all">全部项目</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>

                  <div className="relative col-span-2 flex-1 md:col-span-1">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#7a8295]" />
                    <input
                      value={assetSearch}
                      onChange={(event) => setAssetSearch(event.target.value)}
                      placeholder="搜索素材"
                      className="h-8 w-full rounded-md bg-[#262a33] pl-7 pr-2 text-xs text-white outline-none placeholder:text-[#6b7384]"
                    />
                  </div>

                  <select
                    value={assetSort}
                    onChange={(event) => setAssetSort(event.target.value as typeof assetSort)}
                    className="h-8 rounded-md bg-[#262a33] px-2 text-xs text-white outline-none"
                  >
                    <option value="newest">最新</option>
                    <option value="oldest">最早</option>
                  </select>
                </div>

                <div className="min-h-[220px] flex-1 overflow-y-auto px-2 py-2 md:max-h-[480px] md:min-h-[330px]">
                  {filteredAssets.length === 0 ? (
                    <div className="flex h-full items-center justify-center py-8 text-xs text-[#7a8295]">
                      当前筛选下还没有可用素材
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {filteredAssets.map((asset) => {
                        const resolvedReferenceUrl = resolvedAssetReferenceUrls[asset.id];
                        const selected =
                          (!!asset.url && visibleReferenceImages.includes(asset.url)) ||
                          (!!resolvedReferenceUrl && visibleReferenceImages.includes(resolvedReferenceUrl));
                        return (
                          <button
                            key={asset.id}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => void handleToggleAsset(asset)}
                            onMouseEnter={() => {
                              setAssetPreviewUrl(resolvedReferenceUrl ?? asset.url ?? null);
                              if (asset.savedFileName) {
                                void getAssetReferenceUrl(asset).then((url) => {
                                  if (url) setAssetPreviewUrl(url);
                                });
                              }
                            }}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition",
                              selected ? "bg-cyan-400/10 text-white" : "text-[#d5d9e2] hover:bg-white/[0.05]"
                            )}
                          >
                            <LocalAssetImage
                              itemId={asset.id}
                              src={asset.url}
                              alt={asset.prompt || "asset"}
                              className="h-10 w-10 shrink-0 rounded-md object-cover"
                            />
                            <span className="line-clamp-1 flex-1 text-xs">{asset.prompt || "未命名素材"}</span>
                            {selected ? <Check className="h-4 w-4 shrink-0 text-cyan-200" /> : null}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    fileInputRef.current?.click();
                  }}
                  className="flex items-center gap-2 border-t border-white/[0.06] px-3 py-3 text-left text-sm text-[#d5d9e2] transition hover:bg-white/[0.04] hover:text-white"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#262a33]">
                    <Upload className="h-4 w-4" />
                  </div>
                  <span>上传图片</span>
                </button>
              </div>

              <div className="hidden min-h-[390px] flex-1 flex-col border-l border-white/[0.06] bg-[#14171d] p-4 md:flex">
                  <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-sm text-white">预览</div>
                  <div className="text-xs text-[#7a8295]">已选 {visibleReferenceImages.length} 张</div>
                </div>
                <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl bg-black/20 p-3">
                  {previewUrl ? (
                    <img src={getDisplayAssetUrl(previewUrl)} alt="预览" className="max-h-[420px] max-w-full rounded-lg object-contain" />
                  ) : (
                    <div className="text-xs text-[#6b7384]">选择左侧素材后会在这里预览</div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {type === "image" ? (
            <div className="static shrink-0">
            <button
              type="button"
              onClick={() => onOpenGeneratorPanelChange(openGeneratorPanel === "styles" ? null : "styles")}
              className={cn(
                "hidden h-[38px] min-w-max shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] border border-white/8 px-3 text-[14px] font-medium transition hover:border-white/14",
                selectedStyle ? "bg-cyan-400/12 text-cyan-100" : "bg-[#2a2d35] text-[#cfd6e2] hover:text-white",
                isHome && "h-10 rounded-[14px] bg-[#22262f]"
              )}
              title="风格库"
            >
              <Palette className="h-4 w-4" />
              <span className="hidden sm:inline">{selectedStyle?.name ?? "风格库"}</span>
            </button>

            {openGeneratorPanel === "styles" ? (
              <div className="fixed inset-0 z-[999] bg-black/70 p-3 backdrop-blur-sm md:px-5 md:py-10" onMouseDown={() => onOpenGeneratorPanelChange(null)}>
                <div
                  className="mx-auto flex h-full max-h-[900px] w-full max-w-[1440px] flex-col overflow-hidden rounded-[18px] bg-[#232425] shadow-[0_30px_100px_rgba(0,0,0,0.65)]"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <div className="flex items-center justify-between px-4 py-4 md:px-6 md:py-5">
                    <h3 className="text-lg font-semibold text-white md:text-xl">风格库</h3>
                    <button
                      type="button"
                      onClick={() => onOpenGeneratorPanelChange(null)}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-white/8 text-white transition hover:bg-white/14"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="border-b border-white/[0.06] px-4 pb-3 md:px-6 md:pb-4">
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {styleCategories.map((category) => {
                        const active = category.id === styleCategoryId;
                        return (
                          <button
                            key={category.id}
                            type="button"
                            onClick={() => setStyleCategoryId(category.id)}
                            className={cn(
                              "shrink-0 rounded-full px-4 py-2 text-sm transition",
                              active ? "bg-white text-[#15171b]" : "bg-white/[0.06] text-[#cfd6e2] hover:bg-white/[0.10] hover:text-white"
                            )}
                          >
                            {category.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-5">
                    {styleError ? (
                      <div className="mb-4 rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">{styleError}</div>
                    ) : null}

                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6">
                      <button
                        type="button"
                        onClick={() => styleFileInputRef.current?.click()}
                        className="flex aspect-[9/16] min-h-[180px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.12] bg-[#2b2d30] text-[#929aa8] transition hover:border-cyan-300/35 hover:bg-[#303339] hover:text-white md:min-h-[220px]"
                      >
                        {styleLoading ? <Loader2 className="h-9 w-9 animate-spin" /> : <Upload className="h-9 w-9" />}
                        <span className="mt-3 text-sm">上传风格图片</span>
                      </button>

                      {filteredStyles.map((style) => {
                        const selected = selectedStyle?.id === style.id;
                        const samples = style.sampleImageUrls.slice(0, 3);
                        return (
                          <button
                            key={style.id}
                            type="button"
                            onClick={() => {
                              onSelectedStyleChange?.({
                                id: style.id,
                                name: style.name,
                                imageUrl: style.coverImageUrl,
                                prompt: style.prompt,
                                strength: style.strength,
                                custom: style.source === "custom",
                              });
                              onOpenGeneratorPanelChange(null);
                            }}
                            className={cn(
                              "group overflow-hidden rounded-2xl border bg-[#15171b] text-left shadow-[0_18px_42px_rgba(0,0,0,0.32)] transition",
                              selected ? "border-cyan-300/70 shadow-[0_0_0_1px_rgba(103,232,249,0.22)]" : "border-white/[0.08] hover:border-white/[0.18]"
                            )}
                          >
                            <div className="relative aspect-[9/16] overflow-hidden bg-[#111318]">
                              {style.isNew ? (
                                <span className="absolute left-2 top-2 z-10 rounded-full bg-cyan-300 px-3 py-1 text-xs font-semibold text-black">New</span>
                              ) : null}
                              {style.source === "custom" ? (
                                <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition group-hover:opacity-100">
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleRenameStyle(style);
                                    }}
                                    onKeyDown={(event) => {
                                      if (event.key !== "Enter" && event.key !== " ") return;
                                      event.preventDefault();
                                      event.stopPropagation();
                                      void handleRenameStyle(style);
                                    }}
                                    className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
                                    title="修改风格名称"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </span>
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleDeleteStyle(style);
                                    }}
                                    onKeyDown={(event) => {
                                      if (event.key !== "Enter" && event.key !== " ") return;
                                      event.preventDefault();
                                      event.stopPropagation();
                                      void handleDeleteStyle(style);
                                    }}
                                    className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-red-100 transition hover:bg-red-500/80 hover:text-white"
                                    title="删除自定义风格"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </span>
                                </div>
                              ) : null}
                              <img src={getDisplayAssetUrl(style.coverImageUrl)} alt={style.name} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
                              {samples.length ? (
                                <div className="absolute bottom-3 right-3 flex shrink-0 -space-x-2">
                                  {samples.map((sample, index) => (
                                    <img key={`${style.id}-${index}`} src={getDisplayAssetUrl(sample)} alt="" className="h-8 w-8 rounded-lg border border-white/20 object-cover shadow-lg" />
                                  ))}
                                </div>
                              ) : null}
                            </div>
                            <div className="px-3 py-2">
                              <div className="truncate text-sm font-semibold text-white">{style.name}</div>
                              {selected ? <div className="mt-0.5 text-xs text-cyan-200">已选择</div> : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Agent Mode Button */}
        <button
          type="button"
          onClick={() => {
            if (isSidebarOpen) {
              closeSidebar();
              return;
            }
            const agentCategory = type === "image" ? "prompt-optimization" : "storyboard";
            const targetAgent = agents.find(a => a.category === agentCategory && a.isActive);
            openSidebar(targetAgent?.id);
          }}
          className={cn(
            "flex h-[38px] min-w-max shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] border border-white/8 bg-[#2a2d35] px-3 text-[14px] font-medium text-[#cfd6e2] transition hover:border-white/14 hover:text-white",
            isHome && "h-10 rounded-[14px] bg-[#22262f]"
          )}
          title="提示词 Agent"
        >
          <Wand2 className="h-4 w-4" />
          <span>提示词 Agent</span>
        </button>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {estimatedCredits !== undefined && estimatedCredits > 0 ? (
            <div className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1 text-[11px] font-medium text-cyan-100 md:px-3 md:py-1.5 md:text-xs">
              {estimatedCredits} 积分
            </div>
          ) : null}
          <button
            type="button"
            onClick={onGenerate}
            disabled={!canGenerate || isGenerating}
            className={cn(
              "flex h-[42px] w-[42px] items-center justify-center rounded-full border-0 bg-[#343944] text-[#7d8596] shadow-none transition hover:bg-[#404653] hover:text-white active:scale-95",
              isHome && "h-11 w-11 bg-[#262d39] hover:bg-[#2e3644]",
              canGenerate && !isGenerating && "text-[#cfd6e2]",
              isHome && canGenerate && !isGenerating && "bg-[#10c8ff] text-[#071018] hover:bg-[#41d6ff]"
            )}
            title="开始生成"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>

      {promptReferencePreview ? (
        <div
          className="fixed z-[120] w-[260px] -translate-y-full rounded-xl border border-white/10 bg-[#101319] p-2 shadow-[0_20px_44px_rgba(0,0,0,0.55)]"
          style={{
            left: Math.max(12, Math.min(promptReferencePreview.left, Math.max(12, window.innerWidth - 272))),
            top: promptReferencePreview.top,
          }}
          onMouseEnter={() => {
            if (promptReferencePreviewCloseTimeoutRef.current !== null) {
              window.clearTimeout(promptReferencePreviewCloseTimeoutRef.current);
              promptReferencePreviewCloseTimeoutRef.current = null;
            }
          }}
          onMouseLeave={closePromptReferencePreviewWithDelay}
        >
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              handleRemovePromptReference(promptReferencePreview.index);
              setPromptReferencePreview(null);
            }}
            className="absolute right-3 top-3 z-[121] flex h-7 w-7 items-center justify-center rounded-full bg-black/75 text-white shadow-lg transition hover:bg-red-500"
            title="删除引用"
          >
            <X className="h-4 w-4" />
          </button>
          <img
            src={getDisplayAssetUrl(promptReferencePreview.image)}
            alt={`@image${promptReferencePreview.index + 1} 预览`}
            className="max-h-[300px] w-full rounded-lg object-contain"
          />
        </div>
      ) : null}
    </div>
  );
}
