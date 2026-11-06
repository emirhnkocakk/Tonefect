import { FlipHorizontal2, FlipVertical2, Link2, RotateCcw, RotateCw, Spline, Unlink2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ASPECTS, MAX_SIDE, SIZE_PRESETS, naturalSize, photoSize, ratioOf } from "@/lib/geo"
import { PLATFORMS, platformGroups, platformOf, ratioText } from "@/lib/platforms"
import { cn } from "@/lib/utils"
import type { CanvasExt, Geo, Item } from "@/types"

type Props = {
  item: Item
  geo: Geo
  setGeo: (p: Partial<Geo>) => void
  applyAll: () => void
  perspEdit: boolean
  setPerspEdit: (v: boolean) => void
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

export function GeoPanel({ item, geo, setGeo, applyAll, perspEdit, setPerspEdit }: Props) {
  const src = item.src
  const nat = src ? naturalSize(geo, src) : null
  const out = photoSize(geo, src)
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
        <Label id="sec-ratio">Oran</Label>
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
        {!!ratioOf(geo.aspect) && (
          <div className="grid grid-cols-2 gap-1.5">
            {([[null, "Kırparak", "kenarlar kesilir"], ["content", "İçeriğe duyarlı", "hiçbir şey kesilmez"]] as const).map(([v, l, s]) => (
              <button
                key={l}
                onClick={() => setGeo({ fit: v, crop: null, outW: null, outH: null, lock: true })}
                className={cn(
                  "flex flex-col items-center rounded-lg border px-1 py-1.5 text-xs transition-colors hover:border-primary/60",
                  (geo.fit ?? null) === v ? "border-primary/70 bg-primary/15 text-foreground" : "text-muted-foreground"
                )}
              >
                <span className="font-medium">{l}</span>
                <span className="text-[10px] opacity-70">{s}</span>
              </button>
            ))}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          {geo.fit === "content" && ratioOf(geo.aspect)
            ? "Fotoğraf orana kesilmeden sığdırılır: gökyüzü, duvar gibi boş alanlar daralır, kişiler ve nesneler korunur. İstersen önce kırpabilirsin."
            : "Kırpma çerçevesini önizlemede sürükleyerek ayarla."}
        </p>
      </div>

      <div className="space-y-2">
        <Label id="sec-rotate">Döndür ve çevir</Label>
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

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label id="sec-persp">Perspektif kırpma</Label>
          {geo.persp && (
            <button className="text-xs text-muted-foreground hover:text-primary" onClick={() => setGeo({ persp: null, crop: null })}>
              sıfırla
            </button>
          )}
        </div>
        <Button variant={perspEdit ? "default" : "secondary"} size="sm" className="w-full" onClick={() => setPerspEdit(!perspEdit)}>
          <Spline className="!size-4" /> {perspEdit ? "Bitti" : geo.persp ? "Perspektifi düzenle" : "Perspektifi düzelt"}
        </Button>
        <p className="text-[11px] text-muted-foreground">
          {perspEdit
            ? "Dört köşeyi eğik görünen binanın, belgenin ya da tablonun köşelerine sürükle. Bitince düzleştirilmiş hali kırpabilirsin."
            : "Eğik çekilmiş bir yüzeyi düz, karşıdan bakılmış gibi yapar."}
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label id="sec-straighten">Düzelt (eğim)</Label>
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
        <Label id="sec-size">Çıktı boyutu</Label>
        <select
          aria-label="Platforma göre boyut"
          value=""
          onChange={(e) => {
            const pl = platformOf(e.target.value)
            if (pl) setGeo({ aspect: ratioText(pl.w, pl.h), crop: null, fit: geo.fit ?? null, outW: pl.w, outH: pl.h, lock: true })
          }}
          className="h-8 w-full rounded-md border bg-background px-2 text-xs text-muted-foreground"
        >
          <option value="">Platforma göre seç (Instagram, YouTube, baskı…)</option>
          {platformGroups().map((g) => (
            <optgroup key={g} label={g}>
              {PLATFORMS.filter((p) => p.group === g).map((p) => (
                <option key={p.id} value={p.id}>{p.label} · {p.w}×{p.h}</option>
              ))}
            </optgroup>
          ))}
        </select>
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

      {out && <CanvasSection photo={out} canvas={geo.canvas ?? null} set={(c) => setGeo({ canvas: c })} />}

      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" size="sm" className="text-xs" onClick={() => setGeo({ crop: null, rotate: 0, flipH: false, flipV: false, straighten: 0, outW: null, outH: null, lock: true, canvas: null, persp: null, fit: null })}>
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

const CANVAS_COLORS: [string, string][] = [
  ["#FFFFFF", "Beyaz"],
  ["#F4F1EA", "Krem"],
  ["#0E0E0E", "Siyah"],
  ["#B89B5E", "Altın"],
]
const ANCHORS: [number, number][] = [0, 0.5, 1].flatMap((y) => [0, 0.5, 1].map((x) => [x, y] as [number, number]))

/** Tuval boyutu (Photoshop: Canvas Size): fotoğrafı küçültmeden çevresine boşluk ekler. */
function CanvasSection({ photo, canvas, set }: { photo: [number, number]; canvas: CanvasExt | null; set: (c: CanvasExt | null) => void }) {
  const c: CanvasExt = canvas ?? { w: photo[0], h: photo[1], anchor: [0.5, 0.5], color: "#FFFFFF" }
  const put = (p: Partial<CanvasExt>) => {
    const n = { ...c, ...p }
    set(n.w === photo[0] && n.h === photo[1] ? null : n)
  }
  const side = (v: number) => Math.max(16, Math.min(MAX_SIDE, Math.round(v) || 16))
  const pad = (f: number) => put({ w: side(photo[0] + Math.max(photo[0], photo[1]) * f * 2), h: side(photo[1] + Math.max(photo[0], photo[1]) * f * 2) })
  const ratio = (r: number) => {
    const [w, h] = photo
    put(w / h > r ? { w, h: side(w / r) } : { w: side(h * r), h })
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label id="sec-canvas">Tuval boyutu</Label>
        {canvas && (
          <button className="text-xs text-muted-foreground hover:text-primary" onClick={() => set(null)}>
            kaldır
          </button>
        )}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {([["Kare", () => ratio(1)], ["4:5", () => ratio(4 / 5)], ["9:16", () => ratio(9 / 16)], ["+%5 kenar", () => pad(0.05)]] as [string, () => void][]).map(([l, fn]) => (
          <button key={l} onClick={fn} className="rounded-lg border py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/60">
            {l}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <Input type="number" aria-label="Tuval genişliği" value={c.w} onChange={(e) => e.target.value && put({ w: side(Number(e.target.value)) })} className="h-8 text-center text-xs" />
        <span className="text-xs text-muted-foreground">×</span>
        <Input type="number" aria-label="Tuval yüksekliği" value={c.h} onChange={(e) => e.target.value && put({ h: side(Number(e.target.value)) })} className="h-8 text-center text-xs" />
        <span className="text-xs text-muted-foreground">px</span>
      </div>
      <div className="flex items-start gap-3">
        <div className="grid shrink-0 grid-cols-3 gap-0.5 rounded-md border p-0.5" aria-label="Fotoğrafın yeri">
          {ANCHORS.map(([x, y]) => {
            const on = c.anchor[0] === x && c.anchor[1] === y
            return (
              <button
                key={`${x}-${y}`}
                title="Fotoğrafı buraya yasla"
                onClick={() => put({ anchor: [x, y] })}
                className={cn("grid h-5 w-5 place-items-center rounded-sm hover:bg-primary/20", on && "bg-primary/30")}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", on ? "bg-primary" : "bg-muted-foreground/50")} />
              </button>
            )
          })}
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            {CANVAS_COLORS.map(([hex, name]) => (
              <button
                key={hex}
                title={name}
                aria-label={name}
                onClick={() => put({ color: hex })}
                className={cn("h-6 w-6 rounded-full border border-black/30 ring-offset-2 ring-offset-background", c.color.toUpperCase() === hex && "ring-2 ring-primary")}
                style={{ background: hex }}
              />
            ))}
            <button
              title="Şeffaf"
              aria-label="Şeffaf"
              onClick={() => put({ color: "transparent" })}
              className={cn("h-6 w-6 rounded-full border border-black/30 ring-offset-2 ring-offset-background", c.color === "transparent" && "ring-2 ring-primary")}
              style={{ background: "repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 8px 8px" }}
            />
            <label className="relative h-6 w-6 cursor-pointer overflow-hidden rounded-full border border-dashed border-muted-foreground/70" title="Özel renk">
              <input type="color" className="absolute inset-0 cursor-pointer opacity-0" onChange={(e) => put({ color: e.target.value.toUpperCase() })} />
            </label>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {canvas ? `Fotoğraf ${photo[0]} × ${photo[1]} px; çevresine boşluk eklendi.` : "Fotoğrafı küçültmeden çevresine boşluk ekler."}
          </p>
        </div>
      </div>
    </div>
  )
}
