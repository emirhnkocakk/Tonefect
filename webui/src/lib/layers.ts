import { RETOUCH_STROKES } from "@/lib/retouch"
import { colorSummary } from "@/lib/color"
import { filterLabel } from "@/lib/filters"
import { canvasSize } from "@/lib/geo"
import type { Adjust, ImgLayer, Item, PresetMeta, Watermark } from "@/types"

// Fotoğrafa uygulanan her şeyi Photoshop'taki gibi katman listesi olarak gösterir.
// Gizlenen katmanlar item.hidden'da tutulur; önizleme ve dışa aktarma effectiveItem() ile onları atlar.
export type LayerKind = "watermark" | "text" | "paint" | "image" | "frame" | "background" | "retouch" | "colorfx" | "filters" | "group" | "leak" | "bloom" | "dust" | "vignette" | "grain" | "mask" | "detail" | "adjust" | "look" | "geo" | "photo"

export type Layer = {
  key: string // item.hidden içindeki anahtar (mask:<id>)
  kind: LayerKind
  label: string
  sub?: string
  tool: string // tıklayınca açılan araç
  maskId?: string
  layerId?: string
  hideable: boolean
  removable: boolean
  global?: boolean // tüm fotoğrafları etkiler (filigran)
  layer?: ImgLayer
  groupId?: string
  depth?: number
  open?: boolean
}

export const BASE_ID = "base"

/** Ana fotoğraf her zaman en altta bir katmandır: tüm katman araçları ona da çalışır. */
export function withBase(item: Item): Item {
  const [W, H] = canvasSize(item.geo, item.src) ?? [1080, 1350]
  const ar = H / W
  const all = item.layers ?? []
  const cur = all.find((l) => l.id === BASE_ID)
  if (cur && cur.photo === item.id && Math.abs(cur.ar - ar) < 1e-6) return item
  if (cur) return { ...item, layers: all.map((l) => (l === cur ? { ...l, photo: item.id, ar } : l)) }
  return { ...item, layers: [{ id: BASE_ID, base: true, photo: item.id, name: "Arka Plan", x: 0.5, y: 0.5, w: 1, ar, rot: 0, opacity: 1, flipH: false, cutout: false }, ...all] }
}

const DETAIL_KEYS = ["sharpen", "clarity", "denoise"] as const
const pct = (v: number) => `${Math.round(v * 100)}%`
const hasKeys = (a: Adjust, keys: readonly string[], include: boolean) =>
  Object.entries(a).some(([k, v]) => (keys.includes(k) === include) && (k === "hsl" ? Object.values(v as object).some((x: any) => x.some(Boolean)) : k === "levels" ? !!v : !!v))

export function buildLayers(item: Item, presets: PresetMeta[], wm: Watermark | null): Layer[] {
  const fx = item.fx
  const tex = fx.texture ?? {}
  const adj = fx.adjust ?? {}
  const out: Layer[] = []
  if (wm?.enabled && wm.text) out.push({ key: "watermark", kind: "watermark", label: "Filigran", sub: `${wm.text} · tüm fotoğraflar`, tool: "settings", hideable: false, removable: true, global: true })
  if (item.text.trim()) out.push({ key: "text", kind: "text", label: "Yazı", sub: item.text, tool: "text", hideable: true, removable: true })
  if (item.paint?.strokes.length) {
    const fix = item.paint.strokes.filter((s) => RETOUCH_STROKES.has(s.tool)).length
    out.push({ key: "paint", kind: "paint", label: fix === item.paint.strokes.length ? "Rötuş Fırçaları" : fix ? "Boya ve Rötuş" : "Boya", sub: `${item.paint.strokes.length} darbe`, tool: fix === item.paint.strokes.length ? "retouch" : "brush", hideable: true, removable: true })
  }
  const seen = new Set<string>()
  const TYPE: Record<string, string> = { blank: "boş katman", text: "metin", shape: "şekil", fill: "dolgu", adjust: "ayar" }
  ;[...(item.layers ?? [])].filter((l) => l.id !== BASE_ID).reverse().forEach((l: ImgLayer) => {
    const g = l.group ? item.groups?.find((x) => x.id === l.group) : undefined
    if (g && !seen.has(g.id)) {
      seen.add(g.id)
      out.push({ key: `group:${g.id}`, kind: "group", label: g.name, sub: "grup", tool: "design", groupId: g.id, open: g.open, hideable: true, removable: true })
    }
    if (g && !g.open) return
    const bits = [l.kind ? TYPE[l.kind] : l.smart ? "akıllı nesne" : "görsel", l.cutout ? "kesilmiş" : "", l.opacity < 1 ? pct(l.opacity) : "", l.styles && Object.values(l.styles).some((s) => s.on) ? "fx" : ""]
    out.push({ key: `img:${l.id}`, kind: "image", label: l.name.replace(/\.(png|jpe?g|webp)$/i, ""), sub: bits.filter(Boolean).join(" · "), tool: l.kind ? "layers" : "design", layerId: l.id, layer: l, depth: g ? 1 : 0, hideable: true, removable: true })
  })
  if (fx.frame) out.push({ key: "frame", kind: "frame", label: "Çerçeve", sub: { solid: "Düz", polaroid: "Polaroid", film: "Film şeridi", line: "İnce çizgi" }[fx.frame.style], tool: "frame", hideable: true, removable: true })
  if (fx.background?.mode)
    out.push({ key: "background", kind: "background", label: "Arka plan", sub: { remove: "kaldırıldı · şeffaf", color: `renk · ${fx.background.color ?? "#FFFFFF"}`, blur: "bulanık" }[fx.background.mode], tool: "fx", hideable: true, removable: true })
  if (fx.retouch && Object.entries(fx.retouch).some(([k, v]) => k !== "texture" && k !== "fsRadius" && k !== "area" && k !== "fsSkin" && v))
    out.push({ key: "retouch", kind: "retouch", label: "Otomatik Rötuş", sub: "cilt, frekans, onarım", tool: "retouch", hideable: true, removable: true })
  const flt = (fx.filters ?? []).filter((f) => !f.off)
  if (flt.length) out.push({ key: "filters", kind: "filters", label: "Filtreler", sub: flt.map((f) => filterLabel(f.kind)).join(", "), tool: "fx", hideable: true, removable: true })
  const edits = colorSummary(fx.color)
  if (edits.length) out.push({ key: "colorfx", kind: "colorfx", label: "Renk Düzenlemeleri", sub: edits.join(", "), tool: "color", hideable: true, removable: true })
  if (tex.leak) out.push({ key: "leak", kind: "leak", label: "Işık sızıntısı", sub: pct(tex.leak), tool: "fx", hideable: true, removable: true })
  if (tex.bloom) out.push({ key: "bloom", kind: "bloom", label: "Işıma", sub: pct(tex.bloom), tool: "fx", hideable: true, removable: true })
  if (tex.dust) out.push({ key: "dust", kind: "dust", label: "Toz ve çizik", sub: pct(tex.dust), tool: "fx", hideable: true, removable: true })
  if (fx.vignette) out.push({ key: "vignette", kind: "vignette", label: "Vinyet", sub: pct(fx.vignette), tool: "fx", hideable: true, removable: true })
  if (fx.grain) out.push({ key: "grain", kind: "grain", label: "Film greni", sub: pct(fx.grain), tool: "fx", hideable: true, removable: true })
  ;(fx.masks ?? []).forEach((m, i) =>
    out.push({ key: `mask:${m.id}`, kind: "mask", label: `${m.type === "linear" ? "Degrade" : m.type === "select" ? "Seçim" : "Daire"} ${i + 1}`, sub: m.fill ? "alan taşındı · dolduruldu" : m.invert ? "yerel · ters" : "yerel düzenleme", tool: m.type === "select" ? "select" : "local", maskId: m.id, hideable: true, removable: true })
  )
  if (hasKeys(adj, DETAIL_KEYS, true)) out.push({ key: "detail", kind: "detail", label: "Detay", sub: "keskinlik, netlik, gürültü", tool: "color", hideable: true, removable: true })
  if (hasKeys(adj, DETAIL_KEYS, false)) out.push({ key: "adjust", kind: "adjust", label: "Işık ve renk", sub: "ince ayar", tool: "color", hideable: true, removable: true })
  const preset = presets.find((p) => p.id === (fx.preset ?? ""))
  if (fx.preset !== "b:original")
    out.push({ key: "look", kind: "look", label: preset?.name ?? "Renk görünümü", sub: `renk görünümü · ${pct(fx.amount ?? 1)}${fx.bw ? " · S/B" : ""}`, tool: "color", hideable: true, removable: true })
  else if (fx.bw) out.push({ key: "look", kind: "look", label: "Siyah-beyaz", sub: "renk görünümü", tool: "fx", hideable: true, removable: true })
  const base = item.layers?.find((l) => l.id === BASE_ID)
  out.push({ key: `img:${BASE_ID}`, kind: "photo", label: base?.name ?? "Arka Plan", sub: item.name, tool: "design", layerId: base ? BASE_ID : undefined, layer: base, hideable: true, removable: false })
  return out
}

/** Gizli katmanlar çıkarılmış kopya (önizleme ve dışa aktarma için). */
export function effectiveItem(item: Item): Item {
  const h = new Set(item.hidden ?? [])
  if (!h.size) return item
  const fx = { ...item.fx, texture: { ...(item.fx.texture ?? {}) }, adjust: { ...(item.fx.adjust ?? {}) } }
  if (h.has("frame")) fx.frame = undefined
  if (h.has("background")) fx.background = undefined
  if (h.has("retouch")) fx.retouch = undefined
  if (h.has("colorfx")) fx.color = undefined
  if (h.has("filters")) fx.filters = undefined
  for (const k of ["leak", "bloom", "dust"] as const) if (h.has(k)) fx.texture![k] = 0
  if (h.has("vignette")) fx.vignette = 0
  if (h.has("grain")) fx.grain = 0
  fx.masks = (fx.masks ?? []).filter((m) => !h.has(`mask:${m.id}`))
  const layers = (item.layers ?? [])
    .filter((l) => l.id === BASE_ID || (!h.has(`img:${l.id}`) && !(l.group && h.has(`group:${l.group}`))))
    .map((l) => (l.id === BASE_ID && h.has(`img:${l.id}`) ? { ...l, opacity: 0 } : l))
  const a = fx.adjust as Record<string, unknown>
  if (h.has("detail")) for (const k of DETAIL_KEYS) delete a[k]
  if (h.has("adjust")) for (const k of Object.keys(a)) if (!(DETAIL_KEYS as readonly string[]).includes(k)) delete a[k]
  if (h.has("look")) Object.assign(fx, { preset: "b:original", amount: 1, bw: false })
  return { ...item, fx, layers, paint: h.has("paint") ? undefined : item.paint, text: h.has("text") ? "" : item.text }
}

/** Katmanı kaldırır (gizleme değil, ayarı sıfırlar). */
export function removeLayer(item: Item, layer: Layer): Item {
  const fx = { ...item.fx, texture: { ...(item.fx.texture ?? {}) }, adjust: { ...(item.fx.adjust ?? {}) } }
  const a = fx.adjust as Record<string, unknown>
  switch (layer.kind) {
    case "text": return { ...item, text: "", styles: [], offsets: {}, hidden: unhide(item, layer.key) }
    case "paint": return { ...item, paint: undefined, hidden: unhide(item, layer.key) }
    case "group": return { ...item, layers: (item.layers ?? []).filter((l) => l.group !== layer.groupId), groups: (item.groups ?? []).filter((g) => g.id !== layer.groupId), hidden: unhide(item, layer.key) }
    case "image": return { ...item, layers: (item.layers ?? []).filter((l) => l.id !== layer.layerId), hidden: unhide(item, layer.key) }
    case "frame": fx.frame = undefined; break
    case "background": fx.background = undefined; break
    case "retouch": fx.retouch = undefined; break
    case "colorfx": fx.color = undefined; break
    case "filters": fx.filters = undefined; break
    case "leak": case "bloom": case "dust": fx.texture![layer.kind] = 0; break
    case "vignette": fx.vignette = 0; break
    case "grain": fx.grain = 0; break
    case "mask": fx.masks = (fx.masks ?? []).filter((m) => m.id !== layer.maskId); break
    case "detail": for (const k of DETAIL_KEYS) delete a[k]; break
    case "adjust": for (const k of Object.keys(a)) if (!(DETAIL_KEYS as readonly string[]).includes(k)) delete a[k]; break
    case "look": Object.assign(fx, { preset: "b:original", amount: 1, bw: false }); break
  }
  return { ...item, fx, hidden: unhide(item, layer.key) }
}

const unhide = (item: Item, key: string) => (item.hidden ?? []).filter((k) => k !== key)
