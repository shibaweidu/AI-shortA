import { Check } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";
import type { GeneratorOption } from "../../lib/generatorOptions";

type SelectTheme = "gold" | "orange";
type SelectDirection = "down" | "up";

function getThemeClasses(theme: SelectTheme) {
  if (theme === "orange") {
    return {
      trigger: "border-orange-500/30 bg-card hover:border-orange-500/60",
      menu: "border-orange-500/20 bg-[#18110d]/95",
      active: "bg-orange-500/10 text-orange-300",
      hover: "hover:bg-orange-500/10",
      check: "text-orange-400",
      muted: "text-orange-300/70",
    };
  }

  return {
    trigger: "border-primary/30 bg-card hover:border-primary/60",
    menu: "border-primary/20 bg-[#17130d]/95",
    active: "bg-primary/10 text-primary",
    hover: "hover:bg-primary/10",
    check: "text-primary",
    muted: "text-primary/70",
  };
}

function getRatioFrameClass(value: string) {
  if (value === "21:9") return "h-[10px] w-[22px]";
  if (value === "16:9") return "h-[11px] w-[20px]";
  if (value === "3:2") return "h-[12px] w-[18px]";
  if (value === "4:3") return "h-[14px] w-[18px]";
  if (value === "1:1") return "h-[16px] w-[16px]";
  if (value === "3:4") return "h-[18px] w-[14px]";
  if (value === "2:3") return "h-[20px] w-[13px]";
  if (value === "9:16") return "h-[22px] w-[12px]";
  return "h-[16px] w-[16px]";
}

function OptionPreview({
  option,
  size = "default",
}: {
  option: GeneratorOption;
  size?: "default" | "compact";
}) {
  if (option.previewKind === "badge" && option.previewLabel) {
    return (
      <span
        className={cn(
          "flex shrink-0 items-center justify-center bg-gradient-to-br font-bold text-white shadow-sm",
          size === "compact" ? "h-6 w-6 rounded text-[9px]" : "h-8 w-8 rounded-md text-[10px]",
          option.previewClassName
        )}
      >
        {option.previewLabel}
      </span>
    );
  }

  if (option.previewKind === "ratio") {
    return (
      <span
        className={cn(
          "flex shrink-0 items-center justify-center border border-white/10 bg-black/30 shadow-sm",
          size === "compact" ? "h-6 w-6 rounded" : "h-8 w-8 rounded-md"
        )}
      >
        <span
          className={cn(
            "rounded-[3px] border border-white/80 bg-white/10",
            getRatioFrameClass(option.value),
            size === "compact" && "scale-75"
          )}
        />
      </span>
    );
  }

  return null;
}

function OptionText({
  option,
  showDescription = true,
}: {
  option: GeneratorOption;
  showDescription?: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center overflow-hidden">
      <span className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden whitespace-nowrap">
        <span className="truncate text-sm font-medium leading-5">{option.label}</span>
        {showDescription && option.description ? (
          <span className="truncate text-xs leading-5 text-muted-foreground">{option.description}</span>
        ) : null}
      </span>
    </span>
  );
}

export function GeneratorSelect({
  value,
  options,
  onChange,
  theme = "gold",
  direction = "down",
  placeholder = "请选择",
  disabled = false,
  size = "default",
  showPreview = true,
  showDescription = true,
}: {
  value: string;
  options: GeneratorOption[];
  onChange: (value: string) => void;
  theme?: SelectTheme;
  direction?: SelectDirection;
  placeholder?: string;
  disabled?: boolean;
  size?: "default" | "compact";
  showPreview?: boolean;
  showDescription?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const themeClasses = getThemeClasses(theme);
  const selectedOption = options.find((option) => option.value === value);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>();

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;

    const updateMenuStyle = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const viewportPadding = 8;
      const viewportWidth = window.innerWidth;
      const maxWidth = Math.min(672, viewportWidth - viewportPadding * 2);
      const alignRight = rect.left > viewportWidth / 2;

      setMenuStyle({
        minWidth: `${Math.max(rect.width, 168)}px`,
        maxWidth: `${maxWidth}px`,
        ...(alignRight
          ? { right: `${Math.max(viewportPadding, viewportWidth - rect.right)}px` }
          : { left: `${Math.max(viewportPadding, rect.left)}px` }),
        ...(direction === "up"
          ? { bottom: `${window.innerHeight - rect.top + 8}px` }
          : { top: `${rect.bottom + 8}px` }),
      });
    };

    updateMenuStyle();
    window.addEventListener("resize", updateMenuStyle);
    window.addEventListener("scroll", updateMenuStyle, true);

    return () => {
      window.removeEventListener("resize", updateMenuStyle);
      window.removeEventListener("scroll", updateMenuStyle, true);
    };
  }, [direction, open]);

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "flex w-full min-w-0 items-center justify-between overflow-hidden border text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
          size === "compact" ? "h-[34px] gap-2 rounded-lg px-3 py-1.5" : "h-[56px] gap-3 rounded-lg px-3 py-2",
          themeClasses.trigger
        )}
      >
        {selectedOption ? (
          <span className={cn("flex min-w-0 flex-1 items-center overflow-hidden", size === "compact" ? "gap-2" : "gap-3")}>
            {showPreview ? <OptionPreview option={selectedOption} size={size} /> : null}
            <OptionText option={selectedOption} showDescription={showDescription} />
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">{placeholder}</span>
        )}
      </button>
      {open && menuStyle
        ? createPortal(
            <div
              ref={menuRef}
              className={cn(
                "fixed z-[1000] w-max overflow-hidden rounded-xl border shadow-2xl",
                themeClasses.menu
              )}
              style={menuStyle}
            >
              <div className="max-h-72 overflow-y-auto p-1.5">
                {options.map((option) => {
                  const selected = option.value === value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        onChange(option.value);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex min-h-[56px] min-w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                        selected ? themeClasses.active : themeClasses.hover
                      )}
                    >
                      <OptionPreview option={option} />
                      <OptionText option={option} showDescription={showDescription} />
                      {selected ? <Check className={cn("h-4 w-4 shrink-0", themeClasses.check)} /> : null}
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
