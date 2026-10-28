import { useEffect, useRef, useState } from "react"
import { Loader2, RotateCcw, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { Adjust, Fx, Item, PresetMeta } from "@/types"

type Props = {
  item?: Item
  presets: PresetMeta[]
  groups: string[]
  setFx: (p: Partial<Fx>, all?: boolean) => void
  onPresetsChange: () => Promise<void>
}

const ADJUST: [keyof Adjust, string][] = [
  ["exposure", "Pozlama"],
  ["contrast", "Kontrast"],
  ["temperature", "Sıcaklık"],
  ["saturation", "Doygunluk"],
]
const IMPORT_ACCEPT = ".xmp,.lrtemplate,.dng,.cube,.zip"

export function ColorPanel({ item, presets, groups, setFx, onPresetsChange }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [importing, setImporting] = useState(false)
  const current = item?.fx.preset ?? ""
  const adjust = item?.fx.adjust ?? {}
  const amount = item?.fx.amount ?? 1
  const ver = presets.map((p) => p.id).join(",")

  // Kütüphane her zaman aynı stok görsel üzerinde gösterilir (fotoğraf eklemeden de görünür).
  useEffect(() => {
    if (!presets.length) return
    let alive = true
    api
      .presetThumbs()
      .then((r) => alive && setThumbs(r.thumbs))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [ver])

  // Vinyet ve parazit kullanıcıya ait: hazır ayar seçmek onları değiştirmez.
  const choose = (p: PresetMeta) => {
    if (!item) return toast.info("Bu görünümü uygulamak için önce bir fotoğraf ekle")
    setFx({ preset: p.id, amount: 1, bw: p.bw })
  }

  const setAdjust = (k: keyof Adjust, v: number) => setFx({ adjust: { ...adjust, [k]: v } })

  const importFiles = async (files: File[]) => {
    if (!files.length) return
    setImporting(true)
    let first: PresetMeta | null = null
    let count = 0
    for (const f of files) {
      try {
        const r = await api.importPreset(f)
        count += r.imported.length
        first = first ?? r.imported[0] ?? null
        r.warnings.forEach((w) => toast.warning(w, { duration: 8000 }))
      } catch (e: any) {
        toast.error(`${f.name}: ${e.message}`)
      }
    }
    setImporting(false)
    if (!count) return
    await onPresetsChange()
    if (first && item) choose(first)
    toast.success(`${count} hazır ayar eklendi`)
  }

  const remove = async (p: PresetMeta) => {
    if (!window.confirm(`"${p.name}" silinsin mi?`)) return
    try {
      await api.deletePreset(p.id)
      await onPresetsChange()
      if (current === p.id) setFx({ preset: "", amount: 1, bw: true })
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const hasAdjust = ADJUST.some(([k]) => adjust[k])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Label>Renk kütüphanesi</Label>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" disabled={importing} onClick={() => fileRef.current?.click()}>
          {importing ? <Loader2 className="!size-3.5 animate-spin" /> : <Upload className="!size-3.5" />} İçe aktar
        </Button>
      </div>

      {groups.map((g) => {
        const list = presets.filter((p) => p.group === g)
        if (!list.length) return null
        return (
          <div key={g} className="space-y-2">
            <p className="text-[11px] font-semibold tracking-wider text-muted-foreground">{g.toLocaleUpperCase("tr-TR")}</p>
            <div className="grid grid-cols-3 gap-2">
              {list.map((p) => (
                <div key={p.id} className="group relative">
                  <button onClick={() => choose(p)} className="block w-full text-left" title={p.name}>
                    <div
                      className={cn(
                        "aspect-[4/5] w-full overflow-hidden rounded-md bg-muted ring-offset-2 ring-offset-background transition",
                        current === p.id ? "ring-2 ring-primary" : "hover:ring-1 hover:ring-primary/50"
                      )}
                    >
                      {thumbs[p.id] ? (
                        <img src={thumbs[p.id]} alt="" className="h-full w-full object-cover" draggable={false} />
                      ) : (
                        <div className="h-full w-full animate-pulse bg-muted" />
                      )}
                    </div>
                    <span className={cn("mt-1 block truncate text-[11px]", current === p.id ? "text-foreground" : "text-muted-foreground")}>
                      {p.name}
                    </span>
                  </button>
                  {p.user && (
                    <button
                      aria-label="Sil"
                      onClick={() => remove(p)}
                      className="absolute right-1 top-1 hidden rounded bg-background/80 p-0.5 text-muted-foreground hover:text-destructive group-hover:block"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}
      <p className="text-[11px] text-muted-foreground">
        Lightroom (.xmp, .lrtemplate, mobil .dng) ve LUT (.cube) dosyalarını ya da bunları içeren bir .zip'i içe aktarabilirsin.
      </p>

      {item && current !== "" && (
        <div className="space-y-3">
          <div className="flex justify-between">
            <Label>Yoğunluk</Label>
            <span className="text-xs text-muted-foreground">{Math.round(amount * 100)}%</span>
          </div>
          <Slider min={0} max={100} step={1} value={[Math.round(amount * 100)]} onValueChange={([v]) => setFx({ amount: v / 100 })} />
        </div>
      )}

      {item && (<>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>İnce ayar</Label>
          {hasAdjust && (
            <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary" onClick={() => setFx({ adjust: {} })}>
              <RotateCcw className="h-3 w-3" /> sıfırla
            </button>
          )}
        </div>
        {ADJUST.map(([k, label]) => {
          const v = Math.round((adjust[k] ?? 0) * 100)
          return (
            <div key={k} className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">{label}</span>
                <span className="text-muted-foreground">{v > 0 ? `+${v}` : v}</span>
              </div>
              <Slider min={-100} max={100} step={1} value={[v]} onValueChange={([x]) => setAdjust(k, x / 100)} />
            </div>
          )
        })}
      </div>

      <Button variant="secondary" size="sm" className="w-full" onClick={() => setFx({}, true)}>
        Bu rengi tüm fotoğraflara uygula
      </Button>
      </>)}

      <input
        ref={fileRef}
        type="file"
        accept={IMPORT_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          importFiles([...(e.target.files || [])])
          e.target.value = ""
        }}
      />
    </div>
  )
}
