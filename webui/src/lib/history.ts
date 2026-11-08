import type { Item } from "@/types"

const FX_NAMES: [string, string][] = [
  ["filters", "Filtre"], ["color", "Renk Ayarı"], ["adjust", "Işık ve Renk"], ["preset", "Renk Görünümü"], ["bw", "Siyah Beyaz"], ["retouch", "Rötuş"],
  ["masks", "Seçim"], ["frame", "Çerçeve"], ["background", "Arka Plan"], ["texture", "Efekt"], ["grain", "Grenli Efekt"], ["vignette", "Vinyet"],
]
const ITEM_NAMES: [keyof Item, string][] = [["paint", "Fırça Darbesi"], ["text", "Yazı"], ["styles", "Yazı Biçimi"], ["block", "Yazıyı Taşıma"], ["offsets", "Yazıyı Taşıma"], ["geo", "Kırpma ve Dönüşüm"], ["hidden", "Görünürlük"], ["slices", "Dilim"], ["layers", "Katman Değişikliği"]]
const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

/** İki geçmiş adımı arasındaki farktan Geçmiş panelindeki adı üretir. */
export function stepName(a: Item[], b: Item[]): string {
  if (b.length > a.length) return "Fotoğraf Ekleme"
  if (b.length < a.length) return "Fotoğraf Kaldırma"
  for (const it of b) {
    const old = a.find((x) => x.id === it.id)
    if (!old) return "Görüntüyü Birleştirme"
    if (old === it) continue
    if (old.fx !== it.fx) for (const [k, n] of FX_NAMES) if (!same((old.fx as Record<string, unknown>)[k], (it.fx as Record<string, unknown>)[k])) return n
    for (const [k, n] of ITEM_NAMES) if (!same(old[k], it[k])) return n
  }
  return "Düzenleme"
}
