import { useEffect, useRef, useState } from "react"
import { ArrowDown, ArrowUp, Eye, EyeOff, ImagePlus, Loader2, RotateCcw, Shuffle, Trash2, Undo2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Tile } from "@/components/FxPanel"
import { api, thumbUrl } from "@/lib/api"
import { FILTER_GALLERY, GALLERY_SECTIONS, filterEntry, filterLabel, loadFilterSpec, newFilter, type FilterSpec, type LiquifyTool, type ParamSpec } from "@/lib/filters"
import { useIntent } from "@/lib/hooks"
import { cn } from "@/lib/utils"
import type { FilterItem, Fx, Item } from "@/types"

type Props = {
  item: Item
  setFx: (p: Partial<Fx>) => void
  sel: string | null
  setSel: (id: string | null) => void
  maskSel: string | null
  liquify: LiquifyTool
  setLiquify: (p: Partial<LiquifyTool>) => void
  run: (cmd: string) => void
  intent?: { cmd: string; n: number } | null
}

const LIQUIFY: [LiquifyTool["tool"], string][] = [["push", "İt"], ["cw", "Saat Yönü"], ["ccw", "Ters Yön"], ["pucker", "Sık"], ["bloat", "Şişir"], ["rec", "Geri Al"]]
const MAX = 16

function Num({ label, v, set, min, max, step = 1 }: { label: string; v: number; set: (x: number) => void; min: number; max: number; step?: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs"><span className="text-muted-foreground">{label}</span><span>{v}</span></div>
      <Slider min={min} max={max} step={step} value={[v]} onValueChange={([x]) => set(x)} />
    </div>
  )
}

/** Filtre galerisi ve üst üste uygulanan filtre yığını. */
export function FilterPanel({ item, setFx, sel, setSel, maskSel, liquify, setLiquify, run, intent }: Props) {
  const stack = item.fx.filters ?? []
  const cur = stack.find((f) => f.id === sel) ?? null
  const [spec, setSpec] = useState<FilterSpec>({})
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [sec, setSec] = useState(GALLERY_SECTIONS[0])
  const mapRef = useRef<HTMLInputElement>(null)
  const selection = (item.fx.masks ?? []).filter((m) => m.type === "select" && m.ops?.length)
  const target = selection.find((m) => m.id === maskSel) ?? selection[selection.length - 1]

  useEffect(() => {
    let alive = true
    loadFilterSpec().then((s) => alive && setSpec(s)).catch((e) => toast.error(e.message))
    api.filterThumbs().then((r) => alive && setThumbs(r.thumbs)).catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const setStack = (filters: FilterItem[]) => setFx({ filters })
  const put = (id: string, p: Partial<FilterItem>) => setStack(stack.map((f) => (f.id === id ? { ...f, ...p } : f)))
  const add = (kind: string, s: FilterSpec) => {
    if (stack.length >= MAX) return toast("En fazla 16 filtre uygulanabilir")
    const f = newFilter(kind, s)
    setStack([...stack, f])
    setSel(f.id)
  }
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= stack.length) return
    const n = [...stack]
    ;[n[i], n[j]] = [n[j], n[i]]
    setStack(n)
  }
  const scrollTo = (id: string) => setTimeout(() => {
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "start" })
    el.classList.add("menu-flash")
    setTimeout(() => el.classList.remove("menu-flash"), 1200)
  }, 120)

  useIntent(intent, "filter:", (cmd) => {
    if (cmd.startsWith("filter:add:")) {
      const kind = cmd.slice(11)
      const e = filterEntry(kind)
      if (e) setSec(e.section)
      loadFilterSpec().then((s) => add(kind, s)).catch((er) => toast.error(er.message))
    } else if (cmd === "filter:gallery") scrollTo("sec-gallery")
    else if (cmd === "filter:ai") scrollTo("sec-ai")
  })

  const uploadMap = async (f: File | undefined) => {
    if (!f || !cur) return
    setBusy(true)
    try {
      const r = await api.upload(f)
      put(cur.id, { photo: r.id })
    } catch (e: any) {
      toast.error(e.message)
    }
    setBusy(false)
    if (mapRef.current) mapRef.current.value = ""
  }

  const control = (p: ParamSpec, f: FilterItem) => {
    const v = f[p.k]
    const set = (x: unknown) => put(f.id, { [p.k]: x })
    switch (p.t) {
      case "n":
        return <Num key={p.k} label={p.label} v={v ?? p.def} min={p.min!} max={p.max!} step={p.step} set={set} />
      case "sel":
        return (
          <div key={p.k} className="space-y-1">
            <span className="text-xs text-muted-foreground">{p.label}</span>
            <div className="flex flex-wrap gap-1">
              {p.opts!.map(([o, l]) => (
                <button key={o} onClick={() => set(o)} className={cn("rounded-md border px-2 py-0.5 text-[11px] transition-colors hover:border-primary/60", v === o ? "border-primary/70 bg-primary/15 text-foreground" : "text-muted-foreground")}>{l}</button>
              ))}
            </div>
          </div>
        )
      case "color":
        return (
          <label key={p.k} className="flex cursor-pointer items-center justify-between text-xs text-muted-foreground">
            {p.label}
            <span className="relative h-6 w-6 overflow-hidden rounded-md border" style={{ background: v }}>
              <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={v} onChange={(e) => set(e.target.value.toUpperCase())} />
            </span>
          </label>
        )
      case "bool":
        return <div key={p.k} className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{p.label}</span><Switch checked={!!v} onCheckedChange={set} /></div>
      case "seed":
        return <Button key={p.k} variant="ghost" size="sm" className="h-7 w-full gap-1.5 text-xs" onClick={() => set(Math.floor(Math.random() * 1e6))}><Shuffle className="!size-3.5" /> {p.label}</Button>
      case "point":
        return <p key={p.k} className="text-[11px] text-muted-foreground">Merkezi önizlemedeki yuvarlak tutamaçla taşı.</p>
      case "photo":
        return (
          <div key={p.k} className="flex items-center gap-2">
            <input ref={mapRef} type="file" accept="image/*" hidden onChange={(e) => uploadMap(e.target.files?.[0])} />
            {v && <img src={thumbUrl(v)} alt="" className="h-8 w-8 rounded object-cover" />}
            <Button variant="secondary" size="sm" className="h-8 flex-1 gap-1.5 text-xs" disabled={busy} onClick={() => mapRef.current?.click()}>
              {busy ? <Loader2 className="!size-3.5 animate-spin" /> : <ImagePlus className="!size-3.5" />} {p.label}
            </Button>
            {v && <button aria-label="Haritayı kaldır" className="text-muted-foreground hover:text-destructive" onClick={() => set("")}><Trash2 className="h-3.5 w-3.5" /></button>}
          </div>
        )
      case "kernel":
        return (
          <div key={p.k} className="grid grid-cols-5 gap-1">
            {(v as number[]).map((x, i) => (
              <input key={i} aria-label={`Matris ${i + 1}`} type="number" className="h-7 w-full rounded border bg-background text-center text-xs" value={x} onChange={(e) => set((v as number[]).map((o, q) => (q === i ? Number(e.target.value) || 0 : o)))} />
            ))}
          </div>
        )
      case "pins": {
        const pins = (v ?? []) as [number, number, number][]
        return (
          <div key={p.k} className="space-y-2">
            {!pins.length && <p className="text-[11px] text-muted-foreground">Önizlemeye tıklayarak nokta ekle. Nokta yokken tüm görsele üstteki değer uygulanır.</p>}
            {pins.map((q, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="flex-1"><Num label={`Nokta ${i + 1}`} v={q[2]} min={0} max={80} set={(x) => set(pins.map((o, j) => (j === i ? [o[0], o[1], x] : o)))} /></div>
                <button aria-label="Noktayı sil" className="pb-0.5 text-muted-foreground hover:text-destructive" onClick={() => set(pins.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        )
      }
      case "strokes": {
        const st = (v ?? []) as unknown[]
        return (
          <div key={p.k} className="space-y-3">
            <div className="grid grid-cols-3 gap-1">
              {LIQUIFY.map(([t, l]) => (
                <button key={t} onClick={() => setLiquify({ tool: t })} className={cn("rounded-md border py-1 text-[11px] transition-colors hover:border-primary/60", liquify.tool === t ? "border-primary/70 bg-primary/15 text-foreground" : "text-muted-foreground")}>{l}</button>
              ))}
            </div>
            <Num label="Fırça Boyutu" v={Math.round(liquify.size * 100)} min={2} max={80} set={(x) => setLiquify({ size: x / 100 })} />
            <Num label="Basınç" v={Math.round(liquify.rate * 100)} min={5} max={100} set={(x) => setLiquify({ rate: x / 100 })} />
            <div className="grid grid-cols-2 gap-1.5">
              <Button variant="ghost" size="sm" className="text-xs" disabled={!st.length} onClick={() => set(st.slice(0, -1))}><Undo2 className="!size-3.5" /> Son Darbe</Button>
              <Button variant="ghost" size="sm" className="text-xs" disabled={!st.length} onClick={() => set([])}><RotateCcw className="!size-3.5" /> Temizle</Button>
            </div>
          </div>
        )
      }
    }
  }

  const params = cur ? spec[cur.kind] ?? [] : []
  const hint = cur ? filterEntry(cur.kind)?.hint : undefined

  return (
    <div className="space-y-5">
      {stack.length > 0 && (
        <section className="space-y-1.5">
          <Label>Uygulanan Filtreler</Label>
          {[...stack].map((f, i) => (
            <div key={f.id} onClick={() => setSel(f.id === sel ? null : f.id)} className={cn("group flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition-colors hover:border-primary/60", f.id === sel ? "border-primary/70 bg-primary/15" : "text-muted-foreground", f.off && "opacity-50")}>
              <button aria-label={f.off ? "Göster" : "Gizle"} className="hover:text-foreground" onClick={(e) => { e.stopPropagation(); put(f.id, { off: !f.off }) }}>
                {f.off ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
              <span className="flex-1 truncate">{filterLabel(f.kind)}</span>
              <span className="hidden items-center gap-1 group-hover:flex">
                <button aria-label="Yukarı" className="hover:text-foreground" onClick={(e) => { e.stopPropagation(); move(i, -1) }}><ArrowUp className="h-3 w-3" /></button>
                <button aria-label="Aşağı" className="hover:text-foreground" onClick={(e) => { e.stopPropagation(); move(i, 1) }}><ArrowDown className="h-3 w-3" /></button>
                <button aria-label="Filtreyi sil" className="hover:text-destructive" onClick={(e) => { e.stopPropagation(); setStack(stack.filter((x) => x.id !== f.id)); if (f.id === sel) setSel(null) }}><Trash2 className="h-3.5 w-3.5" /></button>
              </span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Filtreler yukarıdan aşağı sırayla uygulanır.</p>
        </section>
      )}

      {cur && (
        <section className="space-y-3 rounded-lg border p-3">
          <p className="text-xs font-medium">{filterLabel(cur.kind)}</p>
          {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
          {params.map((p) => control(p, cur))}
          <Num label="Yoğunluk" v={Math.round(cur.amount * 100)} min={0} max={100} set={(x) => put(cur.id, { amount: x / 100 })} />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Yalnızca Seçili Alan</span>
            <Switch
              checked={!!cur.area && selection.some((m) => m.id === cur.area)}
              onCheckedChange={(v) => {
                if (v && !target) return toast("Önce Selection Tool ile bir alan seç")
                put(cur.id, { area: v ? target!.id : undefined })
              }}
            />
          </div>
        </section>
      )}

      <section id="sec-gallery" className="space-y-2">
        <Label>Filtre Galerisi</Label>
        <div className="flex flex-wrap gap-1">
          {GALLERY_SECTIONS.map((s) => (
            <button key={s} onClick={() => setSec(s)} className={cn("rounded-full border px-2 py-0.5 text-[11px] transition-colors hover:border-primary/60", sec === s ? "border-primary/70 bg-primary/15 text-foreground" : "text-muted-foreground")}>{s}</button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {FILTER_GALLERY.filter((t) => t.section === sec).map((t) => (
            <Tile key={t.kind} img={thumbs[t.kind!]} label={t.label} on={stack.some((f) => f.kind === t.kind)} selected={!!cur && cur.kind === t.kind} onClick={() => add(t.kind!, spec)} />
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">Tıkla, filtre eklensin. Aynı filtreyi birden çok kez kullanabilirsin.</p>
      </section>

      <section id="sec-ai" className="space-y-2 rounded-lg border p-3">
        <Label>Yapay Zekâ Filtreleri</Label>
        <p className="text-[11px] text-muted-foreground">Bilgisayarında çalışan modeller: konuyu bulma, arka plan kaldırma ve üretken dolgu.</p>
        <div className="grid grid-cols-2 gap-1.5">
          <Button variant="secondary" size="sm" className="text-xs" onClick={() => run("sel:subject")}>Konuyu Seç</Button>
          <Button variant="secondary" size="sm" className="text-xs" onClick={() => run("erase:bg")}>Arka Planı Kaldır</Button>
          <Button variant="secondary" size="sm" className="text-xs" onClick={() => run("erase:gen")}>Üretken Dolgu</Button>
          <Button variant="secondary" size="sm" className="text-xs" onClick={() => run("retouch:sec:skin")}>Cilt Rötuşu</Button>
        </div>
      </section>
    </div>
  )
}
