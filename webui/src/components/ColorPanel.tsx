import { useEffect, useRef, useState } from "react"
import { BookmarkPlus, ClipboardCopy, ClipboardPaste, Loader2, Upload, Wand2, X } from "lucide-react"
import { toast } from "sonner"
import { AdjustPanel } from "@/components/AdjustPanel"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
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
  onCopy: () => void
  onPaste: () => void
  canPaste: boolean
}

// anahtar sırasından ve sıfır değerlerden bağımsız karşılaştırma (sunucu sırayı değiştirebilir)
function sameAdjust(a: Adjust, b: Adjust) {
  const norm = (x: any): any =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.keys(x).sort().filter((k) => (Array.isArray(x[k]) ? x[k].some(Boolean) : typeof x[k] === "object" ? Object.keys(x[k]).length : x[k])).map((k) => [k, norm(x[k])])
      : x
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b))
}

const IMPORT_ACCEPT = ".xmp,.lrtemplate,.dng,.cube,.zip"

export function ColorPanel({ item, presets, groups, setFx, onPresetsChange, onCopy, onPaste, canPaste }: Props) {
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
  // Kendi kaydedilen ayarlar (tarif) değerlerini fotoğrafa kopyalar.
  const choose = (p: PresetMeta) => {
    if (!item) return toast.info("Bu görünümü uygulamak için önce bir fotoğraf ekle")
    if (p.recipe) setFx({ preset: p.recipe.base, amount: p.recipe.amount, adjust: p.recipe.adjust, bw: p.recipe.bw })
    else setFx({ preset: p.id, amount: 1, bw: p.bw })
  }
  const isOn = (p: PresetMeta) =>
    p.recipe
      ? !!item && current === p.recipe.base && Math.abs(amount - p.recipe.amount) < 1e-3 &&
        sameAdjust(adjust, p.recipe.adjust) && item.fx.bw === p.recipe.bw
      : current === p.id

  // tek tıkla iyileştirme: ışık/ton ve canlılık değerlerini ince ayara yazar (sonra elle değiştirilebilir)
  const [autoBusy, setAutoBusy] = useState(false)
  const autoEnhance = async () => {
    if (!item) return
    setAutoBusy(true)
    try {
      const r = await api.auto({ photo: item.id, geo: item.geo ?? null, fx: item.fx })
      const tone = ["exposure", "contrast", "highlights", "shadows", "whites", "blacks", "vibrance", "levels"] as const
      const next: Adjust = { ...adjust }
      for (const k of tone) delete (next as any)[k]
      setFx({ adjust: { ...next, ...r.adjust } })
      toast.success(Object.keys(r.adjust).length ? "Otomatik iyileştirildi; ince ayardan değiştirebilirsin" : "Fotoğraf zaten dengeli görünüyor")
    } catch (e: any) {
      toast.error(e.message)
    }
    setAutoBusy(false)
  }

  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState("")
  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (!item || !saveName.trim()) return
    setSaving(true)
    try {
      await api.savePreset(saveName.trim(), item.fx)
      await onPresetsChange()
      toast.success(`"${saveName.trim()}" kaydedildi`)
      setSaveOpen(false)
      setSaveName("")
    } catch (e: any) {
      toast.error(e.message)
    }
    setSaving(false)
  }


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


  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Label>Renk kütüphanesi</Label>
        <div className="flex items-center">
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" disabled={!item} onClick={() => setSaveOpen(true)} title="Bu fotoğrafın renk ayarlarını hazır ayar olarak kaydet">
            <BookmarkPlus className="!size-3.5" /> Kaydet
          </Button>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" disabled={importing} onClick={() => fileRef.current?.click()}>
            {importing ? <Loader2 className="!size-3.5 animate-spin" /> : <Upload className="!size-3.5" />} İçe aktar
          </Button>
        </div>
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
                        isOn(p) ? "ring-2 ring-primary" : "hover:ring-1 hover:ring-primary/50"
                      )}
                    >
                      {thumbs[p.id] ? (
                        <img src={thumbs[p.id]} alt="" className="h-full w-full object-cover" draggable={false} />
                      ) : (
                        <div className="h-full w-full animate-pulse bg-muted" />
                      )}
                    </div>
                    <span className={cn("mt-1 block truncate text-[11px]", isOn(p) ? "text-foreground" : "text-muted-foreground")}>
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
      <Button variant="secondary" className="w-full gap-2" onClick={autoEnhance} disabled={autoBusy} title="Işık, ton ve canlılığı fotoğrafa göre otomatik ayarlar">
        {autoBusy ? <Loader2 className="!size-4 animate-spin" /> : <Wand2 className="!size-4" />} Otomatik iyileştir
      </Button>
      <AdjustPanel adjust={adjust} setAdjust={(a) => setFx({ adjust: a })} />

      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" size="sm" className="text-xs" onClick={onCopy} title="Renk ve efekt ayarlarını kopyala (Ctrl+C)">
            <ClipboardCopy className="!size-3.5" /> Ayarları kopyala
          </Button>
          <Button variant="ghost" size="sm" className="text-xs" disabled={!canPaste} onClick={onPaste} title="Kopyalanan ayarları bu fotoğrafa yapıştır (Ctrl+V)">
            <ClipboardPaste className="!size-3.5" /> Yapıştır
          </Button>
        </div>
        <Button variant="secondary" size="sm" className="w-full" onClick={() => setFx({}, true)}>
          Bu rengi tüm fotoğraflara uygula
        </Button>
      </div>
      </>)}

      <Dialog open={saveOpen} onOpenChange={(o) => !saving && setSaveOpen(o)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Hazır ayar olarak kaydet</DialogTitle>
            <DialogDescription>Görünüm, yoğunluk, ışık, renk, renk karıştırıcı ve detay ayarları kaydedilir. Vinyet ve parazit dahil değildir.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={saveName}
            maxLength={60}
            placeholder="örn. Yaz akşamı"
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveOpen(false)} disabled={saving}>Vazgeç</Button>
            <Button onClick={save} disabled={saving || !saveName.trim()}>
              {saving && <Loader2 className="!size-4 animate-spin" />} Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
