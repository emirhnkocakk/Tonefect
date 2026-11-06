import { useEffect, useState } from "react"
import { Slider } from "@/components/ui/slider"
import { DEFAULT_COLOR, FRAMES, FRAME_COLORS, Tile } from "@/components/FxPanel"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { Frame, Fx, Item } from "@/types"

type Props = { item: Item; setFx: (p: Partial<Fx>, all?: boolean) => void }

/** Çerçeve: düz, Polaroid, film şeridi, ince çizgi; kalınlık ve renk. */
export function FramePanel({ item, setFx }: Props) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  useEffect(() => {
    let alive = true
    api.fxThumbs().then((r) => alive && setThumbs(r.thumbs)).catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  const frame = item.fx.frame
  const style = frame?.style ?? "none"
  const setFrame = (p: Partial<Frame>) => frame && setFx({ frame: { ...frame, ...p } })

  return (
    <div className="space-y-6">
      <section id="sec-frame" className="space-y-3">
        <div className="grid grid-cols-3 gap-2.5">
          {FRAMES.map(([v, l]) => (
            <Tile
              key={v}
              img={thumbs[v === "none" ? "orig" : `frame:${v}`]}
              label={l}
              on={style === v && v !== "none"}
              selected={style === v}
              onClick={() => setFx({ frame: v === "none" ? undefined : { style: v, size: frame?.size ?? 0.4, color: frame && frame.style === v ? frame.color : null } })}
            />
          ))}
        </div>
        {frame && (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Kalınlık</span><span>{Math.round(frame.size * 100)}%</span></div>
              <Slider min={0} max={100} step={1} value={[Math.round(frame.size * 100)]} onValueChange={([v]) => setFrame({ size: v / 100 })} />
            </div>
            {frame.style !== "film" && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Renk</span>
                {FRAME_COLORS.map(([hex, name]) => (
                  <button
                    key={hex}
                    title={name}
                    aria-label={name}
                    onClick={() => setFrame({ color: hex })}
                    className={cn("h-6 w-6 rounded-full border border-black/30 ring-offset-2 ring-offset-background", (frame.color ?? DEFAULT_COLOR[frame.style]).toUpperCase() === hex && "ring-2 ring-primary")}
                    style={{ background: hex }}
                  />
                ))}
                <label className="relative h-6 w-6 cursor-pointer overflow-hidden rounded-full border border-dashed border-muted-foreground/70" title="Özel renk">
                  <input type="color" className="absolute inset-0 cursor-pointer opacity-0" onChange={(e) => setFrame({ color: e.target.value.toUpperCase() })} />
                </label>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">Görselin boyutu değişmez; fotoğraf çerçevenin içine yerleşir.</p>
          </div>
        )}
      </section>

    </div>
  )
}
