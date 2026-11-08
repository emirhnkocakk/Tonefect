import { useState } from "react"
import { RotateCcw, X } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import type { Adjust } from "@/types"

type Num = Exclude<keyof Adjust, "hsl" | "levels">
type Props = { adjust: Adjust; setAdjust: (a: Adjust) => void }

const LIGHT: [Num, string][] = [
  ["exposure", "Pozlama"],
  ["contrast", "Kontrast"],
  ["highlights", "Parlak alanlar"],
  ["shadows", "Gölgeler"],
  ["midtones", "Orta tonlar"],
  ["whites", "Beyazlar"],
  ["blacks", "Siyahlar"],
  ["fade", "Soldurma"],
]
const COLOR: [Num, string][] = [
  ["temperature", "Sıcaklık"],
  ["tint", "Renk tonu"],
  ["vibrance", "Canlılık"],
  ["saturation", "Doygunluk"],
]
const DETAIL: [Num, string, number][] = [
  ["sharpen", "Keskinlik", 0],
  ["clarity", "Netlik", -100],
  ["denoise", "Gürültü azaltma", 0],
]
// render tarafındaki looks.HUE_BANDS ile aynı adlar
const BANDS: [string, string, string][] = [
  ["Red", "Kırmızı", "#e5484d"],
  ["Orange", "Turuncu", "#f2862e"],
  ["Yellow", "Sarı", "#f1d02c"],
  ["Green", "Yeşil", "#46a758"],
  ["Aqua", "Turkuaz", "#12b8c4"],
  ["Blue", "Mavi", "#3e63dd"],
  ["Purple", "Mor", "#8e4ec6"],
  ["Magenta", "Macenta", "#d6409f"],
]
const HSL_PARTS: [number, string][] = [
  [2, "Renk tonu"],
  [0, "Doygunluk"],
  [1, "Parlaklık"],
]

function Row({ id, label, value, min = -100, onChange }: { id?: string; label: string; value: number; min?: number; onChange: (v: number) => void }) {
  return (
    <div id={id} className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="cursor-default text-muted-foreground" onDoubleClick={() => onChange(0)} title="Çift tıkla: sıfırla">
          {label}
        </span>
        <span className={cn(value ? "text-foreground" : "text-muted-foreground")}>{value > 0 && min < 0 ? `+${value}` : value}</span>
      </div>
      <Slider min={min} max={100} step={1} value={[value]} onValueChange={([x]) => onChange(x)} />
    </div>
  )
}

function Section({ title, dirty, onReset, children }: { title: string; dirty: boolean; onReset: () => void; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>{title}</Label>
        {dirty && (
          <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary" onClick={onReset}>
            <RotateCcw className="h-3 w-3" /> sıfırla
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

export function AdjustPanel({ adjust, setAdjust }: Props) {
  const [band, setBand] = useState("Orange")
  const hsl = adjust.hsl ?? {}
  const pct = (k: Num) => Math.round((adjust[k] ?? 0) * 100)
  const set = (k: Num, v: number) => setAdjust({ ...adjust, [k]: v / 100 })
  const clear = (keys: Num[]) => setAdjust({ ...adjust, ...Object.fromEntries(keys.map((k) => [k, 0])) })
  const cur = hsl[band] ?? [0, 0, 0]
  const setHsl = (i: number, v: number) => {
    const next = [...cur] as [number, number, number]
    next[i] = v / 100
    setAdjust({ ...adjust, hsl: { ...hsl, [band]: next } })
  }

  return (
    <div className="space-y-6">
      <Section title="Işık" dirty={LIGHT.some(([k]) => adjust[k]) || !!adjust.levels} onReset={() => setAdjust({ ...adjust, ...Object.fromEntries(LIGHT.map(([k]) => [k, 0])), levels: undefined })}>
        {adjust.levels && (
          <div className="flex items-center justify-between rounded-md bg-primary/10 px-2 py-1 text-[11px]">
            <span>Ton aralığı otomatik gerildi</span>
            <button aria-label="Ton germeyi kaldır" className="text-muted-foreground hover:text-foreground" onClick={() => setAdjust({ ...adjust, levels: undefined })}>
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        {LIGHT.map(([k, label]) => (
          <Row key={k} id={`sec-adj-${k}`} label={label} value={pct(k)} min={k === "fade" ? 0 : -100} onChange={(v) => set(k, v)} />
        ))}
      </Section>

      <Section title="Renk" dirty={COLOR.some(([k]) => adjust[k])} onReset={() => clear(COLOR.map(([k]) => k))}>
        {COLOR.map(([k, label]) => (
          <Row key={k} id={`sec-adj-${k}`} label={label} value={pct(k)} onChange={(v) => set(k, v)} />
        ))}
      </Section>

      <Section
        title="Renk karıştırıcı"
        dirty={Object.values(hsl).some((v) => v.some(Boolean))}
        onReset={() => setAdjust({ ...adjust, hsl: {} })}
      >
        <div className="flex justify-between">
          {BANDS.map(([id, name, color]) => {
            const changed = (hsl[id] ?? []).some(Boolean)
            return (
              <button
                key={id}
                title={name}
                aria-label={name}
                onClick={() => setBand(id)}
                className={cn(
                  "relative h-6 w-6 rounded-full ring-offset-2 ring-offset-background transition-transform hover:scale-110",
                  band === id && "ring-2 ring-foreground"
                )}
                style={{ background: color }}
              >
                {changed && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-background bg-foreground" />}
              </button>
            )
          })}
        </div>
        <p className="text-xs font-medium">{BANDS.find(([id]) => id === band)?.[1]}</p>
        {HSL_PARTS.map(([i, label]) => (
          <Row key={i} label={label} value={Math.round(cur[i] * 100)} onChange={(v) => setHsl(i, v)} />
        ))}
        <p className="text-[11px] text-muted-foreground">Yalnızca seçtiğin renge etki eder; örneğin gökyüzünü koyulaştırmak için maviyi seç.</p>
      </Section>

      <Section title="Detay" dirty={DETAIL.some(([k]) => adjust[k])} onReset={() => clear(DETAIL.map(([k]) => k))}>
        {DETAIL.map(([k, label, min]) => (
          <Row key={k} label={label} value={pct(k)} min={min} onChange={(v) => set(k, v)} />
        ))}
        <p className="text-[11px] text-muted-foreground">
          Netlik orta tonlarda dokuyu belirginleştirir (eksiye çekince yumuşatır); gürültü azaltma karanlık fotoğraflardaki kumlanmayı giderir.
        </p>
      </Section>
    </div>
  )
}
