import { useEffect, useMemo, useState } from "react"
import { Check, ChevronDown, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { Item, TextFx } from "@/types"

type Props = { item: Item; patch: (p: Partial<Item>) => void }
type Fonts = { bundled: string[]; system: string[] }

let fontCache: Fonts | null = null // yazı tipi listesi oturum boyunca bir kez alınır

const OUTLINE_COLORS: [string, string][] = [
  ["#000000", "Siyah"],
  ["#FFFFFF", "Beyaz"],
  ["#B89B5E", "Altın"],
  ["#7B2FFF", "Mor"],
]
const ff = (name: string) => `"${name}", system-ui, sans-serif`

function Row({ label, value, min, max, fmt, onChange, onReset }: {
  label: string; value: number; min: number; max: number; fmt: (v: number) => string; onChange: (v: number) => void; onReset: () => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="cursor-default text-muted-foreground" onDoubleClick={onReset} title="Çift tıkla: varsayılan">
          {label}
        </span>
        <span>{fmt(value)}</span>
      </div>
      <Slider min={min} max={max} step={1} value={[value]} onValueChange={([v]) => onChange(v)} />
    </div>
  )
}

export function TextStylePanel({ item, patch }: Props) {
  const [fonts, setFonts] = useState<Fonts | null>(fontCache)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const tfx: TextFx = item.textFx ?? {}
  const setTfx = (p: Partial<TextFx>) => patch({ textFx: { ...tfx, ...p } })

  useEffect(() => {
    if (fonts || !open) return
    api.fonts().then((f) => {
      fontCache = f
      setFonts(f)
    }).catch(() => {})
  }, [open, fonts])

  const filtered = useMemo(() => {
    // Türkçe küçük harf "I"yı "ı" yapar ("Impact" -> "ımpact"); i/ı/I/İ farkını yok say
    const fold = (t: string) => t.toLocaleLowerCase("tr-TR").replace(/ı/g, "i")
    const m = (n: string) => fold(n).includes(fold(q))
    return fonts ? { bundled: fonts.bundled.filter(m), system: fonts.system.filter(m) } : null
  }, [fonts, q])

  const choose = (f: string | null) => {
    patch({ font: f })
    setOpen(false)
    setQ("")
  }
  const option = (f: string | null, name: string) => (
    <button
      key={name}
      onClick={() => choose(f)}
      className={cn("flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-accent", (item.font ?? null) === f && "text-primary")}
      style={f ? { fontFamily: ff(f) } : undefined}
    >
      <span className="truncate">{name}</span>
      {(item.font ?? null) === f && <Check className="h-3.5 w-3.5 shrink-0" />}
    </button>
  )

  const shadow = Math.round((tfx.shadow ?? 0.65) * 100)
  const outline = Math.round((tfx.outline ?? 0) * 100)
  return (
    <>
      <div className="space-y-2">
        <Label>Yazı tipi</Label>
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex h-9 w-full items-center justify-between rounded-md border bg-transparent px-3 text-sm hover:border-primary/60"
          style={item.font ? { fontFamily: ff(item.font) } : undefined}
        >
          <span className="truncate">{item.font ?? "Tona göre (varsayılan)"}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
        </button>
        {open && (
          <div className="rounded-lg border bg-popover p-2 shadow-lg">
            <div className="relative mb-2">
              <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Yazı tipi ara" className="h-8 pl-7 text-xs" />
            </div>
            <div className="max-h-64 overflow-y-auto">
              {!q && option(null, "Tona göre (varsayılan)")}
              {!filtered ? (
                <p className="p-2 text-xs text-muted-foreground">Yazı tipleri yükleniyor…</p>
              ) : (
                <>
                  {filtered.bundled.length > 0 && <p className="px-2 pb-1 pt-2 text-[10px] font-semibold tracking-wider text-muted-foreground">TONEFECT</p>}
                  {filtered.bundled.map((f) => option(f, f))}
                  {filtered.system.length > 0 && <p className="px-2 pb-1 pt-2 text-[10px] font-semibold tracking-wider text-muted-foreground">BİLGİSAYARINDAKİLER</p>}
                  {filtered.system.map((f) => option(f, f))}
                  {!filtered.bundled.length && !filtered.system.length && <p className="p-2 text-xs text-muted-foreground">Bulunamadı</p>}
                </>
              )}
            </div>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">Kalınlık ve italik, kelime çubuğundan seçilir; yazı tipinde yoksa en yakını kullanılır.</p>
      </div>

      <div className="space-y-3">
        <Label>Yazı efektleri</Label>
        <Row label="Gölge" value={shadow} min={0} max={100} fmt={(v) => `${v}%`} onChange={(v) => setTfx({ shadow: v / 100 })} onReset={() => setTfx({ shadow: 0.65 })} />
        <Row label="Kontur" value={outline} min={0} max={100} fmt={(v) => `${v}%`} onChange={(v) => setTfx({ outline: v / 100 })} onReset={() => setTfx({ outline: 0 })} />
        {outline > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Kontur rengi</span>
            {OUTLINE_COLORS.map(([hex, name]) => (
              <button
                key={hex}
                title={name}
                aria-label={name}
                onClick={() => setTfx({ outlineColor: hex })}
                className={cn("h-6 w-6 rounded-full border border-black/30 ring-offset-2 ring-offset-background", (tfx.outlineColor ?? "#000000").toUpperCase() === hex && "ring-2 ring-primary")}
                style={{ background: hex }}
              />
            ))}
            <label className="relative h-6 w-6 cursor-pointer overflow-hidden rounded-full border border-dashed border-muted-foreground/70" title="Özel renk">
              <input type="color" className="absolute inset-0 cursor-pointer opacity-0" onChange={(e) => setTfx({ outlineColor: e.target.value.toUpperCase() })} />
            </label>
          </div>
        )}
        <Row
          label="Harf aralığı"
          value={Math.round((tfx.tracking ?? 0) * 100)}
          min={-10}
          max={50}
          fmt={(v) => (v > 0 ? `+${v}` : `${v}`)}
          onChange={(v) => setTfx({ tracking: v / 100 })}
          onReset={() => setTfx({ tracking: 0 })}
        />
        <Row
          label="Satır aralığı"
          value={Math.round((tfx.leading ?? 1) * 100)}
          min={60}
          max={200}
          fmt={(v) => `${v}%`}
          onChange={(v) => setTfx({ leading: v / 100 })}
          onReset={() => setTfx({ leading: 1 })}
        />
      </div>
    </>
  )
}
