import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { AiSetup, useAi } from "@/components/AiSetup"
import { cn } from "@/lib/utils"
import type { Background, Fx } from "@/types"

type Props = { fx: Fx; setFx: (p: Partial<Fx>) => void }

const MODES: [Background["mode"] | "none", string][] = [
  ["none", "Yok"],
  ["remove", "Kaldır"],
  ["color", "Renk"],
  ["blur", "Bulanık"],
]
const COLORS: [string, string][] = [
  ["#FFFFFF", "Beyaz"],
  ["#F4F1EA", "Krem"],
  ["#0E0E0E", "Siyah"],
  ["#B89B5E", "Altın"],
  ["#9DB7C9", "Mavi"],
]
const HINT: Record<NonNullable<Background["mode"]>, string> = {
  remove: "Arka plan şeffaf olur. Dışa aktarırken PNG ya da WebP seç; JPEG şeffaflık taşımaz, beyaz zemin kullanır.",
  color: "Konu düz bir rengin önüne alınır.",
  blur: "Arka plan bulanıklaşır, konu net kalır (portre modu gibi).",
}

/** Yapay zekâ ile konuyu bulup arka planı kaldırır, renklendirir ya da bulanıklaştırır. */
export function BackgroundPanel({ fx, setFx }: Props) {
  const { ready } = useAi()
  const bg = fx.background ?? {}
  const set = (p: Partial<Background>) => setFx({ background: { color: "#FFFFFF", blur: 0.5, ...bg, ...p } })
  return (
    <div className="space-y-3">
      <Label>Arka plan</Label>
      {!ready ? (
        <AiSetup what="Arka planı kaldırmak ya da değiştirmek" />
      ) : (
        <>
          <div className="grid grid-cols-4 gap-1.5">
            {MODES.map(([m, name]) => (
              <button
                key={m}
                onClick={() => (m === "none" ? setFx({ background: undefined }) : set({ mode: m }))}
                className={cn(
                  "rounded-md border py-1.5 text-xs transition-colors hover:border-primary/60",
                  (bg.mode ?? "none") === m ? "border-primary/70 bg-primary/15 text-foreground" : "text-muted-foreground"
                )}
              >
                {name}
              </button>
            ))}
          </div>
          {bg.mode === "color" && (
            <div className="flex items-center gap-2">
              {COLORS.map(([hex, name]) => (
                <button
                  key={hex}
                  title={name}
                  aria-label={name}
                  onClick={() => set({ color: hex })}
                  className={cn("h-6 w-6 rounded-full border border-black/30 ring-offset-2 ring-offset-background", (bg.color ?? "#FFFFFF").toUpperCase() === hex && "ring-2 ring-primary")}
                  style={{ background: hex }}
                />
              ))}
              <label className="relative h-6 w-6 cursor-pointer overflow-hidden rounded-full border border-dashed border-muted-foreground/70" title="Özel renk">
                <input type="color" className="absolute inset-0 cursor-pointer opacity-0" onChange={(e) => set({ color: e.target.value.toUpperCase() })} />
              </label>
            </div>
          )}
          {bg.mode === "blur" && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Bulanıklık</span>
                <span>{Math.round((bg.blur ?? 0.5) * 100)}%</span>
              </div>
              <Slider min={0} max={100} step={1} value={[Math.round((bg.blur ?? 0.5) * 100)]} onValueChange={([v]) => set({ blur: v / 100 })} />
            </div>
          )}
          {bg.mode && <p className="text-[11px] text-muted-foreground">{HINT[bg.mode]} İlk seferde birkaç saniye sürebilir.</p>}
        </>
      )}
    </div>
  )
}
