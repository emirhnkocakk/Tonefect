import { FlipHorizontal2, FlipVertical2, Link2, RotateCcw, RotateCw, Unlink2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ASPECTS, MAX_SIDE, SIZE_PRESETS, canvasSize, naturalSize } from "@/lib/geo"
import { cn } from "@/lib/utils"
import type { Geo, Item } from "@/types"

type Props = {
  item: Item
  geo: Geo
  setGeo: (p: Partial<Geo>) => void
  applyAll: () => void
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="secondary" size="icon-sm" aria-label={label} onClick={onClick} className="h-9 w-full">
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function GeoPanel({ item, geo, setGeo, applyAll }: Props) {
  const src = item.src
  const nat = src ? naturalSize(geo, src) : null
  const out = canvasSize(geo, src)
  const locked = geo.lock !== false
  const ratio = nat ? nat[0] / nat[1] : out ? out[0] / out[1] : 1
  const clampSide = (v: number) => Math.max(16, Math.min(MAX_SIDE, Math.round(v) || 16))

  const setW = (v: number) => {
    const w = clampSide(v)
    setGeo({ outW: w, outH: locked ? clampSide(w / ratio) : geo.outH ?? out?.[1] ?? w })
  }
  const setH = (v: number) => {
    const h = clampSide(v)
    setGeo({ outH: h, outW: locked ? clampSide(h * ratio) : geo.outW ?? out?.[0] ?? h })
  }
  const longEdge = (n: number | null) => {
    if (!n) return setGeo({ outW: null, outH: null, lock: true })
    setGeo(ratio >= 1 ? { outW: n, outH: clampSide(n / ratio), lock: true } : { outH: n, outW: clampSide(n * ratio), lock: true })
  }
  const curLong = geo.outW && geo.outH ? Math.max(geo.outW, geo.outH) : null
  const upscale = !!(nat && out && out[0] * out[1] > nat[0] * nat[1] * 1.02)
  const stretched = !!(out && Math.abs(out[0] / out[1] - ratio) / ratio > 0.01)

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label>Oran</Label>
        <div className="grid grid-cols-4 gap-1.5">
          {ASPECTS.map(([value, label, sub]) => (
            <button
              key={value}
              onClick={() => setGeo({ aspect: value, crop: null, outW: null, outH: null, lock: true })}
              className={cn(
                "flex flex-col items-center rounded-lg border px-1 py-1.5 text-xs transition-colors hover:border-primary/60",
                geo.aspect === value ? "border-primary/70 bg-primary/15 text-foreground" : "text-muted-foreground"
              )}
            >
              <span className="font-medium">{label}</span>
              <span className="text-[10px] opacity-70">{sub ?? (value === "free" ? "elle" : "fotoğraf")}</span>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">Kırpma çerçevesini önizlemede sürükleyerek ayarla.</p>
      </div>

      <div className="space-y-2">
        <Label>Döndür ve çevir</Label>
        <div className="grid grid-cols-4 gap-1.5">
          <IconBtn label="Sola döndür" onClick={() => setGeo({ rotate: (geo.rotate + 270) % 360, crop: null })}>
            <RotateCcw className="h-4 w-4" />
          </IconBtn>
          <IconBtn label="Sağa döndür" onClick={() => setGeo({ rotate: (geo.rotate + 90) % 360, crop: null })}>
            <RotateCw className="h-4 w-4" />
          </IconBtn>
          <IconBtn label="Yatay çevir" onClick={() => setGeo({ flipH: !geo.flipH })}>
            <FlipHorizontal2 className="h-4 w-4" />
          </IconBtn>
          <IconBtn label="Dikey çevir" onClick={() => setGeo({ flipV: !geo.flipV })}>
            <FlipVertical2 className="h-4 w-4" />
          </IconBtn>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Düzelt (eğim)</Label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{geo.straighten > 0 ? "+" : ""}{geo.straighten.toFixed(1)}°</span>
            {geo.straighten !== 0 && (
              <button className="text-xs text-muted-foreground hover:text-primary" onClick={() => setGeo({ straighten: 0 })}>
                sıfırla
              </button>
            )}
          </div>
        </div>
        <Slider min={-45} max={45} step={0.5} value={[geo.straighten]} onValueChange={([v]) => setGeo({ straighten: v })} />
        <p className="text-[11px] text-muted-foreground">Eğik ufku düzeltir; boş köşeler otomatik kırpılır.</p>
      </div>

      <div className="space-y-2">
        <Label>Çıktı boyutu</Label>
        <div className="grid grid-cols-4 gap-1.5">
          {SIZE_PRESETS.map(([label, n]) => (
            <button
              key={label}
              onClick={() => longEdge(n)}
              className={cn(
                "rounded-lg border py-1.5 text-xs transition-colors hover:border-primary/60",
                curLong === n || (!n && !geo.outW) ? "border-primary/70 bg-primary/15 text-foreground" : "text-muted-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            aria-label="Genişlik"
            value={out?.[0] ?? ""}
            onChange={(e) => e.target.value && setW(Number(e.target.value))}
            className="h-8 text-center text-xs"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={locked ? "Oran kilitli" : "Oran serbest"}
                onClick={() => (locked ? setGeo({ lock: false }) : setGeo({ lock: true, outW: out?.[0] ?? null, outH: out ? clampSide(out[0] / ratio) : null }))}
                className={cn("shrink-0", locked ? "text-primary" : "text-muted-foreground")}
              >
                {locked ? <Link2 className="h-4 w-4" /> : <Unlink2 className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{locked ? "Oran kilitli – kilidi açarsan esnetebilirsin" : "Oran serbest (esnetme) – kilitle"}</TooltipContent>
          </Tooltip>
          <Input
            type="number"
            aria-label="Yükseklik"
            value={out?.[1] ?? ""}
            onChange={(e) => e.target.value && setH(Number(e.target.value))}
            className="h-8 text-center text-xs"
          />
          <span className="text-xs text-muted-foreground">px</span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {nat ? `Kırpılan alan ${nat[0]} × ${nat[1]} px` : "Kırpılan alanın boyutu hesaplanıyor…"}
          {upscale && " · büyütülüyor"}
          {stretched && " · esnetiliyor"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" size="sm" className="text-xs" onClick={() => setGeo({ crop: null, rotate: 0, flipH: false, flipV: false, straighten: 0, outW: null, outH: null, lock: true })}>
          <RotateCcw className="!size-3.5" /> Sıfırla
        </Button>
        <Button variant="secondary" size="sm" className="text-xs" onClick={applyAll}>
          Tümüne uygula
        </Button>
      </div>
      <p className="-mt-3 text-[11px] text-muted-foreground">"Tümüne uygula" oranı ve çıktı boyutunu diğer fotoğraflara kopyalar.</p>
    </div>
  )
}
