import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowUpCircle, Loader2, Redo2, Settings as Cog, Sparkles, Undo2 } from "lucide-react"
import { Toaster, toast } from "sonner"
import { Button } from "@/components/ui/button"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Filmstrip } from "@/components/Filmstrip"
import { SaveMenu } from "@/components/SaveMenu"
import { COLOR_FORMATS, saveAs } from "@/lib/save"
import { LayersPanel } from "@/components/LayersPanel"
import { MenuBar, type Menu } from "@/components/MenuBar"
import { ToolBox } from "@/components/ToolBox"
import { StartPage } from "@/components/StartPage"
import { geoForPreset } from "@/lib/platforms"
import { SELECT_SECTIONS, SELECT_TOOLS } from "@/lib/selection"
import { CROP_SECTIONS, CROP_TOOLS } from "@/lib/crop"
import { ERASE_SECTIONS, ERASE_TOOLS } from "@/lib/erase"
import { RETOUCH_SECTIONS, RETOUCH_TOOLS, retouchDefaults } from "@/lib/retouch"
import { COLOR_SECTIONS, COLOR_TOOLS } from "@/lib/color"
import { createLayer, LAYER_SECTIONS, LAYER_TOOLS, newId } from "@/lib/layerops"
import { layerUV } from "@/lib/design"
import { FILTER_SECTIONS, FILTER_TOOLS, type LiquifyTool } from "@/lib/filters"
import { BRUSH_SECTIONS, BRUSH_TOOLS, DEFAULT_BRUSH } from "@/lib/brushes"
import { XFORM_SECTIONS, XFORM_TOOLS, xformDelta, type XformDelta } from "@/lib/transform"
import { Stage } from "@/components/Stage"
import { Panel } from "@/components/Panel"
import { GenerateDialog } from "@/components/GenerateDialog"
import { UpdateDialog } from "@/components/UpdateDialog"
import { SettingsDialog } from "@/components/SettingsDialog"
import { api } from "@/lib/api"
import { mergeStyle, naturalSort, remap, words } from "@/lib/text"
import { legacyGeo, naturalSize, canvasSize } from "@/lib/geo"
import { applyTheme, isLightTheme } from "@/lib/themes"
import { effectiveItem, removeLayer, type Layer } from "@/lib/layers"
import type { BrushSettings, BrushTool, CloneSource, FilterItem, MaskPaintTool, Stroke, Config, ExportOpts, Geo, ImgLayer, Item, Job, Mask, Mode, SelectTool, PresetMeta, Settings, Slice, Style, XformMode, UpdateInfo, Watermark } from "@/types"

// Vinyet ve parazit yeni fotoğraflarda kapalı başlar; kullanıcı isterse açar.
const DEFAULT_FX: Item["fx"] = { bw: true, grain: 0, vignette: 0, preset: "", amount: 1, adjust: {} }
const SETTINGS_VERSION = 2
const DEFAULT_EXPORT: Settings["export"] = { format: "jpg", quality: 95, naming: "number", exif: false }
const DEFAULTS: Settings = { outDir: "output", tone: "quiet", fx: DEFAULT_FX, guides: true, export: DEFAULT_EXPORT, aspect: "original", theme: "tonefect", v: SETTINGS_VERSION }
const IMG = /\.(jpe?g|png|webp)$/i
const HISTORY_MAX = 100
const HISTORY_GROUP_MS = 600 // art arda gelen değişiklikler (sürükleme, yazma) tek adım sayılır

let intentSeq = Date.now() // menü komutları sırayla numaralanır; aynı milisaniyede gelen ikinci komut kaybolmasın

export default function App() {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [mode, setMode] = useState<Mode>("block")
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [uploading, setUploading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [job, setJob] = useState<Job | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [dlg, setDlg] = useState(false)
  const [bye, setBye] = useState(false)
  const [cog, setCog] = useState(false)
  const [wm, setWm] = useState<Watermark | null>(null)
  const [tab, setTabRaw] = useState("") // "" = panel kapalı
  const [project, setProject] = useState<{ id: string; name: string } | null>(null)
  const [showStrip, setShowStrip] = useState(true)
  const [section, setSection] = useState<{ id: string; n: number } | null>(null)
  const [intent, setIntent] = useState<{ cmd: string; n: number } | null>(null)
  const pickAfterOpen = useRef(false)
  const setTab = (t: string) => setTabRaw(t)
  const [clip, setClip] = useState<Item["fx"] | null>(null) // kopyalanan renk/efekt ayarları
  const [maskSel, setMaskSel] = useState<string | null>(null) // seçili yerel düzenleme
  const [maskShow, setMaskShow] = useState(false)
  const [selTool, setSelTool] = useState<SelectTool>({ mode: "rect", tol: 0.3, contiguous: true, size: 0.04, hard: 0.6, combine: "add", amt: 10, focus: 0.5 })
  const [quitOnClose, setQuitOnClose] = useState(true)
  const [upd, setUpd] = useState<UpdateInfo | null>(null)
  const [updOpen, setUpdOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [presets, setPresets] = useState<PresetMeta[]>([])
  const [groups, setGroups] = useState<string[]>([])

  const loadPresets = useCallback(async () => {
    try {
      const r = await api.presets()
      setPresets(r.presets)
      setGroups(r.groups)
    } catch (e: any) {
      toast.error("Hazır ayarlar yüklenemedi: " + e.message)
    }
  }, [])
  useEffect(() => {
    loadPresets()
  }, [loadPresets])

  useEffect(() => {
    ;(async () => {
      try {
        const c = await api.config()
        setCfg(c)
        // tema başlangıç sayfasında da son projeninki olsun
        api.projects().then(async (r) => {
          if (!r.projects[0]) return
          const last = await api.project(r.projects[0].id)
          if (last.settings?.theme) setSettings((s) => ({ ...s, theme: last.settings.theme }))
        }).catch(() => {})
        setWm(c.watermark)
        setQuitOnClose(c.quitOnClose !== false)
        c.updateFailed && toast.error(`Güncelleme v${c.updateFailed.target} kurulamadı. Kurulum kaydı: ${c.updateFailed.log}`, { duration: 20000 })
        c.fontWarn?.length && toast.warning("Font bulunamadı: " + c.fontWarn.join(", "))
      } catch (e: any) {
        toast.error("Sunucuya bağlanılamadı: " + e.message)
      }
      api.updateCheck().then((u) => {
        setUpd(u)
        if (u.newer) setUpdOpen(true)
      }).catch(() => {})
    })()
  }, [])

  // Sunucuya "pencere açık" bilgisi: pencere kapanınca uygulama (ayar açıksa) tamamen kapanır
  useEffect(() => {
    if (!loaded) return
    const beat = () => api.heartbeat().catch(() => {})
    beat()
    const t = setInterval(beat, 2000)
    const bye = () => { api.closing().catch(() => {}) }
    window.addEventListener("pagehide", bye)
    return () => {
      clearInterval(t)
      window.removeEventListener("pagehide", bye)
    }
  }, [loaded])

  useEffect(() => applyTheme(settings.theme), [settings.theme])

  // açık projeyi otomatik kaydet
  useEffect(() => {
    if (!loaded || !project) return
    const t = setTimeout(() => api.saveProject(project.id, { items, currentId, settings }).catch(() => {}), 500)
    return () => clearTimeout(t)
  }, [items, currentId, settings, loaded, project])

  /** Projeyi aç: fotoğraflar, ayarlar; paneller kapalı başlar (kullanıcı menüden seçer). */
  const openProject = async (id: string, pickPhotos = false) => {
    try {
      const s = await api.project(id)
      const st = s.settings || {}
      // eski kayıtlarda varsayılan vinyet/parazit açıktı; bir kez kapalıya çek
      const fx = { ...DEFAULTS.fx, ...(st.fx || {}), ...((st.v ?? 1) < SETTINGS_VERSION ? { grain: 0, vignette: 0 } : {}) }
      setSettings({ ...DEFAULTS, ...st, fx, export: { ...DEFAULT_EXPORT!, ...(st.export || {}) }, v: SETTINGS_VERSION, outDir: st.outDir || cfg?.outDir || "output" })
      const its: Item[] = (s.items || []).map(normItem)
      hist.current = { past: [], future: [], prev: null, at: 0, skip: true }
      setItems(its)
      setCurrentId(s.currentId && its.some((i) => i.id === s.currentId) ? s.currentId : its[0]?.id ?? null)
      setTabRaw("")
      setProject({ id, name: s.meta?.name || "Proje" })
      setLoaded(true)
      pickAfterOpen.current = pickPhotos
    } catch (e: any) {
      toast.error(e.message)
    }
  }
  const renameProject = async (name: string) => {
    const n = name.trim()
    if (!project || !n || n === project.name) return
    try {
      await api.renameProject(project.id, n)
      setProject({ ...project, name: n.slice(0, 60) })
    } catch (e: any) {
      toast.error(e.message)
    }
  }
  const closeProject = async () => {
    if (project) await api.saveProject(project.id, { items, currentId, settings }).catch(() => {})
    setLoaded(false)
    setProject(null)
    setItems([])
    setCurrentId(null)
  }
  useEffect(() => {
    if (project && pickAfterOpen.current) {
      pickAfterOpen.current = false
      fileRef.current?.click()
    }
  }, [project])

  // geri al / yinele geçmişi
  const hist = useRef({ past: [] as Item[][], future: [] as Item[][], prev: null as Item[] | null, at: 0, skip: false })
  const [histLen, setHistLen] = useState({ past: 0, future: 0 })
  useEffect(() => {
    const h = hist.current
    if (loaded && !h.skip && h.prev && h.prev !== items) {
      const now = Date.now()
      if (now - h.at > HISTORY_GROUP_MS) {
        h.past.push(h.prev)
        if (h.past.length > HISTORY_MAX) h.past.shift()
      }
      h.at = now
      h.future = []
    }
    h.skip = false
    h.prev = items
    setHistLen({ past: h.past.length, future: h.future.length })
  }, [items, loaded])

  const itemsRef = useRef(items)
  itemsRef.current = items
  const currentRef = useRef(currentId)
  currentRef.current = currentId

  const travel = useCallback((dir: "undo" | "redo") => {
    const h = hist.current
    const target = (dir === "undo" ? h.past : h.future).pop()
    if (!target) return
    const now = itemsRef.current
    ;(dir === "undo" ? h.future : h.past).push(now)
    h.skip = true
    h.at = 0
    setItems(target)
    // geri gelen fotoğrafı seç; seçili olan kaybolduysa ilkine geç
    const back = target.find((t) => !now.some((n) => n.id === t.id))
    const cur = currentRef.current
    if (back) setCurrentId(back.id)
    else if (!target.some((t) => t.id === cur)) setCurrentId(target[0]?.id ?? null)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const el = e.target as HTMLElement | null
      // metin alanlarında tarayıcının kendi geri alması çalışsın
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return
      const z = e.code === "KeyZ" || e.key.toLowerCase() === "z"
      const y = e.code === "KeyY" || e.key.toLowerCase() === "y"
      // Ctrl+C / Ctrl+V (ya da Shift ile): renk ve efekt ayarlarını kopyala/yapıştır; seçili yazı varsa tarayıcıya bırak
      const noText = !window.getSelection()?.toString()
      if (e.code === "KeyS") e.shiftKey ? saveRef.current.saveAs(false) : saveRef.current.save()
      else if (e.code === "KeyC" && noText) clipRef.current.copyFx()
      else if (e.code === "KeyV") clipRef.current.pasteFx()
      else if (z && !e.shiftKey) travel("undo")
      else if ((z && e.shiftKey) || y) travel("redo")
      else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [travel])

  const item = items.find((i) => i.id === currentId)
  useEffect(() => setSelected([]), [currentId])
  // metin kısalınca artık olmayan kelimeler seçili kalmasın
  const wordCount = item ? words(item.text).length : 0
  useEffect(() => setSelected((s) => (s.some((i) => i >= wordCount) ? s.filter((i) => i < wordCount) : s)), [wordCount])

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
  const patchAllFx = () => {
    if (!item) return
    setItems((a) => a.map((i) => ({ ...i, fx: { ...item.fx } })))
    toast.success("Tüm fotoğraflara uygulandı")
  }

  const applyStyle = (p: Partial<Style>) =>
    update((it) => {
      const n = words(it.text).length
      const styles = Array.from({ length: n }, (_, i) => it.styles[i] ?? {})
      for (const i of selected) if (i < n) styles[i] = mergeStyle(styles[i], p)
      return { ...it, styles }
    })

  const resetPosition = () => update((it) => ({ ...it, block: [0, 0], offsets: {} }))

  // Tasarım: görsel katmanları
  const [layerSel, setLayerSel] = useState<string[]>([])
  const [eraseMode, setEraseMode] = useState<"" | "layermask" | "vector">("")
  const [maskTool, setMaskTool] = useState<MaskPaintTool>({ paint: "hide", size: 0.08, hard: 0.6, shape: "rect" })
  useEffect(() => {
    if (tab !== "erase") setEraseMode("")
  }, [tab])
  const putLayer = (id: string, p: Partial<ImgLayer>) => update((it) => ({ ...it, layers: (it.layers ?? []).map((l) => (l.id === id ? { ...l, ...p } : l)) }))
  const [brushTool, setBrushTool] = useState<BrushTool>("brush")
  const [brush, setBrushRaw] = useState<BrushSettings>(DEFAULT_BRUSH)
  const setBrush = (p: Partial<BrushSettings>) => setBrushRaw((b) => ({ ...b, ...p }))
  const [smoothing, setSmoothing] = useState(0.1)
  // Rötuş: her araç kendi fırçasını hatırlar
  const [retouchTool, setRetouchTool] = useState<BrushTool>("spot")
  const [retouchBrushes, setRetouchBrushes] = useState<Record<string, BrushSettings>>({})
  const retouchBrush = retouchBrushes[retouchTool] ?? retouchDefaults(retouchTool)
  const setRetouchBrush = (p: Partial<BrushSettings>) => setRetouchBrushes((m) => ({ ...m, [retouchTool]: { ...(m[retouchTool] ?? retouchDefaults(retouchTool)), ...p } }))
  // Renk: damlalık ve histogram için güncel önizleme
  const [colorPick, setColorPickRaw] = useState<{ fn: (rgb: [number, number, number]) => void } | null>(null)
  const setColorPick = (f: ((rgb: [number, number, number]) => void) | null) => setColorPickRaw(f ? { fn: f } : null)
  const [previewImg, setPreviewImg] = useState<string | null>(null)
  // Filtreler: seçili filtre ve Sıvılaştır fırçası
  const [filterSel, setFilterSel] = useState<string | null>(null)
  const [liquify, setLiquifyRaw] = useState<LiquifyTool>({ tool: "push", size: 0.2, rate: 0.6 })
  const setLiquify = (p: Partial<LiquifyTool>) => setLiquifyRaw((l) => ({ ...l, ...p }))
  const curFilter = tab === "fx" ? item?.fx.filters?.find((f) => f.id === filterSel && !f.off) : undefined
  const setCurFilter = (p: Partial<FilterItem>) => update((it) => ({ ...it, fx: { ...it.fx, filters: (it.fx.filters ?? []).map((f) => (f.id === filterSel ? { ...f, ...p } : f)) } }))
  const [cloneSource, setCloneSource] = useState<CloneSource | null>(null)
  const [armedSource, setArmedSource] = useState(false)
  const [patchMode, setPatchModeRaw] = useState<Record<string, string>>({})
  const setPatchMode = (t: string, v: string) => setPatchModeRaw((m) => ({ ...m, [t]: v }))
  const armSource = () => {
    setArmedSource(true)
    toast("Fotoğrafta kopyalanacak temiz bir yere tıkla")
  }
  useEffect(() => {
    setCloneSource(null)
    setArmedSource(false)
  }, [currentId])
  const addSpecial = (t: "fillgaps" | "colorkey") => addStroke({ tool: t, pts: [[0.5, 0.5, 1]], seed: 0, b: brush })
  const addStroke = (s: Stroke) => update((it) => {
    // boş katman seçiliyken boya o katmana gider
    const ly = tab === "brush" ? it.layers?.find((l) => l.id === layerSel[0] && l.kind === "blank") : undefined
    if (!ly) return { ...it, paint: { strokes: [...(it.paint?.strokes ?? []), s] } }
    const [W, H] = canvasSize(it.geo, it.src) ?? [1080, 1350]
    const lw = ly.w * W
    const lh = lw * ly.ar * (ly.sy ?? 1)
    const st: Stroke = { ...s, b: { ...s.b, size: (s.b.size * Math.min(W, H)) / Math.min(lw, lh) }, pts: s.pts.map(([x, y, p]) => [...layerUV(ly, W, H, x * W, y * H), p] as [number, number, number]) }
    return { ...it, layers: it.layers!.map((l) => (l.id === ly.id ? { ...l, paint: { strokes: [...(l.paint?.strokes ?? []), st] } } : l)) }
  })
  const [xform, setXform] = useState<XformMode>("move")
  const [lastXform, setLastXform] = useState<XformDelta | null>(null)
  const [sliceTool, setSliceTool] = useState<"draw" | "select">("draw")
  const [sliceSel, setSliceSel] = useState<string | null>(null)
  const setSlices = (slices: Slice[]) => update((it) => ({ ...it, slices }))
  const setLayers = (layers: ImgLayer[]) => update((it) => ({ ...it, layers }))
  useEffect(() => {
    setLayerSel([])
    setSliceSel(null)
  }, [currentId])
  // Yerel → seçimi katmana kopyala / taşı: seçili alan şeffaf PNG katman olur, Tasarım aracında taşınır
  const selectionToLayer = async (cut: boolean, maskId = maskSel) => {
    if (!item || !maskId) return
    try {
      const r = await api.extractSelection({ item: effectiveItem(item), maskId })
      const ly: ImgLayer = { id: Math.random().toString(36).slice(2, 9), photo: r.id, name: r.name, x: r.x, y: r.y, w: r.w, ar: r.height / r.width, rot: 0, opacity: 1, flipH: false, cutout: false }
      const mid = maskId
      update((it) => ({
        ...it,
        layers: [...(it.layers ?? []), ly],
        fx: cut ? { ...it.fx, masks: (it.fx.masks ?? []).map((m) => (m.id === mid ? { ...m, fill: true } : m)) } : it.fx,
      }))
      setTab("design")
      setLayerSel([ly.id])
      toast.success(cut ? "Alan taşındı: şimdi sürükleyip yerleştir" : "Alan katmana kopyalandı")
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const setMasks = (masks: Mask[]) => update((it) => ({ ...it, fx: { ...it.fx, masks } }))
  const setMask = (p: Partial<Mask>) =>
    update((it) => ({ ...it, fx: { ...it.fx, masks: (it.fx.masks ?? []).map((m) => (m.id === maskSel ? { ...m, ...p } : m)) } }))
  useEffect(() => setMaskSel(null), [currentId])
  const curMask = tab === "local" || tab === "select" ? item?.fx.masks?.find((m) => m.id === maskSel && (m.type === "select") === (tab === "select")) : undefined

  // Katmanlar paneli
  const withLinks = (ids: string[]) => {
    const all = item?.layers ?? []
    const links = new Set(all.filter((l) => ids.includes(l.id) && l.link).map((l) => l.link))
    return [...new Set([...ids, ...all.filter((l) => l.link && links.has(l.link)).map((l) => l.id)])]
  }
  const openLayer = (l: Layer, additive = false) => {
    if (l.tool === "settings") return setCog(true)
    if (l.layerId && additive) return setLayerSel(layerSel.includes(l.layerId) ? layerSel.filter((x) => x !== l.layerId) : withLinks([...layerSel, l.layerId]))
    setTab(l.tool)
    if (l.maskId) setMaskSel(l.maskId)
    if (l.layerId) setLayerSel(withLinks([l.layerId]))
  }
  const [renaming, setRenaming] = useState<string | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const putLayerSafe = (id: string, p: Partial<ImgLayer>) => update((it) => ({ ...it, layers: (it.layers ?? []).map((l) => (l.id === id ? { ...l, ...p } : l)) }))
  const toggleGroup = (id: string) => update((it) => ({ ...it, groups: (it.groups ?? []).map((g) => (g.id === id ? { ...g, open: !g.open } : g)) }))
  const renameGroup = (id: string, name: string) => update((it) => ({ ...it, groups: (it.groups ?? []).map((g) => (g.id === id ? { ...g, name } : g)) }))
  const layerCommand = async (cmd: string) => {
    if (!item) return
    const all = item.layers ?? []
    const chosen = all.filter((l) => layerSel.includes(l.id))
    const free = chosen.filter((l) => !l.locked)
    const need = () => {
      if (chosen.length) return false
      toast("Önce sağdan bir katman seç")
      return true
    }
    const [, op, arg] = cmd.split(":")
    const [W, H] = canvasSize(item.geo, item.src) ?? [1080, 1350]
    const map = (fn: (l: ImgLayer) => ImgLayer) => setLayers(all.map((l) => (layerSel.includes(l.id) ? fn(l) : l)))
    if (op === "new") {
      if (all.length >= 40) return void toast("En fazla 40 katman eklenebilir")
      const ly = createLayer(arg as "blank", W, H, all.length + 1)
      setLayers([...all, ly])
      setLayerSel([ly.id])
      return setTabRaw(arg === "blank" ? "design" : "layers")
    }
    if (op === "sec" || op === "styles" || op === "style") {
      setTabRaw("layers")
      return setIntent({ cmd: op === "style" ? `layerp:style:${arg}` : `layerp:${op === "styles" ? "styles" : arg}`, n: ++intentSeq })
    }
    if (op === "filter") return setFilterOpen(true)
    if (op === "quickmask") {
      setMaskShow(true)
      toast("Hızlı Maske: seçilecek yeri boya, kırmızı alan seçimdir")
      return command("sel:brush")
    }
    if (op === "smartmask") {
      toast("Filtreyi seçip Yalnızca Seçili Alan'ı aç; maske olarak seçim kullanılır")
      return command("filter:gallery")
    }
    if (op === "adjmask") {
      const adj = chosen.find((l) => l.kind === "adjust") ?? [...all].reverse().find((l) => l.kind === "adjust")
      if (!adj) return void toast("Önce bir Ayar Katmanı ekle")
      setLayerSel([adj.id])
      return command("erase:layermask")
    }
    if (op === "mergevis" || op === "merge" || op === "flatten") {
      try {
        if (op === "flatten") {
          const r = await api.layersFlatten({ item: effectiveItem(item) })
          const ly: ImgLayer = { id: newId(), photo: r.id, name: "Düzleştirilmiş", x: 0.5, y: 0.5, w: 1, ar: H / W, rot: 0, opacity: 1, flipH: false, cutout: false }
          update((it) => ({ ...it, layers: [ly], groups: [], text: "", styles: [], offsets: {}, paint: undefined, hidden: [], fx: { bw: false, grain: 0, vignette: 0, preset: "b:original", amount: 1, adjust: {} } }))
          setLayerSel([ly.id])
          return void toast.success("Görüntü düzleştirildi; Geri Al ile dönebilirsin")
        }
        const visible = effectiveItem(item).layers ?? []
        const ids = op === "merge" ? layerSel : visible.filter((l) => l.kind !== "adjust").map((l) => l.id)
        if (ids.length < 2) return void toast(op === "merge" ? "Birleştirmek için en az iki katman seç" : "Birleştirilecek görünür katman yok")
        const r = await api.layersMerge({ item: effectiveItem(item), ids })
        const ly: ImgLayer = { id: newId(), photo: r.id, name: "Birleşik Katman", x: 0.5, y: 0.5, w: 1, ar: H / W, rot: 0, opacity: 1, flipH: false, cutout: false }
        const top = Math.max(...ids.map((i) => all.findIndex((l) => l.id === i)))
        setLayers(all.flatMap((l, i) => (i === top ? [ly] : ids.includes(l.id) ? [] : [l])))
        setLayerSel([ly.id])
        toast.success("Katmanlar birleştirildi")
      } catch (e: any) {
        toast.error(e.message)
      }
      return
    }
    if (need()) return
    switch (op) {
      case "dup": {
        const copies = chosen.map((l) => ({ ...structuredClone(l), id: newId(), name: `${l.name} kopya`, x: l.x + 0.03, y: l.y + 0.03, locked: false, link: undefined }))
        setLayers([...all, ...copies])
        return setLayerSel(copies.map((l) => l.id))
      }
      case "del":
        if (!free.length) return void toast("Kilitli katman silinemez")
        setLayers(all.filter((l) => !free.some((x) => x.id === l.id)))
        return setLayerSel([])
      case "rename": return setRenaming(chosen[0].id)
      case "group": {
        const id = newId()
        const n = (item.groups?.length ?? 0) + 1
        const top = Math.max(...chosen.map((l) => all.indexOf(l)))
        const members = all.filter((l) => layerSel.includes(l.id)).map((l) => ({ ...l, group: id }))
        const rest = all.flatMap((l, i) => (i === top ? members : layerSel.includes(l.id) ? [] : [l]))
        return update((it) => ({ ...it, layers: rest, groups: [...(it.groups ?? []), { id, name: `Grup ${n}`, open: true }] }))
      }
      case "ungroup": {
        const gs = new Set(chosen.map((l) => l.group).filter(Boolean))
        return update((it) => ({ ...it, layers: all.map((l) => (l.group && gs.has(l.group) ? { ...l, group: undefined } : l)), groups: (it.groups ?? []).filter((g) => !gs.has(g.id)) }))
      }
      case "link": {
        if (chosen.some((l) => l.link)) return map((l) => ({ ...l, link: undefined }))
        const id = newId()
        return map((l) => ({ ...l, link: id }))
      }
      case "lock": return map((l) => ({ ...l, locked: true }))
      case "unlock": return map((l) => ({ ...l, locked: false }))
      case "toggle":
        return update((it) => {
          const h = new Set(it.hidden ?? [])
          chosen.forEach((l) => (h.has(`img:${l.id}`) ? h.delete(`img:${l.id}`) : h.add(`img:${l.id}`)))
          return { ...it, hidden: [...h] }
        })
      case "clip": return map((l) => ({ ...l, clip: !l.clip }))
      case "smart":
        map((l) => (l.kind ? l : { ...l, smart: true }))
        setTabRaw("layers")
        return
    }
  }
  const toggleLayer = (l: Layer) =>
    update((it) => {
      const h = new Set(it.hidden ?? [])
      h.has(l.key) ? h.delete(l.key) : h.add(l.key)
      return { ...it, hidden: [...h] }
    })
  const removeLayerFx = (l: Layer) => {
    if (l.kind === "watermark") {
      if (!wm) return
      const next = { ...wm, enabled: false }
      setWm(next)
      api.watermark(next).catch((e) => toast.error(e.message))
      toast("Filigran kapatıldı", { action: { label: "Geri al", onClick: () => { setWm(wm); api.watermark(wm).catch(() => {}) } } })
      return
    }
    update((it) => removeLayer(it, l))
  }

  const copyFx = () => {
    if (!item) return
    setClip(JSON.parse(JSON.stringify(item.fx)))
    toast.success("Renk ve efekt ayarları kopyalandı")
  }
  const pasteFx = (id = currentId) => {
    if (!clip || !id) return
    setItems((a) => a.map((i) => (i.id === id ? { ...i, fx: JSON.parse(JSON.stringify(clip)) } : i)))
    toast.success("Ayarlar yapıştırıldı")
  }
  const clipRef = useRef({ copyFx, pasteFx })
  clipRef.current = { copyFx, pasteFx }

  // Kırp/döndür/boyut. Çıktı boyutu sabit ve kilitliyse kırpma değişince uzun kenar korunur, oran uyarlanır.
  const setGeo = (p: Partial<Geo>) =>
    update((it) => {
      const g: Geo = { ...(it.geo ?? legacyGeo()), ...p }
      const reshaped = "crop" in p || "rotate" in p || "straighten" in p || "aspect" in p || "ca" in p
      if (reshaped && !("outW" in p) && g.lock !== false && g.outW && g.outH && it.src) {
        const n = naturalSize(g, it.src)
        const s = Math.max(g.outW, g.outH) / Math.max(n[0], n[1])
        g.outW = Math.max(16, Math.round(n[0] * s))
        g.outH = Math.max(16, Math.round(n[1] * s))
      }
      return { ...it, geo: g }
    })

  const applyAllGeo = () => {
    if (!item) return
    const g = item.geo ?? legacyGeo()
    const long = g.outW && g.outH ? Math.max(g.outW, g.outH) : null
    setItems((a) =>
      a.map((i) => {
        if (i.id === item.id) return i
        const ng: Geo = { ...(i.geo ?? legacyGeo()), aspect: g.aspect, crop: null, lock: g.lock, outW: g.outW, outH: g.outH }
        if (long && g.lock !== false && i.src) {
          const n = naturalSize(ng, i.src)
          const s = long / Math.max(n[0], n[1])
          ng.outW = Math.round(n[0] * s)
          ng.outH = Math.round(n[1] * s)
        }
        return { ...i, geo: ng }
      })
    )
    toast.success("Oran ve boyut tüm fotoğraflara uygulandı")
  }

  // Kırp sekmesi açıkken önizleme yerine döndürülmüş ama kırpılmamış görsel gösterilir.
  const cropping = tab === "crop" && !!item
  const [perspEdit, setPerspEdit] = useState(false)
  const [lineMode, setLineMode] = useState(false)
  useEffect(() => {
    if (!cropping) {
      setPerspEdit(false)
      setLineMode(false)
    }
  }, [cropping])
  const [geoSrc, setGeoSrc] = useState<{ id: string; image: string; inner: [number, number] } | null>(null)
  const g0 = item?.geo
  const srcKey = cropping && item
    ? JSON.stringify([item.id, g0?.rotate ?? 0, !!g0?.flipH, !!g0?.flipV, perspEdit ? "edit" : [g0?.straighten ?? 0, g0?.persp ?? null, !!g0?.ca], item.fx])
    : ""
  useEffect(() => {
    if (!srcKey || !item) return
    let alive = true
    const id = item.id
    const t = setTimeout(() => {
      api
        // perspektif düzenlerken düzeltilmemiş (yalnızca döndürülmüş) görsel
        .geoSource({ photo: id, geo: perspEdit ? { ...(item.geo ?? legacyGeo()), persp: null, straighten: 0, ca: false } : item.geo ?? legacyGeo(), fx: item.fx, w: 1000 })
        .then((r) => {
          if (!alive) return
          setGeoSrc({ id, image: r.image, inner: r.inner })
          // eski fotoğraflarda kaynak boyutu yoktu
          setItems((a) => (a.some((i) => i.id === id && !i.src) ? a.map((i) => (i.id === id ? { ...i, src: r.source } : i)) : a))
        })
        .catch((e) => alive && toast.error(e.message))
    }, 120)
    return () => {
      alive = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcKey])

  const addFiles = async (files: File[]) => {
    const list = files.filter((f) => IMG.test(f.name)).sort(naturalSort)
    if (!list.length) return toast.error("Desteklenen fotoğraf bulunamadı (jpg, png, webp)")
    setUploading(true)
    let last: string | null = null
    for (const f of list) {
      try {
        const r = await api.upload(f)
        const geo = geoForPreset(settings.aspect)
        const it = { ...newItem(r.id, r.name, settings.fx, settings.tone), src: [r.width, r.height] as [number, number], geo }
        setItems((a) => [...a, it])
        last = last ?? r.id
      } catch (e: any) {
        toast.error(`${f.name}: ${e.message}`)
      }
    }
    setUploading(false)
    if (last) setCurrentId(last)
  }

  // Dosya hemen silinmez (geri alınabilsin diye); kullanılmayan yüklemeleri sunucu açılışta temizler.
  const duplicateItem = async (id: string) => {
    const src = items.find((i) => i.id === id)
    if (!src) return
    try {
      const { id: nid } = await api.duplicate(id)
      const base = src.name.replace(/\.[^.]+$/, "")
      const copy: Item = { ...structuredClone(src), id: nid, name: src.name.replace(base, base + " kopya") }
      setItems((a) => {
        const i = a.findIndex((x) => x.id === id)
        return [...a.slice(0, i + 1), copy, ...a.slice(i + 1)]
      })
      setCurrentId(nid)
      toast.success("Fotoğraf çoğaltıldı; kopyayı ayrı düzenleyebilirsin")
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const removeItem = (id: string) => {
    const idx = items.findIndex((i) => i.id === id)
    const removed = items[idx]
    if (!removed) return
    const rest = items.filter((i) => i.id !== id)
    setItems(rest)
    if (currentId === id) setCurrentId(rest[Math.min(idx, rest.length - 1)]?.id ?? null)
    const restore = () => {
      setItems((a) => (a.some((i) => i.id === id) ? a : [...a.slice(0, idx), removed, ...a.slice(idx)]))
      setCurrentId(id)
    }
    toast("Fotoğraf kaldırıldı", { action: { label: "Geri al", onClick: restore } })
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

  // one: yalnızca o fotoğrafı dışa aktar (toplu manifest.json'a dokunulmaz)
  const generate = async (one?: Item, slices = false) => {
    // metin isteğe bağlı: metinsiz fotoğraflar yalnızca renk/efektle üretilir
    if (!items.length) return toast.error("Önce fotoğraf ekle")
    setJob(null)
    setDlg(true)
    try {
      const { job: id } = await api.generate({
        items: (one ? [one] : items).map(effectiveItem), outDir: settings.outDir, export: settings.export, single: !!one, slices,
      })
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

  const saveFile = async (copy: boolean) => {
    if (!item) return
    const ex: ExportOpts = { format: "jpg", quality: 95, naming: "number", exif: false, ...settings.export }
    const formats = COLOR_FORMATS[ex.color ?? "rgb"]
    try {
      const name = await saveAs(effectiveItem(item), ex, formats, copy)
      if (name) toast.success(`Kaydedildi: ${name}`)
    } catch (e: any) {
      toast.error(e.message)
    }
  }
  const saveRef = useRef({ save: () => {}, saveAs: (_copy: boolean) => {} })
  saveRef.current = { save: () => item && generate(item), saveAs: saveFile }

  const tool = (t: string, sec?: string) => {
    setTabRaw(t)
    if (sec) setSection({ id: sec, n: ++intentSeq })
  }
  const command = (cmd: string) => {
    if (cmd === "tool:design:align2") return tool("design", "align")
    if (cmd.startsWith("tool:")) {
      const [, t, sec] = cmd.split(":")
      return tool(t, sec)
    }
    if (cmd === "erase:object") {
      toast("Nesneyi seç, sonra İçeriğe Duyarlı Dolgu'ya bas")
      return command("sel:object")
    }
    if (cmd === "erase:people") {
      toast("Silmek istediğin kişinin ya da nesnenin üzerini boya")
      setBrush({ size: Math.max(brush.size, 0.06), hard: 0.9 })
      return command("brush:tool:remove")
    }
    if (cmd.startsWith("erase:")) {
      setTabRaw("erase")
      return setIntent({ cmd, n: ++intentSeq })
    }
    if (cmd.startsWith("layer:")) return void layerCommand(cmd)
    if (cmd === "filter:vanish") {
      toast("Görseli ekle, köşelerini duvarın ya da düzlemin dört köşesine oturt")
      return command("xf:distort")
    }
    if (cmd.startsWith("filter:") || cmd.startsWith("fx:")) {
      setTabRaw("fx")
      return setIntent({ cmd, n: ++intentSeq })
    }
    if (cmd.startsWith("color:")) {
      setTabRaw("color")
      return setIntent({ cmd, n: ++intentSeq })
    }
    if (cmd.startsWith("retouch:tool:")) {
      setRetouchTool(cmd.slice(13) as BrushTool)
      return setTabRaw("retouch")
    }
    if (cmd.startsWith("retouch:")) {
      setTabRaw("retouch")
      return setIntent({ cmd, n: ++intentSeq })
    }
    if (cmd.startsWith("brush:tool:")) {
      setBrushTool(cmd.slice(11) as BrushTool)
      return setTabRaw("brush")
    }
    if (cmd.startsWith("brush:")) {
      setTabRaw("brush")
      return setIntent({ cmd, n: ++intentSeq })
    }
    if (cmd === "xf:camove") {
      const sels = (item?.fx.masks ?? []).filter((m) => m.type === "select" && m.ops?.length)
      const m = sels.find((x) => x.id === maskSel) ?? sels[sels.length - 1]
      if (m) return void selectionToLayer(true, m.id)
      toast("Önce taşımak istediğin alanı seç")
      setTabRaw("select")
      return setIntent({ cmd: "sel:lasso", n: ++intentSeq })
    }
    if (cmd.startsWith("xf:")) {
      setXform(cmd.slice(3) as XformMode)
      return setTabRaw("design")
    }
    if (cmd.startsWith("design:")) {
      setTabRaw("design")
      return setIntent({ cmd, n: ++intentSeq })
    }
    if (cmd === "crop:persp") {
      setLineMode(false)
      setPerspEdit(true)
      return tool("crop", "persp")
    }
    if (cmd === "crop:line") {
      setPerspEdit(false)
      setLineMode(true)
      return tool("crop", "straighten")
    }
    if (cmd === "slice:draw" || cmd === "slice:select") {
      setSliceTool(cmd === "slice:draw" ? "draw" : "select")
      return setTabRaw("slice")
    }
    if (cmd.startsWith("sel:")) {
      setTabRaw("select")
      return setIntent({ cmd, n: ++intentSeq })
    }
    if (cmd.startsWith("mask:")) {
      tool("local", "select")
      return setIntent({ cmd, n: ++intentSeq })
    }
    const run: Record<string, () => void> = {
      projects: closeProject,
      addPhotos: () => fileRef.current?.click(),
      save: () => saveRef.current.save(),
      saveAs: () => saveRef.current.saveAs(false),
      saveCopy: () => saveRef.current.saveAs(true),
      exportAll: () => generate(),
      settings: () => setCog(true),
      quit,
      undo: () => travel("undo"),
      redo: () => travel("redo"),
      copyFx,
      pasteFx: () => pasteFx(),
      duplicate: () => currentId && duplicateItem(currentId),
      addImage: () => {
        tool("design")
        setIntent({ cmd: "design:add", n: ++intentSeq })
      },
      strip: () => setShowStrip((v) => !v),
      guides: () => setSettings((s) => ({ ...s, guides: !s.guides })),
      closePanel: () => setTabRaw(""),
    }
    run[cmd]?.()
  }
  const noItem = !item
  const menus: Menu[] = [
    { label: "Dosya", items: [
      { label: "Yeni proje / Projeler", cmd: "projects" },
      "sep",
      { label: "Fotoğraf ekle…", cmd: "addPhotos" },
      "sep",
      { label: "Kaydet", cmd: "save", key: "Ctrl+S", disabled: noItem },
      { label: "Farklı kaydet…", cmd: "saveAs", key: "Ctrl+Shift+S", disabled: noItem },
      { label: "Kopya kaydet…", cmd: "saveCopy", disabled: noItem },
      { label: "Tümünü dışa aktar", cmd: "exportAll", disabled: !items.length },
      "sep",
      { label: "Ayarlar…", cmd: "settings" },
      { label: "Çıkış", cmd: "quit" },
    ] },
    { label: "Düzenle", items: [
      { label: "Geri al", cmd: "undo", key: "Ctrl+Z", disabled: !histLen.past },
      { label: "Yinele", cmd: "redo", key: "Ctrl+Y", disabled: !histLen.future },
      "sep",
      { label: "Renk ve efektleri kopyala", cmd: "copyFx", key: "Ctrl+C", disabled: noItem },
      { label: "Renk ve efektleri yapıştır", cmd: "pasteFx", key: "Ctrl+V", disabled: !clip || noItem },
      { label: "Fotoğrafı çoğalt", cmd: "duplicate", disabled: noItem },
    ] },
    { label: "Görüntü", items: [
      ...CROP_SECTIONS.flatMap((sec, i): Menu["items"] => [
        ...(i ? ["sep" as const] : []),
        ...CROP_TOOLS.filter((t) => t.section === sec).map((t) => ({ label: t.label, cmd: t.cmd, key: t.key })),
      ]),
    ] },
    { label: "Renk", items: COLOR_SECTIONS.flatMap((sec, i): Menu["items"] => [
      ...(i ? ["sep" as const] : []),
      ...COLOR_TOOLS.filter((t) => t.section === sec).map((t) => ({ label: t.label, cmd: t.cmd, disabled: noItem && t.cmd !== "color:library" })),
    ]) },
    { label: "Efekt", items: [
      { label: "Filtre Galerisi", cmd: "filter:gallery" },
      "sep",
      ...FILTER_SECTIONS.filter((s) => s !== "Efektler").map((sec) => ({ label: sec, children: FILTER_TOOLS.filter((t) => t.section === sec && t.cmd !== "filter:gallery").map((t) => ({ label: t.label, cmd: t.cmd, key: t.en, disabled: noItem })) })),
      "sep",
      ...FILTER_TOOLS.filter((t) => t.section === "Efektler").map((t) => ({ label: t.label, cmd: t.cmd })),
    ] },
    { label: "Seçim", items: [
      ...SELECT_SECTIONS.flatMap((sec): Menu["items"] => [
        ...SELECT_TOOLS.filter((t) => t.section === sec).map((t) => ({ label: t.label, cmd: `sel:${t.id}`, key: t.key, disabled: noItem })),
        "sep",
      ]),
      { label: "Degrade maske", cmd: "mask:linear", disabled: noItem },
      { label: "Daire maske", cmd: "mask:radial", disabled: noItem },
      { label: "Tüm yerel düzenlemeler", cmd: "tool:local:select" },
    ] },
    { label: "Fırça", items: BRUSH_SECTIONS.flatMap((sec, i): Menu["items"] => [
      ...(i ? ["sep" as const] : []),
      ...BRUSH_TOOLS.filter((t) => t.section === sec).map((t) => ({ label: t.label, cmd: t.cmd, key: t.key, disabled: noItem })),
    ]) },
    { label: "Silme", items: ERASE_SECTIONS.flatMap((sec, i): Menu["items"] => [
      ...(i ? ["sep" as const] : []),
      ...ERASE_TOOLS.filter((t) => t.section === sec).map((t) => ({ label: t.label, cmd: t.cmd, key: t.key, disabled: noItem })),
    ]) },
    { label: "Rötuş", items: RETOUCH_SECTIONS.flatMap((sec, i): Menu["items"] => [
      ...(i ? ["sep" as const] : []),
      ...RETOUCH_TOOLS.filter((t) => t.section === sec).map((t) => ({ label: t.label, cmd: t.cmd, key: t.key, disabled: noItem })),
    ]) },
    { label: "Metin", items: [{ label: "Yazı ekle ve biçimlendir", cmd: "tool:text" }] },
    { label: "Katman", items: [
      { label: "Görsel ekle…", cmd: "addImage", disabled: noItem },
      "sep",
      ...LAYER_SECTIONS.map((sec) => ({ label: sec, children: LAYER_TOOLS.filter((t) => t.section === sec).map((t) => ({ label: t.label, cmd: t.cmd, key: t.en, disabled: noItem || t.off })) })),
      "sep",
      { label: "Dönüştür ve Hizala", children: XFORM_SECTIONS.flatMap((sec) => XFORM_TOOLS.filter((t) => t.section === sec).map((t) => ({ label: t.label, cmd: t.cmd, key: t.en, disabled: noItem }))) },
    ] },
    { label: "Görünüm", items: [
      { label: "Fotoğraf şeridi", cmd: "strip", checked: showStrip },
      { label: "Hizalama kılavuzları", cmd: "guides", checked: settings.guides },
      "sep",
      { label: "Araç panelini kapat", cmd: "closePanel", disabled: !tab },
    ] },
  ]

  const quit = async () => {
    setBye(true)
    api.quit().catch(() => {})
    setTimeout(() => window.close(), 400)
  }

  if (bye)
    return (
      <div className="grid h-full place-items-center text-muted-foreground">
        <p className="text-sm">Tonefect kapatıldı. Bu pencereyi kapatabilirsin.</p>
      </div>
    )
  if (!cfg)
    return (
      <div className="grid h-full place-items-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )

  const dialogs = (
    <>
      <SettingsDialog open={cog} onClose={() => setCog(false)} cfg={cfg} settings={settings} setSettings={setSettings} defaults={DEFAULTS} watermark={wm} onWatermark={setWm} quitOnClose={quitOnClose} onQuitOnClose={(v) => { setQuitOnClose(v); api.setPrefs({ quitOnClose: v }).catch((e) => toast.error(e.message)) }} version={cfg.version} update={upd} onUpdate={(u) => { setUpd(u); if (u.newer) { setCog(false); setUpdOpen(true) } }} />
      <UpdateDialog open={updOpen} onClose={() => setUpdOpen(false)} info={upd} />
      <Toaster theme={isLightTheme(settings.theme) ? "light" : "dark"} position="bottom-center" />
    </>
  )
  if (!project)
    return (
      <TooltipProvider delayDuration={200}>
        <StartPage onOpen={openProject} onSettings={() => setCog(true)} onQuit={quit} version={cfg.version} />
        {dialogs}
      </TooltipProvider>
    )

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="flex h-full flex-col"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files])
        }}
      >
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-3">
          <div className="flex min-w-0 items-center gap-2">
            <button onClick={closeProject} title="Projeler" className="flex shrink-0 items-center rounded-md p-1 hover:bg-accent">
              <img src="/logo.png" alt="Projeler" className="h-7 w-7" />
            </button>
            <MenuBar menus={menus} onCommand={command} active={tab} />
            <input
              key={project.id}
              defaultValue={project.name}
              aria-label="Proje adı"
              title="Proje adını değiştirmek için tıkla"
              onBlur={(e) => renameProject(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                if (e.key === "Escape") {
                  ;(e.target as HTMLInputElement).value = project.name
                  ;(e.target as HTMLInputElement).blur()
                }
              }}
              className="ml-2 h-7 w-[200px] min-w-0 truncate rounded-md border border-transparent bg-transparent px-2 text-xs text-muted-foreground outline-none transition-colors hover:border-border focus:border-primary/60 focus:text-foreground"
            />
          </div>
          <div className="flex items-center gap-2">
            {upd?.newer && (
              <Button variant="secondary" size="sm" className="h-8 gap-1.5 border border-primary/40 text-primary" onClick={() => setUpdOpen(true)}>
                <ArrowUpCircle className="!size-4" /> Yeni sürüm v{upd.latest}
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" aria-label="Geri al" title="Geri al (Ctrl+Z)" disabled={!histLen.past} onClick={() => travel("undo")}>
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Yinele" title="Yinele (Ctrl+Y)" disabled={!histLen.future} onClick={() => travel("redo")}>
              <Redo2 className="h-4 w-4" />
            </Button>
            <SaveMenu disabled={!item} onSave={() => saveRef.current.save()} onSaveAs={() => saveRef.current.saveAs(false)} onSaveCopy={() => saveRef.current.saveAs(true)} />
            <Button onClick={() => generate()} disabled={!items.length} className="h-8 gap-1.5">
              <Sparkles className="!size-4" /> Görselleri üret
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Ayarlar" onClick={() => setCog(true)}>
              <Cog className="h-4 w-4" />
            </Button>
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
          {/* sol: araç kutusu + seçilen aracın ayarları (seçilmeden kapalı) */}
          <ToolBox active={tab} onCommand={command} />
          {tab && <Panel
            item={item} items={items} cfg={cfg} selected={selected} setSelected={setSelected} setText={setText}
            patch={(p, all) => (all && p.fx ? patchAllFx() : patch(p, all))}
            presets={presets} groups={groups} onPresetsChange={loadPresets}
            tab={tab} setTab={setTab} setGeo={setGeo} applyAllGeo={applyAllGeo} perspEdit={perspEdit} setPerspEdit={setPerspEdit} lineMode={lineMode} setLineMode={setLineMode}
            eraseMode={eraseMode} setEraseMode={setEraseMode} maskTool={maskTool} setMaskTool={setMaskTool} addSpecial={addSpecial} command={command}
            filterSel={filterSel} setFilterSel={setFilterSel} liquify={liquify} setLiquify={setLiquify} previewImg={previewImg} setPick={setColorPick} retouchTool={retouchTool} setRetouchTool={setRetouchTool} retouchBrush={retouchBrush} setRetouchBrush={setRetouchBrush} cloneSource={cloneSource} armSource={armSource} patchMode={patchMode} setPatchMode={setPatchMode}
            brushTool={brushTool} setBrushTool={setBrushTool} brush={brush} setBrush={setBrush} smoothing={smoothing} setSmoothing={setSmoothing} settings={settings} setSettings={setSettings}
            xform={xform} setXform={setXform} xformDelta={lastXform}
            sliceTool={sliceTool} setSliceTool={setSliceTool} sliceSel={sliceSel} setSliceSel={setSliceSel} setSlices={setSlices} exportSlices={() => item && generate(effectiveItem(item), true)}
            setLayers={setLayers} layerSel={layerSel} setLayerSel={setLayerSel} selectionToLayer={selectionToLayer}
            onCopy={copyFx} onPaste={() => pasteFx()} canPaste={!!clip}
            maskSel={maskSel} setMaskSel={setMaskSel} setMasks={setMasks} maskShow={maskShow} setMaskShow={setMaskShow}
            selTool={selTool} setSelTool={setSelTool} section={section} intent={intent} onClose={() => setTabRaw("")}
          />}
          {/* orta: önizleme + fotoğraf şeridi */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <Stage
              item={item ? effectiveItem(item) : undefined} cfg={cfg} mode={mode} setMode={setMode} selected={selected} setSelected={setSelected}
              update={update} applyStyle={applyStyle} resetPosition={resetPosition} pickFiles={() => fileRef.current?.click()}
              guides={settings.guides} wm={wm}
              cropping={cropping} geoSrc={geoSrc && geoSrc.id === item?.id ? geoSrc : null} setGeo={setGeo} perspEdit={perspEdit} lineMode={lineMode} endLine={() => setLineMode(false)}
              eraseMode={tab === "erase" ? eraseMode : ""} maskTool={maskTool} putLayer={putLayer}
              brushMode={tab === "brush" || tab === "retouch"} brushTool={tab === "retouch" ? retouchTool : brushTool} brush={tab === "retouch" ? retouchBrush : brush} setBrush={tab === "retouch" ? setRetouchBrush : setBrush} smoothing={tab === "retouch" ? 0 : smoothing} onStroke={addStroke}
              filterEdit={curFilter ? { filter: curFilter, set: setCurFilter, liquify } : null} pick={tab === "color" || tab === "layers" ? colorPick?.fn ?? null : null} onPreview={setPreviewImg} patchMode={patchMode} source={cloneSource} setSource={setCloneSource} armed={armedSource} setArmed={setArmedSource} onNeedSource={() => toast("Önce Alt+tıkla ile kaynak seç")}
              xform={xform} onXformDone={(a, b) => setLastXform(xformDelta(a, b))}
              sliceMode={tab === "slice"} sliceTool={sliceTool} sliceSel={sliceSel} setSliceSel={setSliceSel} setSlices={setSlices}
              designMode={tab === "design"} layerSel={layerSel} setLayerSel={setLayerSel} setLayers={setLayers}
              localMode={tab === "local" || tab === "select" || tab === "slice" || tab === "brush" || tab === "retouch" || (tab === "erase" && !!eraseMode)} mask={curMask} maskShow={maskShow} setMask={setMask} selTool={selTool}
            />
            {showStrip && <Filmstrip items={items} currentId={currentId} select={setCurrentId} move={move} remove={removeItem} pickFiles={() => fileRef.current?.click()} uploading={uploading} pasteTo={clip ? pasteFx : undefined} exportOne={(id) => { const it = items.find((i) => i.id === id); if (it) generate(it) }} duplicate={duplicateItem} />}
          </div>
          {/* sağ: katmanlar ve efektler */}
          <LayersPanel item={item} presets={presets} wm={wm} tool={tab} maskSel={maskSel} sel={layerSel} open={openLayer} toggle={toggleLayer} remove={removeLayerFx} run={command} put={putLayerSafe} toggleGroup={toggleGroup} renameGroup={renameGroup} renaming={renaming} setRenaming={setRenaming} filterOpen={filterOpen} setFilterOpen={setFilterOpen} />
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles([...(e.target.files || [])]); e.target.value = "" }} />
        <GenerateDialog open={dlg} onClose={() => setDlg(false)} job={job} jobId={jobId} />
        {dialogs}
      </div>
    </TooltipProvider>
  )
}

function newItem(id: string, name: string, fx: Item["fx"], tone = "quiet"): Item {
  return { id, name, text: "", tone, accent: "", styles: [], block: [0, 0], offsets: {}, fx: { ...fx } }
}

function normItem(r: any): Item {
  return {
    ...newItem(r.id, r.name || r.id, DEFAULT_FX),
    ...r,
    fx: { ...DEFAULT_FX, ...(r.fx || {}) },
    styles: r.styles || [],
    offsets: r.offsets || {},
    block: r.block || [0, 0],
  }
}
