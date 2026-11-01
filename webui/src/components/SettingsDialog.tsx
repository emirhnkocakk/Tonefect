import { useEffect, useRef, useState } from "react"
import { FolderOpen, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api } from "@/lib/api"
import { TONE_INFO } from "@/lib/constants"
import { THEMES } from "@/lib/themes"
import { cn } from "@/lib/utils"
import type { Config, ExportOpts, Settings, UpdateInfo, Watermark } from "@/types"

type Props = {
  open: boolean
  onClose: () => void
  cfg: Config
  settings: Settings
  setSettings: (s: Settings) => void
  defaults: Settings
  watermark: Watermark | null
  onWatermark: (w: Watermark) => void
  quitOnClose: boolean
  onQuitOnClose: (v: boolean) => void
  version: string
  update: UpdateInfo | null
  onUpdate: (u: UpdateInfo) => void
}

const FORMATS: [ExportOpts["format"], string, string][] = [
  ["jpg", "JPEG", "en yaygın"],
  ["png", "PNG", "kayıpsız, büyük"],
  ["webp", "WebP", "küçük, web için"],
]

const WM_POSITIONS: [string, string][] = [
  ["tl", "Sol üst"], ["tr", "Sağ üst"], ["center", "Orta"],
  ["bl", "Sol alt"], ["br", "Sağ alt"], ["tile", "Döşe (tüm görsel)"],
]

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <Label>{title}</Label>
        {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function SettingsDialog({ open, onClose, cfg, settings, setSettings, defaults, watermark, onWatermark, quitOnClose, onQuitOnClose, version, update, onUpdate }: Props) {
  const [checking, setChecking] = useState(false)
  const [msg, setMsg] = useState("")
  const [text, setText] = useState(watermark?.text ?? "")
  useEffect(() => setText(watermark?.text ?? ""), [watermark?.text, open])
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()

  // önizleme anında güncellenir, sunucuya kısa bir beklemeyle kaydedilir
  const setWm = (p: Partial<Watermark>) => {
    if (!watermark) return
    const next = { ...watermark, ...p }
    onWatermark(next)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => api.watermark(next).catch((e) => toast.error(e.message)), 300)
  }
  const wm = watermark
  const ex = settings.export ?? { format: "jpg", quality: 95, naming: "number", exif: false }
  const setEx = (p: Partial<ExportOpts>) => setSettings({ ...settings, export: { ...ex, ...p } })
  const fx = settings.fx
  const check = async () => {
    setChecking(true)
    setMsg("")
    try {
      const u = await api.updateCheck(true)
      onUpdate(u)
      if (u.error) setMsg("Denetlenemedi: internet bağlantını kontrol et.")
      else if (!u.newer) setMsg("Tonefect güncel.")
    } catch (e: any) {
      setMsg(e.message)
    }
    setChecking(false)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Ayarlar</DialogTitle>
          <DialogDescription>Değişiklikler otomatik kaydedilir.</DialogDescription>
        </DialogHeader>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold tracking-wider text-muted-foreground">GÖRÜNÜM</h3>
          <div className="grid grid-cols-3 gap-2">
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => setSettings({ ...settings, theme: t.id })}
                className={cn(
                  "rounded-lg border p-2 text-left transition-colors hover:border-primary/60",
                  (settings.theme ?? "tonefect") === t.id && "border-primary ring-1 ring-primary"
                )}
              >
                <div className="flex h-6 overflow-hidden rounded-md">
                  {t.swatch.map((c) => (
                    <span key={c} className="flex-1" style={{ background: c }} />
                  ))}
                </div>
                <p className="mt-1.5 text-xs font-medium">{t.name}</p>
                <p className="text-[10px] leading-tight text-muted-foreground">{t.desc}</p>
              </button>
            ))}
          </div>
        </section>

        <Separator />

        <section className="space-y-3">
          <h3 className="text-xs font-semibold tracking-wider text-muted-foreground">ÇIKTI</h3>
          <div className="space-y-2">
            <Label>Çıktı klasörü</Label>
            <div className="flex gap-2">
              <Input value={settings.outDir} onChange={(e) => setSettings({ ...settings, outDir: e.target.value })} />
              <Button variant="secondary" size="icon-sm" aria-label="Klasörü aç" onClick={() => api.openFolder(settings.outDir).catch((e) => toast.error(e.message))}>
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Dosya biçimi</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {FORMATS.map(([v, l, hint]) => (
                <button
                  key={v}
                  onClick={() => setEx({ format: v })}
                  className={cn(
                    "rounded-lg border px-2 py-1.5 text-left transition-colors hover:border-primary/60",
                    ex.format === v ? "border-primary/70 bg-primary/15 text-foreground" : "text-muted-foreground"
                  )}
                >
                  <span className="block text-xs font-medium">{l}</span>
                  <span className="block text-[10px] opacity-70">{hint}</span>
                </button>
              ))}
            </div>
          </div>
          {ex.format !== "png" && (
            <div className="space-y-2">
              <div className="flex justify-between"><Label>Kalite</Label><span className="text-xs text-muted-foreground">{ex.quality}</span></div>
              <Slider min={50} max={100} step={1} value={[ex.quality]} onValueChange={([v]) => setEx({ quality: v })} />
              <p className="text-[11px] text-muted-foreground">Yüksek kalite = daha büyük dosya. Instagram için 85–95 yeterli.</p>
            </div>
          )}
          <div className="space-y-2">
            <Label>Dosya adı</Label>
            <ToggleGroup type="single" value={ex.naming} onValueChange={(v) => v && setEx({ naming: v as "number" | "original" })} className="grid grid-cols-2 gap-2">
              <ToggleGroupItem value="number" className="h-auto flex-col items-start gap-0.5 rounded-lg border px-3 py-2 data-[state=on]:border-primary/60 data-[state=on]:bg-primary/15 data-[state=on]:text-foreground">
                <span className="text-sm">Numaralı</span>
                <span className="text-[11px] font-normal text-muted-foreground">001_foto.jpg (sıralı)</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="original" className="h-auto flex-col items-start gap-0.5 rounded-lg border px-3 py-2 data-[state=on]:border-primary/60 data-[state=on]:bg-primary/15 data-[state=on]:text-foreground">
                <span className="text-sm">Orijinal ad</span>
                <span className="text-[11px] font-normal text-muted-foreground">foto.jpg</span>
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <Row title="Fotoğraf bilgilerini koru (EXIF)" hint="Kamera, lens ve çekim tarihi korunur; konum bilgisi her zaman silinir">
            <Switch checked={ex.exif} onCheckedChange={(v) => setEx({ exif: v })} />
          </Row>
        </section>

        <Separator />

        <section className="space-y-4">
          <h3 className="text-xs font-semibold tracking-wider text-muted-foreground">FİLİGRAN</h3>
          <Row title="Filigran ekle" hint="Tüm görsellere yazı filigranı; istemezsen kapat">
            <Switch checked={!!wm?.enabled} onCheckedChange={(v) => setWm({ enabled: v })} />
          </Row>
          {wm?.enabled && (
            <>
              <Input
                value={text}
                maxLength={40}
                onChange={(e) => setText(e.target.value)}
                onBlur={() => text.trim() !== wm.text && setWm({ text: text.trim() })}
                onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
                placeholder="Filigran yazısı, örn. @kullaniciadi"
              />
              <div className="space-y-2">
                <Label>Konum</Label>
                <div className="grid grid-cols-3 gap-1.5">
                  {WM_POSITIONS.map(([v, l]) => (
                    <button
                      key={v}
                      onClick={() => setWm({ position: v })}
                      className={cn(
                        "rounded-lg border py-1.5 text-xs transition-colors hover:border-primary/60",
                        wm.position === v ? "border-primary/70 bg-primary/15 text-foreground" : "text-muted-foreground"
                      )}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between"><Label>Opaklık</Label><span className="text-xs text-muted-foreground">{Math.round(wm.opacity * 100)}%</span></div>
                <Slider min={5} max={100} step={1} value={[Math.round(wm.opacity * 100)]} onValueChange={([v]) => setWm({ opacity: v / 100 })} />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between"><Label>Boyut</Label><span className="text-xs text-muted-foreground">{wm.size.toFixed(1)}×</span></div>
                <Slider min={5} max={60} step={1} value={[Math.round(wm.size * 10)]} onValueChange={([v]) => setWm({ size: v / 10 })} />
              </div>
              {!wm.text && <p className="text-[11px] text-destructive">Filigran yazısı boş; görsellere bir şey eklenmez.</p>}
            </>
          )}
        </section>

        <Separator />

        <section className="space-y-4">
          <h3 className="text-xs font-semibold tracking-wider text-muted-foreground">YENİ FOTOĞRAF VARSAYILANLARI</h3>
          <div className="space-y-2">
            <Label>Oran ve boyut</Label>
            <ToggleGroup type="single" value={settings.aspect ?? "original"} onValueChange={(v) => v && setSettings({ ...settings, aspect: v })} className="grid grid-cols-2 gap-2">
              <ToggleGroupItem value="original" className="h-auto flex-col items-start gap-0.5 rounded-lg border px-3 py-2 data-[state=on]:border-primary/60 data-[state=on]:bg-primary/15 data-[state=on]:text-foreground">
                <span className="text-sm">Orijinal</span>
                <span className="text-[11px] font-normal text-muted-foreground">fotoğrafın kendi boyutu</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="insta" className="h-auto flex-col items-start gap-0.5 rounded-lg border px-3 py-2 data-[state=on]:border-primary/60 data-[state=on]:bg-primary/15 data-[state=on]:text-foreground">
                <span className="text-sm">Instagram</span>
                <span className="text-[11px] font-normal text-muted-foreground">4:5 · 1080×1350</span>
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="space-y-2">
            <Label>Ton</Label>
            <ToggleGroup type="single" value={settings.tone} onValueChange={(v) => v && setSettings({ ...settings, tone: v })} className="grid grid-cols-2 gap-2">
              {cfg.tones.map((t) => (
                <ToggleGroupItem key={t} value={t} className="h-9 rounded-lg border text-sm data-[state=on]:border-primary/60 data-[state=on]:bg-primary/15 data-[state=on]:text-foreground">
                  {TONE_INFO[t]?.label ?? t}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <Row title="Siyah-beyaz" hint="Kapalıysa fotoğraf renkli kalır">
            <Switch checked={fx.bw} onCheckedChange={(v) => setSettings({ ...settings, fx: { ...fx, bw: v } })} />
          </Row>
          <div className="space-y-2">
            <div className="flex justify-between"><Label>Parazit (grain)</Label><span className="text-xs text-muted-foreground">{Math.round(fx.grain * 100)}%</span></div>
            <Slider min={0} max={100} step={1} value={[Math.round(fx.grain * 100)]} onValueChange={([v]) => setSettings({ ...settings, fx: { ...fx, grain: v / 100 } })} />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between"><Label>Vinyet</Label><span className="text-xs text-muted-foreground">{Math.round(fx.vignette * 100)}%</span></div>
            <Slider min={0} max={100} step={1} value={[Math.round(fx.vignette * 100)]} onValueChange={([v]) => setSettings({ ...settings, fx: { ...fx, vignette: v / 100 } })} />
          </div>
          <p className="text-[11px] text-muted-foreground">Bu değerler yalnızca bundan sonra eklediğin fotoğraflara uygulanır.</p>
        </section>

        <Separator />

        <section className="space-y-4">
          <h3 className="text-xs font-semibold tracking-wider text-muted-foreground">UYGULAMA</h3>
          <Row
            title="Pencereyi kapatınca tamamen kapat"
            hint={quitOnClose ? "Pencere kapanınca Tonefect arka planda da çalışmaz" : "Arka planda çalışmaya devam eder; yeniden açınca anında açılır"}
          >
            <Switch checked={quitOnClose} onCheckedChange={onQuitOnClose} />
          </Row>
          <Row title="Akıllı kılavuz çizgileri" hint="Sürüklerken merkez ve komşu kelimelere hizalar, yapıştırır">
            <Switch checked={settings.guides} onCheckedChange={(v) => setSettings({ ...settings, guides: v })} />
          </Row>
        </section>

        <Separator />

        <section className="space-y-3">
          <h3 className="text-xs font-semibold tracking-wider text-muted-foreground">HAKKINDA</h3>
          <Row title="Tonefect" hint={`Sürüm ${version === "dev" ? "geliştirme" : "v" + version}`}>
            <Button variant="secondary" size="sm" onClick={check} disabled={checking || version === "dev"}>
              {checking ? "Denetleniyor…" : "Güncellemeleri denetle"}
            </Button>
          </Row>
          {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
          {update?.newer && <p className="text-xs text-primary">Yeni sürüm var: v{update.latest}</p>}
        </section>

        <div className="flex items-center justify-between pt-1">
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground" onClick={() => setSettings({ ...defaults, outDir: settings.outDir, theme: settings.theme })}>
            <RotateCcw className="!size-3.5" /> Varsayılanlara dön
          </Button>
          <Button onClick={onClose}>Tamam</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
