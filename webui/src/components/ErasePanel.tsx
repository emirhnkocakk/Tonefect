import { useState } from "react"
import { Circle, PenTool, RotateCcw, Square } from "lucide-react"
import { toast } from "sonner"
import { AiSetup, useAi } from "@/components/AiSetup"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, thumbUrl } from "@/lib/api"
import { ERASE_TOOLS } from "@/lib/erase"
import { useIntent } from "@/lib/hooks"
import { cn } from "@/lib/utils"
import type { Background, Fx, ImgLayer, Item, MaskPaintTool, Mask } from "@/types"

type Mode = "" | "layermask" | "vector"
type Props = {
  item: Item
  setFx: (p: Partial<Fx>) => void
  setMasks: (m: Mask[]) => void
  maskSel: string | null
  layers: ImgLayer[]
  setLayers: (l: ImgLayer[]) => void
  sel: string[]
  setSel: (ids: string[]) => void
  mode: Mode
  setMode: (m: Mode) => void
  tool: MaskPaintTool
  setTool: (t: MaskPaintTool) => void
  addSpecial: (tool: "fillgaps" | "colorkey") => void
  run: (cmd: string) => void
  intent?: { cmd: string; n: number } | null
}

const QUICK = ["brush:tool:erase", "brush:tool:bgerase", "brush:tool:magic", "brush:tool:remove"]
function Value({ id, label, v, set, disabled }: { id?: string; label: string; v: number; set: (x: number) => void; disabled?: boolean }) {
  return (
    <div id={id} className="space-y-1.5">
      <div className="flex justify-between text-xs"><span className="text-muted-foreground">{label}</span><span>{Math.round(v * 100)}</span></div>
      <Slider disabled={disabled} min={0} max={100} step={1} value={[Math.round(v * 100)]} onValueChange={([x]) => set(x / 100)} />
    </div>
  )
}

/** Silme ve Arka Plan: silgiler, arka plan kaldırma, doldurma ve katman maskeleri. */
export function ErasePanel({ item, setFx, setMasks, maskSel, layers, setLayers, sel, setSel, mode, setMode, tool, setTool, addSpecial, run, intent }: Props) {
  const ai = useAi()
  const lama = useAi("lama")
  const [needLama, setNeedLama] = useState(false)
  const [needAi, setNeedAi] = useState(false)
  const bg: Background = item.fx.background ?? {}
  const setBg = (p: Partial<Background>) => setFx({ background: { color: "#FFFFFF", blur: 0.5, ...bg, ...p } })
  const cur = layers.find((l) => l.id === sel[0]) ?? null
  const put = (p: Partial<ImgLayer>) => cur && setLayers(layers.map((l) => (l.id === cur.id ? { ...l, ...p } : l)))
  const selection = (item.fx.masks ?? []).filter((m) => m.type === "select" && m.ops?.length)
  const target = selection.find((m) => m.id === maskSel) ?? selection[selection.length - 1]
  const scrollTo = (id: string) => setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60)

  const removeBg = () => {
    if (!ai.ready) return setNeedAi(true)
    setBg({ mode: bg.mode === "remove" ? undefined : "remove" })
  }
  const fillSel = () => {
    if (!target) {
      toast("Önce doldurulacak alanı seç")
      return run("sel:lasso:keep")
    }
    setMasks((item.fx.masks ?? []).map((m) => (m.id === target.id ? { ...m, fill: true } : m)))
    toast.success("Seçili alan çevresinden dolduruluyor")
  }
  const needLayer = () => {
    if (cur) return false
    toast("Önce aşağıdan bir katman seç")
    return true
  }
  const mask = (m: Mode) => {
    if (needLayer()) return
    setMode(mode === m ? "" : m)
  }

  useIntent(intent, "erase:", (cmd) => {
    if (cmd === "erase:bg") removeBg()
    else if (cmd === "erase:colorkey") addSpecial("colorkey")
    else if (cmd === "erase:fill") fillSel()
    else if (cmd === "erase:gen") {
      // panel yeni açıldıysa model durumu henüz gelmemiş olabilir
      api.aiStatus("lama").then((st) => {
        if (st.state === "ready") fillSel()
        else {
          setNeedLama(true)
          scrollTo("sec-fill")
        }
      }).catch((e) => toast.error(e.message))
    }
    else if (cmd === "erase:gaps") addSpecial("fillgaps")
    else if (cmd === "erase:layermask" || cmd === "erase:vector") {
      if (!cur && layers[0]) setSel([layers[layers.length - 1].id])
      if (layers.length) setMode(cmd === "erase:vector" ? "vector" : "layermask")
      else needLayer()
      scrollTo("sec-masks")
    }
  })

  const icon = (cmd: string) => {
    const t = ERASE_TOOLS.find((x) => x.cmd === cmd)!
    const I = t.icon
    return (
      <Tooltip key={cmd}>
        <TooltipTrigger asChild>
          <button aria-label={t.label} onClick={() => run(cmd)} className="grid h-9 place-items-center rounded-md border text-muted-foreground transition-colors hover:border-primary/60">
            <I className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t.label} ({t.en})</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <Label>Silgiler</Label>
        <div className="grid grid-cols-4 gap-1">{QUICK.map(icon)}</div>
        <p className="text-[11px] text-muted-foreground">Kaldırma Aracı ile nesnenin üzerini boya: çevresindeki dokuyla kapanır.</p>
      </section>

      <section id="sec-bg" className="space-y-3">
        <Label>Arka Plan</Label>
        {needAi && !ai.ready && <AiSetup what="Arka planı kaldırmak" />}
        <div className="grid grid-cols-2 gap-1.5">
          <Button variant={bg.mode === "remove" ? "default" : "secondary"} size="sm" className="text-xs" onClick={removeBg}>Arka Planı Kaldır</Button>
          <Button variant="secondary" size="sm" className="text-xs" onClick={() => addSpecial("colorkey")} title="Köşelerdeki düz rengi şeffaf yapar; logo ve beyaz zeminli görseller için">Düz Rengi Şeffaf Yap</Button>
          <Button variant="secondary" size="sm" className="text-xs" onClick={() => run("sel:subject")}>Konuyu Seç</Button>
          <Button variant="secondary" size="sm" className="text-xs" onClick={() => run("sel:refine")}>Seç ve Maskele</Button>
        </div>
        <Value id="sec-edge" label="Kenar İyileştir" v={bg.edge ?? 0} set={(edge) => setBg({ edge })} disabled={!bg.mode} />
        <Value id="sec-defringe" label="Renk Saçağını Temizle" v={bg.defringe ?? 0} set={(defringe) => setBg({ defringe })} disabled={!bg.mode} />
        {!bg.mode && <p className="text-[11px] text-muted-foreground">Kenar ayarları arka plan kaldırılınca açılır. Saç gibi ince kenarlar için Kenar İyileştir'i artır.</p>}
      </section>

      <section id="sec-fill" className="space-y-2">
        <Label>Doldurma</Label>
        {needLama || !lama.ready ? (
          !lama.ready && <AiSetup model="lama" what="Daha gerçekçi silme ve dolgu" about="alanı tamamlayan bir yapay zekâ modeli" />
        ) : (
          <p className="text-[11px] text-muted-foreground">Yapay zekâ dolgusu açık: silme ve doldurma bu modelle yapılır. Yazıyla yeni içerik üretmez, alanı akla yatkın biçimde tamamlar.</p>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          <Button variant="secondary" size="sm" className="text-xs" onClick={fillSel}>İçeriğe Duyarlı Dolgu</Button>
          <Button variant="secondary" size="sm" className="text-xs" onClick={() => addSpecial("fillgaps")} title="Silinmiş ya da şeffaf kalan yerleri çevreden tamamlar">Boşlukları Doldur</Button>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <Button variant="secondary" size="sm" className="text-xs" onClick={() => run("erase:object")}>Nesne Kaldırma</Button>
          <Button variant="secondary" size="sm" className="text-xs" onClick={() => run("erase:people")}>Kişi Silme</Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {target ? "Dolgu, aktif seçimin içine uygulanır." : "Önce Selection Tool ile alan seç ya da Kaldırma Aracı ile üzerini boya."} İlk hesaplama birkaç saniye sürebilir.
        </p>
      </section>

      <section id="sec-masks" className="space-y-3">
        <Label>Katman Maskeleri</Label>
        <>
            <div className="space-y-1">
              {[...layers].reverse().map((l) => (
                <button key={l.id} onClick={() => setSel([l.id])} className={cn("flex w-full items-center gap-2 rounded-lg border px-2 py-1 text-left text-xs transition-colors hover:border-primary/60", l.id === cur?.id ? "border-primary/70 bg-primary/15" : "text-muted-foreground")}>
                  {l.photo ? <img src={thumbUrl(l.photo)} alt="" className="h-6 w-6 rounded object-cover" draggable={false} /> : <span className="grid h-6 w-6 place-items-center rounded bg-muted text-[9px] text-muted-foreground">{l.name.slice(0, 1)}</span>}
                  <span className="flex-1 truncate">{l.name}</span>
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between rounded-lg border p-2.5">
              <div className="pr-2">
                <p className="text-xs font-medium">Kırpma Maskesi</p>
                <p className="text-[10px] text-muted-foreground">Katman yalnızca altındaki katmanın dolu yerlerinde görünür</p>
              </div>
              <Switch id="sec-clip" disabled={!cur} checked={!!cur?.clip} onCheckedChange={(clip) => put({ clip })} />
            </div>
            <Value label="Renk Saçağını Temizle (Katman)" v={cur?.defringe ?? 0} set={(defringe) => put({ defringe })} disabled={!cur} />

            <div className="space-y-2 rounded-lg border p-2.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium">Katman Maskesi</p>
                <Button variant={mode === "layermask" ? "default" : "secondary"} size="sm" className="h-7 text-xs" onClick={() => mask("layermask")}>{mode === "layermask" ? "Bitti" : "Maske Boya"}</Button>
              </div>
              {mode === "layermask" && (
                <>
                  <div className="grid grid-cols-2 gap-1">
                    {([["hide", "Gizle"], ["show", "Göster"]] as const).map(([p, l]) => (
                      <button key={p} onClick={() => setTool({ ...tool, paint: p })} className={cn("rounded-md border py-1 text-xs hover:border-primary/60", tool.paint === p ? "border-primary/70 bg-primary/15" : "text-muted-foreground")}>{l}</button>
                    ))}
                  </div>
                  <Value label="Boyut" v={tool.size} set={(size) => setTool({ ...tool, size: Math.max(0.005, size) })} />
                  <Value label="Sertlik" v={tool.hard} set={(hard) => setTool({ ...tool, hard })} />
                  <p className="text-[10px] text-muted-foreground">Alt basılıyken boyarsan ters çalışır.</p>
                </>
              )}
              {cur && (
                <div className="flex items-center gap-2 text-xs">
                  <label className="flex items-center gap-1.5 text-muted-foreground"><Switch checked={!!cur.mask?.invert} onCheckedChange={(invert) => put({ mask: { ops: cur.mask?.ops ?? [], off: cur.mask?.off, invert } })} /> Ters</label>
                  <label className="flex items-center gap-1.5 text-muted-foreground"><Switch checked={!cur.mask?.off} onCheckedChange={(on) => put({ mask: { ops: cur.mask?.ops ?? [], invert: cur.mask?.invert, off: !on } })} /> Açık</label>
                  <button className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-primary" onClick={() => put({ mask: undefined })}><RotateCcw className="h-3 w-3" /> temizle</button>
                </div>
              )}
            </div>

            <div className="space-y-2 rounded-lg border p-2.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium">Vektör Maske</p>
                <Button variant={mode === "vector" ? "default" : "secondary"} size="sm" className="h-7 text-xs" onClick={() => mask("vector")}>{mode === "vector" ? "Bitti" : "Şekil Çiz"}</Button>
              </div>
              {mode === "vector" && (
                <>
                  <div className="grid grid-cols-3 gap-1">
                    {([["rect", "Dikdörtgen", Square], ["ellipse", "Elips", Circle], ["path", "Kalem", PenTool]] as const).map(([s, l, I]) => (
                      <button key={s} onClick={() => setTool({ ...tool, shape: s })} className={cn("flex flex-col items-center gap-0.5 rounded-md border py-1.5 text-[11px] hover:border-primary/60", tool.shape === s ? "border-primary/70 bg-primary/15" : "text-muted-foreground")}>
                        <I className="h-3.5 w-3.5" /> {l}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground">{tool.shape === "path" ? "Köşelere tıkla; başlangıca tıkla ya da çift tıkla: kapat. Esc: vazgeç." : "Katmanın üzerinde sürükle; yalnızca şeklin içi görünür."}</p>
                </>
              )}
              {cur?.vector && <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary" onClick={() => put({ vector: undefined })}><RotateCcw className="h-3 w-3" /> kaldır</button>}
            </div>
        </>
      </section>
    </div>
  )
}
