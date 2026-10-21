import type { Offsets, Style } from "@/types"

export const words = (t: string): string[] => t.split(/\s+/).filter(Boolean)

/** Metin değişince kelime stillerini ve konumlarını aynı kelimelere bağlı tut (önek/sonek eşleştirme). */
export function remap(oldW: string[], newW: string[], styles: Style[], offsets: Offsets) {
  let p = 0
  while (p < oldW.length && p < newW.length && oldW[p] === newW[p]) p++
  let s = 0
  while (s < oldW.length - p && s < newW.length - p && oldW[oldW.length - 1 - s] === newW[newW.length - 1 - s]) s++

  const ns: Style[] = newW.map(() => ({}))
  const no: Offsets = {}
  for (let i = 0; i < p; i++) {
    ns[i] = styles[i] ?? {}
    if (offsets[i]) no[i] = offsets[i]
  }
  for (let i = 0; i < s; i++) {
    const o = oldW.length - 1 - i
    const n = newW.length - 1 - i
    ns[n] = styles[o] ?? {}
    if (offsets[o]) no[n] = offsets[o]
  }
  const mo = oldW.length - p - s
  const mn = newW.length - p - s
  if (mo >= 1 && mn >= 1) {
    for (let k = 0; k < mn; k++) {
      ns[p + k] = styles[p] ?? {}
      if (k === 0 && offsets[p]) no[p] = offsets[p]
    }
  }
  return { styles: ns, offsets: no }
}

export function mergeStyle(s: Style, patch: Partial<Style>): Style {
  const out: any = { ...s }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null || (k === "size" && v === 1) || (k === "italic" && v === false)) delete out[k]
    else out[k] = v
  }
  return out
}

export type Common = {
  color: string | undefined | "*"
  weight: string | undefined | "*"
  italic: boolean | "*"
  size: number | "*"
}

export function commonStyle(styles: Style[], idxs: number[]): Common {
  const pick = <T,>(f: (s: Style) => T): T | "*" => {
    const vals = idxs.map((i) => f(styles[i] ?? {}))
    return vals.every((v) => v === vals[0]) ? vals[0] : "*"
  }
  return {
    color: pick((s) => s.color),
    weight: pick((s) => s.weight),
    italic: pick((s) => !!s.italic),
    size: pick((s) => s.size ?? 1),
  }
}

export const naturalSort = (a: File, b: File) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })

export const todayPlus = (days: number) => {
  const d = new Date(Date.now() + days * 864e5)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function addDays(start: string, n: number) {
  const [y, m, d] = start.split("-").map(Number)
  const dt = new Date(y, (m || 1) - 1, d || 1)
  dt.setDate(dt.getDate() + n)
  return dt.toLocaleDateString("tr-TR", { day: "numeric", month: "short", weekday: "short" })
}
