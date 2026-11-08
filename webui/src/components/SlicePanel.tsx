import { useState } from "react"
import { Download, Grid2x2, MousePointer2, RotateCcw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { canvasSize } from "@/lib/geo"
import { cn } from "@/lib/utils"
import type { Item, Slice } from "@/types"

type Props = {
  item: Item
  tool: "draw" | "select"
  setTool: (t: "draw" | "select") => void
  sel: string | null
  setSel: (id: string | null) => void
  setSlices: (s: Slice[]) => void
  onExport: () => void
}

const newId = () => Math.random().toString(36).slice(2, 9)
const QUICK: [string, string, number, number][] = [
  ["Kaydırmalı Gönderi", "3 × 1", 3, 1],
  ["Izgara", "3 × 3", 3, 3],
  ["İkiye Böl", "2 × 1", 2, 1],
  ["Dörde Böl", "2 × 2", 2, 2],
]

/** Dilimleme: görseli parçalara ayırır; her parça ayrı dosya olarak dışa aktarılır. */
export function SlicePanel({ item, tool, setTool, sel, setSel, setSlices, onExport }: Props) {
  const slices = item.slices ?? []
  const [W, H] = canvasSize(item.geo, item.src) ?? [1080, 1350]
  const [cols, setCols] = useState(3)
  const [rows, setRows] = useState(1)
  const cur = slices.find((s) => s.id === sel) ?? null

  const divide = (c: number, r: number) => {
    const out: Slice[] = []
    for (let y = 0; y < r; y++) for (let x = 0; x < c; x++) out.push({ id: newId(), x: x / c, y: y / r, w: 1 / c, h: 1 / r })
    setSlices(out)
    setSel(null)
  }
  const count = (v: string) => Math.max(1, Math.min(12, Math.round(Number(v)) || 1))

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-1.5">
        {([["draw", "Dilim", "Sürükleyerek çiz", Grid2x2], ["select", "Dilim Seçimi", "Taşı, boyutlandır", MousePointer2]] as const).map(([m, l, s, I]) => (
          <button
            key={m}
            onClick={() => setTool(m)}
            className={cn(
              "flex flex-col items-center gap-0.5 rounded-lg border px-1 py-2 text-xs transition-colors hover:border-primary/60",
              tool === m ? "border-primary/70 bg-primary/15 text-foreground" : "text-muted-foreground"
            )}
          >
            <I className="h-4 w-4" strokeWidth={1.8} />
            <span className="font-medium">{l}</span>
            <span className="text-[10px] opacity-70">{s}</span>
          </button>
        ))}
      </div>

      <section className="space-y-2">
        <Label>Eşit Böl</Label>
        <div className="grid grid-cols-2 gap-1.5">
          {QUICK.map(([l, s, c, r]) => (
            <button key={l} onClick={() => divide(c, r)} className="flex flex-col items-center rounded-lg border px-1 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/60">
              <span className="font-medium">{l}</span>
              <span className="text-[10px] opacity-70">{s}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <Input type="number" aria-label="Sütun" min={1} max={12} value={cols} onChange={(e) => setCols(count(e.target.value))} className="h-8 text-center text-xs" />
          <span className="text-xs text-muted-foreground">×</span>
          <Input type="number" aria-label="Satır" min={1} max={12} value={rows} onChange={(e) => setRows(count(e.target.value))} className="h-8 text-center text-xs" />
          <Button variant="secondary" size="sm" className="h-8 shrink-0 text-xs" onClick={() => divide(cols, rows)}>Böl</Button>
        </div>
      </section>

      {slices.length > 0 ? (
        <section className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>Dilimler ({slices.length})</Label>
            <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary" onClick={() => { setSlices([]); setSel(null) }}>
              <RotateCcw className="h-3 w-3" /> temizle
            </button>
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {slices.map((s, i) => (
              <div
                key={s.id}
                onClick={() => { setSel(s.id); setTool("select") }}
                className={cn("group flex cursor-pointer items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs transition-colors hover:border-primary/60", s.id === sel ? "border-primary/70 bg-primary/15" : "text-muted-foreground")}
              >
                <span className="truncate">{s.name || String(i + 1).padStart(2, "0")}</span>
                <span className="flex items-center gap-2">
                  <span className="text-[10px] opacity-70">{Math.round(s.w * W)} × {Math.round(s.h * H)}</span>
                  <button aria-label="Dilimi sil" className="opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100" onClick={(e) => { e.stopPropagation(); setSlices(slices.filter((x) => x.id !== s.id)); if (s.id === sel) setSel(null) }}>
                    <Trash2 className="h-3 w-3" />
                  </button>
                </span>
              </div>
            ))}
          </div>
          {cur && <Input value={cur.name ?? ""} placeholder="Dilim adı (dosya adına eklenir)" onChange={(e) => setSlices(slices.map((x) => (x.id === cur.id ? { ...x, name: e.target.value.slice(0, 30) } : x)))} className="h-8 text-xs" />}
          <Button className="w-full" onClick={onExport}>
            <Download className="!size-4" /> Dilimleri Dışa Aktar
          </Button>
          <p className="text-[11px] text-muted-foreground">Her dilim ayrı dosya olarak çıktı klasörüne kaydedilir; biçim ve kalite ayarlardan gelir.</p>
        </section>
      ) : (
        <p className="text-[11px] text-muted-foreground">Fotoğrafın üzerinde sürükleyerek dilim çiz ya da yukarıdan eşit parçalara böl.</p>
      )}
    </div>
  )
}
