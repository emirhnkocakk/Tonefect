import { api } from "@/lib/api"
import type { ColorMode, ExportOpts, Item } from "@/types"

// render.COLOR_MODES ile aynı: renk modu -> kaydedebilen biçimler (ilki varsayılan)
export const COLOR_FORMATS: Record<ColorMode, ExportOpts["format"][]> = {
  rgb: ["jpg", "png", "webp", "tiff"], gray: ["jpg", "png", "tiff"], cmyk: ["jpg", "tiff"],
  bitmap: ["png", "tiff"], indexed: ["png", "tiff"], lab: ["tiff"],
}

// Farklı kaydet / kopya kaydet: dosyayı kullanıcının seçtiği yere yazar (Windows'un kaydetme penceresi).
const TYPES: Record<ExportOpts["format"], { description: string; accept: Record<string, string[]> }> = {
  jpg: { description: "JPEG", accept: { "image/jpeg": [".jpg", ".jpeg"] } },
  png: { description: "PNG", accept: { "image/png": [".png"] } },
  webp: { description: "WebP", accept: { "image/webp": [".webp"] } },
  tiff: { description: "TIFF", accept: { "image/tiff": [".tif", ".tiff"] } },
}
const EXT: Record<string, ExportOpts["format"]> = { jpg: "jpg", jpeg: "jpg", png: "png", webp: "webp", tif: "tiff", tiff: "tiff" }

/** true: kaydedildi, false: vazgeçildi. formats: seçilebilecek biçimler (ilki önerilen). */
export async function saveAs(item: Item, ex: ExportOpts, formats: ExportOpts["format"][], copy = false): Promise<string | false> {
  const stem = item.name.replace(/\.[^.]+$/, "") + (copy ? " kopya" : "")
  const order = [ex.format, ...formats.filter((f) => f !== ex.format)]
  const picker = (window as any).showSaveFilePicker
  if (picker) {
    let handle: any
    try {
      // kullanıcı hareketi bitmeden pencere açılmalı; bu yüzden önce sorulur, sonra çizilir
      handle = await picker({ suggestedName: `${stem}.${ex.format === "tiff" ? "tif" : ex.format}`, types: order.map((f) => TYPES[f]), excludeAcceptAllOption: true })
    } catch (e: any) {
      if (e?.name === "AbortError") return false
      throw e
    }
    const format = EXT[handle.name.split(".").pop()?.toLowerCase() ?? ""] ?? ex.format
    const blob = await api.renderFile({ item, export: { ...ex, format } })
    const w = await handle.createWritable()
    await w.write(blob)
    await w.close()
    return handle.name
  }
  // pencere desteklenmiyorsa indirme olarak kaydet
  const blob = await api.renderFile({ item, export: ex })
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = `${stem}.${ex.format}`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  return a.download
}
