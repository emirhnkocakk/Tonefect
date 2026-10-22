import { useEffect, useState } from "react"
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
import type { Config, Settings, UpdateInfo } from "@/types"

type Props = {
  open: boolean
  onClose: () => void
  cfg: Config
  settings: Settings
  setSettings: (s: Settings) => void
  defaults: Settings
  signature: string
  onSignature: (s: string) => void
  quitOnClose: boolean
  onQuitOnClose: (v: boolean) => void
  version: string
  update: UpdateInfo | null
  onUpdate: (u: UpdateInfo) => void
}

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

export function SettingsDialog({ open, onClose, cfg, settings, setSettings, defaults, signature, onSignature, quitOnClose, onQuitOnClose, version, update, onUpdate }: Props) {
  const [sig, setSig] = useState(signature)
  const [checking, setChecking] = useState(false)
  const [msg, setMsg] = useState("")
  useEffect(() => setSig(signature), [signature, open])

  const saveSig = async () => {
    if (sig.trim() === signature) return
    try {
      const r = await api.signature(sig)
      onSignature(r.signature)
      setSig(r.signature)
      toast.success("İmza güncellendi")
    } catch (e: any) {
      toast.error(e.message)
    }
  }
  const fx = settings.fx
  const check = async () => {
    setChecking(true)
    setMsg("")
    try {
      const u = await api.updateCheck(true)
      onUpdate(u)
      if (u.error) setMsg("Denetlenemedi: internet bağlantını kontrol et.")
      else if (!u.newer) setMsg("Grainline güncel.")
    } catch (e: any) {
      setMsg(e.message)
    }
    setChecking(false)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ayarlar</DialogTitle>
          <DialogDescription>Değişiklikler otomatik kaydedilir.</DialogDescription>
        </DialogHeader>

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
            <Label>Görsel imzası (sağ alt köşe)</Label>
            <Input
              value={sig}
              maxLength={40}
              onChange={(e) => setSig(e.target.value)}
              onBlur={saveSig}
              onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
              placeholder="NEGANS VISION"
            />
          </div>
        </section>

        <Separator />

        <section className="space-y-4">
          <h3 className="text-xs font-semibold tracking-wider text-muted-foreground">YENİ FOTOĞRAF VARSAYILANLARI</h3>
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
            hint={quitOnClose ? "Pencere kapanınca Grainline arka planda da çalışmaz" : "Arka planda çalışmaya devam eder; yeniden açınca anında açılır"}
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
          <Row title="Grainline" hint={`Sürüm ${version === "dev" ? "geliştirme" : "v" + version}`}>
            <Button variant="secondary" size="sm" onClick={check} disabled={checking || version === "dev"}>
              {checking ? "Denetleniyor…" : "Güncellemeleri denetle"}
            </Button>
          </Row>
          {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
          {update?.newer && <p className="text-xs text-primary">Yeni sürüm var: v{update.latest}</p>}
        </section>

        <div className="flex items-center justify-between pt-1">
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground" onClick={() => setSettings({ ...defaults, outDir: settings.outDir })}>
            <RotateCcw className="!size-3.5" /> Varsayılanlara dön
          </Button>
          <Button onClick={onClose}>Tamam</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
