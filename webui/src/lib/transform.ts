import {
  AlignHorizontalDistributeCenter, AlignStartVertical, Blend, Box, BoxSelect, Grip, Layers2, Maximize2, Move, Pin, Repeat, RotateCw, Scan, SquareStack, Waves, WandSparkles,
} from "lucide-react"
import type { ImgLayer, XformMode } from "@/types"

// Taşıma ve Dönüştürme kategorisi: sol araç kutusu, üst menü ve panel aynı listeyi kullanır.
export type XformEntry = { cmd: string; label: string; en: string; section: string; icon: typeof Move; key?: string; mode?: XformMode; hint?: string }

export const XFORM_TOOLS: XformEntry[] = [
  { cmd: "xf:move", label: "Taşı", en: "Move", section: "Taşıma", icon: Move, key: "V", mode: "move", hint: "Sürükleyerek taşı, köşeden büyüt, üstteki noktayla döndür. Shift+tıkla: çoklu seç." },
  { cmd: "xf:camove", label: "İçeriğe Duyarlı Taşıma", en: "Content-Aware Move", section: "Taşıma", icon: WandSparkles },
  { cmd: "xf:free", label: "Serbest Dönüştür", en: "Free Transform", section: "Dönüştür", icon: BoxSelect, key: "F", mode: "free", hint: "Köşe: ölçekle (Shift: oran serbest), kenar: tek yönde ölçekle, nokta: döndür. Ctrl+köşe bozar, Ctrl+kenar eğer." },
  { cmd: "xf:scale", label: "Ölçekle", en: "Scale", section: "Dönüştür", icon: Maximize2, mode: "scale", hint: "Köşeden orantılı (Shift: serbest), kenardan tek yönde ölçekle." },
  { cmd: "xf:rotate", label: "Döndür", en: "Rotate", section: "Dönüştür", icon: RotateCw, mode: "rotate", hint: "Köşelerden ya da üstteki noktadan sürükleyerek döndür." },
  { cmd: "xf:skew", label: "Eğ", en: "Skew", section: "Dönüştür", icon: Scan, mode: "skew", hint: "Kenar tutamacını kenar boyunca kaydır." },
  { cmd: "xf:distort", label: "Boz", en: "Distort", section: "Dönüştür", icon: Box, mode: "distort", hint: "Her köşeyi serbestçe sürükle." },
  { cmd: "xf:perspective", label: "Perspektif", en: "Perspective", section: "Dönüştür", icon: Layers2, mode: "perspective", hint: "Bir köşeyi sürükle: karşısındaki köşe ters yönde hareket eder." },
  { cmd: "xf:warp", label: "Çarpıt", en: "Warp", section: "Çarpıt", icon: Waves, mode: "warp", hint: "Izgaradaki noktaları sürükleyerek görseli bük." },
  { cmd: "xf:puppet", label: "Kukla Çarpıtma", en: "Puppet Warp", section: "Çarpıt", icon: Pin, mode: "puppet", hint: "Görsele tıklayıp pim koy, pimi sürükle; diğer pimler yerinde kalır. Alt+tıkla: pimi sil." },
  { cmd: "xf:pwarp", label: "Perspektif Çarpıtma", en: "Perspective Warp", section: "Çarpıt", icon: Grip, mode: "pwarp", hint: "İki düzlem vardır; altı noktayı sürükleyerek her düzlemin perspektifini ayrı ayarla." },
  { cmd: "tool:design:align", label: "Katmanları Hizala", en: "Align Layers", section: "Hizala", icon: AlignStartVertical },
  { cmd: "tool:design:align2", label: "Katmanları Dağıt", en: "Distribute Layers", section: "Hizala", icon: AlignHorizontalDistributeCenter },
  { cmd: "design:autoalign", label: "Otomatik Hizala", en: "Auto-Align Layers", section: "Hizala", icon: SquareStack },
  { cmd: "design:autoblend", label: "Otomatik Harmanla", en: "Auto-Blend Layers", section: "Hizala", icon: Blend },
  { cmd: "design:again", label: "Dönüşümü Tekrarla", en: "Transform Again", section: "Tekrarla", icon: Repeat, key: "A" },
]

export const XFORM_SECTIONS = [...new Set(XFORM_TOOLS.map((t) => t.section))]
export const XFORM_MODES = XFORM_TOOLS.filter((t) => t.mode)

// Dönüşümü Tekrarla: son hareketin farkı
export type XformDelta = { dx: number; dy: number; sw: number; ssy: number; drot: number; dcorners?: [number, number][]; warp?: [number, number][]; pwarp?: [number, number][] }
const ZERO: [number, number][] = [[0, 0], [0, 0], [0, 0], [0, 0]]

export function xformDelta(a: ImgLayer, b: ImgLayer): XformDelta {
  const ca = a.corners ?? ZERO
  const cb = b.corners ?? ZERO
  return {
    dx: b.x - a.x, dy: b.y - a.y, sw: b.w / a.w, ssy: (b.sy ?? 1) / (a.sy ?? 1), drot: b.rot - a.rot,
    dcorners: cb.map((p, i) => [p[0] - ca[i][0], p[1] - ca[i][1]] as [number, number]),
    warp: b.warp !== a.warp ? b.warp ?? undefined : undefined,
    pwarp: b.pwarp !== a.pwarp ? b.pwarp ?? undefined : undefined,
  }
}

export function applyDelta(l: ImgLayer, d: XformDelta): ImgLayer {
  const c = l.corners ?? ZERO
  const corners = d.dcorners?.some((p) => p[0] || p[1]) ? c.map((p, i) => [p[0] + d.dcorners![i][0], p[1] + d.dcorners![i][1]] as [number, number]) : l.corners
  return {
    ...l, x: l.x + d.dx, y: l.y + d.dy, w: Math.max(0.02, Math.min(5, l.w * d.sw)), sy: Math.max(0.02, Math.min(20, (l.sy ?? 1) * d.ssy)),
    rot: Math.round((((l.rot + d.drot + 540) % 360) - 180) * 10) / 10, corners, warp: d.warp ?? l.warp, pwarp: d.pwarp ?? l.pwarp,
  }
}
