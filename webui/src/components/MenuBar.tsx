import { useEffect, useRef, useState } from "react"
import { Check, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

// Photoshop'taki gibi üstte kategorili menüler. Her öğe bir komut (App yürütür):
// "tool:<sekme>[:<bölüm>]" ilgili paneli açar ve o bölüme kaydırır; diğerleri doğrudan işlem.
type Leaf = { label: string; cmd: string; key?: string; title?: string; disabled?: boolean; checked?: boolean }
export type MenuItem = Leaf | { label: string; children: (Leaf | "sep")[] } | "sep"
export type Menu = { label: string; items: MenuItem[] }

type Props = { menus: Menu[]; onCommand: (cmd: string) => void }

export function MenuBar({ menus, onCommand }: Props) {
  const [open, setOpenRaw] = useState<number | null>(null)
  const [child, setChild] = useState<{ label: string; items: (Leaf | "sep")[]; x: number; y: number } | null>(null)
  const setOpen = (v: number | null) => {
    setChild(null)
    setOpenRaw(v)
  }
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open === null) return
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(null)
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null)
    window.addEventListener("pointerdown", close)
    window.addEventListener("keydown", esc)
    return () => {
      window.removeEventListener("pointerdown", close)
      window.removeEventListener("keydown", esc)
    }
  }, [open])

  return (
    <div ref={ref} className="flex items-center" role="menubar">
      {menus.map((m, i) => {
        return (
          <div key={m.label} className="relative">
            <button
              role="menuitem"
              onClick={() => setOpen(open === i ? null : i)}
              onPointerEnter={() => open !== null && setOpen(i)}
              className={cn(
                "rounded px-2 py-0.5 text-[12px] transition-colors",
                open === i ? "bg-accent text-foreground" : "text-foreground/85 hover:bg-accent/60"
              )}
            >
              {m.label}
            </button>
            {open === i && (
              <div className="absolute left-0 top-7 z-50 max-h-[calc(100vh-64px)] min-w-[220px] overflow-y-auto rounded-lg border bg-popover p-1 text-[12px] shadow-xl" role="menu">
                {m.items.map((it, j) =>
                  it === "sep" ? (
                    <div key={j} className="my-1 h-px bg-border" />
                  ) : "children" in it ? (
                    <button
                      key={it.label}
                      role="menuitem"
                      aria-haspopup="menu"
                      onPointerEnter={(e) => {
                        const r = e.currentTarget.getBoundingClientRect()
                        setChild({ label: it.label, items: it.children, x: r.right + 2, y: Math.min(r.top - 4, window.innerHeight - 8 - it.children.length * 26 - 8) })
                      }}
                      className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-accent", child?.label === it.label && "bg-accent")}
                    >
                      <span className="w-4 shrink-0" />
                      <span className="flex-1">{it.label}</span>
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    </button>
                  ) : (
                    <button
                      key={it.cmd + j}
                      role="menuitem"
                      disabled={it.disabled}
                      title={it.title}
                      onPointerEnter={() => setChild(null)}
                      onClick={() => {
                        setOpen(null)
                        onCommand(it.cmd)
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
                    >
                      <span className="w-4 shrink-0">{it.checked && <Check className="h-3.5 w-3.5 text-primary" />}</span>
                      <span className="flex-1 whitespace-nowrap">{it.label}</span>
                      {it.key && <span className="text-[10px] text-muted-foreground">{it.key}</span>}
                    </button>
                  )
                )}
              </div>
            )}
            {open === i && child && (
              <div className="fixed z-[60] max-h-[calc(100vh-16px)] min-w-[220px] overflow-y-auto rounded-lg border bg-popover p-1 text-[12px] shadow-xl" style={{ left: child.x, top: Math.max(8, child.y) }} role="menu">
                {child.items.map((it, k) => it === "sep" ? <div key={k} className="my-1 h-px bg-border" /> : (
                  <button key={it.cmd + k} role="menuitem" disabled={it.disabled} title={it.title} onClick={() => { setOpen(null); onCommand(it.cmd) }} className="flex w-full items-center gap-4 rounded-sm px-2 py-1 text-left hover:bg-accent disabled:pointer-events-none disabled:opacity-40">
                    <span className="flex-1 whitespace-nowrap">{it.label}</span>
                    {it.key && <span className="text-[10px] text-muted-foreground">{it.key}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
