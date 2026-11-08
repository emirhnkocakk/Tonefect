import { Plus, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Item } from "@/types"

/** Üstteki belge sekmeleri: açık fotoğraflar arasında geçiş. Sıralama ve toplu işlemler Fotoğraf Şeridi'nde. */
export function DocTabs({ items, currentId, select, remove, add }: { items: Item[]; currentId: string | null; select: (id: string) => void; remove: (id: string) => void; add: () => void }) {
  return (
    <div className="flex h-7 shrink-0 items-end gap-px overflow-x-auto border-b bg-card px-1" role="tablist" aria-label="Açık fotoğraflar">
      {items.map((it) => (
        <div key={it.id} role="tab" aria-selected={it.id === currentId} title={it.name} onClick={() => select(it.id)} className={cn("group flex h-6 max-w-[180px] shrink-0 cursor-pointer items-center gap-1 rounded-t-sm px-2 text-[11px]", it.id === currentId ? "bg-background text-foreground" : "text-muted-foreground hover:bg-accent/60")}>
          <span className="truncate">{it.name}</span>
          <button aria-label={`${it.name} kapat`} title="Kapat" onClick={(e) => { e.stopPropagation(); remove(it.id) }} className="rounded-sm opacity-0 hover:text-destructive group-hover:opacity-100"><X className="h-3 w-3" /></button>
        </div>
      ))}
      <button aria-label="Fotoğraf ekle" title="Fotoğraf Aç (Ctrl+O)" onClick={add} className="mb-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"><Plus className="h-3.5 w-3.5" /></button>
    </div>
  )
}
