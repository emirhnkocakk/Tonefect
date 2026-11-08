import { useRef, useState } from "react"
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter,
  AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, ArrowDown, ArrowUp, Copy, FlipHorizontal2,
  Blend, ImagePlus, Loader2, Maximize, Repeat, RotateCcw, SquareStack, Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAi } from "@/components/AiSetup"
import { api, thumbUrl } from "@/lib/api"
import { useIntent } from "@/lib/hooks"
import { align, distribute, type AlignKind } from "@/lib/design"
import { cn } from "@/lib/utils"
import type { Fx, ImgLayer, Item, XformMode } from "@/types"
import { BASE_ID } from "@/lib/layers"
import { XFORM_MODES, applyDelta, type XformDelta } from "@/lib/transform"

type Props = {
  layers: ImgLayer[]
  setLayers: (l: ImgLayer[]) => void
  sel: string[]
  setSel: (ids: string[]) => void
  canvas: [number, number]
  intent?: { cmd: string; n: number } | null
  item: Item
  setFx: (p: Partial<Fx>) => void
  run: (cmd: string) => void
  mode: XformMode
  setMode: (m: XformMode) => void
  delta: XformDelta | null
}

const ALIGN: [AlignKind, string, typeof AlignStartVertical][] = [
  ["left", "Sola hizala", AlignStartVertical],
  ["hcenter", "Yatayda ortala", AlignCenterVertical],
  ["right", "Sağa hizala", AlignEndVertical],
  ["top", "Üste hizala", AlignStartHorizontal],
  ["vcenter", "Dikeyde ortala", AlignCenterHorizontal],
  ["bottom", "Alta hizala", AlignEndHorizontal],
]

const newId = () => Math.random().toString(36).slice(2, 9)

function Icon({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="secondary" size="icon-sm" aria-label={label} disabled={disabled} onClick={onClick} className="h-8 w-full">
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Taşıma ve Dönüştürme: fotoğrafın kendisi ya da eklenen katmanlar seçilir, dönüştürülür ve hizalanır. */
export function DesignPanel({ layers, setLayers, sel, setSel, canvas: [W, H], intent, item, setFx, run, mode, setMode, delta }: Props) {
  const [aligning, setAligning] = useState(false)
  const selected = layers.filter((l) => sel.includes(l.id))
  const again = () => {
    if (!delta) return void toast("Önce bir dönüşüm yap")
    if (!selected.length) return void toast("Önce bir katman seç")
    setLayers(layers.map((l) => (sel.includes(l.id) ? applyDelta(l, delta) : l)))
  }
  const autoAlign = async () => {
    if (!selected.length) return void toast("Önce hizalanacak katmanı seç")
    setAligning(true)
    try {
      const r = await api.autoAlign({ item: { ...item, layers }, ids: sel })
      setLayers(layers.map((l) => (r.layers[l.id] ? { ...l, ...r.layers[l.id] } : l)))
      const n = Object.keys(r.layers).length
      n ? toast.success(`${n} katman hizalandı`) : toast("Ortak içerik bulunamadı; katmanlar üst üste binmeli ve benzer içerik taşımalı")
    } catch (e: any) {
      toast.error(e.message)
    }
    setAligning(false)
  }
  const autoBlend = () => {
    if (!selected.length) return void toast("Önce bir katman seç")
    const on = !selected.every((l) => l.blend)
    setLayers(layers.map((l) => (sel.includes(l.id) ? { ...l, blend: on } : l)))
  }
  const modeEntry = XFORM_MODES.find((t) => t.mode === mode)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const ai = useAi()
  const cur = sel.length === 1 ? layers.find((l) => l.id === sel[0]) ?? null : null
  const set = (p: Partial<ImgLayer>) => cur && setLayers(layers.map((l) => (l.id === cur.id ? { ...l, ...p } : l)))

  const add = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    const added: ImgLayer[] = []
    try {
      for (const f of Array.from(files)) {
        const r = await api.upload(f)
        const ar = r.height / r.width
        const w = Math.min(0.5, (0.5 * H) / (W * ar)) // tuvalin yarısına sığsın
        const off = (layers.length + added.length) * 0.03
        added.push({ id: newId(), photo: r.id, name: r.name, x: 0.5 + off, y: 0.5 + off, w, ar, rot: 0, opacity: 1, flipH: false, cutout: false })
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ""
    }
    if (added.length) {
      setLayers([...layers, ...added])
      setSel(added.map((l) => l.id))
    }
  }
  const isBase = cur?.id === BASE_ID
  const duplicate = () => {
    if (!cur) return
    const c = { ...cur, id: newId(), name: isBase ? `${cur.name} kopya` : cur.name, x: cur.x + 0.03, y: cur.y + 0.03 }
    setLayers([...layers, c])
    setSel([c.id])
  }
  const remove = () => {
    setLayers(layers.filter((l) => l.id === BASE_ID || !sel.includes(l.id)))
    setSel([])
  }
  const bg = item.fx.background ?? {}
  useIntent(intent, "design:", (cmd) => {
    if (cmd === "design:add") fileRef.current?.click()
    else if (cmd === "design:again") again()
    else if (cmd === "design:autoalign") autoAlign()
    else if (cmd === "design:autoblend") autoBlend()
  })

  const fill = () => cur && set({ x: 0.5, y: 0.5, rot: 0, w: Math.max(1, H / (W * cur.ar)) })

  return (
    <div className="space-y-5">
      <section id="sec-xform" className="space-y-2">
        <Label>Araçlar</Label>
        <div className="grid grid-cols-5 gap-1">
          {XFORM_MODES.map((t) => {
            const I = t.icon
            return (
              <Tooltip key={t.cmd}>
                <TooltipTrigger asChild>
                  <button
                    aria-label={t.label}
                    onClick={() => setMode(t.mode!)}
                    className={cn("grid h-9 place-items-center rounded-md border transition-colors hover:border-primary/60", mode === t.mode ? "border-primary/70 bg-primary/15 text-foreground" : "text-muted-foreground")}
                  >
                    <I className="h-4 w-4" strokeWidth={1.8} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t.label} ({t.en}){t.key ? ` · ${t.key}` : ""}</TooltipContent>
              </Tooltip>
            )
          })}
        </div>
        {modeEntry && (
          <p className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">{modeEntry.label}</span> · {modeEntry.hint}
          </p>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          <Button variant="secondary" size="sm" className="text-xs" disabled={!delta || !selected.length} onClick={again}>
            <Repeat className="!size-3.5" /> Dönüşümü Tekrarla
          </Button>
          <Button variant="ghost" size="sm" className="text-xs" disabled={!selected.length} onClick={() => setLayers(layers.map((l) => (sel.includes(l.id) ? { ...l, rot: 0, sy: undefined, corners: undefined, warp: undefined, pwarp: undefined, pins: undefined } : l)))}>
            <RotateCcw className="!size-3.5" /> Dönüşümü Sıfırla
          </Button>
        </div>
      </section>

      {layers.length > 0 && (
        <div className="space-y-1.5">
          {[...layers].reverse().map((l) => (
            <div
              key={l.id}
              onClick={(e) => setSel(e.shiftKey ? (sel.includes(l.id) ? sel.filter((x) => x !== l.id) : [...sel, l.id]) : [l.id])}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-sm transition-colors hover:border-primary/60",
                sel.includes(l.id) ? "border-primary/70 bg-primary/15" : "text-muted-foreground"
              )}
            >
              {l.photo ? <img src={thumbUrl(l.photo)} alt="" className="h-8 w-8 rounded object-cover" draggable={false} /> : <span className="grid h-6 w-6 place-items-center rounded bg-muted text-[9px] text-muted-foreground">{l.name.slice(0, 1)}</span>}
              <span className="flex-1 truncate text-xs">{l.name}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Shift ile birden çok katman seç. Üstteki, önde görünür.</p>
        </div>
      )}

      {sel.length > 0 && (
        <div className="space-y-2">
          <Label id="sec-align">Katmanları Hizala {sel.length > 1 ? "(seçime göre)" : "(tuvale göre)"}</Label>
          <div className="grid grid-cols-6 gap-1">
            {ALIGN.map(([k, label, I]) => (
              <Icon key={k} label={label} onClick={() => setLayers(align(layers, sel, k, W, H))}>
                <I className="h-4 w-4" />
              </Icon>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1">
            <Button variant="secondary" size="sm" className="text-xs" disabled={sel.length < 3} onClick={() => setLayers(distribute(layers, sel, "h", W, H))}>
              <AlignHorizontalDistributeCenter className="!size-3.5" /> Yatay Dağıt
            </Button>
            <Button variant="secondary" size="sm" className="text-xs" disabled={sel.length < 3} onClick={() => setLayers(distribute(layers, sel, "v", W, H))}>
              <AlignVerticalDistributeCenter className="!size-3.5" /> Dikey Dağıt
            </Button>
          </div>
          {sel.length < 3 && <p className="text-[10px] text-muted-foreground">Dağıtmak için en az 3 katman seç: aralarındaki boşluklar eşitlenir.</p>}
          <div id="sec-auto-layers" className="grid grid-cols-2 gap-1">
            <Button variant="secondary" size="sm" className="text-xs" disabled={aligning} onClick={autoAlign} title="Auto-Align Layers: tek katman fotoğrafa, birden çok katman en alttakine göre içerikten hizalanır">
              {aligning ? <Loader2 className="!size-3.5 animate-spin" /> : <SquareStack className="!size-3.5" />} Otomatik Hizala
            </Button>
            <Button variant={selected.every((l) => l.blend) ? "default" : "secondary"} size="sm" className="text-xs" onClick={autoBlend} title="Auto-Blend Layers: renkleri alttakine eşitler, kenarları yumuşatır">
              <Blend className="!size-3.5" /> Otomatik Harmanla
            </Button>
          </div>
        </div>
      )}

      {cur && (
        <div className="space-y-4 rounded-lg border p-3">
          <div className="grid grid-cols-6 gap-1">
            <Icon label="Öne getir" onClick={() => run("layer:forward")} disabled={isBase}><ArrowUp className="h-4 w-4" /></Icon>
            <Icon label="Arkaya gönder" onClick={() => run("layer:backward")} disabled={isBase}><ArrowDown className="h-4 w-4" /></Icon>
            <Icon label="Yatay çevir" onClick={() => set({ flipH: !cur.flipH })}><FlipHorizontal2 className="h-4 w-4" /></Icon>
            <Icon label="Tuvali doldur" onClick={fill}><Maximize className="h-4 w-4" /></Icon>
            <Icon label="Çoğalt" onClick={duplicate}><Copy className="h-4 w-4" /></Icon>
            <Icon label="Sil" onClick={remove} disabled={isBase}><Trash2 className="h-4 w-4" /></Icon>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Opaklık</span><span>{Math.round(cur.opacity * 100)}%</span></div>
            <Slider min={0} max={100} step={1} value={[Math.round(cur.opacity * 100)]} onValueChange={([v]) => set({ opacity: v / 100 })} />
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Döndür</span>
              <span>{cur.rot}°</span>
            </div>
            <Slider min={-180} max={180} step={1} value={[cur.rot]} onValueChange={([v]) => set({ rot: v })} />
          </div>
          {(isBase || !cur.base) && (
            <div className="flex items-center justify-between">
              <div>
                <Label>Konuyu kes</Label>
                <p className="text-[11px] text-muted-foreground">{ai.ready ? "Yapay zekâ arka planını siler" : "Önce Silme → Arka Planı Kaldır'dan yapay zekâyı kur"}</p>
              </div>
              {isBase ? (
                <Switch checked={bg.mode === "remove"} disabled={!ai.ready && bg.mode !== "remove"} onCheckedChange={(v) => setFx({ background: { color: "#FFFFFF", blur: 0.5, ...bg, mode: v ? "remove" : undefined } })} />
              ) : (
                <Switch checked={cur.cutout} disabled={!ai.ready && !cur.cutout} onCheckedChange={(v) => set({ cutout: v })} />
              )}
            </div>
          )}
        </div>
      )}
      {sel.length > 1 && (
        <Button variant="ghost" size="sm" className="w-full text-xs text-destructive" onClick={remove}>
          <Trash2 className="!size-3.5" /> Seçili katmanları sil
        </Button>
      )}

      <div className="space-y-2 border-t pt-4">
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => add(e.target.files)} />
        <Button variant="secondary" size="sm" className="w-full text-xs" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="!size-3.5 animate-spin" /> : <ImagePlus className="!size-3.5" />} Üstüne Başka Görsel Ekle
        </Button>
        <p className="text-[11px] text-muted-foreground">İsteğe bağlı: logo, ürün ya da ikinci bir fotoğraf. Şeffaf PNG'ler şeffaf kalır.</p>
      </div>
    </div>
  )
}
