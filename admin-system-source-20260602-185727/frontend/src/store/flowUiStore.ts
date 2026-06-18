import { create } from "zustand";
import { persist } from "zustand/middleware";

type FlowGeneratorType = "image" | "video";
type FlowProjectViewMode = "grid" | "batch";
type FlowProjectGridSize = "small" | "medium" | "large";

interface FlowUiState {
  selectedModels: Record<FlowGeneratorType, string>;
  autoSaveDirectoryName: string;
  flowProjectViewMode: FlowProjectViewMode;
  flowProjectGridSize: FlowProjectGridSize;
  setSelectedModel: (type: FlowGeneratorType, model: string) => void;
  setAutoSaveDirectoryName: (name: string) => void;
  setFlowProjectViewMode: (mode: FlowProjectViewMode) => void;
  setFlowProjectGridSize: (size: FlowProjectGridSize) => void;
}

export const useFlowUiStore = create<FlowUiState>()(
  persist(
    (set) => ({
      selectedModels: {
        image: "",
        video: "",
      },
      autoSaveDirectoryName: "",
      flowProjectViewMode: "grid",
      flowProjectGridSize: "medium",
      setSelectedModel: (type, model) =>
        set((state) => ({
          selectedModels: {
            ...state.selectedModels,
            [type]: model,
          },
        })),
      setAutoSaveDirectoryName: (name) => set({ autoSaveDirectoryName: name }),
      setFlowProjectViewMode: (flowProjectViewMode) => set({ flowProjectViewMode }),
      setFlowProjectGridSize: (flowProjectGridSize) => set({ flowProjectGridSize }),
    }),
    {
      name: "ai-director-flow-ui-v1",
      partialize: (state) => ({
        selectedModels: state.selectedModels,
        autoSaveDirectoryName: state.autoSaveDirectoryName,
        flowProjectViewMode: state.flowProjectViewMode,
        flowProjectGridSize: state.flowProjectGridSize,
      }),
    }
  )
);
