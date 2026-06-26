import { create } from "zustand";
import { createJSONStorage, persist, type PersistOptions } from "zustand/middleware";
import { createIndexedDbStorage } from "../lib/indexedDbStorage";
import { createScopedServerPrimaryStorage } from "../lib/sharedStateStorage";
import { useAuthStore } from "./authStore";

export type FlowItemType = "image" | "video";
export type FlowItemStatus = "pending" | "generating" | "completed" | "error";
export type FlowReferenceRole = "character" | "scene" | "object" | "general";

export interface FlowProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface FlowItem {
  id: string;
  projectId: string;
  type: FlowItemType;
  prompt: string;
  status: FlowItemStatus;
  url?: string;
  thumbnail?: string;
  savedFileName?: string;
  saveError?: string;
  progress?: number;
  parameters: {
    model: string;
    modelValue?: string;
    aspectRatio: string;
    duration?: string;
    resolution?: string;
  };
  referenceImage?: string;
  referenceImages?: string[];
  referenceImageRoles?: Record<string, FlowReferenceRole>;
  styleReference?: FlowStyleReference;
  styleReferenceImages?: string[];
  editSourceId?: string;
  editRootId?: string;
  createdAt: number;
}

export interface FlowStyleReference {
  id: string;
  name: string;
  imageUrl?: string;
  prompt?: string;
  strength?: number;
  custom?: boolean;
}

interface FlowState {
  projects: FlowProject[];
  items: FlowItem[];
  deletedItemIds: string[];
  deletedProjectIds: string[];
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  addProject: (input: { name: string }) => string;
  updateProject: (id: string, updates: Partial<Pick<FlowProject, "name" | "updatedAt">>) => void;
  removeProject: (id: string) => void;
  addItem: (item: Omit<FlowItem, "id" | "createdAt">) => string;
  updateItem: (id: string, updates: Partial<FlowItem>) => void;
  removeItem: (id: string) => void;
  clearAll: () => void;
}

type PersistedFlowStateV2 = Pick<FlowState, "projects" | "items" | "deletedItemIds" | "deletedProjectIds">;

function createDefaultState(): PersistedFlowStateV2 {
  return {
    projects: [],
    items: [],
    deletedItemIds: [],
    deletedProjectIds: [],
  };
}

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

let allowNextEmptyFlowPersist = false;

function getCurrentFlowScopeId() {
  return useAuthStore.getState().currentUserId;
}

function getPersistedFlowCounts(value?: string | null) {
  if (typeof value !== "string") return null;
  try {
    const state = (JSON.parse(value) as { state?: Partial<PersistedFlowStateV2> }).state;
    return {
      projects: Array.isArray(state?.projects) ? state.projects.length : 0,
      items: Array.isArray(state?.items) ? state.items.length : 0,
      deletedItemIds: Array.isArray(state?.deletedItemIds) ? state.deletedItemIds.length : 0,
      deletedProjectIds: Array.isArray(state?.deletedProjectIds) ? state.deletedProjectIds.length : 0,
    };
  } catch {
    return null;
  }
}

function shouldSkipEmptyFlowOverwrite(value: string, backendValue: string | null) {
  if (allowNextEmptyFlowPersist) {
    allowNextEmptyFlowPersist = false;
    return false;
  }

  const nextCounts = getPersistedFlowCounts(value);
  const backendCounts = getPersistedFlowCounts(backendValue);
  return Boolean(
    nextCounts &&
      backendCounts &&
      nextCounts.projects === 0 &&
      nextCounts.items === 0 &&
      nextCounts.deletedItemIds === 0 &&
      nextCounts.deletedProjectIds === 0 &&
      (backendCounts.projects > 0 || backendCounts.items > 0)
  );
}

function sanitizeObjectUrl(url?: string) {
  if (!url) return undefined;
  return url.startsWith("blob:") ? undefined : url;
}

function sanitizePersistedUrl(url?: string, keepSmallDataUrls = false) {
  const sanitizedUrl = sanitizeObjectUrl(url);
  if (!sanitizedUrl) return undefined;
  if (/^data:(?:image|video)\//i.test(sanitizedUrl)) {
    return keepSmallDataUrls && sanitizedUrl.length <= 250_000 ? sanitizedUrl : undefined;
  }
  return sanitizedUrl;
}

function sanitizeObjectUrls(input: unknown, stripDataUrls = false) {
  if (!Array.isArray(input)) return [];
  return input
    .map((value) => (typeof value === "string" ? (stripDataUrls ? sanitizePersistedUrl(value) : sanitizeObjectUrl(value)) : undefined))
    .filter((value): value is string => Boolean(value));
}

function normalizeReferenceImages(raw: Partial<FlowItem>, stripDataUrls = false) {
  const sanitizedImages = sanitizeObjectUrls(raw.referenceImages, stripDataUrls);
  if (Array.isArray(raw.referenceImages)) return sanitizedImages;

  const legacyImage = stripDataUrls
    ? sanitizePersistedUrl(typeof raw.referenceImage === "string" ? raw.referenceImage : undefined)
    : sanitizeObjectUrl(typeof raw.referenceImage === "string" ? raw.referenceImage : undefined);
  return legacyImage ? [legacyImage] : [];
}

function normalizeReferenceImageRoles(raw: Partial<FlowItem>, referenceImages: string[]) {
  const value = raw.referenceImageRoles;
  if (!value || typeof value !== "object") return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, FlowReferenceRole] =>
      referenceImages.includes(entry[0]) &&
      (entry[1] === "character" || entry[1] === "scene" || entry[1] === "object" || entry[1] === "general")
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function normalizeStyleReference(raw: Partial<FlowItem>): FlowStyleReference | undefined {
  const value = raw.styleReference;
  if (!value || typeof value !== "object") return undefined;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name) return undefined;
  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id : `style-${Date.now()}`,
    name,
    imageUrl: sanitizeObjectUrl(typeof value.imageUrl === "string" ? value.imageUrl : undefined),
    prompt: typeof value.prompt === "string" ? value.prompt : undefined,
    strength: typeof value.strength === "number" ? Math.max(0, Math.min(1, value.strength)) : undefined,
    custom: value.custom === true,
  };
}

function normalizeProject(project: unknown): FlowProject | null {
  if (!project || typeof project !== "object") return null;
  const raw = project as Partial<FlowProject>;

  if (!raw.id || typeof raw.name !== "string") return null;

  return {
    id: String(raw.id),
    name: raw.name.trim() || "Untitled Project",
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
  };
}

function normalizeFlowItem(item: unknown): FlowItem | null {
  if (!item || typeof item !== "object") return null;

  const raw = item as Partial<FlowItem>;
  if (!raw.id || !raw.type || !raw.status || !raw.parameters || typeof raw.createdAt !== "number") {
    return null;
  }

  const normalizedStatus: FlowItemStatus =
    raw.status === "completed" || raw.status === "error" || raw.status === "generating" ? raw.status : "error";
  const referenceImages = normalizeReferenceImages(raw, true);
  const referenceImageRoles = normalizeReferenceImageRoles(raw, referenceImages);
  const styleReferenceImages = sanitizeObjectUrls(raw.styleReferenceImages, true);
  const styleReference = normalizeStyleReference(raw);

  return {
    id: String(raw.id),
    projectId: typeof raw.projectId === "string" ? raw.projectId : "",
    type: raw.type === "video" ? "video" : "image",
    prompt: typeof raw.prompt === "string" ? raw.prompt : "",
    status: normalizedStatus,
    url: sanitizePersistedUrl(typeof raw.url === "string" ? raw.url : undefined),
    thumbnail: sanitizePersistedUrl(typeof raw.thumbnail === "string" ? raw.thumbnail : undefined),
    savedFileName: typeof raw.savedFileName === "string" ? raw.savedFileName : undefined,
    progress: typeof raw.progress === "number" ? Math.max(0, Math.min(100, raw.progress)) : undefined,
    saveError:
      normalizedStatus === "error"
        ? typeof raw.saveError === "string"
          ? raw.saveError
          : raw.status === "pending" || raw.status === "generating"
            ? undefined
            : undefined
        : typeof raw.saveError === "string"
          ? raw.saveError
          : undefined,
    parameters: {
      model: typeof raw.parameters.model === "string" ? raw.parameters.model : "",
      modelValue: typeof raw.parameters.modelValue === "string" ? raw.parameters.modelValue : undefined,
      aspectRatio: typeof raw.parameters.aspectRatio === "string" ? raw.parameters.aspectRatio : "16:9",
      duration: typeof raw.parameters.duration === "string" ? raw.parameters.duration : undefined,
      resolution: typeof raw.parameters.resolution === "string" ? raw.parameters.resolution : undefined,
    },
    referenceImage: referenceImages[0],
    referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
    referenceImageRoles,
    styleReference,
    styleReferenceImages: styleReferenceImages.length > 0 ? styleReferenceImages : undefined,
    editSourceId: typeof raw.editSourceId === "string" ? raw.editSourceId : undefined,
    editRootId: typeof raw.editRootId === "string" ? raw.editRootId : undefined,
    createdAt: raw.createdAt,
  };
}

function pruneFlowItemForPersistence(item: FlowItem): FlowItem {
  const referenceImages = sanitizeObjectUrls(item.referenceImages, true);
  const referenceImageRoles = normalizeReferenceImageRoles(item, referenceImages);
  const styleReferenceImages = sanitizeObjectUrls(item.styleReferenceImages, true);
  const styleReference = item.styleReference
    ? {
        ...item.styleReference,
        imageUrl: sanitizePersistedUrl(item.styleReference.imageUrl),
      }
    : undefined;

  return {
    ...item,
    url: sanitizePersistedUrl(item.url, true),
    thumbnail: sanitizePersistedUrl(item.thumbnail),
    referenceImage: referenceImages[0],
    referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
    referenceImageRoles,
    styleReference,
    styleReferenceImages: styleReferenceImages.length > 0 ? styleReferenceImages : undefined,
  };
}

function normalizeProjects(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input.map(normalizeProject).filter((project): project is FlowProject => Boolean(project));
}

function normalizeItems(input: unknown) {
  if (!Array.isArray(input)) return [];

  return input
    .map(normalizeFlowItem)
    .filter((item): item is FlowItem => Boolean(item))
    .filter((item) => Boolean(item.url) || item.status === "error" || item.status === "generating");
}

function normalizeDeletedItemIds(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value): value is string => Boolean(value));
}

function normalizeDeletedProjectIds(input: unknown) {
  return normalizeDeletedItemIds(input);
}

function reconcileData(projects: FlowProject[], items: FlowItem[]) {
  const nextProjects = [...projects];
  const existingIds = new Set(nextProjects.map((project) => project.id));

  if (nextProjects.length === 0 && items.length > 0) {
    const importedProjectId = "project-imported";
    nextProjects.push({
      id: importedProjectId,
      name: "Imported Project",
      createdAt: items.reduce((min, item) => Math.min(min, item.createdAt), items[0]?.createdAt ?? Date.now()),
      updatedAt: items.reduce((max, item) => Math.max(max, item.createdAt), items[0]?.createdAt ?? Date.now()),
    });
    existingIds.add(importedProjectId);
  }

  for (const item of items) {
    if (!item.projectId) continue;
    if (existingIds.has(item.projectId)) continue;

    nextProjects.push({
      id: item.projectId,
      name: "Recovered Project",
      createdAt: item.createdAt,
      updatedAt: item.createdAt,
    });
    existingIds.add(item.projectId);
  }

  const fallbackProjectId = nextProjects[0]?.id ?? "";
  const nextItems = items.map((item) => ({
    ...item,
    projectId: item.projectId || fallbackProjectId,
  }));

  const updatedProjects = nextProjects.map((project) => {
    const projectItems = nextItems.filter((item) => item.projectId === project.id);
    if (!projectItems.length) return project;
    const latestItemTime = projectItems.reduce((max, item) => Math.max(max, item.createdAt), project.updatedAt);
    return {
      ...project,
      updatedAt: Math.max(project.updatedAt, latestItemTime),
    };
  });

  return {
    projects: updatedProjects.sort((a, b) => b.updatedAt - a.updatedAt),
    items: nextItems,
  };
}

function shouldPreserveLocalTransientItem(item: FlowItem) {
  if (item.status !== "generating") return false;
  const oneDayMs = 24 * 60 * 60 * 1000;
  return Date.now() - item.createdAt <= oneDayMs;
}

function mergeWithLocalTransientItems(
  persistedProjects: FlowProject[],
  persistedItems: FlowItem[],
  currentProjects: FlowProject[],
  currentItems: FlowItem[]
) {
  const persistedItemIds = new Set(persistedItems.map((item) => item.id));
  const localTransientItems = currentItems.filter(
    (item) => !persistedItemIds.has(item.id) && shouldPreserveLocalTransientItem(item)
  );

  if (localTransientItems.length === 0) {
    return { projects: persistedProjects, items: persistedItems };
  }

  const projectIds = new Set(persistedProjects.map((project) => project.id));
  const localProjects = currentProjects.filter(
    (project) => !projectIds.has(project.id) && localTransientItems.some((item) => item.projectId === project.id)
  );

  return reconcileData([...persistedProjects, ...localProjects], [...persistedItems, ...localTransientItems]);
}

export const useFlowStore = create<FlowState>()(
  persist(
    (set) => ({
      ...createDefaultState(),
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),
      addProject: ({ name }) => {
        const now = Date.now();
        const id = createId("project");
        const project: FlowProject = {
          id,
          name: name.trim() || "Untitled Project",
          createdAt: now,
          updatedAt: now,
        };

        set((state) => ({
          projects: [project, ...state.projects].sort((a, b) => b.updatedAt - a.updatedAt),
        }));

        return id;
      },
      updateProject: (id, updates) => {
        set((state) => ({
          projects: state.projects
            .map((project) =>
              project.id === id
                ? {
                    ...project,
                    ...updates,
                    name: typeof updates.name === "string" ? updates.name.trim() || project.name : project.name,
                  }
                : project
            )
            .sort((a, b) => b.updatedAt - a.updatedAt),
        }));
      },
      removeProject: (id) => {
        set((state) => {
          const removedItemIds = state.items.filter((item) => item.projectId === id).map((item) => item.id);
          return {
            projects: state.projects.filter((project) => project.id !== id),
            items: state.items.filter((item) => item.projectId !== id),
            deletedItemIds: Array.from(new Set([...state.deletedItemIds, ...removedItemIds])),
            deletedProjectIds: state.deletedProjectIds.includes(id) ? state.deletedProjectIds : [...state.deletedProjectIds, id],
          };
        });
      },
      addItem: (item) => {
        const id = createId("item");
        const createdAt = Date.now();
        const referenceImages =
          item.referenceImages?.filter((value, index, list) => Boolean(value) && list.indexOf(value) === index) ?? [];
        const referenceImageRoles = normalizeReferenceImageRoles(item, referenceImages);
        const styleReferenceImages =
          item.styleReferenceImages?.filter((value, index, list) => Boolean(value) && list.indexOf(value) === index) ?? [];
        const newItem: FlowItem = {
          ...item,
          referenceImage: referenceImages[0] ?? item.referenceImage,
          referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
          referenceImageRoles,
          styleReferenceImages: styleReferenceImages.length > 0 ? styleReferenceImages : undefined,
          id,
          createdAt,
        };

        set((state) => ({
          items: [...state.items, newItem],
          projects: state.projects
            .map((project) =>
              project.id === item.projectId
                ? {
                    ...project,
                    updatedAt: createdAt,
                  }
                : project
            )
            .sort((a, b) => b.updatedAt - a.updatedAt),
        }));

        return id;
      },
      updateItem: (id, updates) => {
        set((state) => {
          let touchedProjectId = "";
          const items = state.items.map((item) => {
            if (item.id !== id) return item;
            touchedProjectId = updates.projectId ?? item.projectId;
            const mergedItem = { ...item, ...updates };
            const referenceImages = normalizeReferenceImages(mergedItem);
            const referenceImageRoles = normalizeReferenceImageRoles(mergedItem, referenceImages);
            const styleReferenceImages = sanitizeObjectUrls(mergedItem.styleReferenceImages);
            return {
              ...mergedItem,
              referenceImage: referenceImages[0],
              referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
              referenceImageRoles,
              styleReference: normalizeStyleReference(mergedItem),
              styleReferenceImages: styleReferenceImages.length > 0 ? styleReferenceImages : undefined,
            };
          });

          if (!touchedProjectId) {
            return { items };
          }

          return {
            items,
            projects: state.projects
              .map((project) =>
                project.id === touchedProjectId
                  ? {
                      ...project,
                      updatedAt: Date.now(),
                    }
                  : project
              )
              .sort((a, b) => b.updatedAt - a.updatedAt),
          };
        });
      },
      removeItem: (id) => {
        set((state) => ({
          items: state.items.filter((item) => item.id !== id),
          deletedItemIds: state.deletedItemIds.includes(id) ? state.deletedItemIds : [...state.deletedItemIds, id],
        }));
      },
      clearAll: () => {
        allowNextEmptyFlowPersist = true;
        set(createDefaultState());
      },
    }),
    {
      name: "ai-director-flow-v2",
      skipHydration: true,
      storage: createJSONStorage(() =>
        createScopedServerPrimaryStorage(createIndexedDbStorage(), getCurrentFlowScopeId, {
          shouldSkipWrite: ({ value, backendValue }) => shouldSkipEmptyFlowOverwrite(value, backendValue),
        })
      ),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
      partialize: (state): PersistedFlowStateV2 => ({
        projects: state.projects,
        items: state.items.map(pruneFlowItemForPersistence),
        deletedItemIds: state.deletedItemIds,
        deletedProjectIds: state.deletedProjectIds,
      }),
      merge: (persistedState, currentState) => {
        const raw = (persistedState ?? {}) as Partial<PersistedFlowStateV2>;
        const deletedItemIds = normalizeDeletedItemIds(raw.deletedItemIds);
        const deletedProjectIds = normalizeDeletedProjectIds(raw.deletedProjectIds);
        const mergedDeletedItemIds = Array.from(new Set([...(currentState.deletedItemIds ?? []), ...deletedItemIds]));
        const mergedDeletedProjectIds = Array.from(new Set([...(currentState.deletedProjectIds ?? []), ...deletedProjectIds]));
        const deletedItemIdSet = new Set(mergedDeletedItemIds);
        const deletedProjectIdSet = new Set(mergedDeletedProjectIds);
        const projects = normalizeProjects(raw.projects).filter((project) => !deletedProjectIdSet.has(project.id));
        const items = normalizeItems(raw.items).filter(
          (item) => !deletedItemIdSet.has(item.id) && !deletedProjectIdSet.has(item.projectId)
        );
        const reconciledBase = reconcileData(projects, items);
        const merged = mergeWithLocalTransientItems(
          reconciledBase.projects,
          reconciledBase.items,
          currentState.projects.filter((project) => !deletedProjectIdSet.has(project.id)),
          currentState.items.filter((item) => !deletedItemIdSet.has(item.id) && !deletedProjectIdSet.has(item.projectId))
        );

        return {
          ...currentState,
          ...createDefaultState(),
          projects: merged.projects,
          items: merged.items.filter((item) => !deletedItemIdSet.has(item.id) && !deletedProjectIdSet.has(item.projectId)),
          deletedItemIds: mergedDeletedItemIds,
          deletedProjectIds: mergedDeletedProjectIds,
        };
      },
    } as PersistOptions<FlowState, PersistedFlowStateV2>
  )
);
