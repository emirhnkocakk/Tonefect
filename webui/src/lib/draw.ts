import { Blend, Circle, CircleDot, Hexagon, Minus, PaintBucket, RectangleHorizontal, Square, Star, Triangle } from "lucide-react"

// Tuvalde sürükleyerek çizilen araçlar: şekiller (U), degrade ve boya kovası (G). Araç kutusu ve menü aynı listeyi kullanır.
export type DrawTool = "rect" | "round" | "ellipse" | "triangle" | "polygon" | "star" | "line" | "gradient" | "radial" | "bucket"
export type DrawEntry = { id: DrawTool; cmd: string; label: string; en: string; icon: typeof Square; group: "shape" | "fill"; hint: string }

const S = "Sürükleyerek çiz. Shift: eşit kenar. Renk ön plan renginden gelir."
const add = (id: DrawTool, label: string, en: string, icon: typeof Square, group: "shape" | "fill", hint = S): DrawEntry => ({ id, cmd: `draw:${id}`, label, en, icon, group, hint })

export const DRAW_TOOLS: DrawEntry[] = [
  add("rect", "Dikdörtgen Aracı", "Rectangle Tool", Square, "shape"),
  add("round", "Yuvarlak Köşeli Dikdörtgen", "Rounded Rectangle Tool", RectangleHorizontal, "shape"),
  add("ellipse", "Elips Aracı", "Ellipse Tool", Circle, "shape"),
  add("triangle", "Üçgen Aracı", "Triangle Tool", Triangle, "shape"),
  add("polygon", "Çokgen Aracı", "Polygon Tool", Hexagon, "shape"),
  add("star", "Yıldız Aracı", "Custom Shape Tool", Star, "shape"),
  add("line", "Çizgi Aracı", "Line Tool", Minus, "shape", "Sürükleyerek çiz. Shift: 45° açılara oturur."),
  add("gradient", "Degrade Aracı", "Gradient Tool", Blend, "fill", "Sürükle: başladığın yer ön plan, bıraktığın yer arka plan rengi olur. Shift: 45° açılar."),
  add("radial", "Dairesel Degrade", "Radial Gradient", CircleDot, "fill", "Merkezden dışarı sürükle: merkez ön plan, kenar arka plan rengi olur."),
  add("bucket", "Boya Kovası", "Paint Bucket Tool", PaintBucket, "fill", "Tıkla: benzer renkteki alan ön plan rengiyle dolar ve ayrı bir nesne olur."),
]
export const drawEntry = (id: DrawTool) => DRAW_TOOLS.find((t) => t.id === id)!
export const SHAPE_TYPE: Record<string, [string, number]> = { rect: ["rect", 0], round: ["rect", 0.3], ellipse: ["ellipse", 0], triangle: ["triangle", 0], polygon: ["hexagon", 0], star: ["star", 0] }
