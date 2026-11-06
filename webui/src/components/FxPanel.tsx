import { useEffect, useState } from "react"
import { Shuffle, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { BackgroundPanel } from "@/components/BackgroundPanel"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { Frame, Fx, Item, Texture } from "@/types"

type Props = { item: Item; setFx: (p: Partial<Fx>, all?: boolean) => void }

type EffectKey = "bw" | "grain" | "vignette" | "leak" | "bloom" | "dust"
const EFFECTS: [EffectKey, string, number][] = [
  ["bw", "Siyah-beyaz", 1],
  ["grain", "Film greni", 0.5],
  ["vignette", "Vinyet", 0.5],
  ["leak", "Işık sızıntısı", 0.5],
  ["bloom", "Işıma", 0.4],
  ["dust", "Toz ve çizik", 0.5],
]
const FRAMES: [Frame["style"] | "none", string][] = [
  ["none", "Yok"],
  ["solid", "Düz"],
  ["polaroid", "Polaroid"],
  ["film", "Film şeridi"],
  ["line", "İnce çizgi"],
]
const FRAME_COLORS: [string, string][] = [
  ["#FFFFFF", "Beyaz"],
  ["#F4F1EA", "Krem"],
  ["#0E0E0E", "Siyah"],
  ["#B89B5E", "Altın"],
]
// render.FRAME_DEFAULT_COLOR ile aynı
const DEFAULT_COLOR: Record<Frame["style"], string> = { solid: "#FFFFFF", polaroid: "#F4F1EA", film: "#0E0E0E", line: "#FFFFFF" }

function Tile({ img, label, on, selected, badge, onClick }: { img?: string; label: string; on: boolean; selected: boolean; badge?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group block w-full text-left" title={label}>
      <div
        className={cn(
          "relative aspect-square w-full overflow-hidden rounded-lg bg-muted ring-offset-2 ring-offset-background transition",
          selected ? "ring-2 ring-primary" : on ? "ring-1 ring-primary/60" : "hover:ring-1 hover:ring-primary/50"
        )}
      >
        {img ? <img src={img} alt="" className="h-full w-full object-cover" draggable={false} /> : <div className="h-full w-full animate-pulse bg-muted" />}
        {badge && <span className="absolute right-1 top-1 rounded bg-primary px-1 text-[9px] font-semibold text-primary-foreground">{badge}</span>}
      </div>
      <span className={cn("mt-1 block truncate text-[11px]", on || selected ? "text-foreground" : "text-muted-foreground")}>{label}</span>
    </button>
  )
}

/** Efektler: her efekt kendi fotoğrafının kare önizlemesinde; tıkla aç, altta miktarını ayarla. */
export function FxPanel({ item, setFx }: Props) {
  const fx = item.fx
  const tex: Texture = fx.texture ?? {}
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [sel, setSel] = useState<EffectKey | null>(null)

  useEffect(() => {
    let alive = true
    setThumbs({})
    api.fxThumbs(item.id).then((r) => alive && setThumbs(r.thumbs)).catch(() => {})
    return () => {
      alive = false
    }
  }, [item.id])

  const value = (k: EffectKey) => (k === "bw" ? (fx.bw ? 1 : 0) : k === "grain" || k === "vignette" ? fx[k] : tex[k] ?? 0)
  const setValue = (k: EffectKey, v: number) => {
    if (k === "bw") setFx({ bw: v > 0 })
    else if (k === "grain" || k === "vignette") setFx({ [k]: v })
    else setFx({ texture: { ...tex, [k]: v } })
  }
  const click = (k: EffectKey, def: number) => {
    if (k === "bw") return setValue("bw", fx.bw ? 0 : 1)
    if (!value(k)) setValue(k, def)
    setSel(k)
  }
  const cur = sel && sel !== "bw" ? EFFECTS.find(([k]) => k === sel)! : null

  const frame = fx.frame
  const style = frame?.style ?? "none"
  const setFrame = (p: Partial<Frame>) => frame && setFx({ frame: { ...frame, ...p } })

  return (
    <div className="space-y-6">
      <section id="sec-effects" className="space-y-3">
        <Label>Efektler</Label>
        <div className="grid grid-cols-3 gap-2.5">
          {EFFECTS.map(([k, label, def]) => {
            const v = value(k)
            return (
              <Tile
                key={k}
                img={thumbs[k]}
                label={label}
                on={!!v}
                selected={sel === k && k !== "bw"}
                badge={v ? (k === "bw" ? "AÇIK" : `${Math.round(v * 100)}`) : undefined}
                onClick={() => click(k, def)}
              />
            )
          })}
        </div>
        {cur ? (
          <div className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">{cur[1]}</span>
              <div className="flex items-center gap-2">
                {cur[0] === "leak" && !!tex.leak && (
                  <button className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary" title="Sızıntının yönünü ve rengini değiştir" onClick={() => setFx({ texture: { ...tex, variant: ((tex.variant ?? 0) + 1) % 4 } })}>
                    <Shuffle className="h-3 w-3" /> {(tex.variant ?? 0) + 1}/4
                  </button>
                )}
                <span>{Math.round(value(cur[0]) * 100)}%</span>
                <button aria-label="Kapat" className="text-muted-foreground hover:text-destructive" title="Efekti kaldır" onClick={() => { setValue(cur[0], 0); setSel(null) }}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <Slider min={0} max={100} step={1} value={[Math.round(value(cur[0]) * 100)]} onValueChange={([v]) => setValue(cur[0], v / 100)} />
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">Bir efekte tıkla; miktarını burada ayarlarsın. Önizlemeler senin fotoğrafın üzerinde.</p>
        )}
      </section>

      <section id="sec-frame" className="space-y-3">
        <Label>Çerçeve</Label>
        <div className="grid grid-cols-3 gap-2.5">
          {FRAMES.map(([v, l]) => (
            <Tile
              key={v}
              img={thumbs[v === "none" ? "orig" : `frame:${v}`]}
              label={l}
              on={style === v && v !== "none"}
              selected={style === v}
              onClick={() => setFx({ frame: v === "none" ? undefined : { style: v, size: frame?.size ?? 0.4, color: frame && frame.style === v ? frame.color : null } })}
            />
          ))}
        </div>
        {frame && (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Kalınlık</span><span>{Math.round(frame.size * 100)}%</span></div>
              <Slider min={0} max={100} step={1} value={[Math.round(frame.size * 100)]} onValueChange={([v]) => setFrame({ size: v / 100 })} />
            </div>
            {frame.style !== "film" && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Renk</span>
                {FRAME_COLORS.map(([hex, name]) => (
                  <button
                    key={hex}
                    title={name}
                    aria-label={name}
                    onClick={() => setFrame({ color: hex })}
                    className={cn("h-6 w-6 rounded-full border border-black/30 ring-offset-2 ring-offset-background", (frame.color ?? DEFAULT_COLOR[frame.style]).toUpperCase() === hex && "ring-2 ring-primary")}
                    style={{ background: hex }}
                  />
                ))}
                <label className="relative h-6 w-6 cursor-pointer overflow-hidden rounded-full border border-dashed border-muted-foreground/70" title="Özel renk">
                  <input type="color" className="absolute inset-0 cursor-pointer opacity-0" onChange={(e) => setFrame({ color: e.target.value.toUpperCase() })} />
                </label>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">Görselin boyutu değişmez; fotoğraf çerçevenin içine yerleşir.</p>
          </div>
        )}
      </section>

      <section id="sec-background">
        <BackgroundPanel fx={fx} setFx={(p) => setFx(p)} />
      </section>

      <Button variant="secondary" size="sm" className="w-full" onClick={() => setFx({}, true)}>
        Renk ve efektleri tüm fotoğraflara uygula
      </Button>
    </div>
  )
}
