import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, Power, Sparkles } from "lucide-react"
import { Toaster, toast } from "sonner"
import { Button } from "@/components/ui/button"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Sidebar } from "@/components/Sidebar"
import { Stage } from "@/components/Stage"
import { Panel } from "@/components/Panel"
import { GenerateDialog } from "@/components/GenerateDialog"
import { api } from "@/lib/api"
import { mergeStyle, naturalSort, remap, todayPlus, words } from "@/lib/text"
import type { Config, Item, Job, Mode, Settings, Style } from "@/types"

const IMG = /\.(jpe?g|png|webp|bmp)$/i

export default function App() {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [mode, setMode] = useState<Mode>("block")
  const [settings, setSettings] = useState<Settings>({ start: todayPlus(1), time: "20:00", outDir: "output" })
  const [uploading, setUploading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [job, setJob] = useState<Job | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [dlg, setDlg] = useState(false)
  const [bye, setBye] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const defFx = useRef({ bw: true, grain: 1, vignette: 1 })

  useEffect(() => {
    ;(async () => {
      try {
        const [c, s] = await Promise.all([api.config(), api.session()])
        setCfg(c)
        const st = s.settings || {}
        setSettings({ start: st.start || todayPlus(1), time: st.time || c.schedule.time || "20:00", outDir: st.outDir || c.outDir || "output" })
        const its: Item[] = (s.items || []).map(normItem)
        setItems(its)
        setCurrentId(s.currentId && its.some((i) => i.id === s.currentId) ? s.currentId : its[0]?.id ?? null)
        c.fontWarn?.length && toast.warning("Font bulunamadı: " + c.fontWarn.join(", "))
      } catch (e: any) {
        toast.error("Sunucuya bağlanılamadı: " + e.message)
      }
      setLoaded(true)
    })()
  }, [])

  // oturumu otomatik kaydet
  useEffect(() => {
    if (!loaded) return
    const t = setTimeout(() => api.saveSession({ items, currentId, settings }).catch(() => {}), 500)
    return () => clearTimeout(t)
  }, [items, currentId, settings, loaded])

  const item = items.find((i) => i.id === currentId)
  useEffect(() => setSelected([]), [currentId])

  const update = useCallback(
    (fn: (it: Item) => Item) => setItems((a) => a.map((i) => (i.id === currentId ? fn(i) : i))),
    [currentId]
  )

  const setText = (text: string) =>
    update((it) => {
      const r = remap(words(it.text), words(text), it.styles, it.offsets)
      return { ...it, text, styles: r.styles, offsets: r.offsets }
    })

  const patch = (p: Partial<Item>, all = false) => {
    if (all) {
      const key = Object.keys(p)[0] as keyof Item
      setItems((a) => a.map((i) => ({ ...i, [key]: (p as any)[key] ?? (item as any)[key] })))
      if (!Object.keys(p).length) return
      toast.success("Tüm fotoğraflara uygulandı")
    } else update((it) => ({ ...it, ...p }))
  }
  // "hepsine uygula" efekt için: mevcut fx'i kopyala
  const patchAllFx = () => item && setItems((a) => a.map((i) => ({ ...i, fx: { ...item.fx } })))

  const applyStyle = (p: Partial<Style>) =>
    update((it) => {
      const n = words(it.text).length
      const styles = Array.from({ length: n }, (_, i) => it.styles[i] ?? {})
      for (const i of selected) if (i < n) styles[i] = mergeStyle(styles[i], p)
      return { ...it, styles }
    })

  const resetPosition = () => update((it) => ({ ...it, block: [0, 0], offsets: {} }))

  const addFiles = async (files: File[]) => {
    const list = files.filter((f) => IMG.test(f.name)).sort(naturalSort)
    if (!list.length) return toast.error("Desteklenen fotoğraf bulunamadı (jpg, png, webp)")
    setUploading(true)
    let last: string | null = null
    for (const f of list) {
      try {
        const r = await api.upload(f)
        const it = newItem(r.id, r.name, defFx.current)
        setItems((a) => [...a, it])
        last = last ?? r.id
      } catch (e: any) {
        toast.error(`${f.name}: ${e.message}`)
      }
    }
    setUploading(false)
    if (last) setCurrentId(last)
  }

  const removeItem = async (id: string) => {
    const idx = items.findIndex((i) => i.id === id)
    const rest = items.filter((i) => i.id !== id)
    setItems(rest)
    if (currentId === id) setCurrentId(rest[Math.min(idx, rest.length - 1)]?.id ?? null)
    api.remove(id).catch(() => {})
  }

  const move = (id: string, dir: -1 | 1) =>
    setItems((a) => {
      const i = a.findIndex((x) => x.id === id)
      const j = i + dir
      if (j < 0 || j >= a.length) return a
      const b = [...a]
      ;[b[i], b[j]] = [b[j], b[i]]
      return b
    })

  const generate = async () => {
    const empty = items.findIndex((i) => !words(i.text).length)
    if (!items.length) return toast.error("Önce fotoğraf ekle")
    if (empty >= 0) {
      setCurrentId(items[empty].id)
      return toast.error(`${empty + 1}. fotoğrafın metni boş`)
    }
    setJob(null)
    setDlg(true)
    try {
      const { job: id } = await api.generate({ items, ...settings })
      setJobId(id)
      for (;;) {
        const j = await api.job(id)
        setJob(j)
        if (j.finished) break
        await new Promise((r) => setTimeout(r, 350))
      }
    } catch (e: any) {
      toast.error(e.message)
      setDlg(false)
    }
  }

  const quit = async () => {
    setBye(true)
    api.quit().catch(() => {})
    setTimeout(() => window.close(), 400)
  }

  if (bye)
    return (
      <div className="grid h-full place-items-center text-muted-foreground">
        <p className="text-sm">NEGANS VISION kapatıldı. Bu pencereyi kapatabilirsin.</p>
      </div>
    )
  if (!cfg)
    return (
      <div className="grid h-full place-items-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="flex h-full flex-col"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          addFiles([...e.dataTransfer.files])
        }}
      >
        <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold tracking-[0.2em] text-primary">{cfg.brand.name}</span>
            <span className="text-xs text-muted-foreground">{cfg.brand.handle}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={generate} disabled={!items.length} className="h-8 gap-1.5">
              <Sparkles className="!size-4" /> Görselleri üret
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Kapat" onClick={quit}>
              <Power className="h-4 w-4" />
            </Button>
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
          <Sidebar items={items} currentId={currentId} select={setCurrentId} move={move} remove={removeItem} pickFiles={() => fileRef.current?.click()} uploading={uploading} />
          <Stage
            item={item} cfg={cfg} mode={mode} setMode={setMode} selected={selected} setSelected={setSelected}
            update={update} applyStyle={applyStyle} resetPosition={resetPosition} pickFiles={() => fileRef.current?.click()}
          />
          <Panel
            item={item} items={items} cfg={cfg} selected={selected} setSelected={setSelected} setText={setText}
            patch={(p, all) => (all && p.fx ? patchAllFx() : patch(p, all))} settings={settings} setSettings={setSettings}
          />
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles([...(e.target.files || [])]); e.target.value = "" }} />
        <GenerateDialog open={dlg} onClose={() => setDlg(false)} job={job} jobId={jobId} />
        <Toaster theme="dark" position="bottom-center" />
      </div>
    </TooltipProvider>
  )
}

function newItem(id: string, name: string, fx: Item["fx"]): Item {
  return { id, name, text: "", tone: "quiet", accent: "", styles: [], block: [0, 0], offsets: {}, fx: { ...fx } }
}

function normItem(r: any): Item {
  return {
    ...newItem(r.id, r.name || r.id, { bw: true, grain: 1, vignette: 1 }),
    ...r,
    fx: { bw: true, grain: 1, vignette: 1, ...(r.fx || {}) },
    styles: r.styles || [],
    offsets: r.offsets || {},
    block: r.block || [0, 0],
  }
}
