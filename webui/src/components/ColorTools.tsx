import { useEffect, useRef, useState } from "react"
import { ImagePlus, Loader2, Pipette, RotateCcw, Upload } from "lucide-react"
import { toast } from "sonner"
import { AdjustPanel } from "@/components/AdjustPanel"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, thumbUrl } from "@/lib/api"
import { COLOR_GRID, colorActive, splineAt } from "@/lib/color"
import { cn } from "@/lib/utils"
import type { ColorEdits, ColorToolId, Fx, Item, PresetMeta } from "@/types"

export type ColorPick = (rgb: [number, number, number]) => void
type Props = {
  item: Item
  items: Item[]
  tool: ColorToolId
  setTool: (t: ColorToolId) => void
  setFx: (p: Partial<Fx>) => void
  presets: PresetMeta[]
  onPresetsChange: () => Promise<void>
  preview: string | null
  setPick: (f: ColorPick | null) => void
  noBasic?: boolean // ayar katmanında temel ayarlar yok
}

function Num({ id, label, v, set, min = -100, max = 100, unit = "", dflt = 0 }: { id?: string; label: string; v: number; set: (x: number) => void; min?: number; max?: number; unit?: string; dflt?: number }) {
  return (
    <div id={id} className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="cursor-default text-muted-foreground" title="Çift tıkla: sıfırla" onDoubleClick={() => set(dflt)}>{label}</span>
        <span>{v > 0 && min < 0 ? "+" : ""}{v}{unit}</span>
      </div>
      <Slider min={min} max={max} step={1} value={[v]} onValueChange={([x]) => set(x)} />
    </div>
  )
}
// oranlar 0..1 saklanır, arayüzde yüzde görünür
const Pct = ({ id, label, v, set, min = -100, max = 100, dflt = 0 }: { id?: string; label: string; v: number | undefined; set: (x: number) => void; min?: number; max?: number; dflt?: number }) => (
  <Num id={id} label={label} v={Math.round((v ?? dflt) * 100)} min={min} max={max} dflt={Math.round(dflt * 100)} set={(x) => set(x / 100)} />
)
const Chips = ({ value, set, options }: { value: string; set: (v: string) => void; options: [string, string][] }) => (
  <div className="flex flex-wrap gap-1">
    {options.map(([v, l]) => (
      <button key={v} onClick={() => set(v)} className={cn("rounded-md border px-2 py-0.5 text-[11px] transition-colors hover:border-primary/60", value === v ? "border-primary/70 bg-primary/15 text-foreground" : "text-muted-foreground")}>{l}</button>
    ))}
  </div>
)
const Toggle = ({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) => (
  <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{label}</span><Switch checked={on} onCheckedChange={set} /></div>
)
const Swatch = ({ value, set }: { value: string; set: (v: string) => void }) => (
  <label className="relative block h-7 w-7 cursor-pointer overflow-hidden rounded-md border" style={{ background: value }}>
    <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={value} onChange={(e) => set(e.target.value.toUpperCase())} />
  </label>
)
const CHANNELS: [string, string][] = [["rgb", "RGB"], ["r", "Kırmızı"], ["g", "Yeşil"], ["b", "Mavi"]]
const CH_STROKE: Record<string, string> = { rgb: "hsl(var(--foreground))", r: "#e5484d", g: "#46a758", b: "#3e63dd" }

function Histogram({ src, ch }: { src: string | null; ch: string }) {
  const [path, setPath] = useState("")
  useEffect(() => {
    if (!src) return
    let alive = true
    const img = new Image()
    img.onload = () => {
      if (!alive) return
      const c = document.createElement("canvas")
      c.width = 256
      c.height = Math.max(1, Math.round((256 * img.height) / img.width))
      const g = c.getContext("2d", { willReadFrequently: true })!
      g.drawImage(img, 0, 0, c.width, c.height)
      const d = g.getImageData(0, 0, c.width, c.height).data
      const bins = new Array(256).fill(0)
      for (let i = 0; i < d.length; i += 4) {
        const v = ch === "rgb" ? Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) : d[i + (ch === "r" ? 0 : ch === "g" ? 1 : 2)]
        bins[v]++
      }
      const top = [...bins].sort((a, b) => b - a)[4] || 1 // tek bir uçtaki tepe grafiği ezmesin
      setPath(`M0 100 ${bins.map((b, i) => `L${(i / 255) * 256} ${100 - Math.min(100, (b / top) * 100)}`).join(" ")} L256 100 Z`)
    }
    img.src = src
    return () => {
      alive = false
    }
  }, [src, ch])
  return (
    <svg viewBox="0 0 256 100" preserveAspectRatio="none" className="h-16 w-full rounded bg-muted/40">
      <path d={path} fill={ch === "rgb" ? "hsl(var(--muted-foreground))" : CH_STROKE[ch]} opacity={0.75} />
    </svg>
  )
}

type P2 = [number, number]
const IDENT: P2[] = [[0, 0], [1, 1]]

function CurveEditor({ pts, set, stroke, src, ch }: { pts: P2[]; set: (p: P2[]) => void; stroke: string; src: string | null; ch: string }) {
  const ref = useRef<SVGSVGElement>(null)
  const drag = useRef<number | null>(null)
  const S = 240
  const at = (e: { clientX: number; clientY: number }): P2 => {
    const r = ref.current!.getBoundingClientRect()
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))]
  }
  const down = (e: React.PointerEvent) => {
    const p = at(e)
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    let i = pts.findIndex(([x, y]) => Math.hypot(x - p[0], y - p[1]) < 0.05)
    if (i < 0) {
      if (pts.length >= 14) return
      const next = [...pts, p].sort((a, b) => a[0] - b[0]) as P2[]
      i = next.indexOf(p)
      set(next)
    }
    drag.current = i
  }
  const move = (e: React.PointerEvent) => {
    const i = drag.current
    if (i === null) return
    const [x, y] = at(e)
    const lo = i === 0 ? 0 : pts[i - 1][0] + 0.01
    const hi = i === pts.length - 1 ? 1 : pts[i + 1][0] - 0.01
    set(pts.map((p, q) => (q === i ? [Math.min(hi, Math.max(lo, x)), y] : p)) as P2[])
  }
  const remove = (e: React.MouseEvent) => {
    const p = at(e)
    const i = pts.findIndex(([x, y]) => Math.hypot(x - p[0], y - p[1]) < 0.05)
    if (i > 0 && i < pts.length - 1) set(pts.filter((_, q) => q !== i))
  }
  const line = splineAt(pts).map((y, i, a) => `${i ? "L" : "M"}${(i / (a.length - 1)) * S} ${(1 - y) * S}`).join(" ")
  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-0 opacity-60"><HistogramFill src={src} ch={ch} /></div>
      <svg ref={ref} viewBox={`0 0 ${S} ${S}`} className="relative aspect-square w-full touch-none rounded border bg-transparent" onPointerDown={down} onPointerMove={move} onPointerUp={() => (drag.current = null)} onDoubleClick={remove}>
        {[1, 2, 3].map((i) => <path key={i} d={`M${(i * S) / 4} 0V${S}M0 ${(i * S) / 4}H${S}`} stroke="hsl(var(--border))" strokeWidth={1} />)}
        <path d={`M0 ${S}L${S} 0`} stroke="hsl(var(--border))" strokeWidth={1} />
        <path d={line} fill="none" stroke={stroke} strokeWidth={2} />
        {pts.map(([x, y], i) => <circle key={i} cx={x * S} cy={(1 - y) * S} r={4.5} fill="hsl(var(--background))" stroke={stroke} strokeWidth={1.5} />)}
      </svg>
    </div>
  )
}
const HistogramFill = ({ src, ch }: { src: string | null; ch: string }) => <div className="flex h-full items-end [&>svg]:h-full"><Histogram src={src} ch={ch} /></div>

function Wheel({ label, v, set }: { label: string; v: [number, number, number]; set: (x: [number, number, number]) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const pick = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const dx = (e.clientX - r.left) / r.width - 0.5
    const dy = (e.clientY - r.top) / r.height - 0.5
    const hue = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360
    set([Math.round(hue), Math.min(1, Math.round(Math.hypot(dx, dy) * 200) / 100), v[2]])
  }
  const a = (v[0] * Math.PI) / 180
  return (
    <div className="space-y-1.5">
      <p className="text-center text-[11px] text-muted-foreground">{label}</p>
      <div
        ref={ref}
        className="relative mx-auto aspect-square w-[92px] touch-none rounded-full border"
        style={{ background: "radial-gradient(closest-side, hsl(0 0% 50%), transparent), conic-gradient(red, yellow, lime, aqua, blue, magenta, red)" }}
        onPointerDown={(e) => {
          ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
          pick(e)
        }}
        onPointerMove={(e) => e.buttons && pick(e)}
        onDoubleClick={() => set([0, 0, v[2]])}
      >
        <span className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow" style={{ left: `${50 + 50 * v[1] * Math.sin(a)}%`, top: `${50 - 50 * v[1] * Math.cos(a)}%` }} />
      </div>
      <Slider min={-100} max={100} step={1} value={[Math.round(v[2] * 100)]} onValueChange={([x]) => set([v[0], v[1], x / 100])} />
    </div>
  )
}

const WB_LIGHTS: [string, number, number][] = [["Gün Işığı", 0, 0], ["Bulutlu", 0.18, 0.04], ["Gölge", 0.32, 0.06], ["Tungsten", -0.72, 0.12], ["Floresan", -0.4, 0.45], ["Flaş", 0.1, 0]]
const FILTERS: [string, string][] = [["Sıcak", "#EC8A00"], ["Soğuk", "#006DFF"], ["Kırmızı", "#EA1A1A"], ["Yeşil", "#19C900"], ["Sepya", "#AC7A33"], ["Macenta", "#E31D8C"]]
const GRADIENTS: [string, [number, string][]][] = [
  ["Gün Batımı", [[0, "#14102E"], [0.5, "#C2476B"], [1, "#FFE9A8"]]],
  ["Deniz", [[0, "#04152E"], [0.55, "#0E7C8A"], [1, "#DFFBF0"]]],
  ["Sepya", [[0, "#1C1108"], [0.5, "#8C6239"], [1, "#F6E8CF"]]],
  ["İki Ton", [[0, "#1B1464"], [1, "#FFD166"]]],
  ["Siyah Beyaz", [[0, "#000000"], [1, "#FFFFFF"]]],
]
const BW_PRESETS: [string, Partial<Record<"r" | "y" | "g" | "c" | "b" | "m", number>>][] = [
  ["Varsayılan", { r: 0.4, y: 0.6, g: 0.4, c: 0.6, b: 0.2, m: 0.8 }],
  ["Yüksek Kontrast", { r: 0.9, y: 0.8, g: 0.3, c: 0.2, b: -0.3, m: 0.6 }],
  ["Kızılötesi", { r: -0.4, y: 2.2, g: 2.4, c: -0.6, b: -0.3, m: -0.3 }],
  ["Mavi Filtre", { r: -0.2, y: 0.2, g: 0.5, c: 1.1, b: 1.5, m: 0.9 }],
]
const BW_KEYS: ["r" | "y" | "g" | "c" | "b" | "m", string][] = [["r", "Kırmızılar"], ["y", "Sarılar"], ["g", "Yeşiller"], ["c", "Camgöbekleri"], ["b", "Maviler"], ["m", "Macentalar"]]
const BANDS: [string, string][] = [["Red", "Kırmızı"], ["Yellow", "Sarı"], ["Green", "Yeşil"], ["Cyan", "Camgöbeği"], ["Blue", "Mavi"], ["Magenta", "Macenta"], ["White", "Beyaz"], ["Neutral", "Nötr"], ["Black", "Siyah"]]

/** Renk ve Işık düzenlemeleri: araç ızgarası ve seçili aracın ayarları. */
export function ColorTools({ item, items, tool, setTool, setFx, presets, onPresetsChange, preview, setPick, noBasic }: Props) {
  const c: ColorEdits = item.fx.color ?? {}
  const entry = COLOR_GRID.find((t) => t.tool === tool)
  const [ch, setCh] = useState("rgb")
  const [zone, setZone] = useState<"shadows" | "mids" | "highs">("mids")
  const [band, setBand] = useState("Red")
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const lutRef = useRef<HTMLInputElement>(null)
  const matchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    setCh("rgb")
    setPick(null)
    setPicking(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool])
  useEffect(() => () => setPick(null), [])

  const put = <K extends keyof ColorEdits>(k: K, p: Partial<NonNullable<ColorEdits[K]>>) => setFx({ color: { ...c, [k]: { ...(c[k] as object), ...p } } })
  const reset = () => {
    const { [tool as keyof ColorEdits]: _drop, ...rest } = c
    setFx({ color: rest })
  }
  const dropper = (fn: ColorPick) => {
    setPicking(true)
    setPick((rgb) => {
      fn(rgb)
      setPicking(false)
      setPick(null)
    })
  }
  const Dropper = ({ fn, label }: { fn: ColorPick; label: string }) => (
    <Button variant={picking ? "default" : "secondary"} size="sm" className="h-8 w-full gap-1.5 text-xs" onClick={() => (picking ? (setPicking(false), setPick(null)) : dropper(fn))}>
      <Pipette className="!size-3.5" /> {picking ? "Görselde bir yere tıkla…" : label}
    </Button>
  )

  const lv = c.levels?.[ch as "rgb"] ?? [0, 1, 1, 0, 1]
  const setLv = (i: number, v: number) => {
    const next = [...lv] as [number, number, number, number, number]
    next[i] = v
    if (i === 0) next[2] = Math.max(next[2], v + 0.02)
    if (i === 2) next[0] = Math.min(next[0], v - 0.02)
    put("levels", { [ch]: next })
  }
  const curve = (c.curves?.[ch as "rgb"] ?? IDENT) as P2[]
  const mix = c.mixer ?? {}
  const row = (mix[ch as "r"] ?? (ch === "g" ? [0, 1, 0, 0] : ch === "b" ? [0, 0, 1, 0] : [1, 0, 0, 0])) as [number, number, number, number]
  const setRow = (i: number, v: number) => {
    const next = [...row] as typeof row
    next[i] = v
    put("mixer", { [ch]: next })
  }
  const bal = (c.balance?.[zone] ?? [0, 0, 0]) as [number, number, number]
  const ink = (c.selective?.bands?.[band] ?? [0, 0, 0, 0]) as [number, number, number, number]
  const gr = c.grade ?? {}
  const wheel = (k: "shadow" | "mid" | "high" | "global", label: string) => <Wheel label={label} v={(gr[k] ?? [0, 0, 0]) as [number, number, number]} set={(x) => put("grade", { [k]: x })} />
  const luts = presets.filter((p) => p.id && !p.recipe)
  const others = items.filter((i) => i.id !== item.id)

  const importLut = async (f: File | undefined) => {
    if (!f) return
    setBusy(true)
    try {
      const r = await api.importPreset(f)
      r.warnings.forEach((w) => toast.warning(w))
      await onPresetsChange()
      if (r.imported[0]) put("lut", { id: r.imported[0].id, amount: 1 })
    } catch (e: any) {
      toast.error(e.message)
    }
    setBusy(false)
    if (lutRef.current) lutRef.current.value = ""
  }
  const uploadMatch = async (f: File | undefined) => {
    if (!f) return
    setBusy(true)
    try {
      const r = await api.upload(f)
      put("match", { photo: r.id })
    } catch (e: any) {
      toast.error(e.message)
    }
    setBusy(false)
    if (matchRef.current) matchRef.current.value = ""
  }

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="grid grid-cols-6 gap-1">
          {COLOR_GRID.filter((t) => !noBasic || t.tool !== "basic").map((t) => {
            const I = t.icon
            return (
              <Tooltip key={t.cmd}>
                <TooltipTrigger asChild>
                  <button aria-label={t.label} onClick={() => setTool(t.tool!)} className={cn("relative grid h-9 place-items-center rounded-md border transition-colors hover:border-primary/60", tool === t.tool ? "border-primary/70 bg-primary/15 text-foreground" : "text-muted-foreground")}>
                    <I className="h-4 w-4" strokeWidth={1.8} />
                    {colorActive(t.tool!, c) && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t.label} ({t.en})</TooltipContent>
              </Tooltip>
            )
          })}
        </div>
        {entry && (
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11px] text-muted-foreground"><span className="font-medium text-foreground">{entry.label}</span> · {entry.hint}</p>
            {tool !== "basic" && colorActive(tool, c) && (
              <button className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-primary" onClick={reset}><RotateCcw className="h-3 w-3" /> sıfırla</button>
            )}
          </div>
        )}
      </section>

      {tool === "basic" && <AdjustPanel adjust={item.fx.adjust ?? {}} setAdjust={(a) => setFx({ adjust: a })} />}

      {tool === "bc" && (
        <section className="space-y-3">
          <Pct label="Parlaklık" v={c.bc?.b} set={(b) => put("bc", { b })} />
          <Pct label="Kontrast" v={c.bc?.c} set={(x) => put("bc", { c: x })} />
        </section>
      )}

      {tool === "levels" && (
        <section className="space-y-3">
          <Chips value={ch} set={setCh} options={CHANNELS} />
          <Histogram src={preview} ch={ch} />
          <Num label="Siyah Nokta" v={Math.round(lv[0] * 255)} min={0} max={250} set={(x) => setLv(0, x / 255)} />
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs"><span className="cursor-default text-muted-foreground" onDoubleClick={() => setLv(1, 1)}>Orta Ton (Gama)</span><span>{lv[1].toFixed(2)}</span></div>
            <Slider min={-100} max={100} step={1} value={[Math.round(Math.log(lv[1]) / Math.log(3) * 100)]} onValueChange={([x]) => setLv(1, Math.round(3 ** (x / 100) * 100) / 100)} />
          </div>
          <Num label="Beyaz Nokta" v={Math.round(lv[2] * 255)} min={5} max={255} dflt={255} set={(x) => setLv(2, x / 255)} />
          <Num label="Çıkış Siyahı" v={Math.round(lv[3] * 255)} min={0} max={255} set={(x) => setLv(3, x / 255)} />
          <Num label="Çıkış Beyazı" v={Math.round(lv[4] * 255)} min={0} max={255} dflt={255} set={(x) => setLv(4, x / 255)} />
        </section>
      )}

      {tool === "curves" && (
        <section className="space-y-2">
          <Chips value={ch} set={setCh} options={CHANNELS} />
          <CurveEditor pts={curve} set={(p) => put("curves", { [ch]: p })} stroke={CH_STROKE[ch]} src={preview} ch={ch} />
          <Chips value="" set={(v) => put("curves", { [ch]: v === "s" ? [[0, 0], [0.25, 0.18], [0.75, 0.82], [1, 1]] : v === "matte" ? [[0, 0.08], [0.3, 0.3], [1, 1]] : IDENT })} options={[["s", "S Eğrisi"], ["matte", "Mat Siyah"], ["id", "Düz"]]} />
        </section>
      )}

      {tool === "shhi" && (
        <section className="space-y-3">
          <Pct label="Gölgeleri Aç" v={c.shhi?.s} min={0} set={(s) => put("shhi", { s })} />
          <Pct label="Parlak Alanları Geri Getir" v={c.shhi?.h} min={0} set={(h) => put("shhi", { h })} />
          <Pct label="Orta Ton" v={c.shhi?.mid} set={(mid) => put("shhi", { mid })} />
          <Pct label="Yarıçap" v={c.shhi?.radius} min={0} dflt={0.3} set={(radius) => put("shhi", { radius })} />
          <Pct label="Renk Düzeltme" v={c.shhi?.color} set={(color) => put("shhi", { color })} />
        </section>
      )}

      {tool === "hdr" && (
        <section className="space-y-3">
          <Pct label="Güç" v={c.hdr?.amount} min={0} set={(amount) => put("hdr", { amount })} />
          <Pct label="Yarıçap" v={c.hdr?.radius} min={0} dflt={0.3} set={(radius) => put("hdr", { radius })} />
          <Pct label="Ayrıntı" v={c.hdr?.detail} min={0} dflt={0.3} set={(detail) => put("hdr", { detail })} />
          <Pct label="Doygunluk" v={c.hdr?.sat} set={(sat) => put("hdr", { sat })} />
        </section>
      )}

      {tool === "wb" && (
        <section className="space-y-3">
          <Dropper
            label="Gri Noktayı Seç"
            fn={([r, g, b]) => {
              const [R, G, B] = [r, g, b].map((v) => Math.max(1, v))
              const clamp = (v: number) => Math.round(Math.max(-1, Math.min(1, v)) * 100) / 100
              put("wb", { temp: clamp((c.wb?.temp ?? 0) - Math.log2(R / B) / 1.2), tint: clamp((c.wb?.tint ?? 0) + Math.log2(G / Math.sqrt(R * B)) / 0.35) })
            }}
          />
          <div className="flex flex-wrap gap-1">
            {WB_LIGHTS.map(([n, temp, tint]) => (
              <button key={n} onClick={() => put("wb", { temp, tint })} className="rounded-md border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/60">{n}</button>
            ))}
          </div>
          <Pct id="sec-wb-temp" label="Renk Sıcaklığı" v={c.wb?.temp} set={(temp) => put("wb", { temp })} />
          <Pct id="sec-wb-tint" label="Tint" v={c.wb?.tint} set={(tint) => put("wb", { tint })} />
        </section>
      )}

      {tool === "hue" && (
        <section className="space-y-3">
          <Num label="Renk Tonu" v={Math.round(c.hue?.h ?? 0)} min={-180} max={180} unit="°" set={(h) => put("hue", { h })} />
          <Pct label="Doygunluk" v={c.hue?.s} set={(s) => put("hue", { s })} />
          <Pct label="Açıklık" v={c.hue?.l} set={(l) => put("hue", { l })} />
          <p className="text-[11px] text-muted-foreground">Tek bir rengi değiştirmek için Işık ve Renk içindeki Renk Karıştırıcı'yı kullan.</p>
        </section>
      )}

      {tool === "balance" && (
        <section className="space-y-3">
          <Chips value={zone} set={(v) => setZone(v as typeof zone)} options={[["shadows", "Gölgeler"], ["mids", "Orta Tonlar"], ["highs", "Parlak"]]} />
          {([["Camgöbeği ↔ Kırmızı", 0], ["Macenta ↔ Yeşil", 1], ["Sarı ↔ Mavi", 2]] as const).map(([l, i]) => (
            <Pct key={l} label={l} v={bal[i]} set={(x) => { const n = [...bal] as typeof bal; n[i] = x; put("balance", { [zone]: n }) }} />
          ))}
          <Toggle label="Parlaklığı Koru" on={c.balance?.preserve !== false} set={(preserve) => put("balance", { preserve })} />
        </section>
      )}

      {tool === "grade" && (
        <section className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {wheel("shadow", "Gölgeler")}
            {wheel("mid", "Orta Tonlar")}
            {wheel("high", "Parlak")}
            {wheel("global", "Genel")}
          </div>
          <Pct label="Denge" v={gr.balance} set={(balance) => put("grade", { balance })} />
          <Pct label="Karışım" v={gr.blend} min={0} dflt={0.5} set={(blend) => put("grade", { blend })} />
          <p className="text-[11px] text-muted-foreground">Tekerleğin altındaki kaydırıcı o bölgenin aydınlığıdır. Çift tıkla: rengi sıfırla.</p>
        </section>
      )}

      {tool === "selective" && (
        <section className="space-y-3">
          <Chips value={band} set={setBand} options={BANDS} />
          {([["Camgöbeği", 0], ["Macenta", 1], ["Sarı", 2], ["Siyah", 3]] as const).map(([l, i]) => (
            <Pct key={l} label={l} v={ink[i]} set={(x) => { const n = [...ink] as typeof ink; n[i] = x; put("selective", { bands: { ...c.selective?.bands, [band]: n } }) }} />
          ))}
          <Toggle label="Göreli" on={c.selective?.relative !== false} set={(relative) => put("selective", { relative })} />
        </section>
      )}

      {tool === "mixer" && (
        <section className="space-y-3">
          <Toggle label="Tek Renkli" on={!!mix.mono} set={(mono) => put("mixer", { mono })} />
          {!mix.mono && <Chips value={ch === "rgb" ? "r" : ch} set={setCh} options={CHANNELS.slice(1)} />}
          {([["Kırmızı", 0], ["Yeşil", 1], ["Mavi", 2], ["Sabit", 3]] as const).map(([l, i]) => (
            <Pct key={l} label={l} v={row[i]} min={-200} max={200} dflt={(ch === "rgb" || ch === "r") && i === 0 ? 1 : ch === "g" && i === 1 ? 1 : ch === "b" && i === 2 ? 1 : 0} set={(x) => setRow(i, x)} />
          ))}
        </section>
      )}

      {tool === "filter" && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Swatch value={c.filter?.color ?? "#EC8A00"} set={(color) => put("filter", { color })} />
            {FILTERS.map(([n, color]) => (
              <button key={n} onClick={() => put("filter", { color, density: c.filter?.density || 0.25 })} className="rounded-md border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/60">{n}</button>
            ))}
          </div>
          <Pct label="Yoğunluk" v={c.filter?.density} min={0} set={(density) => put("filter", { density })} />
          <Toggle label="Parlaklığı Koru" on={c.filter?.preserve !== false} set={(preserve) => put("filter", { preserve })} />
        </section>
      )}

      {tool === "lut" && (
        <section className="space-y-3">
          <input ref={lutRef} type="file" accept=".cube,.zip" hidden onChange={(e) => importLut(e.target.files?.[0])} />
          <Button variant="secondary" size="sm" className="h-8 w-full gap-1.5 text-xs" disabled={busy} onClick={() => lutRef.current?.click()}>
            {busy ? <Loader2 className="!size-3.5 animate-spin" /> : <Upload className="!size-3.5" />} .cube Dosyası Yükle
          </Button>
          <select aria-label="LUT" className="h-8 w-full rounded-md border bg-background px-2 text-xs" value={c.lut?.id ?? ""} onChange={(e) => put("lut", { id: e.target.value, amount: c.lut?.amount ?? 1 })}>
            <option value="">Yok</option>
            {luts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {c.lut?.id && <Pct label="Yoğunluk" v={c.lut?.amount ?? 1} min={0} dflt={1} set={(amount) => put("lut", { amount })} />}
        </section>
      )}

      {tool === "match" && (
        <section className="space-y-3">
          <Label>Kaynak Fotoğraf</Label>
          <input ref={matchRef} type="file" accept="image/*" hidden onChange={(e) => uploadMatch(e.target.files?.[0])} />
          <div className="grid grid-cols-4 gap-1">
            {others.map((o) => (
              <button key={o.id} title={o.name} onClick={() => put("match", { photo: o.id })} className={cn("block aspect-square overflow-hidden rounded-md border hover:border-primary/60", c.match?.photo === o.id && "ring-2 ring-primary")}>
                <img src={thumbUrl(o.id)} alt="" className="h-full w-full object-cover" draggable={false} />
              </button>
            ))}
            {c.match?.photo && !others.some((o) => o.id === c.match?.photo) && (
              <div className="aspect-square overflow-hidden rounded-md ring-2 ring-primary"><img src={thumbUrl(c.match.photo)} alt="" className="h-full w-full object-cover" draggable={false} /></div>
            )}
            <button title="Dosyadan seç" disabled={busy} onClick={() => matchRef.current?.click()} className="grid aspect-square place-items-center rounded-md border border-dashed text-muted-foreground hover:border-primary/60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            </button>
          </div>
          {c.match?.photo && (
            <>
              <Pct label="Parlaklık" v={c.match.lum ?? 1} min={0} max={200} dflt={1} set={(lum) => put("match", { lum })} />
              <Pct label="Renk Yoğunluğu" v={c.match.sat ?? 1} min={0} max={200} dflt={1} set={(sat) => put("match", { sat })} />
              <Pct label="Etkiyi Azalt" v={c.match.fade} min={0} set={(fade) => put("match", { fade })} />
            </>
          )}
        </section>
      )}

      {tool === "replace" && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Swatch value={c.replace?.color ?? "#FF0000"} set={(color) => put("replace", { color })} />
            <div className="flex-1"><Dropper label="Rengi Görselden Al" fn={([r, g, b]) => put("replace", { color: "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase() })} /></div>
          </div>
          <Pct label="Tolerans" v={c.replace?.fuzz} min={0} dflt={0.3} set={(fuzz) => put("replace", { fuzz })} />
          <Num label="Renk Tonu" v={Math.round(c.replace?.h ?? 0)} min={-180} max={180} unit="°" set={(h) => put("replace", { h })} />
          <Pct label="Doygunluk" v={c.replace?.s} set={(s) => put("replace", { s })} />
          <Pct label="Açıklık" v={c.replace?.l} set={(l) => put("replace", { l })} />
        </section>
      )}

      {tool === "bw" && (
        <section className="space-y-3">
          <Toggle label="Açık" on={!!c.bw?.on} set={(on) => put("bw", { on })} />
          <Chips value="" set={(v) => put("bw", { on: true, ...BW_PRESETS.find(([n]) => n === v)![1] })} options={BW_PRESETS.map(([n]) => [n, n])} />
          {BW_KEYS.map(([k, l]) => {
            const d = { r: 0.4, y: 0.6, g: 0.4, c: 0.6, b: 0.2, m: 0.8 }[k]
            return <Pct key={k} label={l} v={c.bw?.[k]} min={-200} max={300} dflt={d} set={(x) => put("bw", { on: true, [k]: x })} />
          })}
          <Toggle label="Renklendir" on={!!c.bw?.tint} set={(tint) => put("bw", { on: true, tint })} />
          {c.bw?.tint && (
            <>
              <Num label="Renk Tonu" v={Math.round(c.bw?.hue ?? 40)} min={0} max={360} unit="°" dflt={40} set={(hue) => put("bw", { hue })} />
              <Pct label="Doygunluk" v={c.bw?.sat} min={0} dflt={0.2} set={(sat) => put("bw", { sat })} />
            </>
          )}
        </section>
      )}

      {(tool === "desat" || tool === "invert") && <Toggle label="Açık" on={!!c[tool]?.on} set={(on) => put(tool, { on })} />}

      {tool === "posterize" && (
        <section className="space-y-3">
          <Toggle label="Açık" on={!!c.posterize?.on} set={(on) => put("posterize", { on, n: c.posterize?.n ?? 4 })} />
          <Num label="Ton Sayısı" v={c.posterize?.n ?? 4} min={2} max={32} dflt={4} set={(n) => put("posterize", { on: true, n })} />
        </section>
      )}

      {tool === "threshold" && (
        <section className="space-y-3">
          <Toggle label="Açık" on={!!c.threshold?.on} set={(on) => put("threshold", { on, level: c.threshold?.level ?? 0.5 })} />
          <Histogram src={preview} ch="rgb" />
          <Num label="Eşik" v={Math.round((c.threshold?.level ?? 0.5) * 255)} min={0} max={255} dflt={128} set={(x) => put("threshold", { on: true, level: x / 255 })} />
        </section>
      )}

      {tool === "gradient" && (
        <section className="space-y-3">
          <Toggle label="Açık" on={!!c.gradient?.on} set={(on) => put("gradient", { on, stops: c.gradient?.stops ?? GRADIENTS[0][1] })} />
          <div className="grid grid-cols-5 gap-1">
            {GRADIENTS.map(([n, stops]) => (
              <button key={n} title={n} aria-label={n} onClick={() => put("gradient", { on: true, stops })} className="h-7 rounded-md border transition hover:border-primary/60" style={{ background: `linear-gradient(90deg, ${stops.map(([p, h]) => `${h} ${p * 100}%`).join(",")})` }} />
            ))}
          </div>
          {c.gradient?.stops && (
            <div className="flex items-center gap-2">
              {c.gradient.stops.map(([p, h], i) => (
                <Swatch key={i} value={h} set={(v) => put("gradient", { on: true, stops: c.gradient!.stops!.map((s, q): [number, string] => (q === i ? [p, v] : s)) })} />
              ))}
            </div>
          )}
          <Pct label="Yoğunluk" v={c.gradient?.amount ?? 1} min={0} dflt={1} set={(amount) => put("gradient", { amount })} />
          <Toggle label="Ters Çevir" on={!!c.gradient?.reverse} set={(reverse) => put("gradient", { reverse })} />
        </section>
      )}
    </div>
  )
}
