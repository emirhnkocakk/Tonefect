import type { CSSProperties } from "react"
import { Italic, Plus, RotateCcw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PALETTE, SIZES, WEIGHTS } from "@/lib/constants"
import type { Common } from "@/lib/text"
import { cn } from "@/lib/utils"
import type { Style } from "@/types"

type Props = {
  common: Common
  count: number
  apply: (patch: Partial<Style>) => void
  onClose: () => void
  style?: CSSProperties
}

const CLEAR: Partial<Style> = { color: undefined, weight: undefined, italic: undefined, size: undefined }

export function StyleBar({ common, count, apply, onClose, style }: Props) {
  const weightValue = typeof common.weight === "string" && common.weight !== "*" ? common.weight : ""
  const sizeValue = common.size === "*" ? "" : String(common.size)

  return (
    <div
      className="absolute z-30 w-[352px] animate-fade-in rounded-xl border bg-popover/95 p-3 shadow-2xl backdrop-blur"
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5">
        {PALETTE.map(([name, hex]) => (
          <Tooltip key={hex}>
            <TooltipTrigger asChild>
              <button
                aria-label={name}
                onClick={() => apply({ color: common.color === hex ? undefined : hex })}
                className={cn(
                  "h-6 w-6 shrink-0 rounded-full border border-black/40 ring-offset-2 ring-offset-popover transition-transform hover:scale-110",
                  common.color === hex && "ring-2 ring-primary"
                )}
                style={{ background: hex }}
              />
            </TooltipTrigger>
            <TooltipContent>{name}</TooltipContent>
          </Tooltip>
        ))}
        <Tooltip>
          <TooltipTrigger asChild>
            <label className="relative grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-full border border-dashed border-muted-foreground/70 text-muted-foreground transition-colors hover:border-primary hover:text-primary">
              <Plus className="h-3 w-3" />
              <input
                type="color"
                className="absolute inset-0 cursor-pointer opacity-0"
                onChange={(e) => apply({ color: e.target.value })}
              />
            </label>
          </TooltipTrigger>
          <TooltipContent>Özel renk</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label="Varsayılan renk"
              onClick={() => apply({ color: undefined })}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Varsayılan renk</TooltipContent>
        </Tooltip>
        <div className="flex-1" />
        <button aria-label="Kapat" onClick={onClose} className="text-muted-foreground transition-colors hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <Separator className="my-2.5" />

      <div className="flex items-center gap-2">
        <ToggleGroup
          type="single"
          size="sm"
          value={weightValue}
          onValueChange={(v) => apply({ weight: v || undefined })}
          className="flex-1 justify-start"
        >
          {WEIGHTS.map(([label, w]) => (
            <ToggleGroupItem key={w} value={w} className="h-7 flex-1 px-1.5 text-[11px]">
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Toggle
          size="sm"
          aria-label="İtalik"
          pressed={common.italic === true}
          onPressedChange={(p) => apply({ italic: p ? true : undefined })}
          className="h-7 w-7 px-0"
        >
          <Italic className="h-3.5 w-3.5" />
        </Toggle>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <ToggleGroup
          type="single"
          size="sm"
          value={sizeValue}
          onValueChange={(v) => apply({ size: v ? Number(v) : 1 })}
          className="flex-1 justify-start"
        >
          {SIZES.map(([s, px]) => (
            <ToggleGroupItem key={s} value={String(s)} className="h-8 flex-1 px-0 font-bold" aria-label={`Boyut ${s}`}>
              <span style={{ fontSize: px * 0.8 }}>A</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground" onClick={() => apply(CLEAR)}>
          Temizle
        </Button>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">{count} kelime seçili</p>
    </div>
  )
}
