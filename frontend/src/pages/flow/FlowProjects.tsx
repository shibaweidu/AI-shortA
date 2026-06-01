import { useEffect, useMemo, useRef, useState } from "react";
import { FolderPlus, Image as ImageIcon, Plus, Trash2, Video, Edit2, Check, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { LocalAssetImage } from "../../components/LocalAssetImage";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { buildModelCatalogOptions, getPreferredModelValue } from "../../lib/modelCatalog";
import {
  IMAGE_RATIO_OPTIONS,
  VIDEO_RATIO_OPTIONS,
  buildGeneratorModelOptions,
  getImageSizeFromPreset,
  getVideoDurationOptionsForModel,
} from "../../lib/generatorOptions";
import { cn } from "../../lib/utils";
import { generateImageAsset, generateVideoAsset } from "../../services/media";
import { FlowGeneratorBar, type SelectedStyleReference } from "./FlowGeneratorBar";
import { useFlowUiStore } from "../../store/flowUiStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useUserModelStore } from "../../store/userModelStore";
import { useFlowStore, type FlowItemType, type FlowReferenceRole } from "../../store/flowStore";
import { useCreditStore } from "../../store/creditStore";
import { useAuthStore } from "../../store/authStore";
import { getModelCreditCost, useModelCreditStore } from "../../store/modelCreditStore";

function padNumber(value: number) {
  return value.toString().padStart(2, "0");
}

function createAutoProjectName(date = new Date()) {
  const year = date.getFullYear();
  const month = padNumber(date.getMonth() + 1);
  const day = padNumber(date.getDate());
  const hours = padNumber(date.getHours());
  const minutes = padNumber(date.getMinutes());
  const seconds = padNumber(date.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function isRenderableAssetUrl(url?: string) {
  if (!url) return false;
  return url.startsWith("/uploads/") || /^https?:\/\//i.test(url) || /^data:(?:image|video)\//i.test(url) || /^blob:/i.test(url);
}

export default function FlowProjects() {
  const navigate = useNavigate();
  const { projects, items, addProject, addItem, updateItem, removeProject, updateProject, hasHydrated } = useFlowStore();
  const { spendCredits, refundCredits } = useCreditStore();
  const { currentUserId, hasHydrated: authHydrated } = useAuthStore();
  const { rules: modelCreditRules } = useModelCreditStore();
  const { providers, routing } = useSettingsStore();
  const { providers: userProviders, routing: userRouting } = useUserModelStore();
  const { selectedModels, setSelectedModel } = useFlowUiStore();
  const [draftName, setDraftName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [prompt, setPrompt] = useState("");
  const [type, setType] = useState<FlowItemType>("image");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [resolution, setResolution] = useState("2k");
  const [duration, setDuration] = useState("10s");
  const [generationCount, setGenerationCount] = useState(1);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [referenceImageRoles, setReferenceImageRoles] = useState<Record<string, FlowReferenceRole>>({});
  const [openGeneratorPanel, setOpenGeneratorPanel] = useState<"type" | "model" | "ratio" | "count" | "assets" | "styles" | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<SelectedStyleReference | null>(null);

  const generatorRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const imageModelOptions = useMemo(
    () => [
      ...buildGeneratorModelOptions(buildModelCatalogOptions(providers, routing, "image", "koala")),
      ...buildGeneratorModelOptions(buildModelCatalogOptions(userProviders, userRouting, "image", "custom")),
    ],
    [providers, routing, userProviders, userRouting]
  );
  const videoModelOptions = useMemo(
    () => [
      ...buildGeneratorModelOptions(buildModelCatalogOptions(providers, routing, "video", "koala")),
      ...buildGeneratorModelOptions(buildModelCatalogOptions(userProviders, userRouting, "video", "custom")),
    ],
    [providers, routing, userProviders, userRouting]
  );
  const model = selectedModels[type];
  const currentModelOptions = type === "image" ? imageModelOptions : videoModelOptions;
  const ratioOptions = type === "image" ? IMAGE_RATIO_OPTIONS : VIDEO_RATIO_OPTIONS;
  const ratioValues = ratioOptions.map((option) => option.value);
  const selectedModelOption = currentModelOptions.find((option) => option.value === model);
  const durationOptions = useMemo(
    () => getVideoDurationOptionsForModel(model, selectedModelOption?.label, selectedModelOption?.providerName),
    [model, selectedModelOption?.label, selectedModelOption?.providerName]
  );
  const isCustomModel = selectedModelOption?.source === "custom";
  const estimatedCreditsPerItem = model
    ? getModelCreditCost({
        rules: modelCreditRules,
        modelValue: model,
        type,
        resolution: type === "image" ? resolution : undefined,
        duration: type === "video" ? duration : undefined,
        fallbackCredits: selectedModelOption?.credits,
      })
    : undefined;
  const estimatedCredits = estimatedCreditsPerItem !== undefined ? estimatedCreditsPerItem * generationCount : undefined;
  const canGenerate = (!!prompt.trim() || referenceImages.length > 0) && !!model;

  const visibleProjects = currentUserId ? projects : [];
  const visibleItems = currentUserId ? items : [];

  const projectCards = useMemo(() => {
    return visibleProjects.map((project) => {
      const projectItems = visibleItems.filter((item) => item.projectId === project.id);
      const totalImages = projectItems.filter((item) => item.type === "image").length;
      const totalVideos = projectItems.filter((item) => item.type === "video").length;
      const latestCover = [...projectItems]
        .filter((item) => item.url)
        .sort((a, b) => b.createdAt - a.createdAt)[0];

      return {
        project,
        totalItems: projectItems.length,
        totalImages,
        totalVideos,
        latestCover,
      };
    });
  }, [visibleItems, visibleProjects]);

  useEffect(() => {
    const preferredModel = getPreferredModelValue(currentModelOptions);
    if (model && currentModelOptions.some((option) => option.value === model)) return;
    setSelectedModel(type, preferredModel);
  }, [currentModelOptions, model, setSelectedModel, type]);

  useEffect(() => {
    if (ratioValues.includes(aspectRatio)) return;
    setAspectRatio(ratioValues[0] ?? "16:9");
  }, [aspectRatio, ratioValues]);

  useEffect(() => {
    if (type !== "video") return;
    if (durationOptions.some((option) => option.value === duration)) return;
    setDuration(durationOptions.find((option) => option.value === "10s")?.value ?? durationOptions[0]?.value ?? "10s");
  }, [duration, durationOptions, type]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!generatorRef.current?.contains(target)) {
        setOpenGeneratorPanel(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!renamingProjectId) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renamingProjectId]);

  const startRenameProject = (projectId: string, currentName: string) => {
    setRenamingProjectId(projectId);
    setRenameValue(currentName);
  };

  const cancelRenameProject = () => {
    setRenamingProjectId(null);
    setRenameValue("");
  };

  const commitRenameProject = (projectId: string, fallbackName: string) => {
    const nextName = renameValue.trim();
    if (!nextName) {
      setRenameValue(fallbackName);
      return;
    }

    updateProject(projectId, { name: nextName, updatedAt: Date.now() });
    setRenamingProjectId(null);
    setRenameValue("");
  };

  const handleCreateProject = () => {
    if (!currentUserId) {
      navigate("/auth");
      return;
    }
    const id = addProject({ name: draftName || `项目 ${visibleProjects.length + 1}` });
    setDraftName("");
    setShowCreate(false);
    navigate(`/projects/${id}`);
  };

  const handleGenerate = async () => {
    if ((!prompt.trim() && referenceImages.length === 0) || !model) return;
    if (!isCustomModel && !currentUserId) {
      alert("请先登录后再生成内容。");
      navigate("/auth");
      return;
    }

    const now = new Date();
    const projectId = addProject({ name: createAutoProjectName(now) });
    const itemPrompt = prompt.trim();
    const itemType = type;
    const itemReferenceImages = referenceImages;
    const itemReferenceImage = itemReferenceImages[0];
    const itemReferenceRoles = itemReferenceImages.map((image) => referenceImageRoles[image] ?? "general");
    const itemStyle = selectedStyle;
    const itemStyleImages = itemStyle?.imageUrl ? [itemStyle.imageUrl] : [];
    const modelLabel = selectedModelOption?.label ?? model;
    const count = Math.min(4, Math.max(1, generationCount));
    const creditCost = getModelCreditCost({
      rules: modelCreditRules,
      modelValue: model,
      type: itemType,
      resolution,
      duration: itemType === "video" ? duration : undefined,
      fallbackCredits: selectedModelOption?.credits,
    });

    setPrompt("");
    setReferenceImages([]);
    setReferenceImageRoles({});
    setOpenGeneratorPanel(null);
    navigate(`/projects/${projectId}`);

    const tasks: Array<Promise<void>> = [];
    for (let index = 0; index < count; index += 1) {
      const itemId = addItem({
        projectId,
        type: itemType,
        prompt: itemPrompt,
        status: "generating",
        parameters: {
          model: modelLabel,
          modelValue: model,
          aspectRatio,
          resolution,
          duration: itemType === "video" ? duration : undefined,
        },
        referenceImage: itemReferenceImage,
        referenceImages: itemReferenceImages.length > 0 ? itemReferenceImages : undefined,
        referenceImageRoles: itemReferenceImages.length > 0 ? referenceImageRoles : undefined,
        styleReference: itemStyle ?? undefined,
        styleReferenceImages: itemStyleImages.length > 0 ? itemStyleImages : undefined,
      });

      if (!isCustomModel && currentUserId) {
        const spendResult = spendCredits({
          userId: currentUserId,
          amount: creditCost,
          generationTaskId: itemId,
          note: `生成${itemType === "image" ? "图片" : "视频"}：${modelLabel}`,
        });
        if (!spendResult.ok) {
          updateItem(itemId, { status: "error", saveError: spendResult.message });
          alert(spendResult.message);
          break;
        }
      }

      tasks.push((async () => {
        try {
          if (itemType === "image") {
            const url = await generateImageAsset({
              modelId: model,
              prompt: itemPrompt,
              referenceImageUrl: itemReferenceImage,
              referenceImageUrls: itemReferenceImages,
              referenceImageRoles: itemReferenceRoles,
              styleReferenceImageUrls: itemStyleImages,
              styleReferencePrompt: itemStyle?.prompt,
              styleReferenceName: itemStyle?.name,
              styleStrength: itemStyle?.strength,
              size: getImageSizeFromPreset(aspectRatio, resolution),
              ratio: aspectRatio === "auto" ? undefined : aspectRatio,
              resolution,
              n: 1,
              clientTaskId: itemId,
            });
            if (localStorage.getItem("media-debug") === "1") console.log("[media-debug] image generation completed", { itemId, url });
            if (!isRenderableAssetUrl(url)) {
              if (localStorage.getItem("media-debug") === "1") console.log("[media-debug] image generation returned non-renderable url; waiting for recovery", { itemId, url });
              return;
            }
            updateItem(itemId, { status: "completed", url });
            return;
          }

          const durationNum = Number.parseFloat(duration) || 5;
          const url = await generateVideoAsset({
            modelId: model,
            prompt: itemPrompt,
            ratio: aspectRatio,
            resolution,
            duration: durationNum,
            n: 1,
            startImageUrl: itemReferenceImages[0],
            endImageUrl: itemReferenceImages[1],
            referenceImageUrls: itemReferenceImages,
            onProgress: (progress) => updateItem(itemId, { progress: Math.round(progress) }),
          });
          if (!isRenderableAssetUrl(url)) {
            if (localStorage.getItem("media-debug") === "1") console.log("[media-debug] video generation returned non-renderable url; waiting for recovery", { itemId, url });
            return;
          }
          updateItem(itemId, { status: "completed", url, progress: 100 });
        } catch (error) {
          if (localStorage.getItem("media-debug") === "1") console.log("[media-debug] generation failed", error);
          updateItem(itemId, {
            status: "error",
            url: undefined,
            progress: undefined,
            saveError: error instanceof Error ? error.message : String(error),
          });
          if (!isCustomModel && currentUserId) {
            refundCredits({ userId: currentUserId, amount: creditCost, generationTaskId: itemId, note: `生成失败返还：${modelLabel}` });
          }
        }
      })());
    }

    await Promise.allSettled(tasks);
  };

  if (!authHydrated || !hasHydrated) return null;

  return (
    <div className="relative -m-3 flex h-[calc(100%+88px)] flex-col overflow-hidden bg-[#08090d] text-white md:-m-8 md:h-[calc(100%+4rem)]">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5 pb-[316px] md:px-6 md:py-8 md:pb-[228px]">
        <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col gap-4 md:mb-8 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 text-xs uppercase tracking-[0.28em] text-[#6f7890]">Projects</div>
            <h1 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">项目管理</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#8f97aa]">
              集中管理你的创作项目，也可以直接从这里继续生成新的图片和视频。
            </p>
          </div>

          <Button
            type="button"
            onClick={() => setShowCreate((current) => !current)}
            className="h-11 rounded-xl bg-cyan-400 px-5 text-sm font-medium text-black hover:bg-cyan-300"
          >
            <Plus className="mr-2 h-4 w-4" />
            新建项目
          </Button>
        </div>

        {showCreate ? (
          <div className="mb-8 rounded-3xl border border-white/[0.08] bg-[#11141b] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
            <div className="flex flex-col gap-3 md:flex-row">
              <Input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder="输入项目名称"
                className="h-11 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]"
              />
              <Button type="button" onClick={handleCreateProject} className="h-11 rounded-xl bg-white px-5 text-black hover:bg-white/90">
                立即进入
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDraftName("");
                  setShowCreate(false);
                }}
                className="h-11 rounded-xl border-white/[0.08] bg-white/[0.03] px-5 text-white hover:bg-white/[0.06]"
              >
                取消
              </Button>
            </div>
          </div>
        ) : null}

        {projectCards.length === 0 ? (
          <div className="flex min-h-[52vh] flex-col items-center justify-center rounded-[32px] border border-dashed border-white/[0.10] bg-white/[0.02] text-center">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.04] text-cyan-300">
              <FolderPlus className="h-7 w-7" />
            </div>
            <h2 className="text-xl font-semibold text-white">还没有项目</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-[#8f97aa]">
              先创建一个项目，再开始生成图片、视频以及后续的编辑版本。
            </p>
            <Button
              type="button"
              onClick={() => setShowCreate(true)}
              className="mt-6 h-11 rounded-xl bg-cyan-400 px-5 text-black hover:bg-cyan-300"
            >
              <Plus className="mr-2 h-4 w-4" />
              创建第一个项目
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 md:gap-5 xl:grid-cols-3">
            {projectCards.map(({ project, totalItems, totalImages, totalVideos, latestCover }) => (
              <article
                key={project.id}
                className="group overflow-hidden rounded-[30px] border border-white/[0.08] bg-[#11141b] transition hover:border-white/[0.14]"
              >
                <button
                  type="button"
                  onClick={() => navigate(`/projects/${project.id}`)}
                  className="block w-full text-left"
                >
                  <div className="relative aspect-[16/10] overflow-hidden bg-[#0b0d12]">
                    {latestCover?.type === "image" && latestCover.url ? (
                      <LocalAssetImage itemId={latestCover.id} src={latestCover.url} alt={project.name} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
                    ) : latestCover?.type === "video" && latestCover.thumbnail ? (
                      <img
                        src={latestCover.thumbnail}
                        alt={project.name}
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_top,#182131,transparent_60%)]">
                        <FolderPlus className="h-10 w-10 text-[#5f6b85]" />
                      </div>
                    )}

                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent px-5 pb-5 pt-16">
                      <div className="text-lg font-semibold text-white">{renamingProjectId === project.id ? renameValue || project.name : project.name}</div>
                      <div className="mt-1 text-xs text-white/70">
                        最近更新 {new Date(project.updatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                  </div>
                </button>

                <div className="flex items-center justify-between px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[#9ca5b5]">
                    <span className="rounded-full bg-white/[0.04] px-3 py-1">{totalItems} 件作品</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.04] px-3 py-1">
                      <ImageIcon className="h-3.5 w-3.5" />
                      {totalImages}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.04] px-3 py-1">
                      <Video className="h-3.5 w-3.5" />
                      {totalVideos}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {renamingProjectId === project.id ? (
                      <>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            commitRenameProject(project.id, project.name);
                          }}
                          className="flex h-9 w-9 items-center justify-center rounded-xl text-[#8892a7] transition hover:bg-emerald-500/12 hover:text-emerald-200"
                          title="保存项目名"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            cancelRenameProject();
                          }}
                          className="flex h-9 w-9 items-center justify-center rounded-xl text-[#8892a7] transition hover:bg-white/[0.06] hover:text-white"
                          title="取消重命名"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            startRenameProject(project.id, project.name);
                          }}
                          className={cn(
                            "flex h-9 w-9 items-center justify-center rounded-xl text-[#8892a7] transition",
                            "hover:bg-white/[0.06] hover:text-white"
                          )}
                          title="重命名项目"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeProject(project.id);
                          }}
                          className={cn(
                            "flex h-9 w-9 items-center justify-center rounded-xl text-[#8892a7] transition",
                            "hover:bg-red-500/12 hover:text-red-200"
                          )}
                          title="删除项目"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {renamingProjectId === project.id ? (
                  <div className="border-t border-white/[0.06] px-5 pb-4 pt-1">
                    <Input
                      ref={renameInputRef}
                      value={renameValue}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitRenameProject(project.id, project.name);
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelRenameProject();
                        }
                      }}
                      placeholder="输入新的项目名称"
                      className="h-11 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]"
                    />
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-[72px] z-20 px-3 pb-3 md:bottom-0 md:px-10 md:pb-4 lg:px-16 xl:px-24">
        <div className="pointer-events-auto mx-auto w-full max-w-[1180px]">
          <FlowGeneratorBar
            generatorRef={generatorRef}
            prompt={prompt}
            onPromptChange={setPrompt}
            onPromptKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void handleGenerate();
              }
            }}
            type={type}
            onTypeChange={setType}
            model={model}
            onModelChange={(value) => setSelectedModel(type, value)}
            aspectRatio={aspectRatio}
            onAspectRatioChange={setAspectRatio}
            resolution={resolution}
            onResolutionChange={setResolution}
            duration={duration}
            onDurationChange={setDuration}
            generationCount={generationCount}
            onGenerationCountChange={setGenerationCount}
            referenceImages={referenceImages}
            onReferenceImagesChange={setReferenceImages}
            referenceImageRoles={referenceImageRoles}
            onReferenceImageRolesChange={setReferenceImageRoles}
            selectedStyle={selectedStyle}
            onSelectedStyleChange={setSelectedStyle}
            currentModelOptions={currentModelOptions}
            ratioOptions={ratioOptions}
            durationOptions={durationOptions}
            canGenerate={canGenerate}
            estimatedCredits={estimatedCredits}
            openGeneratorPanel={openGeneratorPanel}
            onOpenGeneratorPanelChange={setOpenGeneratorPanel}
            onGenerate={() => void handleGenerate()}
            projects={projects}
            assets={items}
            imageDimensions={(() => {
              if (type === "video") {
                const height = resolution === "1080p" ? "1080" : "720";
                return aspectRatio === "9:16" ? { width: height, height: resolution === "1080p" ? "1920" : "1280" } : { width: resolution === "1080p" ? "1920" : "1280", height };
              }
              const [width = "1440", height = "2560"] = getImageSizeFromPreset(aspectRatio, resolution).split("x");
              return { width, height };
            })()}
          />
        </div>
      </div>
    </div>
  );
}
