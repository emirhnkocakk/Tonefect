import { CircleDashed, Crop, LayoutTemplate, Palette, Sparkles, Type } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export const TOOLS: [string, string, string, typeof Crop][] = [
  ["crop", "Kırp", "Kırp, döndür, boyutlandır", Crop],
  ["color", "Renk", "Renk kütüphanesi, ışık ve renk", Palette],
  ["fx", "Efekt", "Siyah-beyaz, gren, vinyet, doku, çerçeve", Sparkles],
  ["local", "Yerel", "Bölgesel düzenleme (maske)", CircleDashed],
  ["text", "Metin", "Yazı ekle ve biçimlendir", Type],
  ["design", "Tasarım", "Görsel ekle, birleştir, hizala, dağıt", LayoutTemplate],
]

type Props = { tool: string; setTool: (t: string) => void }

/** Sol dikey araç çubuğu: seçilen aracın ayarları yanındaki panelde açılır. */
export function ToolRail({ tool, setTool }: Props) {
  return (
    <nav className="flex w-[64px] shrink-0 flex-col items-center gap-1 border-r bg-card/60 py-3">
      {TOOLS.map(([id, label, hint, Icon]) => (
        <Tooltip key={id}>
          <TooltipTrigger asChild>
            <button
              onClick={() => setTool(id)}
              aria-label={label}
              aria-pressed={tool === id}
              className={cn(
                "flex w-[54px] flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-medium transition-colors",
                tool === id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <Icon className="h-5 w-5" />
              {label}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{hint}</TooltipContent>
        </Tooltip>
      ))}
    </nav>
  )
}
