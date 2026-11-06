import type { Adjust, Item, PresetMeta, Watermark } from "@/types"

// Fotoğrafa uygulanan her şeyi Photoshop'taki gibi katman listesi olarak gösterir.
// Gizlenen katmanlar item.hidden'da tutulur; önizleme ve dışa aktarma effectiveItem() ile onları atlar.
export type LayerKind = "watermark" | "text" | "image" | "frame" | "background" | "leak" | "bloom" | "dust" | "vignette" | "grain" | "mask" | "detail" | "adjust" | "look" | "geo" | "photo"

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
  ;[...(item.layers ?? [])].reverse().forEach((l) =>
    out.push({ key: `img:${l.id}`, kind: "image", label: l.name.replace(/\.[^.]+$/, ""), sub: `görsel${l.cutout ? " · kesilmiş" : ""}${l.opacity < 1 ? ` · ${pct(l.opacity)}` : ""}`, tool: "design", layerId: l.id, hideable: true, removable: true })
  )
  if (fx.frame) out.push({ key: "frame", kind: "frame", label: "Çerçeve", sub: { solid: "Düz", polaroid: "Polaroid", film: "Film şeridi", line: "İnce çizgi" }[fx.frame.style], tool: "frame", hideable: true, removable: true })
  if (fx.background?.mode)
    out.push({ key: "background", kind: "background", label: "Arka plan", sub: { remove: "kaldırıldı · şeffaf", color: `renk · ${fx.background.color ?? "#FFFFFF"}`, blur: "bulanık" }[fx.background.mode], tool: "fx", hideable: true, removable: true })
  if (tex.leak) out.push({ key: "leak", kind: "leak", label: "Işık sızıntısı", sub: pct(tex.leak), tool: "fx", hideable: true, removable: true })
  if (tex.bloom) out.push({ key: "bloom", kind: "bloom", label: "Işıma", sub: pct(tex.bloom), tool: "fx", hideable: true, removable: true })
  if (tex.dust) out.push({ key: "dust", kind: "dust", label: "Toz ve çizik", sub: pct(tex.dust), tool: "fx", hideable: true, removable: true })
  if (fx.vignette) out.push({ key: "vignette", kind: "vignette", label: "Vinyet", sub: pct(fx.vignette), tool: "fx", hideable: true, removable: true })
  if (fx.grain) out.push({ key: "grain", kind: "grain", label: "Film greni", sub: pct(fx.grain), tool: "fx", hideable: true, removable: true })
  ;(fx.masks ?? []).forEach((m, i) =>
    out.push({ key: `mask:${m.id}`, kind: "mask", label: `${m.type === "linear" ? "Degrade" : m.type === "select" ? "Seçim" : "Daire"} ${i + 1}`, sub: m.fill ? "alan taşındı · dolduruldu" : m.invert ? "yerel · ters" : "yerel düzenleme", tool: "local", maskId: m.id, hideable: true, removable: true })
  )
  if (hasKeys(adj, DETAIL_KEYS, true)) out.push({ key: "detail", kind: "detail", label: "Detay", sub: "keskinlik, netlik, gürültü", tool: "color", hideable: true, removable: true })
  if (hasKeys(adj, DETAIL_KEYS, false)) out.push({ key: "adjust", kind: "adjust", label: "Işık ve renk", sub: "ince ayar", tool: "color", hideable: true, removable: true })
  const preset = presets.find((p) => p.id === (fx.preset ?? ""))
  if (fx.preset !== "b:original")
    out.push({ key: "look", kind: "look", label: preset?.name ?? "Renk görünümü", sub: `renk görünümü · ${pct(fx.amount ?? 1)}${fx.bw ? " · S/B" : ""}`, tool: "color", hideable: true, removable: true })
  else if (fx.bw) out.push({ key: "look", kind: "look", label: "Siyah-beyaz", sub: "renk görünümü", tool: "fx", hideable: true, removable: true })
  out.push({ key: "photo", kind: "photo", label: "Fotoğraf", sub: item.name, tool: "crop", hideable: false, removable: false })
  return out
}

/** Gizli katmanlar çıkarılmış kopya (önizleme ve dışa aktarma için). */
export function effectiveItem(item: Item): Item {
  const h = new Set(item.hidden ?? [])
  if (!h.size) return item
  const fx = { ...item.fx, texture: { ...(item.fx.texture ?? {}) }, adjust: { ...(item.fx.adjust ?? {}) } }
  if (h.has("frame")) fx.frame = undefined
  if (h.has("background")) fx.background = undefined
  for (const k of ["leak", "bloom", "dust"] as const) if (h.has(k)) fx.texture![k] = 0
  if (h.has("vignette")) fx.vignette = 0
  if (h.has("grain")) fx.grain = 0
  fx.masks = (fx.masks ?? []).filter((m) => !h.has(`mask:${m.id}`))
  const layers = (item.layers ?? []).filter((l) => !h.has(`img:${l.id}`))
  const a = fx.adjust as Record<string, unknown>
  if (h.has("detail")) for (const k of DETAIL_KEYS) delete a[k]
  if (h.has("adjust")) for (const k of Object.keys(a)) if (!(DETAIL_KEYS as readonly string[]).includes(k)) delete a[k]
  if (h.has("look")) Object.assign(fx, { preset: "b:original", amount: 1, bw: false })
  return { ...item, fx, layers, text: h.has("text") ? "" : item.text }
}

/** Katmanı kaldırır (gizleme değil, ayarı sıfırlar). */
export function removeLayer(item: Item, layer: Layer): Item {
  const fx = { ...item.fx, texture: { ...(item.fx.texture ?? {}) }, adjust: { ...(item.fx.adjust ?? {}) } }
  const a = fx.adjust as Record<string, unknown>
  switch (layer.kind) {
    case "text": return { ...item, text: "", styles: [], offsets: {}, hidden: unhide(item, layer.key) }
    case "image": return { ...item, layers: (item.layers ?? []).filter((l) => l.id !== layer.layerId), hidden: unhide(item, layer.key) }
    case "frame": fx.frame = undefined; break
    case "background": fx.background = undefined; break
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
