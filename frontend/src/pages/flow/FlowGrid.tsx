import { FlowCard } from "./FlowCard";
import type { FlowItem } from "../../store/flowStore";

export type GridSize = "small" | "medium" | "large";

const GRID_COLS: Record<GridSize, string> = {
  small: "columns-2 md:columns-4 lg:columns-5 2xl:columns-6",
  medium: "columns-1 md:columns-2 lg:columns-3 2xl:columns-4",
  large: "columns-1 md:columns-2 2xl:columns-3",
};

interface FlowGridProps {
  items: FlowItem[];
  gridSize: GridSize;
  showDetails: boolean;
  onRemove: (id: string) => void;
  onSave: (item: FlowItem) => void;
  onOpen?: (item: FlowItem) => void;
  onReusePrompt?: (item: FlowItem) => void;
  onUseAsReference?: (item: FlowItem) => void;
}

export function FlowGrid({ items, gridSize, showDetails, onRemove, onSave, onOpen, onReusePrompt, onUseAsReference }: FlowGridProps) {
  const colClass = GRID_COLS[gridSize] ?? GRID_COLS.medium;

  return (
    <div className={`${colClass} gap-3 [column-fill:_balance]`}>
      {items.map((item) => (
        <FlowCard
          key={item.id}
          item={item}
          gridSize={gridSize}
          showDetails={showDetails}
          onRemove={onRemove}
          onSave={onSave}
          onOpen={onOpen}
          onReusePrompt={onReusePrompt}
          onUseAsReference={onUseAsReference}
          className="mb-3 break-inside-avoid"
        />
      ))}
    </div>
  );
}
