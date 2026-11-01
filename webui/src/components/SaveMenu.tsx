import { useEffect, useRef, useState } from "react"
import { ChevronDown, Copy, Download, FilePlus2 } from "lucide-react"
import { Button } from "@/components/ui/button"

type Props = { disabled: boolean; onSave: () => void; onSaveAs: () => void; onSaveCopy: () => void }

/** Kaydet (çıktı klasörüne) + Farklı kaydet / Kopya kaydet (kaydetme penceresiyle). */
export function SaveMenu({ disabled, onSave, onSaveAs, onSaveCopy }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener("pointerdown", close)
    return () => window.removeEventListener("pointerdown", close)
  }, [open])
  const pick = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }
  return (
    <div ref={ref} className="relative flex">
      <Button variant="secondary" size="sm" onClick={onSave} disabled={disabled} className="h-8 gap-1.5 rounded-r-none" title="Seçili fotoğrafı çıktı klasörüne kaydet (Ctrl+S)">
        <Download className="!size-4" /> Kaydet
      </Button>
      <Button variant="secondary" size="sm" onClick={() => setOpen((o) => !o)} disabled={disabled} className="h-8 rounded-l-none border-l border-background/40 px-1.5" aria-label="Diğer kaydetme seçenekleri">
        <ChevronDown className="!size-3.5" />
      </Button>
      {open && (
        <div className="absolute right-0 top-9 z-50 w-56 rounded-lg border bg-popover p-1 text-sm shadow-xl">
          <button className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-accent" onClick={pick(onSaveAs)}>
            <FilePlus2 className="h-4 w-4" />
            <span className="flex-1">Farklı kaydet…</span>
            <span className="text-[10px] text-muted-foreground">Ctrl+Shift+S</span>
          </button>
          <button className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-accent" onClick={pick(onSaveCopy)}>
            <Copy className="h-4 w-4" />
            <span className="flex-1">Kopya kaydet…</span>
          </button>
          <p className="px-2.5 pb-1.5 pt-1 text-[11px] text-muted-foreground">Yeri, adı ve biçimi sen seçersin. Ayarlardaki renk modu ve DPI kullanılır.</p>
        </div>
      )}
    </div>
  )
}
