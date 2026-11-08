import { useRef, useState } from "react"
import { Crosshair, ImagePlus, Loader2, RotateCcw, Undo2, Wand2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, thumbUrl } from "@/lib/api"
import { canvasSize } from "@/lib/geo"
import { useIntent } from "@/lib/hooks"
import { RETOUCH_MODES } from "@/lib/retouch"
import { cn } from "@/lib/utils"
import type { BrushSettings, BrushTool, CloneSource, Fx, Item, Retouch, Settings } from "@/types"

type Props = {
  item: Item
  tool: BrushTool
  setTool: (t: BrushTool) => void
  brush: BrushSettings
  setBrush: (p: Partial<BrushSettings>) => void
  setFx: (p: Partial<Fx>) => void
  patchItem: (p: Partial<Item>) => void
  maskSel: string | null
  source: CloneSource | null
  armSource: () => void
  patchMode: Record<string, string>
  setPatchMode: (tool: string, v: string) => void
  settings: Settings
  setSettings: (s: Settings) => void
  intent?: { cmd: string; n: number } | null
}

function Value({ id, label, v, set }: { id?: string; label: string; v: number; set: (x: number) => void }) {
  const n = Math.round(v * 100)
  return (
    <div id={id} className="space-y-1.5">
      <div className="flex justify-between text-xs"><span className="text-muted-foreground">{label}</span><span>{n}</span></div>
      <Slider min={0} max={100} step={1} value={[n]} onValueChange={([x]) => set(x / 100)} />
    </div>
  )
}
const Choice = ({ value, set, options }: { value: string; set: (v: string) => void; options: [string, string][] }) => (
  <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
    {options.map(([v, l]) => (
      <button key={v} onClick={() => set(v)} className={cn("rounded-md border px-1.5 py-1 text-[11px] transition-colors hover:border-primary/60", value === v ? "border-primary/70 bg-primary/15 text-foreground" : "text-muted-foreground")}>{l}</button>
    ))}
  </div>
)

const STRENGTH: Partial<Record<BrushTool, string>> = {
  dodge: "Pozlama", burn: "Pozlama", sponge: "Akış", blur: "Güç", sharpen: "Güç", smudge: "Güç", freq: "Güç", wrinkle: "Güç", skin: "Güç", blemish: "Hassasiyet", teeth: "Beyazlık", eye: "Güç", redeye: "Karartma",
}
const PATTERNS: [string, string][] = [["dots", "Nokta"], ["stripes", "Çizgi"], ["checker", "Dama"], ["hatch", "Tarama"]]
const AUTO_RESTORE: Retouch = { scratch: 0.5, denoise: 0.35, fade: 0.6, cast: 0.5, sharp: 0.2 }
const AUTO_SKIN: Retouch = { smooth: 0.5, tone: 0.4, blemish: 0.5, texture: 0.6 }

/** Rötuş ve Onarım: iyileştirme, damga, ton ve odak fırçaları, otomatik cilt ve fotoğraf onarımı. */
export function RetouchPanel({ item, tool, setTool, brush: b, setBrush: set, setFx, patchItem, maskSel, source, armSource, patchMode, setPatchMode, settings, setSettings, intent }: Props) {
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const short = Math.min(...(canvasSize(item.geo, item.src) ?? [1080, 1350]))
  const strokes = item.paint?.strokes ?? []
  const rt: Retouch = item.fx.retouch ?? {}
  const put = (p: Retouch) => setFx({ retouch: { ...rt, ...p } })
  const tips = settings.brushes?.tips ?? []
  const entry = RETOUCH_MODES.find((x) => x.tool === tool)
  const selection = (item.fx.masks ?? []).filter((m) => m.type === "select" && m.ops?.length)
  const target = selection.find((m) => m.id === maskSel) ?? selection[selection.length - 1]
  const areaOk = !!rt.area && selection.some((m) => m.id === rt.area)
  const lasso = tool === "patch" || tool === "camove"
  const needsSource = tool === "heal" || tool === "clone"
  const scrollTo = (id: string) => setTimeout(() => {
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "start" })
    el.classList.add("menu-flash")
    setTimeout(() => el.classList.remove("menu-flash"), 1200)
  }, 60)

  useIntent(intent, "retouch:", (cmd) => {
    if (cmd.startsWith("retouch:sec:")) scrollTo("sec-" + cmd.slice(12))
  })

  const addPattern = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    try {
      const r = await api.upload(files[0])
      setSettings({ ...settings, brushes: { presets: settings.brushes?.presets ?? [], tips: [...tips, { id: Math.random().toString(36).slice(2, 9), photo: r.id, name: r.name }] } })
      set({ stamp: `img:${r.id}` })
    } catch (e: any) {
      toast.error(e.message)
    }
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ""
  }

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <Label>Araçlar</Label>
        <div className="grid grid-cols-6 gap-1">
          {RETOUCH_MODES.map((x) => {
            const I = x.icon
            return (
              <Tooltip key={x.cmd}>
                <TooltipTrigger asChild>
                  <button aria-label={x.label} onClick={() => setTool(x.tool!)} className={cn("grid h-9 place-items-center rounded-md border transition-colors hover:border-primary/60", tool === x.tool ? "border-primary/70 bg-primary/15 text-foreground" : "text-muted-foreground")}>
                    <I className="h-4 w-4" strokeWidth={1.8} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{x.label} ({x.en}){x.key ? ` · ${x.key}` : ""}</TooltipContent>
              </Tooltip>
            )
          })}
        </div>
        {entry && <p className="text-[11px] text-muted-foreground"><span className="font-medium text-foreground">{entry.label}</span> · {entry.hint}</p>}
        <div className="grid grid-cols-2 gap-1.5">
          <Button variant="ghost" size="sm" className="text-xs" disabled={!strokes.length} onClick={() => patchItem({ paint: { strokes: strokes.slice(0, -1) } })}>
            <Undo2 className="!size-3.5" /> Son Darbe
          </Button>
          <Button variant="ghost" size="sm" className="text-xs" disabled={!strokes.length} onClick={() => patchItem({ paint: undefined })}>
            <RotateCcw className="!size-3.5" /> Tümünü Temizle
          </Button>
        </div>
      </section>

      {needsSource && (
        <section className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{source ? "Kaynak seçildi" : "Kaynak seçilmedi"}</span>
            <Button variant="secondary" size="sm" className="h-7 gap-1.5 text-xs" onClick={armSource}><Crosshair className="!size-3.5" /> Kaynak Seç</Button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground">Hizalı</span>
              <p className="text-[10px] text-muted-foreground">Kapalıysa her darbe aynı kaynaktan başlar</p>
            </div>
            <Switch checked={b.aligned} onCheckedChange={(aligned) => set({ aligned })} />
          </div>
        </section>
      )}

      {tool === "patch" && (
        <section className="space-y-1.5">
          <Label>Yama Yönü</Label>
          <Choice value={patchMode.patch ?? "source"} set={(v) => setPatchMode("patch", v)} options={[["source", "Kaynak"], ["dest", "Hedef"]]} />
          <p className="text-[11px] text-muted-foreground">{(patchMode.patch ?? "source") === "source" ? "Çizdiğin alan, sürüklediğin yerin dokusuyla düzelir." : "Çizdiğin alan, sürüklediğin yere dokusuyla kopyalanır."}</p>
        </section>
      )}
      {tool === "camove" && (
        <section className="space-y-1.5">
          <Label>Taşıma Kipi</Label>
          <Choice value={patchMode.camove ?? "move"} set={(v) => setPatchMode("camove", v)} options={[["move", "Taşı"], ["extend", "Genişlet"]]} />
          <p className="text-[11px] text-muted-foreground">{(patchMode.camove ?? "move") === "move" ? "Nesnenin eski yeri çevresinden kapanır." : "Eski yer kalır, nesne kopyalanır."}</p>
        </section>
      )}
      {lasso && <p className="text-[11px] text-muted-foreground">Esc: çizimi iptal eder. Alanı temiz ve kenarı boş yerlerden çizersen dikiş kalmaz.</p>}

      {(tool === "dodge" || tool === "burn") && (
        <section className="space-y-1.5">
          <Label>Aralık</Label>
          <Choice value={b.range} set={(range) => set({ range: range as BrushSettings["range"] })} options={[["shadows", "Gölgeler"], ["mid", "Orta Tonlar"], ["high", "Parlak"]]} />
        </section>
      )}
      {tool === "sponge" && (
        <section className="space-y-2">
          <Choice value={b.sponge} set={(sponge) => set({ sponge: sponge as BrushSettings["sponge"] })} options={[["desat", "Doygunluğu Azalt"], ["sat", "Doygunluğu Artır"]]} />
          <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Doğal Canlılık</span><Switch checked={b.vib} onCheckedChange={(vib) => set({ vib })} /></div>
        </section>
      )}
      {tool === "smudge" && (
        <section className="space-y-2">
          <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Parmakla Boyama</span><Switch checked={b.finger} onCheckedChange={(finger) => set({ finger })} /></div>
          {b.finger && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <span className="relative h-7 w-7 overflow-hidden rounded-md border" style={{ background: b.color }}>
                <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={b.color} onChange={(e) => set({ color: e.target.value.toUpperCase() })} />
              </span>
              Başlangıç rengi
            </label>
          )}
        </section>
      )}
      {tool === "patstamp" && (
        <section className="space-y-2">
          <Label>Desen</Label>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => addPattern(e.target.files)} />
          <Choice value={b.stamp || "checker"} set={(stamp) => set({ stamp })} options={PATTERNS} />
          <div className="grid grid-cols-5 gap-1">
            {tips.map((x) => (
              <button key={x.id} title={x.name} onClick={() => set({ stamp: `img:${x.photo}` })} className={cn("block aspect-square w-full overflow-hidden rounded-md border hover:border-primary/60", b.stamp === `img:${x.photo}` ? "border-primary/70 ring-1 ring-primary" : "")}>
                <img src={thumbUrl(x.photo)} alt="" className="h-full w-full bg-white object-cover" draggable={false} />
              </button>
            ))}
            <button title="Görselden desen yap" disabled={busy} onClick={() => fileRef.current?.click()} className="grid aspect-square place-items-center rounded-md border border-dashed text-muted-foreground hover:border-primary/60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            </button>
          </div>
          {!b.stamp?.startsWith("img:") && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {([["color", "Renk 1"], ["color2", "Renk 2"]] as const).map(([k, l]) => (
                <label key={k} className="flex cursor-pointer items-center gap-1.5">
                  <span className="relative h-6 w-6 overflow-hidden rounded-md border" style={{ background: b[k] }}>
                    <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={b[k]} onChange={(e) => set({ [k]: e.target.value.toUpperCase() })} />
                  </span>
                  {l}
                </label>
              ))}
            </div>
          )}
          <Value label="Desen Boyutu" v={b.stampScale} set={(stampScale) => set({ stampScale: Math.max(0.02, stampScale) })} />
        </section>
      )}

      {!lasso && (
        <section id="sec-brushset" className="space-y-3">
          <Label>Fırça</Label>
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Boyut (px)</span><span>{Math.max(1, Math.round(b.size * short))}</span></div>
            <Slider min={1} max={Math.round(short * 0.5)} step={1} value={[Math.max(1, Math.round(b.size * short))]} onValueChange={([v]) => set({ size: v / short })} />
          </div>
          <Value label="Sertlik" v={b.hard} set={(hard) => set({ hard })} />
          {STRENGTH[tool] && <Value label={STRENGTH[tool]!} v={b.amount} set={(amount) => set({ amount })} />}
          <Value label="Opaklık" v={b.opacity} set={(opacity) => set({ opacity })} />
          <p className="text-[10px] text-muted-foreground">[ ve ] ile boyut değişir. Her aracın ayarları ayrı hatırlanır.</p>
        </section>
      )}

      <section id="sec-skin" className="space-y-3 rounded-lg border p-3">
        <div className="flex items-center justify-between">
          <Label>Cilt Rötuşu</Label>
          <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary" onClick={() => put(AUTO_SKIN)}><Wand2 className="h-3 w-3" /> Otomatik</button>
        </div>
        <Value label="Yumuşatma" v={rt.smooth ?? 0} set={(smooth) => put({ smooth })} />
        <Value label="Doku Korunumu" v={rt.texture ?? 0.6} set={(texture) => put({ texture })} />
        <Value label="Ten Eşitleme" v={rt.tone ?? 0} set={(tone) => put({ tone })} />
        <Value label="Leke Temizleme" v={rt.blemish ?? 0} set={(blemish) => put({ blemish })} />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Yalnızca Seçili Alan</span>
          <Switch
            checked={areaOk}
            onCheckedChange={(v) => {
              if (v && !target) return toast("Önce Selection Tool ile kişiyi ya da yüzü seç")
              put({ area: v ? target!.id : undefined })
            }}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">Cilt, renginden bulunur; ten rengine yakın duvar ya da ahşap da etkilenebilir. Öyleyse kişiyi seçip bu anahtarı aç.</p>
      </section>

      <section id="sec-freq" className="space-y-3 rounded-lg border p-3">
        <Label>Frekans Ayırma</Label>
        <Value label="Ton Yumuşatma (Düşük Frekans)" v={rt.fsLow ?? 0} set={(fsLow) => put({ fsLow })} />
        <Value label="Doku Vurgusu (Yüksek Frekans)" v={rt.fsHigh ?? 0} set={(fsHigh) => put({ fsHigh })} />
        <Value label="Ayırma Yarıçapı" v={rt.fsRadius ?? 0.3} set={(fsRadius) => put({ fsRadius })} />
        <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Yalnızca Cilt</span><Switch checked={!!rt.fsSkin} onCheckedChange={(fsSkin) => put({ fsSkin })} /></div>
      </section>

      <section id="sec-restore" className="space-y-3 rounded-lg border p-3">
        <div className="flex items-center justify-between">
          <Label>Fotoğraf Onarımı</Label>
          <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary" onClick={() => put(AUTO_RESTORE)}><Wand2 className="h-3 w-3" /> Otomatik</button>
        </div>
        <Value label="Çizik ve Toz" v={rt.scratch ?? 0} set={(scratch) => put({ scratch })} />
        <Value label="Gürültü Azaltma" v={rt.denoise ?? 0} set={(denoise) => put({ denoise })} />
        <Value label="Solmayı Gider" v={rt.fade ?? 0} set={(fade) => put({ fade })} />
        <Value label="Renk Kaymasını Düzelt" v={rt.cast ?? 0} set={(cast) => put({ cast })} />
        <Value label="Keskinlik" v={rt.sharp ?? 0} set={(sharp) => put({ sharp })} />
        <p className="text-[11px] text-muted-foreground">Yırtık ya da büyük kayıp için Kaldırma Aracı ve Klonlama Damgası'nı kullan.</p>
        <Button variant="ghost" size="sm" className="w-full text-xs" disabled={!item.fx.retouch} onClick={() => setFx({ retouch: undefined })}>
          <RotateCcw className="!size-3.5" /> Otomatik Rötuşu Sıfırla
        </Button>
      </section>
    </div>
  )
}
