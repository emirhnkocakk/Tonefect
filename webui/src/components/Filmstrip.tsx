import { ChevronLeft, ChevronRight, ClipboardPaste, CopyPlus, Download, ImagePlus, Trash2 } from "lucide-react"
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
  pasteTo?: (id: string) => void // kopyalanan ayar varsa
  exportOne: (id: string) => void
  duplicate: (id: string) => void
}

/** Alttaki yatay fotoğraf şeridi (Lightroom'daki gibi). */
export function Filmstrip({ items, currentId, select, move, remove, pickFiles, uploading, pasteTo, exportOne, duplicate }: Props) {
  const act = "rounded p-0.5 text-white/80 hover:text-white disabled:opacity-30"
  return (
    <div className="flex h-[104px] shrink-0 items-center gap-2 overflow-x-auto border-t bg-card/40 px-3">
      <button
        onClick={pickFiles}
        disabled={uploading}
        className="flex h-[80px] w-[64px] shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-[10px] text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground disabled:opacity-60"
        title="Fotoğraf ekle (ya da sürükleyip bırak)"
      >
        <ImagePlus className="h-5 w-5" />
        {uploading ? "Yükleniyor" : "Ekle"}
      </button>
      {items.length === 0 && <p className="px-2 text-xs text-muted-foreground">Fotoğraflarını buraya ya da önizlemeye sürükle.</p>}
      {items.map((it, i) => (
        <div
          key={it.id}
          onClick={() => select(it.id)}
          title={`${i + 1}. ${it.name}${it.text ? " — " + it.text : ""}`}
          className={cn(
            "group relative h-[80px] w-[64px] shrink-0 cursor-pointer overflow-hidden rounded-lg ring-offset-2 ring-offset-background transition",
            it.id === currentId ? "ring-2 ring-primary" : "opacity-80 hover:opacity-100 hover:ring-1 hover:ring-primary/50"
          )}
        >
          <img src={thumbUrl(it.id)} alt="" className="h-full w-full bg-muted object-cover" loading="lazy" draggable={false} />
          <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[9px] font-semibold text-white">{String(i + 1).padStart(2, "0")}</span>
          <div className="absolute inset-x-0 bottom-0 hidden items-center justify-between bg-black/65 px-0.5 py-0.5 group-hover:flex">
            <button aria-label="Sola taşı" disabled={i === 0} onClick={(e) => { e.stopPropagation(); move(it.id, -1) }} className={act}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button aria-label="Dışa aktar" title="Yalnızca bu fotoğrafı dışa aktar" onClick={(e) => { e.stopPropagation(); exportOne(it.id) }} className={act}>
              <Download className="h-3 w-3" />
            </button>
            <button aria-label="Çoğalt" title="Çoğalt: aynı fotoğrafı başka bir düzenleme için kopyala" onClick={(e) => { e.stopPropagation(); duplicate(it.id) }} className={act}>
              <CopyPlus className="h-3 w-3" />
            </button>
            {pasteTo && (
              <button aria-label="Ayarları yapıştır" title="Kopyalanan ayarları yapıştır" onClick={(e) => { e.stopPropagation(); pasteTo(it.id) }} className={act}>
                <ClipboardPaste className="h-3 w-3" />
              </button>
            )}
            <button aria-label="Sil" onClick={(e) => { e.stopPropagation(); remove(it.id) }} className={cn(act, "hover:text-red-400")}>
              <Trash2 className="h-3 w-3" />
            </button>
            <button aria-label="Sağa taşı" disabled={i === items.length - 1} onClick={(e) => { e.stopPropagation(); move(it.id, 1) }} className={act}>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
