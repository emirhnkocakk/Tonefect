import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowUpCircle, Download, Loader2, Redo2, Settings as Cog, Undo2 } from "lucide-react"
import { Toaster, toast } from "sonner"
import { Button } from "@/components/ui/button"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Filmstrip } from "@/components/Filmstrip"
import { SaveMenu } from "@/components/SaveMenu"
import { OptionsBar } from "@/components/OptionsBar"
import { DocTabs } from "@/components/DocTabs"
import { KeysDialog } from "@/components/KeysDialog"
import { comboOf, keyOf, SHORTCUTS, TYPING } from "@/lib/shortcuts"
import { stepName } from "@/lib/history"
import { capPoints, flatten, newPathId, nodesFromBox } from "@/lib/paths"
import { MAX_MASKS } from "@/components/MaskPanel"
import { addStep, diffItem, newActionId, playAction, type Action, type Op } from "@/lib/actions"
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
import { XFORM_TOOLS, xformDelta, type XformDelta } from "@/lib/transform"
import { Stage } from "@/components/Stage"
import { Panel } from "@/components/Panel"
import { GenerateDialog } from "@/components/GenerateDialog"
import { UpdateDialog } from "@/components/UpdateDialog"
import { SettingsDialog } from "@/components/SettingsDialog"
import { api } from "@/lib/api"
import { mergeStyle, naturalSort, remap, words } from "@/lib/text"
import { legacyGeo, naturalSize, canvasSize, photoRect } from "@/lib/geo"
import { applyTheme, isLightTheme } from "@/lib/themes"
import { BASE_ID, effectiveItem, keepTextAnchor, moveInStack, psdItem, removeLayer, stackIds, withBase, type Layer } from "@/lib/layers"
import type { Fx, PenTool, VPath, BrushSettings, BrushTool, CloneSource, FilterItem, MaskPaintTool, Stroke, Config, ExportOpts, Geo, ImgLayer, Item, Job, Mask, Mode, SelectTool, PresetMeta, Settings, Slice, Style, XformMode, UpdateInfo, Watermark } from "@/types"

// Yeni fotoğraflar olduğu gibi açılır; görünüm ve efektleri kullanıcı kendisi seçer.
const DEFAULT_FX: Item["fx"] = { bw: false, grain: 0, vignette: 0, preset: "b:original", amount: 1, adjust: {} }
const SETTINGS_VERSION = 3
const DEFAULT_EXPORT: Settings["export"] = { format: "jpg", quality: 95, naming: "number", exif: false }
const DEFAULTS: Settings = { outDir: "output", tone: "quiet", fx: DEFAULT_FX, guides: true, export: DEFAULT_EXPORT, aspect: "original", theme: "dark", v: SETTINGS_VERSION }
const IMG = /\.(jpe?g|png|webp|psd)$/i
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
  const [showStrip, setShowStrip] = useState(false)
  const [showTools, setShowTools] = useState(true)
  const [showOptions, setShowOptions] = useState(true)
  const [showLayers, setShowLayers] = useState(true)
  const [bare, setBare] = useState(false) // Tab: tüm paneller gizli
  const [keysOpen, setKeysOpen] = useState(false)
  const [layersH, setLayersH] = useState(() => {
    try {
      return Number(localStorage.getItem("dock-layers")) || 300
    } catch {
      return 300
    }
  })
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
      // eski kayıtlarda yeni fotoğraflar siyah-beyaz başlıyordu; bu varsayılan da kalkar (eklenmiş fotoğraflara dokunulmaz)
      const fx = {
        ...DEFAULTS.fx, ...(st.fx || {}),
        ...((st.v ?? 1) < 2 ? { grain: 0, vignette: 0 } : {}),
        ...((st.v ?? 1) < 3 && st.fx?.bw !== false && !st.fx?.preset ? { bw: false, preset: "b:original" } : {}),
      }
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

  // Eylemler: kayıt durumu travel'dan önce tanımlı olmalı
  const [actions, setActions] = useState<Action[]>([])
  const [actionsLoaded, setActionsLoaded] = useState(false)
  const [recording, setRecording] = useState<string | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const rec = useRef<{ id: string; prev: Item[]; skip: boolean; auto: string | null } | null>(null)
  useEffect(() => {
    api.actions().then((r) => {
      setActions(r.actions)
      setActionsLoaded(true)
    }).catch((e) => toast.error("Eylemler yüklenemedi: " + e.message))
  }, [])
  useEffect(() => {
    if (!actionsLoaded) return
    const t = setTimeout(() => api.saveActions(actions).catch((e) => toast.error(e.message)), 500)
    return () => clearTimeout(t)
  }, [actions, actionsLoaded])

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
    if (rec.current) {
      rec.current.skip = true
      if (dir === "undo") {
        const id = rec.current.id
        setActions((l) => l.map((a) => (a.id === id ? { ...a, steps: a.steps.slice(0, -1) } : a)))
      }
    }
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

  // tüm kısayollar lib/shortcuts.ts tablosundan; araç harfleri ToolBox'ta, yakınlaştırma Stage'de
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const item = useMemo(() => {
    const it = items.find((i) => i.id === currentId)
    return it && withBase(it)
  }, [items, currentId])
  // kayıt: fotoğraftaki her değişiklik bir adım olur
  useEffect(() => {
    const r = rec.current
    if (!r) return
    const before = r.prev
    r.prev = items
    if (r.skip) {
      r.skip = false
      return
    }
    const a = before.find((x) => x.id === currentId)
    const b = items.find((x) => x.id === currentId)
    if (!a || !b || a === b) return
    let ops: Op[] = diffItem(withBase(a), withBase(b))
    if (!ops.length) return
    // Otomatik Ton gibi işlemler sabit değer değil, her fotoğrafta yeniden hesaplanacak komut olarak yazılır
    const only = ops.length === 1 ? ops[0] : null
    if (r.auto && only?.t === "patch" && only.path === "fx.color" && "levels" in only.value) {
      ops = [{ t: "auto", kind: r.auto }]
      r.auto = null
    }
    const id = r.id
    setActions((l) => l.map((x) => (x.id === id ? { ...x, steps: addStep(x.steps, ops) } : x)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])
  useEffect(() => setSelected([]), [currentId])
  // metin kısalınca artık olmayan kelimeler seçili kalmasın
  const wordCount = item ? words(item.text).length : 0
  useEffect(() => setSelected((s) => (s.some((i) => i >= wordCount) ? s.filter((i) => i < wordCount) : s)), [wordCount])

  const update = useCallback(
    (fn: (it: Item) => Item) => setItems((a) => a.map((i) => {
      if (i.id !== currentId) return i
      const before = withBase(i)
      return keepTextAnchor(before, fn(before))
    })),
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

  // Yazı rengi: kelime seçiliyse yalnızca onlara, değilse tüm yazıya (sonradan yazılanlar dahil)
  const setTextColor = (color: string | undefined) => {
    if (selected.length) return applyStyle({ color })
    update((it) => ({ ...it, textFx: { ...it.textFx, color }, styles: it.styles.map(({ color: _drop, ...rest }) => rest) }))
  }
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
  // Ayarlamalar ve Filtreler seçili nesneye uygulanır; seçim yoksa ya da Arka Plan seçiliyse fotoğrafa
  const fxLayer = tab === "color" || tab === "fx" ? item?.layers?.find((l) => l.id === layerSel[0] && l.id !== BASE_ID && l.kind !== "adjust") : undefined
  const setLayerFx = (p: Partial<Fx>) => {
    if (!fxLayer) return
    const id = fxLayer.id
    update((it) => ({ ...it, layers: (it.layers ?? []).map((l) => (l.id === id ? { ...l, fx: { ...l.fx, ...p } } : l)) }))
  }
  // Seçili nesnelere doğrudan renk: şekil ve metin kendi rengini, çizim ve görseller renk tonunu alır
  const colorable = (item?.layers ?? []).filter((l) => layerSel.includes(l.id) && l.id !== BASE_ID && l.kind !== "adjust")
  const colorIds = colorable.map((l) => l.id)
  const colorObject = (hex: string | undefined) => update((it) => ({ ...it, layers: (it.layers ?? []).map((l) => {
    if (!colorIds.includes(l.id)) return l
    if (hex && l.shapeDef) return { ...l, shapeDef: { ...l.shapeDef, color: hex } }
    if (hex && l.textDef) return { ...l, textDef: { ...l.textDef, color: hex } }
    if (hex && l.fillDef) return { ...l, fillDef: { ...l.fillDef, color: hex } }
    // eski sürümde verilen renk kaplaması yerini ton rengine bırakır
    const styles = l.styles?.color?.on ? { ...l.styles, color: { ...l.styles.color, on: false } } : l.styles
    return { ...l, tint: hex, styles }
  }) }))
  const objectColor = (() => {
    const l = colorable[0]
    return !l ? "#FFFFFF" : l.shapeDef?.color ?? l.textDef?.color ?? l.fillDef?.color ?? l.tint ?? (l.styles?.color?.on ? String(l.styles.color.color) : "#FFFFFF")
  })()
  const colorBar = colorable.length ? { color: objectColor, set: colorObject, canClear: colorable.some((l) => l.tint || l.styles?.color?.on) } : null
  const curFilter = tab === "fx" && !fxLayer ? item?.fx.filters?.find((f) => f.id === filterSel && !f.off) : undefined
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
  const addStroke = (s: Stroke) => {
    // Her çizim ayrı bir nesnedir: önce anında görünür, sonra kendi sınırlarına kırpılmış gerçek görsele dönüşür.
    // Elle açılmış Boş Katman seçiliyse darbeler o katmanda birikir. Rötuş araçları fotoğrafın kendisinde çalışır.
    const drawing = tab === "brush" || tab === "paths"
    const has = drawing && !!item?.layers?.some((l) => l.id === layerSel[0] && l.kind === "blank")
    let fresh: ImgLayer | null = null
    if (drawing && !has && item && (s.tool === "brush" || s.tool === "pencil")) {
      const [W, H] = canvasSize(item.geo, item.src) ?? [1080, 1350]
      const n = item.layers?.length ?? 1
      const made: ImgLayer = { ...createLayer("blank", W, H, n), name: `Çizim ${n}` }
      fresh = made
      const owner = item.id
      api.layerFromStrokes({ strokes: [s], w: W, h: H }).then((r) => {
        hist.current.skip = true // aynı geri alma adımı: görsele dönüşmek ayrı adım sayılmaz
        setItems((a) => a.map((i) => {
          if (i.id !== owner) return i
          if (r.empty) return { ...i, layers: (i.layers ?? []).filter((l) => l.id !== made.id) }
          return { ...i, layers: (i.layers ?? []).map((l) => (l.id === made.id ? { ...l, kind: undefined, paint: undefined, photo: r.id, x: r.x, y: r.y, w: r.w, ar: r.ar } : l)) }
        }))
        if (!r.empty) setLayerSel([made.id])
      }).catch((e) => toast.error(e.message))
    }
    update((prev) => {
    const it = fresh ? { ...prev, layers: [...(prev.layers ?? []), fresh] } : prev
    const ly = fresh ?? (drawing ? it.layers?.find((l) => l.id === layerSel[0] && l.kind === "blank") : undefined)
    if (!ly) return { ...it, paint: { strokes: [...(it.paint?.strokes ?? []), s] } }
    const [W, H] = canvasSize(it.geo, it.src) ?? [1080, 1350]
    const lw = ly.w * W
    const lh = lw * ly.ar * (ly.sy ?? 1)
    const st: Stroke = { ...s, b: { ...s.b, size: (s.b.size * Math.min(W, H)) / Math.min(lw, lh) }, pts: s.pts.map(([x, y, p]) => [...layerUV(ly, W, H, x * W, y * H), p] as [number, number, number]) }
    return { ...it, layers: it.layers!.map((l) => (l.id === ly.id ? { ...l, paint: { strokes: [...(l.paint?.strokes ?? []), st] } } : l)) }
    })
  }
  const [xform, setXform] = useState<XformMode>("move")
  const [lastXform, setLastXform] = useState<XformDelta | null>(null)
  const [sliceTool, setSliceTool] = useState<"draw" | "select">("draw")
  const [sliceSel, setSliceSel] = useState<string | null>(null)
  const setSlices = (slices: Slice[]) => update((it) => ({ ...it, slices }))
  const setLayers = (layers: ImgLayer[]) => update((it) => ({ ...it, layers }))
  // önizlemedeki liste gizli katmanları içermez: yalnızca gelenler güncellenir, gizliler kaybolmaz
  const changeLayers = (next: ImgLayer[]) => update((it) => ({ ...it, layers: (it.layers ?? []).map((l) => next.find((n) => n.id === l.id) ?? l) }))
  useEffect(() => {
    setLayerSel([])
    setSliceSel(null)
  }, [currentId])
  // katman araçları açılınca boşa düşmesin: bir şey seçili değilse fotoğrafın kendisi seçilir
  useEffect(() => {
    if (tab === "design" || tab === "layers" || tab === "erase") setLayerSel((s) => (s.length ? s : [BASE_ID]))
  }, [tab, currentId])
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
  /** Ctrl+A / Ctrl+D. Ayarı olan seçimler yerel düzenleme olarak kalır, yalnızca etkinliği biter. */
  const selectAll = (on: boolean) => {
    if (!item) return
    const all = item.fx.masks ?? []
    if (!on) {
      const plain = (m: Mask) => m.type === "select" && !m.fill && !Object.keys(m.adjust ?? {}).length
      if (!all.some((m) => m.type === "select")) return
      setMaskSel(null)
      return setMasks(all.filter((m) => !plain(m)))
    }
    const m: Mask = { id: newId(), type: "select", ops: [{ kind: "rect", box: [0, 0, 1, 1], add: true }], feather: 0, invert: false, adjust: {} }
    setMasks([...all, m])
    setMaskSel(m.id)
    setTabRaw("select")
  }
  // Çerçeve ve kement: çizilen alan hemen ayrı bir nesne (katman) olur; Shift/Alt ile birleştirirken ya da Nesne Yap kapalıyken seçim kalır
  const keepSelection = useRef(false)
  const setMask = (p: Partial<Mask>, drawn = false) => {
    update((it) => ({ ...it, fx: { ...it.fx, masks: (it.fx.masks ?? []).map((m) => (m.id === maskSel ? { ...m, ...p } : m)) } }))
    if (!drawn || !curMask || !item || p.ops?.length !== 1) return
    const keep = keepSelection.current
    keepSelection.current = false
    const kind = p.ops[0].kind
    if (keep || selTool.noObject || selTool.combine !== "add" || !(kind === "rect" || kind === "ellipse" || kind === "poly" || kind === "magnetic") || Object.keys(curMask.adjust ?? {}).length) return
    void objectFromSelection({ ...curMask, ...p })
  }
  const objectFromSelection = async (m: Mask) => {
    if (!item) return
    const owner = item.id
    const cut = !!selTool.cutObject
    try {
      const snap: Item = { ...item, fx: { ...item.fx, masks: (item.fx.masks ?? []).map((x) => (x.id === m.id ? m : x)) } }
      const r = await api.extractSelection({ item: effectiveItem(snap), maskId: m.id })
      const n = item.layers?.length ?? 1
      const ly: ImgLayer = { id: newId(), photo: r.id, name: `Nesne ${n}`, x: r.x, y: r.y, w: r.w, ar: r.height / r.width, rot: 0, opacity: 1, flipH: false, cutout: false }
      const fresh: Mask | null = cut && (item.fx.masks?.length ?? 0) < MAX_MASKS ? { id: newId(), type: "select", ops: [], feather: 0, invert: false, adjust: {} } : null
      hist.current.skip = true // seçim ile nesne tek geri alma adımı
      setItems((a) => a.map((i) => {
        if (i.id !== owner) return i
        const masks = (i.fx.masks ?? []).map((x) => (x.id !== m.id ? x : cut ? { ...x, fill: true } : { ...x, ops: [] }))
        return { ...i, layers: [...(i.layers ?? []), ly], fx: { ...i.fx, masks: fresh ? [...masks, fresh] : masks } }
      }))
      setLayerSel([ly.id])
      if (fresh) setMaskSel(fresh.id)
      else if (cut) setMaskSel(null)
    } catch (e: any) {
      toast.error(e.message)
    }
  }
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
    if (l.part && l.layerId) {
      setLayerSel([l.layerId])
      return setTab(l.tool)
    }
    if (l.layerId && additive) return setLayerSel(layerSel.includes(l.layerId) ? layerSel.filter((x) => x !== l.layerId) : withLinks([...layerSel, l.layerId]))
    // Photoshop gibi: katman seçmek açık aracı değiştirmez
    if (l.layerId && tab) return setLayerSel(withLinks([l.layerId]))
    setTab(l.tool)
    if (l.maskId) setMaskSel(l.maskId)
    if (l.layerId) setLayerSel(withLinks([l.layerId]))
  }
  const [renaming, setRenaming] = useState<string | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const putLayerSafe = (id: string, p: Partial<ImgLayer>) => update((it) => ({ ...it, layers: (it.layers ?? []).map((l) => (l.id === id ? { ...l, ...p } : l)) }))
  const toggleGroup = (id: string) => update((it) => ({ ...it, groups: (it.groups ?? []).map((g) => (g.id === id ? { ...g, open: !g.open } : g)) }))
  const renameGroup = (id: string, name: string) => update((it) => ({ ...it, groups: (it.groups ?? []).map((g) => (g.id === id ? { ...g, name } : g)) }))
  /** Fotoğrafı (ids verilirse yalnızca o katmanlarla) tek görsele çizer ve yeni Arka Plan yapar; renk, efekt ve rötuş artık onun üstünde çalışır. */
  const bakeItem = async (it: Item, ids?: string[]): Promise<Item> => {
    const r = await api.layersFlatten({ item: effectiveItem(it), ids })
    const keep = ids ? (it.layers ?? []).filter((l) => l.id !== BASE_ID && !ids.includes(l.id)) : []
    return {
      ...it, id: r.id, src: [r.width, r.height], geo: geoForPreset("original"), fx: { ...DEFAULT_FX }, paint: undefined, layers: keep,
      groups: ids ? it.groups : [], text: ids ? it.text : "", styles: ids ? it.styles : [], offsets: ids ? it.offsets : {},
      hidden: ids ? (it.hidden ?? []).filter((k) => keep.some((l) => k === `img:${l.id}`)) : [],
    }
  }
  const visibleIds = (it: Item) => {
    const eff = effectiveItem(it)
    const off = new Set(eff.hidden ?? [])
    return (eff.layers ?? []).filter((l) => !off.has(`img:${l.id}`)).map((l) => l.id)
  }
  const bakeIntoPhoto = async (ids?: string[]) => {
    if (!item) return
    const was = item.id
    const next = await bakeItem(item, ids)
    setItems((a) => a.map((i) => (i.id === was ? next : i)))
    setCurrentId(next.id)
  }
  const recordCmd = (cmd: "flatten" | "mergevis") => {
    if (!rec.current) return
    const id = rec.current.id
    setActions((l) => l.map((x) => (x.id === id ? { ...x, steps: [...x.steps, { id: newActionId(), ops: [{ t: "cmd", cmd }] }] } : x)))
  }
  const startRecord = (id: string) => {
    rec.current = { id, prev: itemsRef.current, skip: false, auto: null }
    setRecording(id)
  }
  const stopRecord = () => {
    rec.current = null
    setRecording(null)
  }
  const playOne = (a: Action, it: Item) => playAction(it, a.steps, {
    auto: (x, kind) => api.colorAuto({ photo: x.id, geo: x.geo ?? null, fx: x.fx, kind }).then((r) => r.levels),
    bake: (x, op) => (op === "flatten" ? bakeItem(x) : bakeItem(x, visibleIds(x))),
  })
  /** Eylemi oynatır. Tamamı tek geri alma adımıdır; bir fotoğrafta hata olursa o fotoğraf atlanır. */
  const runAction = async (a: Action, batch: boolean, exportAfter: boolean) => {
    const targets = batch ? items : items.filter((i) => i.id === currentId)
    if (!targets.length) return
    setPlaying(batch ? "batch" : "one")
    const done = new Map<string, Item>()
    let failed = 0
    for (const it of targets) {
      try {
        done.set(it.id, await playOne(a, it))
      } catch (e: any) {
        failed++
        toast.error(`${it.name}: ${e.message}`)
      }
    }
    const next = itemsRef.current.map((i) => done.get(i.id) ?? i)
    setItems(next)
    const cur = currentRef.current
    if (cur && done.has(cur)) setCurrentId(done.get(cur)!.id)
    setPlaying(null)
    toast.success(batch ? `"${a.name}" ${done.size} fotoğrafa uygulandı${failed ? `, ${failed} atlandı` : ""}` : `"${a.name}" uygulandı; Ctrl+Z ile geri alabilirsin`)
    if (exportAfter && done.size) generateRef.current(next)
  }
  // Kalem ve Yollar
  const [penTool, setPenTool] = useState<PenTool>("pen")
  const [pathSel, setPathSel] = useState<string | null>(null)
  useEffect(() => setPathSel(null), [currentId])
  const setPaths = (paths: VPath[]) => update((it) => ({ ...it, paths }))
  const pathOp = (op: string) => {
    if (!item) return
    const [W, H] = canvasSize(item.geo, item.src) ?? [1080, 1350]
    const [rx, ry, rw, rh] = photoRect(item.geo, item.src)
    if (op === "fromsel") {
      // seçim fotoğrafa göre, yol tuvale göre
      const to = ([x, y]: [number, number]): [number, number] => [rx + x * rw, ry + y * rh]
      const sels = (item.fx.masks ?? []).filter((m) => m.type === "select" && m.ops?.length)
      const m = sels.find((x) => x.id === maskSel) ?? sels[sels.length - 1]
      const last = m?.ops?.[m.ops.length - 1]
      let nodes: VPath["nodes"] | null = null
      if (last && (last.kind === "rect" || last.kind === "ellipse")) {
        const a = to([last.box[0], last.box[1]])
        const b = to([last.box[2], last.box[3]])
        nodes = nodesFromBox(last.kind, [a[0], a[1], b[0], b[1]])
      } else if (last && (last.kind === "poly" || last.kind === "magnetic")) nodes = capPoints(last.pts, 200).map((p) => ({ p: to(p) }))
      if (!nodes) return void toast("Yol yalnızca çerçeve, elips ve kement seçimlerinden oluşturulabilir")
      const p: VPath = { id: newPathId(), name: `Yol ${(item.paths?.length ?? 0) + 1}`, closed: true, nodes }
      setPaths([...(item.paths ?? []), p])
      setPathSel(p.id)
      return setTabRaw("paths")
    }
    const all = item.paths ?? []
    const cur = all.find((p) => p.id === pathSel) ?? all[all.length - 1]
    if (!cur || cur.nodes.length < 2) return void toast("Önce Kalem ile bir yol çiz")
    const pts = flatten(cur)
    if (op === "stroke") {
      const closed = cur.closed ? [...pts, pts[0]] : pts
      addStroke({ tool: "brush", pts: capPoints(closed, 5000).map(([x, y]) => [x, y, 1]), seed: Math.floor(Math.random() * 1e9), b: brush })
      return void toast.success("Yol geçerli fırçayla konturlandı")
    }
    if (cur.nodes.length < 3 && !pts.some((_, i) => i > 1) && op !== "stroke") return void toast("Bu işlem için en az üç noktalı ya da eğri bir yol gerekir")
    if (op === "selection") {
      const masks = item.fx.masks ?? []
      if (masks.length >= MAX_MASKS) return void toast.error(`En fazla ${MAX_MASKS} seçim ve yerel düzenleme olabilir`)
      const m: Mask = { id: newId(), type: "select", ops: [{ kind: "poly", pts: capPoints(pts, 2000).map(([x, y]) => [(x - rx) / rw, (y - ry) / rh]), add: true }], feather: 0, invert: false, adjust: {} }
      setMasks([...masks, m])
      setMaskSel(m.id)
      setTabRaw("select")
      return void toast.success("Yol seçime çevrildi")
    }
    if (op === "mask") {
      const target = (item.layers ?? []).find((l) => l.id === (layerSel[0] ?? BASE_ID))
      if (!target) return
      if (target.kind === "adjust") return void toast("Vektör maske ayar katmanına uygulanamaz")
      const uv = capPoints(pts, 400).map(([x, y]) => layerUV(target, W, H, x * W, y * H))
      putLayer(target.id, { vector: { kind: "path", pts: uv } })
      return void toast.success(`Vektör maske "${target.name}" katmanına uygulandı`)
    }
    if (op === "fill") {
      const xs = pts.map((p) => p[0])
      const ys = pts.map((p) => p[1])
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
      if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4) return void toast("Yol doldurulamayacak kadar ince")
      const base = createLayer("shape", W, H, (item.layers?.length ?? 0) + 1)
      const ly: ImgLayer = { ...base, name: `${cur.name} Dolgusu`, x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, ar: ((y1 - y0) * H) / ((x1 - x0) * W), shapeDef: { type: "path", pts: capPoints(pts, 3000).map(([x, y]) => [(x - x0) / (x1 - x0), (y - y0) / (y1 - y0)]), color: brush.color, stroke: "#FFFFFF", strokeW: 0, radius: 0 } }
      setLayers([...(item.layers ?? []), ly])
      setLayerSel([ly.id])
      toast.success("Yol ön plan rengiyle dolduruldu")
    }
  }
  const layerCommand = async (cmd: string) => {
    if (!item) return
    const all = item.layers ?? []
    const picked = layerSel.length ? layerSel : [BASE_ID] // seçim yoksa işlem fotoğrafın kendisine
    const chosen = all.filter((l) => picked.includes(l.id))
    const free = chosen.filter((l) => !l.locked && l.id !== BASE_ID)
    const [, op, arg] = cmd.split(":")
    const [W, H] = canvasSize(item.geo, item.src) ?? [1080, 1350]
    if (op === "base") {
      setLayerSel([BASE_ID])
      return setTabRaw("design")
    }
    if (op === "via") {
      // Photoshop'taki Ctrl+J: seçim varsa seçili alan yeni katman olur, yoksa katman çoğalır
      const sels = (item.fx.masks ?? []).filter((m) => m.type === "select" && m.ops?.length)
      const m = sels.find((x) => x.id === maskSel) ?? sels[sels.length - 1]
      if (m) return void selectionToLayer(arg === "cut", m.id)
      if (arg === "cut") return void toast("Önce kesilecek alanı seç")
      return void layerCommand("layer:dup")
    }
    if (op === "front" || op === "back" || op === "forward" || op === "backward") {
      const moving = chosen.filter((l) => l.id !== BASE_ID).map((l) => l.id)
      if (!moving.length) return void toast("Arka Plan her zaman en altta kalır")
      const stack = stackIds(item)
      const places = moving.map((id) => stack.indexOf(id))
      const top = stack[stack.length - 1]
      const target = op === "front" ? top : op === "back" ? BASE_ID : op === "forward" ? stack[Math.min(stack.length - 1, Math.max(...places) + 1)] : stack[Math.max(0, Math.min(...places) - 2)]
      return update((it) => moveInStack(it, moving, target))
    }
    const map = (fn: (l: ImgLayer) => ImgLayer) => setLayers(all.map((l) => (picked.includes(l.id) ? fn(l) : l)))
    if (op === "new") {
      if (all.length >= 200) return void toast("En fazla 200 katman eklenebilir")
      // Photoshop gibi: seçili katmanın hemen üstüne; seçim Arka Plan ise en üste
      const made = createLayer(arg as "blank", W, H, all.length + 1)
      const over = [...all].reverse().find((l) => layerSel.includes(l.id) && l.id !== BASE_ID)
      const ly = over ? { ...made, group: over.group } : made
      setLayers(over ? [...all.slice(0, all.indexOf(over) + 1), ly, ...all.slice(all.indexOf(over) + 1)] : [...all, ly])
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
          await bakeIntoPhoto()
          recordCmd("flatten")
          return void toast.success("Görüntü düzleştirildi; Geri Al ile dönebilirsin")
        }
        const eff = effectiveItem(item)
        const off = new Set(eff.hidden ?? [])
        const visible = (eff.layers ?? []).filter((l) => !off.has(`img:${l.id}`))
        const baseShown = visible.some((l) => l.id === BASE_ID)
        // ayar katmanları yalnızca fotoğrafın üstünde anlamlı: fotoğraf birleşmiyorsa dışarıda kalır
        const below = all[all.indexOf(chosen[0]) - 1] // tek katman seçiliyse altındakiyle birleşir
        const ids = op === "merge" ? (picked.length === 1 && below ? [below.id, picked[0]] : picked) : visible.filter((l) => baseShown || l.kind !== "adjust").map((l) => l.id)
        if (ids.length < 2) return void toast(op === "merge" ? "Birleştirmek için en az iki katman seç" : "Birleştirilecek görünür katman yok")
        if (ids.includes(BASE_ID)) {
          await bakeIntoPhoto(ids)
          if (op === "mergevis") recordCmd("mergevis")
          else if (rec.current) toast("Seçili katmanları birleştirme eyleme kaydedilmedi; Görünenleri Birleştir kaydedilir")
          return void toast.success("Katmanlar Arka Plan ile birleştirildi")
        }
        const r = await api.layersMerge({ item: eff, ids })
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
    if (!layerSel.length) setLayerSel(picked)
    switch (op) {
      case "dup": {
        const copies = chosen.map((l) => ({ ...structuredClone(l), id: newId(), name: `${l.name} kopya`, x: l.x + 0.03, y: l.y + 0.03, locked: false, link: undefined }))
        setLayers([...all, ...copies])
        return setLayerSel(copies.map((l) => l.id))
      }
      case "del":
        if (!free.length) return void toast(chosen.some((l) => l.id === BASE_ID) ? "Arka Plan silinemez; göz simgesiyle gizleyebilirsin" : "Kilitli katman silinemez")
        setLayers(all.filter((l) => !free.some((x) => x.id === l.id)))
        return setLayerSel([])
      case "rename": return setRenaming(chosen[0].id)
      case "group": {
        const inGroup = chosen.filter((l) => l.id !== BASE_ID) // Arka Plan her zaman en altta kalır
        if (!inGroup.length) return void toast("Arka Plan gruba alınamaz; önce başka bir katman seç")
        const id = newId()
        const n = (item.groups?.length ?? 0) + 1
        const top = Math.max(...inGroup.map((l) => all.indexOf(l)))
        const members = inGroup.map((l) => ({ ...l, group: id }))
        const rest = all.flatMap((l, i) => (i === top ? members : inGroup.includes(l) ? [] : [l]))
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
        map((l) => (l.kind || l.base ? l : { ...l, smart: true }))
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
    if (!list.length) return toast.error("Desteklenen dosya bulunamadı (jpg, png, webp, psd)")
    setUploading(true)
    let last: string | null = null
    for (const f of list) {
      try {
        if (/\.psd$/i.test(f.name)) {
          const d = await api.importPsd(f)
          const it = { ...newItem(d.id, d.name, DEFAULT_FX, settings.tone), src: [d.width, d.height] as [number, number], geo: geoForPreset("original"), layers: d.layers, groups: d.groups, hidden: d.hidden }
          setItems((a) => [...a, it])
          last = last ?? d.id
          d.warnings.forEach((w) => toast.warning(w, { duration: 10000 }))
          continue
        }
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
  const generate = async (one?: Item, slices = false, list: Item[] = items) => {
    // metin isteğe bağlı: metinsiz fotoğraflar yalnızca renk/efektle üretilir
    if (!list.length) return toast.error("Önce fotoğraf ekle")
    setJob(null)
    setDlg(true)
    try {
      const { job: id } = await api.generate({
        items: (one ? [one] : list).map(effectiveItem), outDir: settings.outDir, export: settings.export, single: !!one, slices,
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

  const generateRef = useRef((_list: Item[]) => {})
  generateRef.current = (list) => void generate(undefined, false, list)

  const saveFile = async (copy: boolean, psd = false) => {
    if (!item) return
    const ex: ExportOpts = { format: "jpg", quality: 95, naming: "number", exif: false, ...settings.export, ...(psd ? { format: "psd" as const, color: "rgb" as const } : {}) }
    const formats = psd ? (["psd"] as ExportOpts["format"][]) : COLOR_FORMATS[ex.color ?? "rgb"]
    try {
      const name = await saveAs(ex.format === "psd" ? psdItem(item) : effectiveItem(item), ex, formats, copy)
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
    if (cmd.startsWith("color:auto:") && rec.current) rec.current.auto = cmd.slice(11)
    if (cmd.startsWith("pen:tool:")) {
      setPenTool(cmd.slice(9) as PenTool)
      return setTabRaw("paths")
    }
    if (cmd.startsWith("path:")) return pathOp(cmd.slice(5))
    if (cmd.startsWith("view:")) return setIntent({ cmd, n: ++intentSeq })
    if (cmd.startsWith("win:")) {
      if (cmd === "win:layers") setShowLayers((v) => !v)
      else if (cmd === "win:tools") setShowTools((v) => !v)
      else setShowOptions((v) => !v)
      return setBare(false)
    }
    if (cmd === "panels") return setBare((v) => !v)
    if (cmd === "help:keys") return setKeysOpen(true)
    if (cmd === "color:reset") return setBrush({ color: "#000000", color2: "#FFFFFF" })
    if (cmd === "color:swap") return setBrush({ color: brush.color2, color2: brush.color })
    if (cmd === "sel:all" || cmd === "sel:none") return selectAll(cmd === "sel:all")
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
      toast("Katmanın köşelerini duvarın ya da düzlemin dört köşesine oturt")
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
      keepSelection.current = true
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
    if (cmd === "sel:lasso:keep") {
      keepSelection.current = true
      return command("sel:lasso")
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
      savePsd: () => void saveFile(false, true),
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
  keyRef.current = (e) => {
    if (TYPING(e.target) || document.querySelector("[role=dialog]")) return
    const combo = comboOf(e)
    if (!combo) {
      const dir = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[e.code]
      if (!dir || (tab !== "design" && tab) || !item || !layerSel.length) return
      e.preventDefault()
      const [W, H] = canvasSize(item.geo, item.src) ?? [1080, 1350]
      const n = e.shiftKey ? 10 : 1
      return setLayers((item.layers ?? []).map((l) => (layerSel.includes(l.id) && !l.locked ? { ...l, x: l.x + (dir[0] * n) / W, y: l.y + (dir[1] * n) / H } : l)))
    }
    // fırça opaklığı: 1 = %10 ... 0 = %100
    if (/^\d$/.test(combo) && (tab === "brush" || tab === "retouch")) return (tab === "brush" ? setBrush : setRetouchBrush)({ opacity: (Number(combo) || 10) / 10 })
    const cmd = SHORTCUTS[combo]
    if (!cmd || (cmd === "copyFx" && window.getSelection()?.toString())) return
    if (cmd === "layer:del" && tab !== "design" && tab !== "layers" && tab) return
    if (cmd.startsWith("path:") && tab !== "paths") return
    e.preventDefault()
    command(cmd)
  }
  const noItem = !item
  type Entry = { label: string; cmd: string; en?: string; off?: boolean }
  type Rows = Menu["items"]
  // tek noktadan menü öğesi: kısayol tablodan, İngilizce ad ipucunda
  const L = (label: string, cmd: string, opt: { disabled?: boolean; checked?: boolean; title?: string } = {}) => ({ label, cmd, key: keyOf(cmd), ...opt })
  const E = (t: Entry, disabled = noItem || !!t.off) => L(t.label, t.cmd, { disabled, title: t.en })
  const by = <T extends Entry & { section: string }>(list: T[], secs: string[]) =>
    secs.flatMap((sec, i): (ReturnType<typeof E> | "sep")[] => [...(i ? ["sep" as const] : []), ...list.filter((t) => t.section === sec).map((t) => E(t))])
  const pickCmd = <T extends Entry>(list: T[], cmds: string[]) => cmds.map((c) => E(list.find((t) => t.cmd === c)!))
  const selE = (id: string) => {
    const t = SELECT_TOOLS.find((x) => x.id === id)!
    return L(t.label, `sel:${id}`, { disabled: noItem, title: t.en })
  }
  const layerSec = (s: string) => LAYER_TOOLS.filter((t) => t.section === s).map((t) => E(t))
  const layerPick = (...cmds: string[]) => pickCmd(LAYER_TOOLS, cmds)
  const xfPick = (...cmds: string[]) => pickCmd(XFORM_TOOLS, cmds)
  const adjustSecs = COLOR_SECTIONS.filter((s) => s !== "Otomatik")
  const filterSecs = FILTER_SECTIONS.filter((s) => s !== "Efektler" && s !== "Diğer Filtreler")
  const cropPick = (...cmds: string[]) => pickCmd(CROP_TOOLS, cmds)
  const filterPick = (...cmds: string[]) => cmds.map((c) => E(FILTER_TOOLS.find((t) => t.cmd === c)!))
  const dockOpen = (t: string) => tab === t
  const fileMenu: Rows = [
    L("Yeni / Projeler…", "projects"),
    L("Fotoğraf Aç…", "addPhotos"),
    L("Görsel Yerleştir…", "addImage", { disabled: noItem, title: "Place" }),
    "sep",
    L("Kaydet", "save", { disabled: noItem }),
    L("Farklı Kaydet…", "saveAs", { disabled: noItem }),
    L("Kopya Kaydet…", "saveCopy", { disabled: noItem }),
    L("PSD Olarak Kaydet…", "savePsd", { disabled: noItem, title: "Katmanlı Photoshop dosyası" }),
    L("Tümünü Dışa Aktar", "exportAll", { disabled: !items.length }),
    "sep",
    { label: "Otomatikleştir", children: [L("Eylemler ve Toplu İşlem…", "tool:actions", { title: "Actions / Batch" })] },
    "sep",
    L("Çıkış", "quit"),
  ]
  const editMenu: Rows = [
    L("Geri Al", "undo", { disabled: !histLen.past }),
    L("Yinele", "redo", { disabled: !histLen.future }),
    "sep",
    L("Renk ve Efektleri Kopyala", "copyFx", { disabled: noItem }),
    L("Renk ve Efektleri Yapıştır", "pasteFx", { disabled: !clip || noItem }),
    L("Fotoğrafı Çoğalt", "duplicate", { disabled: noItem }),
    "sep",
    E(ERASE_TOOLS.find((t) => t.cmd === "erase:fill")!),
    E(ERASE_TOOLS.find((t) => t.cmd === "erase:gen")!),
    { label: "Silme ve Arka Plan", children: by(ERASE_TOOLS, ERASE_SECTIONS.filter((s) => s !== "Maskeler")) },
    "sep",
    E(XFORM_TOOLS.find((t) => t.cmd === "xf:free")!),
    { label: "Dönüştür", children: [...xfPick("xf:scale", "xf:rotate", "xf:skew", "xf:distort", "xf:perspective"), "sep", ...xfPick("xf:warp", "xf:puppet", "xf:pwarp"), "sep", ...xfPick("design:again")] },
    E(XFORM_TOOLS.find((t) => t.cmd === "xf:camove")!),
    "sep",
    ...xfPick("design:autoalign", "design:autoblend"),
    "sep",
    { label: "Yol", children: [L("Yolu Doldur", "path:fill", { disabled: !item?.paths?.length, title: "Fill Path" }), L("Yolu Konturla", "path:stroke", { disabled: !item?.paths?.length, title: "Stroke Path" })] },
    "sep",
    L("Tercihler…", "settings"),
  ]
  const imageMenu: Rows = [
    { label: "Ayarlamalar", children: by(COLOR_TOOLS, adjustSecs) },
    "sep",
    ...pickCmd(COLOR_TOOLS, ["color:auto:tone", "color:auto:contrast", "color:auto:color"]),
    E(COLOR_TOOLS.find((t) => t.cmd === "color:library")!, false),
    "sep",
    ...cropPick("tool:crop:size", "tool:crop:canvas", "tool:crop:rotate"),
    "sep",
    { label: "Kırp", children: cropPick("tool:crop:ratio", "tool:crop:custom", "crop:persp", "tool:crop:ca") },
    { label: "Düzelt", children: cropPick("crop:line", "tool:crop:edges", "tool:crop:upright") },
    { label: "Dilimler", children: cropPick("slice:draw", "slice:select") },
  ]
  const layerMenu: Rows = [
    { label: "Yeni", children: [...layerSec("Katman Türleri").filter((x) => x.cmd !== "layer:base"), "sep", L("Görsel Yerleştir…", "addImage", { disabled: noItem })] },
    ...layerPick("layer:dup", "layer:del", "layer:rename"),
    "sep",
    { label: "Katman Stili", children: layerSec("Katman Stilleri") },
    { label: "Maskeler", children: layerSec("Maskeler") },
    "sep",
    ...layerPick("layer:group", "layer:ungroup"),
    { label: "Düzenle (Sıralama)", children: [L("Öne Getir", "layer:front", { disabled: noItem }), L("Bir Öne", "layer:forward", { disabled: noItem }), L("Bir Arkaya", "layer:backward", { disabled: noItem }), L("Arkaya Gönder", "layer:back", { disabled: noItem })] },
    { label: "Hizala ve Dağıt", children: xfPick("tool:design:align", "tool:design:align2", "design:autoalign", "design:autoblend") },
    ...layerPick("layer:link", "layer:lock", "layer:unlock", "layer:toggle"),
    "sep",
    ...layerPick("layer:merge", "layer:mergevis", "layer:flatten"),
    "sep",
    { label: "Katman Özellikleri", children: [...layerPick("layer:sec:blend", "layer:sec:opacity", "layer:sec:fill", "layer:sec:label"), "sep", ...layerPick("layer:sec:comps", "layer:filter", "layer:base")] },
  ]
  const typeMenu: Rows = [L("Yazı Aracı", "tool:text", { disabled: noItem, title: "Type Tool" }), L("Metin Katmanı Ekle", "layer:new:text", { disabled: noItem, title: "Text Layer" })]
  const selectMenu: Rows = [
    L("Tümünü Seç", "sel:all", { disabled: noItem, title: "All" }),
    L("Seçimi Kaldır", "sel:none", { disabled: noItem, title: "Deselect" }),
    selE("invert"),
    "sep",
    selE("subject"), selE("background"), selE("sky"), selE("range"), selE("focus"),
    "sep",
    selE("refine"),
    { label: "Değiştir", children: ["border", "smooth", "expand", "contract", "feather"].map(selE) },
    selE("grow"), selE("similar"),
    "sep",
    selE("save"), selE("load"),
    "sep",
    L("Yolu Seçime Çevir", "path:selection", { disabled: !item?.paths?.length, title: "Load Path as Selection" }),
    L("Seçimden Yol Oluştur", "path:fromsel", { disabled: noItem, title: "Make Work Path" }),
    "sep",
    E(LAYER_TOOLS.find((t) => t.cmd === "layer:quickmask")!),
    L("Degrade Maske", "mask:linear", { disabled: noItem }),
    L("Daire Maske", "mask:radial", { disabled: noItem }),
    L("Tüm Yerel Düzenlemeler", "tool:local:select", { disabled: noItem }),
  ]
  const filterMenu: Rows = [
    L("Filtre Galerisi…", "filter:gallery", { title: "Filter Gallery" }),
    ...filterPick("filter:add:wideangle", "filter:add:lenscor", "filter:add:liquify", "filter:vanish", "color:tool:basic"),
    "sep",
    ...filterSecs.map((sec) => ({ label: sec, children: by(FILTER_TOOLS, [sec]) })),
    { label: "Diğer", children: filterPick("filter:add:highpass", "filter:add:custom") },
    "sep",
    { label: "Rötuş ve Portre", children: by(RETOUCH_TOOLS, RETOUCH_SECTIONS) },
    E(FILTER_TOOLS.find((t) => t.cmd === "filter:ai")!),
    "sep",
    ...FILTER_TOOLS.filter((t) => t.section === "Efektler").map((t) => E(t, false)),
  ]
  const viewMenu: Rows = [
    L("Yakınlaştır", "view:in", { disabled: noItem }),
    L("Uzaklaştır", "view:out", { disabled: noItem }),
    L("Ekrana Sığdır", "view:fit", { disabled: noItem }),
    L("%100", "view:100", { disabled: noItem }),
    "sep",
    L("Önce / Sonra Karşılaştır", "view:compare", { disabled: noItem }),
    "sep",
    L("Akıllı Kılavuzlar", "guides", { checked: settings.guides }),
    L("Izgara", "view:grid", { disabled: noItem }),
  ]
  const windowMenu: Rows = [
    L("Araçlar", "win:tools", { checked: showTools }),
    L("Seçenekler", "win:options", { checked: showOptions }),
    L("Katmanlar", "win:layers", { checked: showLayers }),
    L("Fotoğraf Şeridi", "strip", { checked: showStrip }),
    L("Panelleri Gizle / Göster", "panels"),
    "sep",
    L("Ayarlamalar", "tool:color", { checked: dockOpen("color") }),
    L("Filtreler", "tool:fx", { checked: dockOpen("fx") }),
    L("Özellikler", "tool:layers", { checked: dockOpen("layers") }),
    L("Geçmiş", "tool:history", { checked: dockOpen("history") }),
    L("Eylemler", "tool:actions", { checked: dockOpen("actions") }),
    L("Yollar", "tool:paths", { checked: dockOpen("paths") }),
    L("Çerçeve", "tool:frame", { checked: dockOpen("frame") }),
    "sep",
    { label: "Fırça", children: by(BRUSH_TOOLS, BRUSH_SECTIONS.filter((s) => s !== "Çizim" && s !== "Silgi" && s !== "Geçmiş")) },
    "sep",
    L("Etkin Paneli Kapat", "closePanel", { disabled: !tab }),
  ]
  const helpMenu: Rows = [L("Klavye Kısayolları", "help:keys"), "sep", L("Güncellemeleri Denetle ve Hakkında…", "settings")]
  const menus: Menu[] = [
    { label: "Dosya", items: fileMenu }, { label: "Düzenle", items: editMenu }, { label: "Görüntü", items: imageMenu }, { label: "Katman", items: layerMenu }, { label: "Yazı", items: typeMenu },
    { label: "Seçim", items: selectMenu }, { label: "Filtre", items: filterMenu }, { label: "Görünüm", items: viewMenu }, { label: "Pencere", items: windowMenu }, { label: "Yardım", items: helpMenu },
  ]
  // ToolBox'ta hangi araç basılı görünecek
  const currentTool = tab === "brush" ? `brush:tool:${brushTool}` : tab === "retouch" ? `retouch:tool:${retouchTool}` : tab === "select" ? `sel:${selTool.mode}` : tab === "design" || !tab ? (xform === "free" ? "xf:free" : "xf:move") : tab === "slice" ? `slice:${sliceTool}` : perspEdit ? "crop:persp" : tab === "crop" ? "tool:crop:ratio" : tab === "text" ? "tool:text" : tab === "paths" ? `pen:tool:${penTool}` : `tool:${tab}`
  const historySeq = tab === "history" ? [...hist.current.past, items, ...[...hist.current.future].reverse()] : []
  const history = {
    rows: historySeq.map((snap, i) => (i ? stepName(historySeq[i - 1], snap) : "Açılış")),
    at: histLen.past,
    go: (i: number) => {
      const d = i - hist.current.past.length
      for (let n = Math.abs(d); n > 0; n--) travel(d < 0 ? "undo" : "redo")
    },
  }
  const showPanel = !!tab && tab !== "eyedrop" && tab !== "hand" && tab !== "zoom"
  const startResize = (e: React.PointerEvent) => {
    const y0 = e.clientY
    const h0 = layersH
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => setLayersH(Math.max(140, Math.min(window.innerHeight - 260, h0 + y0 - ev.clientY)))
    const stop = () => {
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerup", stop)
      try {
        localStorage.setItem("dock-layers", String(el.dataset.h ?? ""))
      } catch {
        /* tarayıcı depolaması kapalı olabilir */
      }
    }
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerup", stop)
  }

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
        <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b bg-card px-2">
          <div className="flex min-w-0 items-center gap-2">
            <button onClick={closeProject} title="Projeler" className="flex shrink-0 items-center rounded-md p-1 hover:bg-accent">
              <img src="/logo.png" alt="Projeler" className="h-5 w-5" />
            </button>
            <MenuBar menus={menus} onCommand={command} />
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
              className="ml-2 h-6 w-[160px] min-w-0 truncate rounded-md border border-transparent bg-transparent px-2 text-xs text-muted-foreground outline-none transition-colors hover:border-border focus:border-primary/60 focus:text-foreground"
            />
          </div>
          <div className="flex items-center gap-1">
            {upd?.newer && (
              <Button variant="secondary" size="sm" className="h-6 gap-1 border border-primary/40 px-2 text-[11px] text-primary" onClick={() => setUpdOpen(true)}>
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
            <Button onClick={() => generate()} disabled={!items.length} size="sm" className="h-6 gap-1 px-2 text-[11px]" title="Tüm fotoğrafları çıktı klasörüne kaydet">
              <Download className="!size-3" /> Tümünü Dışa Aktar
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Ayarlar" onClick={() => setCog(true)}>
              <Cog className="h-4 w-4" />
            </Button>
          </div>
        </header>
        {!bare && showOptions && (
          <OptionsBar
            tab={tab} item={item} run={command} brushTool={brushTool} brush={brush} setBrush={setBrush} retouchTool={retouchTool} retouchBrush={retouchBrush} setRetouchBrush={setRetouchBrush}
            cloneSource={cloneSource} armSource={armSource} selTool={selTool} setSelTool={setSelTool} xform={xform} setXform={setXform} layerSel={layerSel} putLayer={putLayer} setGeo={setGeo}
            sliceTool={sliceTool} mode={mode} setMode={setMode} eraseMode={eraseMode} maskTool={maskTool} setMaskTool={setMaskTool} penTool={penTool} setPenTool={setPenTool} colorBar={colorBar} textColor={selected.length ? item?.styles[selected[0]]?.color ?? item?.textFx?.color ?? "#FFFFFF" : item?.textFx?.color ?? "#FFFFFF"} setTextColor={setTextColor}
          />
        )}
        <div className="flex min-h-0 flex-1">
          {!bare && showTools && <ToolBox active={tab} current={currentTool} onCommand={command} fg={brush.color} bg={brush.color2} setFg={(color) => setBrush({ color })} setBg={(color2) => setBrush({ color2 })} />}
          {/* orta: belge sekmeleri, tuval, durum çubuğu */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {items.length > 0 && <DocTabs items={items} currentId={currentId} select={setCurrentId} remove={removeItem} add={() => fileRef.current?.click()} />}
            <Stage
              item={item ? effectiveItem(item) : undefined} cfg={cfg} mode={mode} intent={intent} nav={tab === "hand" || tab === "zoom" ? tab : ""} textTab={tab === "text"} layerName={layerSel.length === 1 ? item?.layers?.find((l) => l.id === layerSel[0])?.name : undefined} selected={selected} setSelected={setSelected}
              update={update} applyStyle={applyStyle} resetPosition={resetPosition} pickFiles={() => fileRef.current?.click()}
              guides={settings.guides} wm={wm}
              cropping={cropping} geoSrc={geoSrc && geoSrc.id === item?.id ? geoSrc : null} setGeo={setGeo} perspEdit={perspEdit} lineMode={lineMode} endLine={() => setLineMode(false)}
              eraseMode={tab === "erase" ? eraseMode : ""} maskTool={maskTool} putLayer={putLayer}
              brushMode={tab === "brush" || tab === "retouch"} brushTool={tab === "retouch" ? retouchTool : brushTool} brush={tab === "retouch" ? retouchBrush : brush} setBrush={tab === "retouch" ? setRetouchBrush : setBrush} smoothing={tab === "retouch" ? 0 : smoothing} onStroke={addStroke}
              filterEdit={curFilter ? { filter: curFilter, set: setCurFilter, liquify } : null}
              pick={tab === "eyedrop" ? ([r, g, b]) => setBrush({ color: "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase() }) : tab === "color" || tab === "layers" ? colorPick?.fn ?? null : null}
              onPreview={setPreviewImg} patchMode={patchMode} source={cloneSource} setSource={setCloneSource} armed={armedSource} setArmed={setArmedSource} onNeedSource={() => toast("Önce Alt+tıkla ile kaynak seç")}
              xform={xform} onXformDone={(a, b) => setLastXform(xformDelta(a, b))}
              pen={tab === "paths" ? { sel: pathSel, setSel: setPathSel, onChange: setPaths, tool: penTool } : null}
              sliceMode={tab === "slice"} sliceTool={sliceTool} sliceSel={sliceSel} setSliceSel={setSliceSel} setSlices={setSlices}
              colorBar={colorBar} designMode={tab === "design" || !tab} layerSel={layerSel} setLayerSel={setLayerSel} setLayers={changeLayers}
              localMode={tab === "paths" || tab === "local" || tab === "select" || tab === "slice" || tab === "brush" || tab === "retouch" || (tab === "erase" && !!eraseMode)} mask={curMask} maskShow={maskShow} setMask={setMask} selTool={selTool}
            />
            {showStrip && <Filmstrip items={items} currentId={currentId} select={setCurrentId} move={move} remove={removeItem} pickFiles={() => fileRef.current?.click()} uploading={uploading} pasteTo={clip ? pasteFx : undefined} exportOne={(id) => { const it = items.find((i) => i.id === id); if (it) generate(it) }} duplicate={duplicateItem} />}
          </div>
          {/* sağ: panel yuvası (Photoshop'taki gibi üstte özellikler, altta katmanlar) */}
          {!bare && (showPanel || showLayers) && (
            <div className="flex w-[320px] shrink-0 flex-col border-l bg-card">
              <div className="flex shrink-0 items-center gap-px border-b px-1 pt-1" role="tablist" aria-label="Paneller">
                {([["color", "Ayarlamalar"], ["fx", "Filtreler"], ["layers", "Özellikler"], ["history", "Geçmiş"], ["actions", "Eylemler"]] as const).map(([t, l]) => (
                  <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTabRaw(tab === t ? "" : t)} className={`rounded-t-sm px-2 py-1 text-[11px] transition-colors ${tab === t ? "bg-background text-foreground" : "text-muted-foreground hover:bg-accent/60"}`}>{l}{t === "actions" && recording ? <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" aria-label="Kaydediliyor" /> : null}</button>
                ))}
              </div>
              {showPanel && <Panel
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
                selTool={selTool} setSelTool={setSelTool} section={section} intent={intent} onClose={() => setTabRaw("")} history={history} fxLayer={fxLayer} setLayerFx={setLayerFx} colorObject={colorObject} setTextColor={setTextColor} pathsPanel={{ setPaths, sel: pathSel, setSel: setPathSel, tool: penTool, setTool: setPenTool, run: command }} actionsPanel={{ actions, setActions, recording, startRecord, stopRecord, play: runAction, busy: playing, count: items.length, hasItem: !!item }}
              />}
              {showLayers && (
                <>
                  {showPanel && <div role="separator" aria-orientation="horizontal" title="Sürükleyerek boyutlandır" data-h={layersH} onPointerDown={startResize} className="h-1.5 shrink-0 cursor-row-resize border-y bg-background hover:bg-primary/30" />}
                  <div className={showPanel ? "shrink-0" : "min-h-0 flex-1"} style={showPanel ? { height: layersH } : undefined}>
                    <LayersPanel item={item} presets={presets} wm={wm} tool={tab} maskSel={maskSel} sel={layerSel} open={openLayer} toggle={toggleLayer} remove={removeLayerFx} run={command} put={putLayerSafe} reorder={(moving, above, group) => update((it) => moveInStack(it, moving, above, group))} toggleGroup={toggleGroup} renameGroup={renameGroup} renaming={renaming} setRenaming={setRenaming} filterOpen={filterOpen} setFilterOpen={setFilterOpen} />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*,.psd" multiple hidden onChange={(e) => { addFiles([...(e.target.files || [])]); e.target.value = "" }} />
        <GenerateDialog open={dlg} onClose={() => setDlg(false)} job={job} jobId={jobId} />
        <KeysDialog open={keysOpen} onClose={() => setKeysOpen(false)} />
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
