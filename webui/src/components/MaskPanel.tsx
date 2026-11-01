import { Circle, RotateCcw, SquareSplitVertical, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { canvasSize } from "@/lib/geo"
import { cn } from "@/lib/utils"
import type { Item, Mask, MaskAdjust } from "@/types"

type Props = {
  item: Item
  selected: string | null
  select: (id: string | null) => void
  setMasks: (m: Mask[]) => void
  show: boolean
  setShow: (v: boolean) => void
}

const KEYS: [keyof MaskAdjust, string][] = [
  ["exposure", "Pozlama"],
  ["contrast", "Kontrast"],
  ["highlights", "Parlak alanlar"],
  ["shadows", "Gölgeler"],
  ["temperature", "Sıcaklık"],
  ["tint", "Renk tonu"],
  ["saturation", "Doygunluk"],
  ["clarity", "Netlik"],
]
export const MAX_MASKS = 8

const label = (m: Mask, i: number) => `${m.type === "linear" ? "Degrade" : "Daire"} ${i + 1}`

export function MaskPanel({ item, selected, select, setMasks, show, setShow }: Props) {
  const masks = item.fx.masks ?? []
  const cur = masks.find((m) => m.id === selected) ?? null
  const set = (p: Partial<Mask>) => cur && setMasks(masks.map((m) => (m.id === cur.id ? { ...m, ...p } : m)))

  const add = (type: Mask["type"]) => {
    const [w, h] = canvasSize(item.geo, item.src) ?? [1080, 1350]
    const id = Math.random().toString(36).slice(2, 9)
    const m: Mask =
      type === "linear"
        ? { id, type, a: [0.5, 0.05], b: [0.5, 0.5], invert: false, adjust: { exposure: -0.3 } }
        : { id, type, c: [0.5, 0.5], r: [0.25, (0.25 * w) / h], feather: 0.5, invert: false, adjust: { exposure: 0.3 } }
    setMasks([...masks, m])
    select(id)
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Yerel düzenlemeler</Label>
        <p className="text-[11px] text-muted-foreground">
          Yalnızca bir bölgeyi değiştir: gökyüzünü koyulaştırmak için degrade, bir yüzü ya da nesneyi öne çıkarmak için daire.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="sm" disabled={masks.length >= MAX_MASKS} onClick={() => add("linear")}>
            <SquareSplitVertical className="!size-4" /> Degrade
          </Button>
          <Button variant="secondary" size="sm" disabled={masks.length >= MAX_MASKS} onClick={() => add("radial")}>
            <Circle className="!size-4" /> Daire
          </Button>
        </div>
      </div>

      {masks.length > 0 && (
        <div className="space-y-1.5">
          {masks.map((m, i) => (
            <div
              key={m.id}
              onClick={() => select(m.id === selected ? null : m.id)}
              className={cn(
                "group flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors hover:border-primary/60",
                m.id === selected ? "border-primary/70 bg-primary/15" : "text-muted-foreground"
              )}
            >
              <span className="flex items-center gap-2">
                {m.type === "linear" ? <SquareSplitVertical className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                {label(m, i)}
                {m.invert && <span className="text-[10px] opacity-70">(ters)</span>}
              </span>
              <button
                aria-label="Sil"
                onClick={(e) => {
                  e.stopPropagation()
                  setMasks(masks.filter((x) => x.id !== m.id))
                  if (m.id === selected) select(null)
                }}
                className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {cur ? (
        <div className="space-y-4">
          <p className="text-[11px] text-muted-foreground">
            {cur.type === "linear"
              ? "Önizlemedeki tutamaçları sürükle: dolu çizgide tam etki, kesikli çizgide etki biter. Ortadaki tutamaç ikisini birlikte taşır."
              : "Ortadaki tutamaçla taşı, kenardakilerle genişlet. İçte tam etki, kesikli çizgiden sonra yumuşakça azalır."}
          </p>
          <div className="flex items-center justify-between">
            <Label>Maskeyi göster</Label>
            <Switch checked={show} onCheckedChange={setShow} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Tersine çevir</Label>
              <p className="text-[11px] text-muted-foreground">Seçili bölgenin dışını etkiler</p>
            </div>
            <Switch checked={cur.invert} onCheckedChange={(v) => set({ invert: v })} />
          </div>
          {cur.type === "radial" && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Yumuşaklık</span>
                <span>{Math.round((cur.feather ?? 0.5) * 100)}%</span>
              </div>
              <Slider min={0} max={100} step={1} value={[Math.round((cur.feather ?? 0.5) * 100)]} onValueChange={([v]) => set({ feather: v / 100 })} />
            </div>
          )}
          <div className="flex items-center justify-between">
            <Label>Bu bölgenin ayarları</Label>
            <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary" onClick={() => set({ adjust: {} })}>
              <RotateCcw className="h-3 w-3" /> sıfırla
            </button>
          </div>
          {KEYS.map(([k, name]) => {
            const v = Math.round((cur.adjust[k] ?? 0) * 100)
            return (
              <div key={k} className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="cursor-default text-muted-foreground" onDoubleClick={() => set({ adjust: { ...cur.adjust, [k]: 0 } })} title="Çift tıkla: sıfırla">
                    {name}
                  </span>
                  <span className={cn(v ? "text-foreground" : "text-muted-foreground")}>{v > 0 ? `+${v}` : v}</span>
                </div>
                <Slider min={-100} max={100} step={1} value={[v]} onValueChange={([x]) => set({ adjust: { ...cur.adjust, [k]: x / 100 } })} />
              </div>
            )
          })}
          <p className="text-[11px] text-muted-foreground">Ayarı hep sıfır olan maske görsele etki etmez.</p>
        </div>
      ) : (
        masks.length > 0 && <p className="text-[11px] text-muted-foreground">Düzenlemek için bir maske seç.</p>
      )}
    </div>
  )
}
