import { useEffect, useRef, useState } from "react"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

// Photoshop'taki gibi üstte kategorili menüler. Her öğe bir komut (App yürütür):
// "tool:<sekme>[:<bölüm>]" ilgili paneli açar ve o bölüme kaydırır; diğerleri doğrudan işlem.
export type MenuItem = { label: string; cmd: string; key?: string; disabled?: boolean; checked?: boolean } | "sep"
export type Menu = { label: string; items: MenuItem[] }

type Props = { menus: Menu[]; onCommand: (cmd: string) => void; active?: string }

export function MenuBar({ menus, onCommand, active }: Props) {
  const [open, setOpen] = useState<number | null>(null)
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
        const on = m.items.some((it) => it !== "sep" && active && it.cmd.startsWith(`tool:${active}`))
        return (
          <div key={m.label} className="relative">
            <button
              role="menuitem"
              onClick={() => setOpen(open === i ? null : i)}
              onPointerEnter={() => open !== null && setOpen(i)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[13px] transition-colors",
                open === i ? "bg-accent text-foreground" : on ? "text-primary" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              )}
            >
              {m.label}
            </button>
            {open === i && (
              <div className="absolute left-0 top-8 z-50 min-w-[230px] rounded-lg border bg-popover p-1 text-sm shadow-xl" role="menu">
                {m.items.map((it, j) =>
                  it === "sep" ? (
                    <div key={j} className="my-1 h-px bg-border" />
                  ) : (
                    <button
                      key={it.cmd + j}
                      role="menuitem"
                      disabled={it.disabled}
                      onClick={() => {
                        setOpen(null)
                        onCommand(it.cmd)
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
                    >
                      <span className="w-4 shrink-0">{it.checked && <Check className="h-3.5 w-3.5 text-primary" />}</span>
                      <span className="flex-1">{it.label}</span>
                      {it.key && <span className="text-[10px] text-muted-foreground">{it.key}</span>}
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
