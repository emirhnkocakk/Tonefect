import { useEffect, useRef, useState } from "react"
import {
  ChevronsLeft, ChevronsRight, Circle, Crop, Eraser, Frame, ImagePlus, Move, Paintbrush, Palette,
  Scissors, SlidersHorizontal, Sparkles, SquareDashed, SquareSplitVertical, Type,
} from "lucide-react"
import { SELECT_TOOLS } from "@/lib/selection"
import { CROP_TOOLS } from "@/lib/crop"
import { XFORM_TOOLS } from "@/lib/transform"
import { BRUSH_TOOLS } from "@/lib/brushes"
import { ERASE_TOOLS } from "@/lib/erase"
import { RETOUCH_ICON, RETOUCH_TOOLS } from "@/lib/retouch"
import { COLOR_TOOLS } from "@/lib/color"
import { FILTER_TOOLS, FX_ICON } from "@/lib/filters"
import { cn } from "@/lib/utils"

// Photoshop'taki gibi sol araç kutusu: küçük simgeler; grubu olan aracın köşesinde üçgen var,
// üzerine gelince (ya da sağ tıklayınca) gruptaki diğer araçlar açılır. cmd'ler App.command'a gider.
// sticky: false -> tek seferlik komut; simgeye sonraki tıklama onu tekrarlamaz. head: açılır listedeki başlık.
type Tool = { cmd: string; label: string; icon: typeof Move; key?: string; en?: string; head?: string; sticky?: boolean }
type Group = { id: string; tab: string; also?: string; tools: Tool[]; label?: string; icon?: typeof Move }

const GROUPS: Group[] = [
  { id: "move", tab: "design", label: "Taşıma ve Dönüştürme", icon: Move, tools: XFORM_TOOLS.map((t) => ({ cmd: t.cmd, label: t.label, en: t.en, icon: t.icon, key: t.key, head: t.section, sticky: !!t.mode })) },
  { id: "select", tab: "select", label: "Selection Tool", icon: SquareDashed, tools: SELECT_TOOLS.map((t) => ({ cmd: `sel:${t.id}`, label: t.label, en: t.en, icon: t.icon, key: t.key, head: t.section, sticky: !!t.draw })) },
  { id: "brush", tab: "brush", label: "Fırça ve Çizim", icon: Paintbrush, tools: BRUSH_TOOLS.map((t) => ({ cmd: t.cmd, label: t.label, en: t.en, icon: t.icon, key: t.key, head: t.section, sticky: !!t.tool })) },
  { id: "erase", tab: "erase", label: "Silme ve Arka Plan", icon: Eraser, tools: ERASE_TOOLS.map((t) => ({ cmd: t.cmd, label: t.label, en: t.en, icon: t.icon, key: t.key, head: t.section, sticky: false })) },
  { id: "retouch", tab: "retouch", label: "Rötuş ve Onarım", icon: RETOUCH_ICON, tools: RETOUCH_TOOLS.map((t) => ({ cmd: t.cmd, label: t.label, en: t.en, icon: t.icon, key: t.key, head: t.section, sticky: !!t.tool })) },
  { id: "local", tab: "local", tools: [
    { cmd: "mask:linear", label: "Degrade maske", icon: SquareSplitVertical },
    { cmd: "mask:radial", label: "Daire maske", icon: Circle },
  ] },
  { id: "crop", tab: "crop", also: "slice", label: "Kırpma ve Dilimleme", icon: Crop, tools: CROP_TOOLS.map((t) => ({ cmd: t.cmd, label: t.label, en: t.en, icon: t.icon, key: t.key, head: t.section })) },
  { id: "color", tab: "color", label: "Renk ve Işık", icon: Palette, tools: COLOR_TOOLS.map((t) => ({ cmd: t.cmd, label: t.label, en: t.en, icon: t.icon, head: t.section, sticky: false })) },
  { id: "fx", tab: "fx", label: "Efekt ve Filtreler", icon: FX_ICON, tools: [{ cmd: "filter:gallery", label: "Filtre Galerisi", en: "Filter Gallery", icon: FX_ICON, head: "Galeri", sticky: false }, ...FILTER_TOOLS.filter((t) => t.cmd !== "filter:gallery").map((t) => ({ cmd: t.cmd, label: t.label, en: t.en, icon: t.icon, head: t.section, sticky: false }))] },
  { id: "frame", tab: "frame", tools: [{ cmd: "tool:frame", label: "Çerçeve", icon: Frame }] },
  { id: "text", tab: "text", tools: [{ cmd: "tool:text", label: "Metin", icon: Type, key: "T" }] },
  { id: "image", tab: "", tools: [{ cmd: "addImage", label: "Görsel ekle", icon: ImagePlus }] },
]

type Props = { active: string; onCommand: (cmd: string) => void }

export function ToolBox({ active, onCommand }: Props) {
  const [wide, setWide] = useState(() => {
    try {
      return localStorage.getItem("toolbox-wide") === "1"
    } catch {
      return false
    }
  })
  const [chosen, setChosen] = useState<Record<string, number>>({}) // grupta en son seçilen araç
  const [fly, setFly] = useState<string | null>(null)
  const timer = useRef<number>()
  useEffect(() => {
    try {
      localStorage.setItem("toolbox-wide", wide ? "1" : "0")
    } catch {
      /* tarayıcı depolaması kapalı olabilir */
    }
  }, [wide])

  function run(g: Group, i: number) {
    if (g.tools[i].sticky !== false) setChosen((c) => ({ ...c, [g.id]: i }))
    window.clearTimeout(timer.current) // bekleyen açılma, tıklamadan sonra listeyi yeniden açmasın
    setFly(null)
    onCommand(g.tools[i].cmd)
  }
  // tek tuş kısayolları (yazı alanında değilken): V taşı, W seçim, C kırp, T metin
  const runRef = useRef(run)
  runRef.current = run
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return
      for (const g of GROUPS) {
        const i = g.tools.findIndex((t) => t.key && t.key.toLowerCase() === e.key.toLowerCase())
        if (i >= 0) {
          e.preventDefault()
          runRef.current(g, i)
          return
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const open = (id: string | null, delay = 0) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setFly(id), delay)
  }

  const item = (g: Group, x: Tool, i: number) => {
    const I = x.icon
    return (
      <button key={x.cmd} role="menuitem" title={x.en} onClick={() => run(g, i)} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1 text-left hover:bg-accent">
        <span className="w-2 text-primary">{x.sticky !== false && (chosen[g.id] ?? 0) === i ? "■" : ""}</span>
        <I className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
        <span className="flex-1 whitespace-nowrap">{x.label}</span>
        {x.key && <span className="text-[10px] text-muted-foreground">{x.key}</span>}
      </button>
    )
  }

  return (
    <nav className="relative z-40 flex shrink-0 flex-col items-center border-r bg-card/70 py-1.5" aria-label="Araçlar">
      <button
        onClick={() => setWide((w) => !w)}
        title={wide ? "Tek sütun" : "İki sütun"}
        aria-label={wide ? "Tek sütun" : "İki sütun"}
        className="mb-1 flex h-4 w-full items-center justify-center text-muted-foreground hover:text-foreground"
      >
        {wide ? <ChevronsLeft className="h-3 w-3" /> : <ChevronsRight className="h-3 w-3" />}
      </button>
      <div className={cn("grid gap-0.5 px-1", wide ? "grid-cols-2" : "grid-cols-1")}>
        {GROUPS.map((g) => {
          const t = g.tools[chosen[g.id] ?? 0]
          const Icon = g.icon ?? t.icon
          const name = g.label ?? t.label
          const on = !!g.tab && (g.tab === active || g.also === active)
          return (
            <div
              key={g.id}
              className="relative"
              onPointerEnter={() => g.tools.length > 1 && open(g.id, 350)}
              onPointerLeave={() => open(null, 150)}
            >
              <button
                onClick={() => run(g, chosen[g.id] ?? 0)}
                onContextMenu={(e) => {
                  if (g.tools.length < 2) return
                  e.preventDefault()
                  open(g.id)
                }}
                title={g.label ?? `${t.label}${t.key ? ` (${t.key})` : ""}`}
                aria-label={name}
                aria-pressed={on}
                className={cn(
                  "relative grid h-8 w-8 place-items-center rounded-md transition-colors",
                  on ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <Icon className="h-[17px] w-[17px]" strokeWidth={1.8} />
                {g.tools.length > 1 && (
                  <span className="absolute bottom-[3px] right-[3px] h-0 w-0 opacity-70" style={{ borderStyle: "solid", borderWidth: "0 0 4px 4px", borderColor: "transparent transparent currentColor transparent" }} />
                )}
              </button>
              {fly === g.id && (
                <div
                  ref={(el) => {
                    // uzun liste ekrandan taşmasın
                    if (!el) return
                    el.style.top = "0px"
                    const over = el.getBoundingClientRect().bottom - (window.innerHeight - 8)
                    if (over > 0) el.style.top = `${-over}px`
                  }}
                  className={cn("absolute left-full top-0 z-50 ml-1.5 rounded-lg border bg-popover p-1 text-[12px] shadow-xl", g.tools.length > 48 ? "w-[900px]" : g.tools.length > 28 ? "w-[680px]" : g.tools.length > 16 ? "w-[452px]" : "min-w-[230px]")}
                  onPointerEnter={() => open(g.id)}
                  onPointerLeave={() => open(null, 150)}
                  role="menu"
                >
                  {g.label && <p className="px-2 pb-0.5 pt-1 text-[10px] font-semibold tracking-wider text-muted-foreground">{g.label}</p>}
                  {g.tools.some((x) => x.head) ? (
                    <div className={g.tools.length > 48 ? "columns-4 gap-1" : g.tools.length > 28 ? "columns-3 gap-1" : g.tools.length > 16 ? "columns-2 gap-1" : undefined}>
                      {[...new Set(g.tools.map((x) => x.head))].map((sec) => (
                        <div key={sec} className="break-inside-avoid">
                          <p className="px-2 pb-0.5 pt-1.5 text-[10px] text-muted-foreground/80">{sec}</p>
                          {g.tools.map((x, i) => x.head === sec && item(g, x, i))}
                        </div>
                      ))}
                    </div>
                  ) : (
                    g.tools.map((x, i) => item(g, x, i))
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </nav>
  )
}
