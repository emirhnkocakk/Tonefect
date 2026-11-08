import { useState } from "react"
import { Copy, Paintbrush, PaintBucket, Plus, ScanLine, SquareDashed, Trash2, Waypoints } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { newPathId, PEN_TOOLS, pathD } from "@/lib/paths"
import { cn } from "@/lib/utils"
import type { PenTool, VPath } from "@/types"

type Props = { paths: VPath[]; setPaths: (p: VPath[]) => void; sel: string | null; setSel: (id: string | null) => void; tool: PenTool; setTool: (t: PenTool) => void; run: (cmd: string) => void }

/** Yollar paneli: Kalem araçları, kayıtlı yollar ve yoldan seçim, maske, dolgu ve kontur. */
export function PathsPanel({ paths, setPaths, sel, setSel, tool, setTool, run }: Props) {
  const [naming, setNaming] = useState<string | null>(null)
  const entry = PEN_TOOLS.find((t) => t.id === tool)
  const cur = paths.find((p) => p.id === sel) ?? paths[paths.length - 1] ?? null
  const dup = () => {
    if (!cur) return
    const c: VPath = { ...structuredClone(cur), id: newPathId(), name: `${cur.name} kopya` }
    setPaths([...paths, c])
    setSel(c.id)
  }
  const remove = () => {
    if (!cur) return
    setPaths(paths.filter((p) => p.id !== cur.id))
    setSel(null)
  }
  const small = "grid h-7 w-7 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <Label>Araçlar</Label>
        <div className="grid grid-cols-7 gap-1">
          {PEN_TOOLS.map((t) => {
            const I = t.icon
            return <button key={t.id} aria-label={t.label} title={`${t.label} · ${t.en}`} onClick={() => setTool(t.id)} className={cn("grid h-8 place-items-center rounded-sm border transition-colors hover:border-primary/60", tool === t.id ? "border-primary/70 bg-primary/15 text-foreground" : "text-muted-foreground")}><I className="h-4 w-4" strokeWidth={1.8} /></button>
          })}
        </div>
        {entry && <p className="text-[11px] text-muted-foreground"><span className="font-medium text-foreground">{entry.label}</span> · {entry.hint}</p>}
      </section>

      <section className="space-y-1">
        <Label>Yollar</Label>
        {!paths.length && <p className="pt-1 text-[11px] text-muted-foreground">Henüz yol yok. Görüntünün üzerine tıklayarak çizmeye başla.</p>}
        {paths.map((p) => (
          <div key={p.id} onClick={() => setSel(p.id)} onDoubleClick={() => setNaming(p.id)} className={cn("flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-xs", p.id === cur?.id ? "bg-primary/20" : "hover:bg-accent/60")}>
            <svg width={30} height={22} className="shrink-0 rounded-sm bg-background"><path d={pathD(p, 30, 22)} fill="none" stroke="currentColor" strokeWidth={1} /></svg>
            {naming === p.id ? (
              <Input autoFocus aria-label="Yol adı" defaultValue={p.name} className="h-5 flex-1 px-1 text-xs" onClick={(e) => e.stopPropagation()} onBlur={(e) => { setPaths(paths.map((x) => (x.id === p.id ? { ...x, name: e.target.value.trim().slice(0, 60) || x.name } : x))); setNaming(null) }} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") (e.target as HTMLInputElement).blur() }} />
            ) : <span className="flex-1 truncate">{p.name}</span>}
            <span className="text-[10px] text-muted-foreground">{p.nodes.length} nokta</span>
          </div>
        ))}
        <div className="flex items-center justify-end gap-1 border-t pt-1">
          <button aria-label="Yeni yol" title="Yeni Yol Başlat" className={small} onClick={() => { setSel(null); setTool("pen") }}><Plus className="h-3.5 w-3.5" /></button>
          <button aria-label="Yolu çoğalt" title="Çoğalt" disabled={!cur} className={small} onClick={dup}><Copy className="h-3.5 w-3.5" /></button>
          <button aria-label="Yolu sil" title="Sil" disabled={!cur} className={small} onClick={remove}><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </section>

      <section className="space-y-2">
        <Label>Yolu Kullan</Label>
        <div className="grid grid-cols-2 gap-1.5">
          <Button variant="secondary" size="sm" className="gap-1 text-xs" disabled={!cur} onClick={() => run("path:selection")} title="Load Path as Selection · Ctrl+Enter"><SquareDashed className="!size-3.5" /> Seçime Çevir</Button>
          <Button variant="secondary" size="sm" className="gap-1 text-xs" disabled={!cur} onClick={() => run("path:mask")} title="Vector Mask: seçili katmana uygular"><ScanLine className="!size-3.5" /> Vektör Maske</Button>
          <Button variant="secondary" size="sm" className="gap-1 text-xs" disabled={!cur} onClick={() => run("path:fill")} title="Fill Path: ön plan rengiyle şekil katmanı oluşturur"><PaintBucket className="!size-3.5" /> Yolu Doldur</Button>
          <Button variant="secondary" size="sm" className="gap-1 text-xs" disabled={!cur} onClick={() => run("path:stroke")} title="Stroke Path: geçerli fırçayla yol boyunca boyar"><Paintbrush className="!size-3.5" /> Yolu Konturla</Button>
        </div>
        <Button variant="ghost" size="sm" className="w-full gap-1 text-xs" onClick={() => run("path:fromsel")} title="Make Work Path"><Waypoints className="!size-3.5" /> Seçimden Yol Oluştur</Button>
        <p className="text-[10px] text-muted-foreground">Yollar çıktıda görünmez. Kontur, Fırça aracının boyut ve rengini kullanır.</p>
      </section>
    </div>
  )
}
