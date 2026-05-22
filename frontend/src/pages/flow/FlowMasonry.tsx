import { FlowCard } from "./FlowCard";
import type { FlowItem } from "../../store/flowStore";

const MASONRY_COLS: Record<number, string> = {
  1: "columns-2 sm:columns-3 md:columns-4 lg:columns-5",
  2: "columns-2 sm:columns-3 md:columns-4",
  3: "columns-1 sm:columns-2 md:columns-3",
  4: "columns-1 sm:columns-2",
  5: "columns-1",
};

interface FlowMasonryProps {
  items: FlowItem[];
  cardSize: number;
  onRemove: (id: string) => void;
}

export function FlowMasonry({ items, cardSize, onRemove }: FlowMasonryProps) {
  const colClass = MASONRY_COLS[cardSize] ?? MASONRY_COLS[3];
  const handleSave = () => {};

  return (
    <div className={`${colClass} gap-3 p-4 [column-fill:_balance]`}>
      {items.map((item) => (
        <FlowCard
          key={item.id}
          item={item}
          onRemove={onRemove}
          onSave={handleSave}
          className="mb-3 break-inside-avoid"
        />
      ))}
    </div>
  );
}
