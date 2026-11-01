import { ImagePlus, Aperture, CircleDashed, Scissors, Copyright, Crop, Droplet, Eye, EyeOff, Film, Frame, Image, Layers, Palette, SlidersHorizontal, Sparkle, Sun, Trash2, Type, Wind } from "lucide-react"
import { buildLayers, type Layer, type LayerKind } from "@/lib/layers"
import { cn } from "@/lib/utils"
import type { Item, PresetMeta, Watermark } from "@/types"

type Props = {
  item?: Item
  presets: PresetMeta[]
  wm: Watermark | null
  tool: string
  maskSel: string | null
  open: (layer: Layer) => void
  toggle: (layer: Layer) => void
  remove: (layer: Layer) => void
}

const ICON: Record<LayerKind, typeof Eye> = {
  watermark: Copyright, text: Type, image: ImagePlus, frame: Frame, background: Scissors, leak: Sun, bloom: Sparkle, dust: Wind, vignette: Aperture,
  grain: Film, mask: CircleDashed, detail: Droplet, adjust: SlidersHorizontal, look: Palette, geo: Crop, photo: Image,
}

/** Sağdaki "Katmanlar ve efektler": fotoğrafa uygulanan her şey, üstteki en son uygulanan. */
export function LayersPanel({ item, presets, wm, tool, maskSel, open, toggle, remove }: Props) {
  const layers = item ? buildLayers(item, presets, wm) : []
  const hidden = new Set(item?.hidden ?? [])
  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-l bg-card/40">
      <div className="flex items-center gap-2 px-4 pb-2 pt-4">
        <Layers className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-semibold tracking-wider text-muted-foreground">KATMANLAR VE EFEKTLER</span>
      </div>
      {!item ? (
        <p className="px-4 pt-4 text-sm text-muted-foreground">Bir fotoğraf seçince uyguladığın her şey burada katman olarak görünür.</p>
      ) : (
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          {layers.map((l) => {
            const Icon = ICON[l.kind]
            const off = hidden.has(l.key)
            const active = l.kind === "mask" ? tool === "local" && maskSel === l.maskId : l.tool === tool && l.kind !== "photo"
            return (
              <div
                key={l.key}
                onClick={() => open(l)}
                className={cn(
                  "group flex cursor-pointer items-center gap-2.5 rounded-lg border px-2 py-2 transition-colors",
                  active ? "border-primary/60 bg-primary/10" : "border-transparent hover:bg-accent/70",
                  l.kind === "photo" && "mt-2 border-dashed border-border"
                )}
              >
                <div className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted", off && "opacity-40")}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className={cn("min-w-0 flex-1", off && "opacity-50")}>
                  <p className="truncate text-xs font-medium">{l.label}</p>
                  {l.sub && <p className="truncate text-[10px] text-muted-foreground">{l.sub}</p>}
                </div>
                {l.removable && (
                  <button
                    aria-label={`${l.label} katmanını kaldır`}
                    title={l.global ? "Filigranı kapat (tüm fotoğraflar)" : "Kaldır"}
                    onClick={(e) => {
                      e.stopPropagation()
                      remove(l)
                    }}
                    className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
                {l.hideable && (
                  <button
                    aria-label={off ? "Göster" : "Gizle"}
                    title={off ? "Göster" : "Gizle (dışa aktarmaya da dahil olmaz)"}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggle(l)
                    }}
                    className={cn("rounded p-1 transition-colors", off ? "text-muted-foreground" : "text-foreground/80 hover:text-primary")}
                  >
                    {off ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                )}
              </div>
            )
          })}
          <p className="px-2 pt-3 text-[10px] leading-relaxed text-muted-foreground">
            Katmana tıklayınca ilgili araç açılır. Göz simgesi geçici olarak gizler; çöp kutusu kaldırır.
          </p>
        </div>
      )}
    </aside>
  )
}
