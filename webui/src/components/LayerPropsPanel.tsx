import { useEffect, useRef, useState } from "react"
import { ImagePlus, Paintbrush, Save, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { ColorTools, type ColorPick } from "@/components/ColorTools"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { api } from "@/lib/api"
import type { FilterSpec, ParamSpec } from "@/lib/filters"
import { useIntent } from "@/lib/hooks"
import { BLEND_GROUPS, LABELS, STYLE_NAMES, takeComp, textRatio } from "@/lib/layerops"
import { cn } from "@/lib/utils"
import type { ColorToolId, Fx, ImgLayer, Item, PresetMeta } from "@/types"

type Props = {
  item: Item
  items: Item[]
  layers: ImgLayer[]
  sel: string[]
  setLayers: (l: ImgLayer[]) => void
  patchItem: (p: Partial<Item>) => void
  presets: PresetMeta[]
  onPresetsChange: () => Promise<void>
  preview: string | null
  setPick: (f: ColorPick | null) => void
  run: (cmd: string) => void
  intent?: { cmd: string; n: number } | null
}

const Num = ({ id, label, v, set, min = 0, max = 100, unit = "" }: { id?: string; label: string; v: number; set: (x: number) => void; min?: number; max?: number; unit?: string }) => (
  <div id={id} className="space-y-1.5">
    <div className="flex justify-between text-xs"><span className="text-muted-foreground">{label}</span><span>{v}{unit}</span></div>
    <Slider min={min} max={max} step={1} value={[v]} onValueChange={([x]) => set(x)} />
  </div>
)
const Swatch = ({ label, value, set }: { label: string; value: string; set: (v: string) => void }) => (
  <label className="flex cursor-pointer items-center justify-between text-xs text-muted-foreground">
    {label}
    <span className="relative h-6 w-6 overflow-hidden rounded-md border" style={{ background: value }}>
      <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={value} onChange={(e) => set(e.target.value.toUpperCase())} />
    </span>
  </label>
)
const Chips = ({ value, set, options }: { value: string; set: (v: string) => void; options: [string, string][] }) => (
  <div className="flex flex-wrap gap-1">
    {options.map(([v, l]) => (
      <button key={v} onClick={() => set(v)} className={cn("rounded-md border px-2 py-0.5 text-[11px] transition-colors hover:border-primary/60", value === v ? "border-primary/70 bg-primary/15 text-foreground" : "text-muted-foreground")}>{l}</button>
    ))}
  </div>
)

/** Seçili katmanın özellikleri: karışım, tür ayarları, stiller, maske, kompozisyonlar. */
export function LayerPropsPanel({ item, items, layers, sel, setLayers, patchItem, presets, onPresetsChange, preview, setPick, run, intent }: Props) {
  const cur = sel.length === 1 ? layers.find((l) => l.id === sel[0]) ?? null : null
  const [styleSpec, setStyleSpec] = useState<Record<string, ParamSpec[]>>({})
  const [open, setOpen] = useState<string | null>(null)
  const [fonts, setFonts] = useState<string[]>([])
  const [adjTool, setAdjTool] = useState<ColorToolId>("levels")
  const [comp, setComp] = useState("")
  const replaceRef = useRef<HTMLInputElement>(null)
  const put = (p: Partial<ImgLayer>) => cur && setLayers(layers.map((l) => (l.id === cur.id ? { ...l, ...p } : l)))
  const comps = item.comps ?? []
  useEffect(() => {
    api.layerSpec().then((s) => setStyleSpec((s as { styles: FilterSpec }).styles)).catch(() => {})
    api.fonts().then((f) => setFonts([...f.bundled, ...f.system].slice(0, 200))).catch(() => {})
  }, [])
  const flash = (id: string) => setTimeout(() => {
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "center" })
    el.classList.add("menu-flash")
    setTimeout(() => el.classList.remove("menu-flash"), 1200)
  }, 120)
  useIntent(intent, "layerp:", (cmd) => {
    if (cmd.startsWith("layerp:style:")) {
      const k = cmd.slice(13)
      setOpen(k)
      flash(`sec-style-${k}`)
      if (cur && !cur.styles?.[k]?.on) setStyle(k, { on: true })
    } else flash(`sec-layer-${cmd.slice(7)}`)
  })
  const defaults = (k: string) => Object.fromEntries((styleSpec[k] ?? []).map((q) => [q.k, q.def]))
  const setStyle = (k: string, p: Record<string, unknown>) => cur && put({ styles: { ...cur.styles, [k]: { ...defaults(k), ...cur.styles?.[k], ...p } } })
  const setText = (p: Partial<NonNullable<ImgLayer["textDef"]>>) => {
    if (!cur?.textDef) return
    const textDef = { ...cur.textDef, ...p }
    put({ textDef, ar: textRatio(textDef.value, textDef.family, textDef.bold) })
  }
  const replace = async (f: File | undefined) => {
    if (!f || !cur) return
    try {
      const r = await api.upload(f)
      put({ photo: r.id, name: r.name, ar: r.height / r.width })
    } catch (e: any) {
      toast.error(e.message)
    }
    if (replaceRef.current) replaceRef.current.value = ""
  }

  const shape = cur?.shapeDef
  const fill = cur?.fillDef
  return (
    <div className="space-y-5">
      {!cur ? (
        <p className="text-[11px] text-muted-foreground">{sel.length > 1 ? "Özellikleri düzenlemek için tek katman seç." : "Sağdaki listeden bir katman seç ya da yeni katman ekle."}</p>
      ) : (
        <>
          <section className="space-y-3">
            <Input aria-label="Katman adı" value={cur.name} className="h-8 text-xs" onChange={(e) => put({ name: e.target.value })} />
            <div id="sec-layer-blend" className="space-y-1">
              <span className="text-xs text-muted-foreground">Karışım Kipi</span>
              <select aria-label="Karışım kipi" className="h-8 w-full rounded-md border bg-background px-2 text-xs" value={cur.mode ?? "normal"} onChange={(e) => put({ mode: e.target.value })}>
                {BLEND_GROUPS.map(([g, m]) => <optgroup key={g} label={g || "Temel"}>{m.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>)}
              </select>
            </div>
            <Num id="sec-layer-opacity" label="Opaklık" unit="%" v={Math.round(cur.opacity * 100)} set={(x) => put({ opacity: x / 100 })} />
            {cur.kind !== "adjust" && <Num id="sec-layer-fill" label="Dolgu Opaklığı" unit="%" v={Math.round((cur.fill ?? 1) * 100)} set={(x) => put({ fill: x / 100 })} />}
            <div id="sec-layer-label" className="flex items-center gap-1.5">
              <span className="flex-1 text-xs text-muted-foreground">Renk Etiketi</span>
              <button aria-label="Etiket yok" className={cn("h-4 w-4 rounded-full border", !cur.label && "ring-1 ring-primary")} onClick={() => put({ label: undefined })} />
              {LABELS.map(([n, c]) => <button key={n} aria-label={n} className={cn("h-4 w-4 rounded-full", cur.label === n && "ring-2 ring-foreground")} style={{ background: c }} onClick={() => put({ label: n })} />)}
            </div>
          </section>

          {cur.kind === "blank" && (
            <Button variant="secondary" size="sm" className="w-full gap-1.5 text-xs" onClick={() => run("brush:tool:brush")}><Paintbrush className="!size-3.5" /> Bu Katmana Boya</Button>
          )}

          {cur.textDef && (
            <section className="space-y-2.5">
              <Label>Metin</Label>
              <textarea aria-label="Metin" className="min-h-[64px] w-full resize-none rounded-md border bg-background p-2 text-xs" value={cur.textDef.value} onChange={(e) => setText({ value: e.target.value })} />
              <select aria-label="Yazı tipi" className="h-8 w-full rounded-md border bg-background px-2 text-xs" value={cur.textDef.family ?? ""} onChange={(e) => setText({ family: e.target.value || null })}>
                <option value="">Varsayılan</option>
                {fonts.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <Chips value={cur.textDef.align} set={(a) => setText({ align: a as "left" })} options={[["left", "Sola"], ["center", "Orta"], ["right", "Sağa"]]} />
              <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Kalın</span><Switch checked={!!cur.textDef.bold} onCheckedChange={(bold) => setText({ bold })} /></div>
              <Swatch label="Renk" value={cur.textDef.color} set={(color) => setText({ color })} />
            </section>
          )}

          {shape && (
            <section className="space-y-2.5">
              <Label>Şekil</Label>
              <Chips value={shape.type} set={(type) => put({ shapeDef: { ...shape, type } })} options={[["rect", "Dikdörtgen"], ["ellipse", "Elips"], ["triangle", "Üçgen"], ["star", "Yıldız"], ["hexagon", "Altıgen"]]} />
              <Swatch label="Dolgu" value={shape.color} set={(color) => put({ shapeDef: { ...shape, color } })} />
              {shape.type === "rect" && <Num label="Köşe Yuvarlaklığı" v={Math.round(shape.radius * 100)} set={(x) => put({ shapeDef: { ...shape, radius: x / 100 } })} />}
              <Num label="Kontur Kalınlığı" v={Math.round(shape.strokeW * 100)} max={30} set={(x) => put({ shapeDef: { ...shape, strokeW: x / 100 } })} />
              {shape.strokeW > 0 && <Swatch label="Kontur Rengi" value={shape.stroke} set={(stroke) => put({ shapeDef: { ...shape, stroke } })} />}
            </section>
          )}

          {fill && (
            <section className="space-y-2.5">
              <Label>Dolgu</Label>
              <Chips value={fill.type} set={(type) => put({ fillDef: { ...fill, type: type as "color" } })} options={[["color", "Düz Renk"], ["gradient", "Degrade"], ["pattern", "Desen"]]} />
              <Swatch label="Renk 1" value={fill.color} set={(color) => put({ fillDef: { ...fill, color } })} />
              {fill.type !== "color" && <Swatch label="Renk 2" value={fill.color2} set={(color2) => put({ fillDef: { ...fill, color2 } })} />}
              {fill.type === "gradient" && <Num label="Açı" min={-180} max={180} unit="°" v={fill.angle} set={(angle) => put({ fillDef: { ...fill, angle } })} />}
              {fill.type === "pattern" && (
                <>
                  <Chips value={fill.pattern} set={(pattern) => put({ fillDef: { ...fill, pattern } })} options={[["dots", "Nokta"], ["stripes", "Çizgi"], ["checker", "Dama"], ["hatch", "Tarama"]]} />
                  <Num label="Ölçek" min={1} max={30} v={Math.round(fill.scale * 100)} set={(x) => put({ fillDef: { ...fill, scale: x / 100 } })} />
                </>
              )}
            </section>
          )}

          {cur.kind === "adjust" && (
            <section className="space-y-2">
              <Label>Ayar</Label>
              <p className="text-[11px] text-muted-foreground">Altındaki tüm katmanları etkiler. Maskeyle bölgesini sınırlayabilirsin.</p>
              <ColorTools noBasic item={{ ...item, fx: { ...item.fx, color: cur.adjust ?? {} } }} items={items} tool={adjTool} setTool={setAdjTool} setFx={(p: Partial<Fx>) => p.color && put({ adjust: p.color })} presets={presets} onPresetsChange={onPresetsChange} preview={preview} setPick={setPick} />
            </section>
          )}

          {!cur.kind && !cur.base && (
            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Akıllı Nesne</Label>
                  <p className="text-[11px] text-muted-foreground">Dönüştürmeler özgün görselden yeniden hesaplanır.</p>
                </div>
                <Switch checked={!!cur.smart} onCheckedChange={(smart) => put({ smart })} />
              </div>
              {cur.smart && (
                <>
                  <input ref={replaceRef} type="file" accept="image/*" hidden onChange={(e) => replace(e.target.files?.[0])} />
                  <Button variant="secondary" size="sm" className="w-full gap-1.5 text-xs" onClick={() => replaceRef.current?.click()}><ImagePlus className="!size-3.5" /> İçeriği Değiştir</Button>
                </>
              )}
            </section>
          )}

          {cur.kind !== "adjust" && (
            <section id="sec-layer-styles" className="space-y-1">
              <Label>Katman Stilleri</Label>
              {STYLE_NAMES.map(([k, l, en]) => {
                const st = cur.styles?.[k]
                return (
                  <div key={k} id={`sec-style-${k}`} className="rounded-md border">
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      <button className="flex-1 text-left text-xs" title={en} onClick={() => setOpen(open === k ? null : k)}>{l}</button>
                      <Switch checked={!!st?.on} onCheckedChange={(on) => { setStyle(k, { on }); if (on) setOpen(k) }} />
                    </div>
                    {open === k && st?.on && (
                      <div className="space-y-2.5 border-t p-2">
                        {(styleSpec[k] ?? []).map((q) => {
                          const v = (st as Record<string, any>)[q.k] ?? q.def
                          if (q.t === "n") return <Num key={q.k} label={q.label} v={v} min={q.min} max={q.max} set={(x) => setStyle(k, { [q.k]: x })} />
                          if (q.t === "color") return <Swatch key={q.k} label={q.label} value={v} set={(x) => setStyle(k, { [q.k]: x })} />
                          return <Chips key={q.k} value={v} set={(x) => setStyle(k, { [q.k]: x })} options={q.opts ?? []} />
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </section>
          )}

          <section id="sec-layer-density" className="space-y-2.5">
            <Label>Maske</Label>
            <div className="grid grid-cols-2 gap-1.5">
              <Button variant="secondary" size="sm" className="text-xs" onClick={() => run("erase:layermask")}>Katman Maskesi</Button>
              <Button variant="secondary" size="sm" className="text-xs" onClick={() => run("erase:vector")}>Vektör Maske</Button>
            </div>
            {cur.mask?.ops?.length ? (
              <>
                <Num label="Yoğunluk" unit="%" v={Math.round((cur.mask.density ?? 1) * 100)} set={(x) => put({ mask: { ...cur.mask!, density: x / 100 } })} />
                <Num label="Yumuşatma" v={Math.round((cur.mask.feather ?? 0) * 100)} set={(x) => put({ mask: { ...cur.mask!, feather: x / 100 } })} />
              </>
            ) : <p className="text-[11px] text-muted-foreground">Yoğunluk için önce katman maskesi boya.</p>}
            <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Kırpma Maskesi</span><Switch checked={!!cur.clip} onCheckedChange={(clip) => put({ clip })} /></div>
          </section>
        </>
      )}

      <section id="sec-layer-comps" className="space-y-2">
        <Label>Katman Kompozisyonları</Label>
        <div className="flex gap-1.5">
          <Input value={comp} placeholder="Kompozisyon adı" className="h-8 text-xs" onChange={(e) => setComp(e.target.value)} />
          <Button
            variant="secondary"
            size="sm"
            className="h-8 shrink-0 gap-1.5 text-xs"
            onClick={() => {
              patchItem({ comps: [...comps, takeComp(comp.trim() || `Kompozisyon ${comps.length + 1}`, layers, item.hidden ?? [])] })
              setComp("")
            }}
          ><Save className="!size-3.5" /> Kaydet</Button>
        </div>
        {comps.map((c) => (
          <div key={c.id} className="group flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
            <button
              className="flex-1 truncate text-left hover:text-primary"
              onClick={() => patchItem({ hidden: c.hidden, layers: layers.map((l) => (c.layers[l.id] ? { ...l, ...c.layers[l.id] } : l)) })}
            >{c.name}</button>
            <button aria-label="Kompozisyonu sil" className="text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100" onClick={() => patchItem({ comps: comps.filter((x) => x.id !== c.id) })}><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
        <p className="text-[10px] text-muted-foreground">Görünürlük, konum, opaklık ve stiller saklanır; adına tıkla geri gelsin.</p>
      </section>
    </div>
  )
}
