import { useEffect, useRef, useState } from "react"
import { ArrowLeftRight, BoxSelect, ChevronsLeft, ChevronsRight, Hand, Move, PaintBucket, Pipette, Shapes, Smile, Type, ZoomIn } from "lucide-react"
import { SELECT_TOOLS } from "@/lib/selection"
import { CROP_TOOLS } from "@/lib/crop"
import { BRUSH_TOOLS } from "@/lib/brushes"
import { RETOUCH_TOOLS } from "@/lib/retouch"
import { PEN_TOOLS } from "@/lib/paths"
import { TYPING } from "@/lib/shortcuts"
import { cn } from "@/lib/utils"

// Photoshop düzeninde sol araç kutusu: her grup tek simge, köşesindeki üçgen gruptaki diğer araçları açar.
// Harf aracı seçer, Shift+harf gruptaki sonraki araca geçer. cmd'ler App.command'a gider.
type Tool = { cmd: string; label: string; icon: typeof Move; en?: string }
type Group = { id: string; key?: string; tabs?: string[]; tools: Tool[]; sep?: boolean }

const sel = (...ids: string[]): Tool[] => ids.map((id) => {
  const t = SELECT_TOOLS.find((x) => x.id === id)!
  return { cmd: `sel:${id}`, label: t.label, en: t.en, icon: t.icon }
})
const pick = <T extends { cmd: string; label: string; en: string; icon: typeof Move }>(list: T[], ...cmds: string[]): Tool[] => cmds.map((c) => {
  const t = list.find((x) => x.cmd === c)!
  return { cmd: t.cmd, label: t.label, en: t.en, icon: t.icon }
})
const br = (...n: string[]) => pick(BRUSH_TOOLS, ...n.map((x) => `brush:tool:${x}`))
const rt = (...n: string[]) => pick(RETOUCH_TOOLS, ...n.map((x) => `retouch:tool:${x}`))

const GROUPS: Group[] = [
  { id: "move", key: "V", tabs: ["design"], tools: [{ cmd: "xf:move", label: "Taşıma Aracı", en: "Move Tool", icon: Move }, { cmd: "xf:free", label: "Serbest Dönüştür", en: "Free Transform", icon: BoxSelect }] },
  { id: "marquee", key: "M", tools: sel("rect", "ellipse", "row", "col") },
  { id: "lasso", key: "L", tools: sel("lasso", "poly", "magnetic") },
  { id: "wand", key: "W", tools: sel("object", "quick", "wand", "brush", "erase") },
  { id: "crop", key: "C", tabs: ["crop", "slice"], tools: pick(CROP_TOOLS, "tool:crop:ratio", "crop:persp", "slice:draw", "slice:select") },
  { id: "eyedrop", key: "I", sep: true, tools: [{ cmd: "tool:eyedrop", label: "Damlalık", en: "Eyedropper Tool", icon: Pipette }] },
  { id: "heal", key: "J", tools: rt("spot", "heal", "patch", "camove", "remove", "redeye") },
  { id: "brush", key: "B", tools: br("brush", "pencil", "replace", "mixer") },
  { id: "stamp", key: "S", tools: rt("clone", "patstamp") },
  { id: "history", key: "Y", tools: br("history", "arthistory") },
  { id: "eraser", key: "E", tools: br("erase", "bgerase", "magic") },
  { id: "fill", key: "G", tools: [{ cmd: "layer:new:fill", label: "Dolgu ve Degrade", en: "Fill / Gradient Layer", icon: PaintBucket }] },
  { id: "focus", key: "R", tools: rt("blur", "sharpen", "smudge") },
  { id: "tone", key: "O", tools: rt("dodge", "burn", "sponge") },
  { id: "portrait", tools: [...rt("skin", "blemish", "wrinkle", "teeth", "eye", "freq"), { cmd: "retouch:sec:skin", label: "Otomatik Cilt Rötuşu", en: "Skin Retouching", icon: Smile }] },
  { id: "pen", key: "P", sep: true, tools: PEN_TOOLS.filter((t) => t.group === "pen") },
  { id: "type", key: "T", tabs: ["text"], tools: [{ cmd: "tool:text", label: "Yazı Aracı", en: "Type Tool", icon: Type }, { cmd: "layer:new:text", label: "Metin Katmanı", en: "Text Layer", icon: Type }] },
  { id: "pathsel", key: "A", tools: PEN_TOOLS.filter((t) => t.group === "select") },
  { id: "shape", key: "U", tools: [{ cmd: "layer:new:shape", label: "Şekil Aracı", en: "Shape Tool", icon: Shapes }] },
  { id: "hand", key: "H", sep: true, tools: [{ cmd: "tool:hand", label: "El Aracı", en: "Hand Tool", icon: Hand }] },
  { id: "zoom", key: "Z", tools: [{ cmd: "tool:zoom", label: "Yakınlaştırma", en: "Zoom Tool", icon: ZoomIn }] },
]

type Props = {
  active: string // açık sekme
  current: string // etkin aracın komutu
  onCommand: (cmd: string) => void
  fg: string
  bg: string
  setFg: (c: string) => void
  setBg: (c: string) => void
}

export function ToolBox({ active, current, onCommand, fg, bg, setFg, setBg }: Props) {
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

  // menüden seçilen araç da grubun simgesine yansısın
  const shown = (g: Group) => {
    const i = g.tools.findIndex((t) => t.cmd === current)
    return i >= 0 ? i : chosen[g.id] ?? 0
  }
  const run = (g: Group, i: number) => {
    setChosen((c) => ({ ...c, [g.id]: i }))
    window.clearTimeout(timer.current) // bekleyen açılma, tıklamadan sonra listeyi yeniden açmasın
    setFly(null)
    onCommand(g.tools[i].cmd)
  }
  const runRef = useRef({ run, shown })
  runRef.current = { run, shown }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || TYPING(e.target) || document.querySelector("[role=dialog]") || !e.code.startsWith("Key")) return
      const g = GROUPS.find((x) => x.key === e.code.slice(3))
      if (!g) return
      e.preventDefault()
      const at = runRef.current.shown(g)
      runRef.current.run(g, e.shiftKey ? (at + 1) % g.tools.length : at)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const open = (id: string | null, delay = 0) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setFly(id), delay)
  }

  return (
    <nav className="relative z-40 flex shrink-0 flex-col items-center border-r bg-card py-1" aria-label="Araçlar">
      <button onClick={() => setWide((w) => !w)} title={wide ? "Tek sütun" : "İki sütun"} aria-label={wide ? "Tek sütun" : "İki sütun"} className="mb-0.5 flex h-3.5 w-full items-center justify-center text-muted-foreground hover:text-foreground">
        {wide ? <ChevronsLeft className="h-3 w-3" /> : <ChevronsRight className="h-3 w-3" />}
      </button>
      <div className={cn("grid gap-px px-1", wide ? "grid-cols-2" : "grid-cols-1")}>
        {GROUPS.map((g) => {
          const at = shown(g)
          const t = g.tools[at]
          const Icon = t.icon
          const on = g.tools.some((x) => x.cmd === current) || !!g.tabs?.includes(active)
          return (
            <div key={g.id} className={cn("relative", g.sep && !wide && "mt-1 border-t pt-1")} onPointerEnter={() => g.tools.length > 1 && open(g.id, 350)} onPointerLeave={() => open(null, 150)}>
              <button
                onClick={() => run(g, at)}
                onContextMenu={(e) => {
                  if (g.tools.length < 2) return
                  e.preventDefault()
                  open(g.id)
                }}
                title={`${t.label}${g.key ? ` (${g.key})` : ""}${t.en ? ` · ${t.en}` : ""}`}
                aria-label={t.label}
                aria-pressed={on}
                className={cn("relative grid h-[26px] w-[30px] place-items-center rounded-sm transition-colors", on ? "bg-primary/25 text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
              >
                <Icon className="h-4 w-4" strokeWidth={1.8} />
                {g.tools.length > 1 && <span className="absolute bottom-[2px] right-[2px] h-0 w-0 opacity-70" style={{ borderStyle: "solid", borderWidth: "0 0 4px 4px", borderColor: "transparent transparent currentColor transparent" }} />}
              </button>
              {fly === g.id && (
                <div
                  ref={(el) => {
                    if (!el) return // uzun liste ekrandan taşmasın
                    el.style.top = "0px"
                    const over = el.getBoundingClientRect().bottom - (window.innerHeight - 8)
                    if (over > 0) el.style.top = `${-over}px`
                  }}
                  className="absolute left-full top-0 z-50 ml-1 min-w-[230px] rounded-md border bg-popover p-1 text-[12px] shadow-xl"
                  onPointerEnter={() => open(g.id)}
                  onPointerLeave={() => open(null, 150)}
                  role="menu"
                >
                  {g.tools.map((x, i) => {
                    const I = x.icon
                    return (
                      <button key={x.cmd} role="menuitem" title={x.en} onClick={() => run(g, i)} className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left hover:bg-accent">
                        <span className="w-2 text-[9px] text-primary">{at === i ? "■" : ""}</span>
                        <I className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
                        <span className="flex-1 whitespace-nowrap">{x.label}</span>
                        {g.key && <span className="text-[10px] text-muted-foreground">{g.key}</span>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="relative mt-2 h-9 w-9 shrink-0">
        <label title="Arka Plan Rengi" className="absolute bottom-0 right-0 h-5 w-5 cursor-pointer rounded-sm border border-foreground/40" style={{ background: bg }}>
          <input aria-label="Arka plan rengi" type="color" className="absolute inset-0 cursor-pointer opacity-0" value={bg} onChange={(e) => setBg(e.target.value.toUpperCase())} />
        </label>
        <label title="Ön Plan Rengi" className="absolute left-0 top-0 h-5 w-5 cursor-pointer rounded-sm border border-foreground/40" style={{ background: fg }}>
          <input aria-label="Ön plan rengi" type="color" className="absolute inset-0 cursor-pointer opacity-0" value={fg} onChange={(e) => setFg(e.target.value.toUpperCase())} />
        </label>
        <button aria-label="Renkleri değiştir" title="Renkleri Değiştir (X)" onClick={() => onCommand("color:swap")} className="absolute right-0 top-0 text-muted-foreground hover:text-foreground"><ArrowLeftRight className="h-2.5 w-2.5" /></button>
        <button aria-label="Varsayılan renkler" title="Varsayılan Renkler (D)" onClick={() => onCommand("color:reset")} className="absolute bottom-0 left-0 h-2.5 w-2.5 border border-foreground/40" style={{ background: "linear-gradient(135deg,#000 50%,#fff 50%)" }} />
      </div>
    </nav>
  )
}
