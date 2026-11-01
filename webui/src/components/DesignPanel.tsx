import { useRef, useState } from "react"
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter,
  AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, ArrowDown, ArrowUp, Copy, FlipHorizontal2,
  ImagePlus, Loader2, Maximize, Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAi } from "@/components/AiSetup"
import { api, thumbUrl } from "@/lib/api"
import { align, distribute, type AlignKind } from "@/lib/design"
import { cn } from "@/lib/utils"
import type { ImgLayer } from "@/types"

type Props = {
  layers: ImgLayer[]
  setLayers: (l: ImgLayer[]) => void
  sel: string[]
  setSel: (ids: string[]) => void
  canvas: [number, number]
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

/** Tasarım: fotoğrafın üstüne başka görseller (logo, ürün, ikinci fotoğraf) ekle, hizala ve dağıt. */
export function DesignPanel({ layers, setLayers, sel, setSel, canvas: [W, H] }: Props) {
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
  const order = (dir: 1 | -1) => {
    if (!cur) return
    const i = layers.indexOf(cur)
    const j = i + dir
    if (j < 0 || j >= layers.length) return
    const a = [...layers]
    ;[a[i], a[j]] = [a[j], a[i]]
    setLayers(a)
  }
  const duplicate = () => {
    if (!cur) return
    const c = { ...cur, id: newId(), x: cur.x + 0.03, y: cur.y + 0.03 }
    setLayers([...layers, c])
    setSel([c.id])
  }
  const remove = () => {
    setLayers(layers.filter((l) => !sel.includes(l.id)))
    setSel([])
  }
  const fill = () => cur && set({ x: 0.5, y: 0.5, rot: 0, w: Math.max(1, H / (W * cur.ar)) })

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => add(e.target.files)} />
        <Button className="w-full" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="!size-4 animate-spin" /> : <ImagePlus className="!size-4" />} Görsel ekle
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Logo, ürün, ikinci bir fotoğraf ya da çıkartma ekle. Şeffaf PNG'ler şeffaf kalır. Önizlemede sürükle, köşeden büyüt, üstteki noktayla döndür.
        </p>
      </div>

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
              <img src={thumbUrl(l.photo)} alt="" className="h-8 w-8 rounded object-cover" draggable={false} />
              <span className="flex-1 truncate text-xs">{l.name}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Shift ile birden çok katman seç. Üstteki, önde görünür.</p>
        </div>
      )}

      {sel.length > 0 && (
        <div className="space-y-2">
          <Label>Hizala {sel.length > 1 ? "(seçime göre)" : "(tuvale göre)"}</Label>
          <div className="grid grid-cols-6 gap-1">
            {ALIGN.map(([k, label, I]) => (
              <Icon key={k} label={label} onClick={() => setLayers(align(layers, sel, k, W, H))}>
                <I className="h-4 w-4" />
              </Icon>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1">
            <Button variant="secondary" size="sm" className="text-xs" disabled={sel.length < 3} onClick={() => setLayers(distribute(layers, sel, "h", W, H))}>
              <AlignHorizontalDistributeCenter className="!size-3.5" /> Yatay dağıt
            </Button>
            <Button variant="secondary" size="sm" className="text-xs" disabled={sel.length < 3} onClick={() => setLayers(distribute(layers, sel, "v", W, H))}>
              <AlignVerticalDistributeCenter className="!size-3.5" /> Dikey dağıt
            </Button>
          </div>
          {sel.length < 3 && <p className="text-[10px] text-muted-foreground">Dağıtmak için en az 3 katman seç: aralarındaki boşluklar eşitlenir.</p>}
        </div>
      )}

      {cur && (
        <div className="space-y-4 rounded-lg border p-3">
          <div className="grid grid-cols-6 gap-1">
            <Icon label="Öne getir" onClick={() => order(1)} disabled={layers.indexOf(cur) === layers.length - 1}><ArrowUp className="h-4 w-4" /></Icon>
            <Icon label="Arkaya gönder" onClick={() => order(-1)} disabled={layers.indexOf(cur) === 0}><ArrowDown className="h-4 w-4" /></Icon>
            <Icon label="Yatay çevir" onClick={() => set({ flipH: !cur.flipH })}><FlipHorizontal2 className="h-4 w-4" /></Icon>
            <Icon label="Tuvali doldur" onClick={fill}><Maximize className="h-4 w-4" /></Icon>
            <Icon label="Çoğalt" onClick={duplicate}><Copy className="h-4 w-4" /></Icon>
            <Icon label="Sil" onClick={remove}><Trash2 className="h-4 w-4" /></Icon>
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
          <div className="flex items-center justify-between">
            <div>
              <Label>Konuyu kes</Label>
              <p className="text-[11px] text-muted-foreground">{ai.ready ? "Yapay zekâ arka planını siler" : "Önce Efekt → Arka plan'dan yapay zekâyı kur"}</p>
            </div>
            <Switch checked={cur.cutout} disabled={!ai.ready && !cur.cutout} onCheckedChange={(v) => set({ cutout: v })} />
          </div>
        </div>
      )}
      {sel.length > 1 && (
        <Button variant="ghost" size="sm" className="w-full text-xs text-destructive" onClick={remove}>
          <Trash2 className="!size-3.5" /> Seçili {sel.length} katmanı sil
        </Button>
      )}
    </div>
  )
}
