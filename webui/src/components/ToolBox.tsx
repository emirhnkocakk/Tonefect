import { useEffect, useRef, useState } from "react"
import {
  ChevronsLeft, ChevronsRight, Circle, Crop, Expand, Frame, Image as ImageIcon, ImagePlus, Move, Palette, RotateCw, Scaling,
  Scissors, SlidersHorizontal, Sparkles, Spline, SquareSplitVertical, Type, User, Wand2,
} from "lucide-react"
import { cn } from "@/lib/utils"

// Photoshop'taki gibi sol araç kutusu: küçük simgeler; grubu olan aracın köşesinde üçgen var,
// üzerine gelince (ya da sağ tıklayınca) gruptaki diğer araçlar açılır. cmd'ler App.command'a gider.
type Tool = { cmd: string; label: string; icon: typeof Move; key?: string }
type Group = { id: string; tab: string; tools: Tool[] }

const GROUPS: Group[] = [
  { id: "move", tab: "design", tools: [{ cmd: "tool:design", label: "Taşı ve katmanlar", icon: Move, key: "V" }] },
  { id: "select", tab: "local", tools: [
    { cmd: "mask:select", label: "Akıllı seçim", icon: Wand2, key: "W" },
    { cmd: "mask:subject", label: "Konuyu seç (yapay zekâ)", icon: User },
    { cmd: "mask:background", label: "Arka planı seç (yapay zekâ)", icon: ImageIcon },
    { cmd: "mask:linear", label: "Degrade maske", icon: SquareSplitVertical },
    { cmd: "mask:radial", label: "Daire maske", icon: Circle },
  ] },
  { id: "crop", tab: "crop", tools: [
    { cmd: "tool:crop:ratio", label: "Kırp", icon: Crop, key: "C" },
    { cmd: "tool:crop:persp", label: "Perspektif kırpma", icon: Spline },
    { cmd: "tool:crop:straighten", label: "Eğim düzelt", icon: RotateCw },
    { cmd: "tool:crop:size", label: "Görüntü boyutu", icon: Scaling },
    { cmd: "tool:crop:canvas", label: "Tuval boyutu", icon: Expand },
  ] },
  { id: "color", tab: "color", tools: [
    { cmd: "tool:color:library", label: "Renk görünümleri", icon: Palette },
    { cmd: "tool:color:adjust", label: "Işık ve renk", icon: SlidersHorizontal },
  ] },
  { id: "fx", tab: "fx", tools: [
    { cmd: "tool:fx:effects", label: "Efektler", icon: Sparkles },
    { cmd: "tool:fx:background", label: "Arka plan (yapay zekâ)", icon: Scissors },
  ] },
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
    setChosen((c) => ({ ...c, [g.id]: i }))
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
          const Icon = t.icon
          const on = !!g.tab && g.tab === active
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
                title={`${t.label}${t.key ? ` (${t.key})` : ""}`}
                aria-label={t.label}
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
                  className="absolute left-full top-0 z-50 ml-1.5 min-w-[210px] rounded-lg border bg-popover p-1 text-[12px] shadow-xl"
                  onPointerEnter={() => open(g.id)}
                  onPointerLeave={() => open(null, 150)}
                  role="menu"
                >
                  {g.tools.map((x, i) => {
                    const I = x.icon
                    return (
                      <button key={x.cmd} role="menuitem" onClick={() => run(g, i)} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent">
                        <span className="w-2 text-primary">{(chosen[g.id] ?? 0) === i ? "■" : ""}</span>
                        <I className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
                        <span className="flex-1 whitespace-nowrap">{x.label}</span>
                        {x.key && <span className="text-[10px] text-muted-foreground">{x.key}</span>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </nav>
  )
}
