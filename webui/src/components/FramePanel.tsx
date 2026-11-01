import { Shuffle } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import type { Fx, Frame, Texture } from "@/types"

type Props = { fx: Fx; setFx: (p: Partial<Fx>) => void }

const STYLES: [Frame["style"] | "none", string][] = [
  ["none", "Yok"],
  ["solid", "Düz"],
  ["polaroid", "Polaroid"],
  ["film", "Film şeridi"],
  ["line", "İnce çizgi"],
]
const COLORS: [string, string][] = [
  ["#FFFFFF", "Beyaz"],
  ["#F4F1EA", "Krem"],
  ["#0E0E0E", "Siyah"],
  ["#B89B5E", "Altın"],
]
// render.FRAME_DEFAULT_COLOR ile aynı
const DEFAULT_COLOR: Record<Frame["style"], string> = { solid: "#FFFFFF", polaroid: "#F4F1EA", film: "#0E0E0E", line: "#FFFFFF" }

function Amount({ label, value, onChange, extra }: { label: string; value: number; onChange: (v: number) => void; extra?: React.ReactNode }) {
  const v = Math.round(value * 100)
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="cursor-default text-muted-foreground" onDoubleClick={() => onChange(0)} title="Çift tıkla: kapat">
          {label}
        </span>
        <div className="flex items-center gap-2">
          {extra}
          <span className={cn(v ? "text-foreground" : "text-muted-foreground")}>{v}%</span>
        </div>
      </div>
      <Slider min={0} max={100} step={1} value={[v]} onValueChange={([x]) => onChange(x / 100)} />
    </div>
  )
}

export function FramePanel({ fx, setFx }: Props) {
  const tex: Texture = fx.texture ?? {}
  const frame = fx.frame
  const setTex = (p: Partial<Texture>) => setFx({ texture: { ...tex, ...p } })
  const setFrame = (p: Partial<Frame>) => frame && setFx({ frame: { ...frame, ...p } })
  const style = frame?.style ?? "none"

  return (
    <>
      <div className="space-y-3">
        <Label>Dokular</Label>
        <Amount
          label="Işık sızıntısı"
          value={tex.leak ?? 0}
          onChange={(v) => setTex({ leak: v })}
          extra={
            !!tex.leak && (
              <button
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary"
                title="Sızıntının yönünü ve rengini değiştir"
                onClick={() => setTex({ variant: ((tex.variant ?? 0) + 1) % 4 })}
              >
                <Shuffle className="h-3 w-3" /> {(tex.variant ?? 0) + 1}/4
              </button>
            )
          }
        />
        <Amount label="Işıma (bloom)" value={tex.bloom ?? 0} onChange={(v) => setTex({ bloom: v })} />
        <Amount label="Toz ve çizik" value={tex.dust ?? 0} onChange={(v) => setTex({ dust: v })} />
      </div>

      <div className="space-y-3">
        <Label>Çerçeve</Label>
        <div className="grid grid-cols-5 gap-1">
          {STYLES.map(([v, l]) => (
            <button
              key={v}
              onClick={() =>
                setFx({ frame: v === "none" ? undefined : { style: v, size: frame?.size ?? 0.4, color: frame && frame.style === v ? frame.color : null } })
              }
              className={cn(
                "rounded-md border px-1 py-1.5 text-[11px] leading-tight transition-colors hover:border-primary/60",
                style === v ? "border-primary/70 bg-primary/15 text-foreground" : "text-muted-foreground"
              )}
            >
              {l}
            </button>
          ))}
        </div>
        {frame && (
          <>
            <Amount label="Kalınlık" value={frame.size} onChange={(v) => setFrame({ size: v })} />
            {frame.style !== "film" && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Renk</span>
                {COLORS.map(([hex, name]) => {
                  const on = (frame.color ?? DEFAULT_COLOR[frame.style]).toUpperCase() === hex
                  return (
                    <button
                      key={hex}
                      title={name}
                      aria-label={name}
                      onClick={() => setFrame({ color: hex })}
                      className={cn("h-6 w-6 rounded-full border border-black/30 ring-offset-2 ring-offset-background", on && "ring-2 ring-primary")}
                      style={{ background: hex }}
                    />
                  )
                })}
                <label className="relative h-6 w-6 cursor-pointer overflow-hidden rounded-full border border-dashed border-muted-foreground/70" title="Özel renk">
                  <input type="color" className="absolute inset-0 cursor-pointer opacity-0" onChange={(e) => setFrame({ color: e.target.value.toUpperCase() })} />
                </label>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">Görselin boyutu değişmez; fotoğraf çerçevenin içine yerleşir.</p>
          </>
        )}
      </div>
    </>
  )
}
