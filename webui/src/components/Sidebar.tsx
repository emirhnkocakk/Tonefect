import { useState } from "react"
import { ArrowDown, ArrowUp, ImagePlus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { thumbUrl } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { Item } from "@/types"

type Props = {
  items: Item[]
  currentId: string | null
  select: (id: string) => void
  move: (id: string, dir: -1 | 1) => void
  remove: (id: string) => void
  pickFiles: () => void
  uploading: boolean
}

export function Sidebar({ items, currentId, select, move, remove, pickFiles, uploading }: Props) {
  const [over, setOver] = useState(false)
  return (
    <aside className="flex h-full w-[264px] shrink-0 flex-col border-r bg-card/40">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <span className="text-xs font-semibold tracking-wider text-muted-foreground">FOTOĞRAFLAR · {items.length}</span>
        <Button size="sm" variant="secondary" onClick={pickFiles} disabled={uploading} className="h-7 gap-1.5 text-xs">
          <ImagePlus className="!size-3.5" /> {uploading ? "Yükleniyor" : "Ekle"}
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-3" onDragOver={() => setOver(true)} onDragLeave={() => setOver(false)} onDrop={() => setOver(false)}>
        {items.length === 0 && (
          <button
            onClick={pickFiles}
            className={cn("mt-2 w-full rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground hover:border-primary/60", over && "border-primary")}
          >
            Fotoğrafları buraya sürükle
            <br />
            ya da tıkla
          </button>
        )}
        {items.map((it, i) => (
          <div
            key={it.id}
            onClick={() => select(it.id)}
            className={cn(
              "group relative flex cursor-pointer items-center gap-3 rounded-lg border border-transparent p-2 transition-colors hover:bg-accent/60",
              it.id === currentId && "border-primary/50 bg-accent"
            )}
          >
            <img src={thumbUrl(it.id)} alt="" className="h-14 w-11 shrink-0 rounded-md bg-muted object-cover" loading="lazy" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="font-semibold text-primary">{String(i + 1).padStart(2, "0")}</span>
                <span className="truncate">{it.name}</span>
              </div>
              <p className={cn("mt-0.5 line-clamp-2 text-xs leading-snug", it.text ? "text-foreground/90" : "italic text-muted-foreground/60")}>
                {it.text || "Metin yok"}
              </p>
            </div>
            <div className="absolute right-1 top-1 hidden items-center gap-0.5 rounded-md bg-background/90 p-0.5 group-hover:flex">
              <button aria-label="Yukarı" disabled={i === 0} onClick={(e) => { e.stopPropagation(); move(it.id, -1) }} className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30">
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button aria-label="Aşağı" disabled={i === items.length - 1} onClick={(e) => { e.stopPropagation(); move(it.id, 1) }} className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30">
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button aria-label="Sil" onClick={(e) => { e.stopPropagation(); remove(it.id) }} className="rounded p-1 text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
