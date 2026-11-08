import { filterLabel } from "@/lib/filters"
import { BASE_ID, withBase } from "@/lib/layers"
import { legacyGeo } from "@/lib/geo"
import type { Item } from "@/types"

// Eylemler: kayıt sırasında fotoğraftaki her değişiklik adım olur, başka fotoğraflara aynen uygulanır.
// Koordinatlar göreli olduğu için farklı boyuttaki fotoğraflarda da çalışır. Seçim işlemleri (konuyu seç gibi) her fotoğrafta yeniden hesaplanır.
type Dict = Record<string, unknown>
export type Op =
  | { t: "set"; path: string; value: unknown }
  | { t: "patch"; path: string; value: Dict } // yalnızca değişen alt anahtarlar; null = sil
  | { t: "list"; path: ListPath; put: ({ id: string } & Dict)[]; del: string[]; order?: string[] }
  | { t: "strokes"; strokes: unknown[] }
  | { t: "hide"; add: string[]; del: string[] }
  | { t: "auto"; kind: string }
  | { t: "cmd"; cmd: "flatten" | "mergevis" }
export type ActionStep = { id: string; off?: boolean; ops: Op[] }
export type Action = { id: string; name: string; steps: ActionStep[] }
type ListPath = "fx.filters" | "fx.masks" | "layers" | "groups" | "paths"

const SET_FX = ["preset", "bw", "amount", "grain", "vignette", "frame", "background"]
const PATCH_FX = ["adjust", "color", "texture", "retouch"]
const SET_ITEM: (keyof Item)[] = ["text", "tone", "accent", "styles", "block", "offsets", "font", "textFx", "slices"]
const LISTS: ListPath[] = ["fx.masks", "fx.filters", "layers", "groups", "paths"]
const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
export const newActionId = () => Math.random().toString(36).slice(2, 9)

const read = (o: unknown, path: string) => path.split(".").reduce<any>((a, k) => a?.[k], o)

function patchOf(a: Dict | undefined, b: Dict | undefined): Dict | null {
  const out: Dict = {}
  for (const k of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) if (!same(a?.[k], b?.[k])) out[k] = b?.[k] ?? null
  return Object.keys(out).length ? out : null
}

/** İki durum arasındaki farktan kayıt işlemleri üretir. */
export function diffItem(a: Item, b: Item): Op[] {
  const ops: Op[] = []
  for (const k of SET_FX) if (!same((a.fx as Dict)[k], (b.fx as Dict)[k])) ops.push({ t: "set", path: `fx.${k}`, value: (b.fx as Dict)[k] ?? null })
  for (const k of PATCH_FX) {
    const p = patchOf((a.fx as Dict)[k] as Dict, (b.fx as Dict)[k] as Dict)
    if (p) ops.push({ t: "patch", path: `fx.${k}`, value: p })
  }
  for (const path of LISTS) {
    const x = (read(a, path) ?? []) as ({ id: string } & Dict)[]
    const y = (read(b, path) ?? []) as ({ id: string } & Dict)[]
    const put = y.filter((n) => !same(x.find((o) => o.id === n.id), n))
    const del = x.filter((o) => !y.some((n) => n.id === o.id)).map((o) => o.id)
    const common = (l: { id: string }[], other: { id: string }[]) => l.filter((v) => other.some((w) => w.id === v.id)).map((v) => v.id)
    const moved = !same(common(x, y), common(y, x))
    if (put.length || del.length || moved) ops.push({ t: "list", path, put: put.map((n) => structuredClone(n)), del, ...(moved ? { order: y.map((n) => n.id) } : {}) })
  }
  const p = patchOf(a.geo as unknown as Dict, b.geo as unknown as Dict)
  if (p) ops.push({ t: "patch", path: "geo", value: p })
  for (const k of SET_ITEM) if (!same(a[k], b[k])) ops.push({ t: "set", path: k, value: b[k] ?? null })
  const s0 = a.paint?.strokes ?? []
  const s1 = b.paint?.strokes ?? []
  if (s1.length > s0.length) ops.push({ t: "strokes", strokes: structuredClone(s1.slice(s0.length)) })
  else if (s1.length < s0.length) ops.push({ t: "set", path: "paint", value: b.paint ?? null })
  const h0 = a.hidden ?? []
  const h1 = b.hidden ?? []
  const add = h1.filter((k) => !h0.includes(k))
  const del = h0.filter((k) => !h1.includes(k))
  if (add.length || del.length) ops.push({ t: "hide", add, del })
  return ops
}

const sig = (ops: Op[]) => JSON.stringify(ops.map((o) => (o.t === "patch" ? [o.t, o.path, Object.keys(o.value).sort()] : o.t === "list" ? [o.t, o.path, o.put.map((x) => x.id), o.del, !!o.order] : o.t === "set" ? [o.t, o.path] : [o.t, Math.random()])))

/** Yeni adım ekler. Kaydırıcı sürükleme gibi art arda aynı ayar tek adım olur, son değer kalır. */
export function addStep(steps: ActionStep[], ops: Op[]): ActionStep[] {
  const last = steps[steps.length - 1]
  if (last && sig(last.ops) === sig(ops)) {
    // listede aynı öğe: ilk kez eklendiyse sırası da korunur
    return [...steps.slice(0, -1), { ...last, ops }]
  }
  return [...steps, { id: newActionId(), ops }]
}

// ---- oynatma
const clone = <T,>(v: T): T => structuredClone(v)

function assign(item: Item, path: string, value: unknown): Item {
  if (path.startsWith("fx.")) return { ...item, fx: { ...item.fx, [path.slice(3)]: value ?? undefined } }
  return { ...item, [path]: value ?? undefined }
}

function mapIds(v: { id: string } & Dict, id: (x: string) => string) {
  const c = clone(v)
  c.id = id(c.id)
  if (typeof c.group === "string") c.group = id(c.group)
  if (typeof c.link === "string") c.link = id(c.link)
  return c
}

export type PlayCtx = { auto: (it: Item, kind: string) => Promise<unknown>; bake: (it: Item, op: "flatten" | "mergevis") => Promise<Item> }

/** Adımları bir fotoğrafa uygular; sonuç yeni Item (bir hata olursa fırlatır, fotoğraf değişmez). */
export async function playAction(start: Item, steps: ActionStep[], ctx: PlayCtx): Promise<Item> {
  let it = withBase(clone(start))
  const ids = new Map<string, string>()
  const id = (x: string) => {
    if (x === BASE_ID) return x
    if (!ids.has(x)) ids.set(x, newActionId())
    return ids.get(x)!
  }
  const hideKey = (k: string) => (k.startsWith("img:") ? `img:${id(k.slice(4))}` : k.startsWith("group:") ? `group:${id(k.slice(6))}` : k.startsWith("mask:") ? `mask:${id(k.slice(5))}` : k)
  for (const step of steps) {
    if (step.off) continue
    for (const op of step.ops) {
      if (op.t === "set") it = assign(it, op.path, clone(op.value))
      else if (op.t === "patch") {
        const base = (op.path === "geo" ? it.geo ?? legacyGeo() : read(it, op.path) ?? {}) as Dict
        const next: Dict = { ...base }
        for (const [k, v] of Object.entries(op.value)) {
          if (v === null && op.path !== "geo") delete next[k]
          else next[k] = clone(v)
        }
        it = assign(it, op.path, next)
      } else if (op.t === "list") {
        let list = [...((read(it, op.path) ?? []) as ({ id: string } & Dict)[])]
        const gone = op.del.map(id)
        list = list.filter((x) => !gone.includes(x.id))
        for (const raw of op.put) {
          const v = mapIds(raw, id)
          const i = list.findIndex((x) => x.id === v.id)
          if (i >= 0) list[i] = v
          else list.push(v)
        }
        if (op.order) {
          const rank = new Map(op.order.map((x, i) => [id(x), i]))
          list = list.map((x, i) => ({ x, r: rank.get(x.id) ?? 1e6 + i })).sort((a, b) => a.r - b.r).map((e) => e.x)
        }
        it = assign(it, op.path, list)
      } else if (op.t === "strokes") it = { ...it, paint: { strokes: [...(it.paint?.strokes ?? []), ...(clone(op.strokes) as NonNullable<Item["paint"]>["strokes"])] } }
      else if (op.t === "hide") {
        const h = new Set(it.hidden ?? [])
        op.add.forEach((k) => h.add(hideKey(k)))
        op.del.forEach((k) => h.delete(hideKey(k)))
        it = { ...it, hidden: [...h] }
      } else if (op.t === "auto") it = { ...it, fx: { ...it.fx, color: { ...it.fx.color, levels: (await ctx.auto(it, op.kind)) as NonNullable<Item["fx"]["color"]>["levels"] } } }
      else it = await ctx.bake(it, op.cmd)
      it = withBase(it)
    }
  }
  return it
}

// ---- adım adları
const NAMES: Record<string, string> = {
  "fx.preset": "Renk Görünümü", "fx.bw": "Siyah Beyaz", "fx.amount": "Görünüm Yoğunluğu", "fx.grain": "Film Greni", "fx.vignette": "Vinyet", "fx.frame": "Çerçeve", "fx.background": "Arka Plan",
  "fx.adjust": "Işık ve Renk", "fx.texture": "Efekt", "fx.retouch": "Otomatik Rötuş", geo: "Kırpma ve Dönüşüm", text: "Yazı", tone: "Yazı Tonu", accent: "Vurgu Kelimesi", styles: "Yazı Biçimi", block: "Yazıyı Taşı", offsets: "Kelimeyi Taşı",
  font: "Yazı Tipi", textFx: "Yazı Efekti", slices: "Dilimler", paint: "Boyayı Temizle",
}
const COLOR_NAMES: Record<string, string> = { levels: "Seviyeler", curves: "Eğriler", wb: "Beyaz Dengesi", bc: "Parlaklık ve Kontrast", shhi: "Gölgeler ve Parlak Alanlar", hdr: "HDR Tonlama", hue: "Ton ve Doygunluk", balance: "Renk Dengesi", grade: "Renk Derecelendirme", selective: "Seçici Renk", mixer: "Kanal Karıştırıcı", filter: "Fotoğraf Filtresi", lut: "Renk Arama", match: "Renk Eşleştirme", replace: "Rengi Değiştir", bw: "Siyah Beyaz", desat: "Doygunluğu Kaldır", gradient: "Degrade Eşleme", invert: "Tersine Çevir", posterize: "Posterleştir", threshold: "Eşik" }
const AUTO: Record<string, string> = { tone: "Otomatik Ton", contrast: "Otomatik Kontrast", color: "Otomatik Renk" }

function opName(o: Op): string {
  if (o.t === "auto") return AUTO[o.kind] ?? "Otomatik"
  if (o.t === "cmd") return o.cmd === "flatten" ? "Görüntüyü Düzleştir" : "Görünenleri Birleştir"
  if (o.t === "strokes") return `Fırça Darbesi (${o.strokes.length})`
  if (o.t === "hide") return "Görünürlük"
  if (o.t === "patch" && o.path === "fx.color") return Object.keys(o.value).map((k) => COLOR_NAMES[k] ?? "Renk Ayarı").join(", ")
  if (o.t === "list") {
    if (o.path === "fx.filters") return o.put.length ? `Filtre: ${o.put.map((f) => filterLabel(String(f.kind))).join(", ")}` : "Filtre Kaldır"
    if (o.path === "fx.masks") return o.put.some((m) => m.type === "select") ? "Seçim" : o.put.length ? "Yerel Düzenleme" : "Seçimi Kaldır"
    if (o.path === "groups") return "Grup"
    if (o.path === "paths") return "Yol"
    if (o.del.length && !o.put.length) return "Katmanı Sil"
    if (o.order && !o.put.length) return "Katman Sırası"
    return o.put.length === 1 ? `Katman: ${String(o.put[0].name ?? "")}` : "Katman Değişikliği"
  }
  return NAMES[o.path] ?? "Düzenleme"
}

export const stepLabel = (s: ActionStep) => [...new Set(s.ops.map(opName))].join(" · ")
