import { useEffect, useState } from "react"
import { Download, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { api } from "@/lib/api"
import type { UpdateInfo, UpdateStatus } from "@/types"

type Props = { open: boolean; onClose: () => void; info: UpdateInfo | null }

export function UpdateDialog({ open, onClose, info }: Props) {
  const [busy, setBusy] = useState(false)
  const [st, setSt] = useState<UpdateStatus | null>(null)
  const [gone, setGone] = useState(false)

  useEffect(() => {
    if (!busy) return
    let alive = true
    let fails = 0
    const tick = async () => {
      try {
        const s = await api.updateStatus()
        fails = 0
        if (!alive) return
        setSt(s)
        if (s.state === "error") setBusy(false)
      } catch {
        // sunucu kapandı = kurulum başladı
        if (++fails >= 2 && alive) {
          setGone(true)
          setTimeout(() => window.close(), 2500)
          return
        }
      }
      if (alive) setTimeout(tick, 400)
    }
    tick()
    return () => {
      alive = false
    }
  }, [busy])

  const start = async () => {
    setSt(null)
    setGone(false)
    setBusy(true)
    try {
      await api.updateInstall()
    } catch (e: any) {
      setBusy(false)
      setSt({ state: "error", done: 0, total: 0, error: e.message })
    }
  }

  const [opened, setOpened] = useState(false)
  const download = async () => {
    try {
      await api.updateOpen()
      setOpened(true)
    } catch (e: any) {
      setSt({ state: "error", done: 0, total: 0, error: e.message })
    }
  }

  const pct = st && st.total ? Math.round((st.done / st.total) * 100) : 0
  const mb = (n: number) => (n / 1048576).toFixed(1)

  if (!info) return null
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Yeni sürüm hazır: v{info.latest}</DialogTitle>
          <DialogDescription>Şu an kullandığın sürüm: v{info.current}</DialogDescription>
        </DialogHeader>

        {info.notes && (
          <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
            {info.notes}
          </div>
        )}

        {busy && !gone && (
          <div className="space-y-2">
            <Progress value={st?.state === "installing" ? 100 : pct} />
            <p className="text-xs text-muted-foreground">
              {st?.state === "installing"
                ? "Kuruluyor…"
                : st && st.total
                ? `İndiriliyor… ${mb(st.done)} / ${mb(st.total)} MB`
                : "Başlatılıyor…"}
            </p>
          </div>
        )}
        {gone && (
          <p className="flex items-center gap-2 text-sm text-primary">
            <Loader2 className="h-4 w-4 animate-spin" /> Güncelleme kuruluyor, Grainline birazdan yeniden açılacak.
          </p>
        )}
        {st?.state === "error" && <p className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">{st.error}</p>}

        {!busy && !gone && (
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Sonra
            </Button>
            {info.canInstall ? (
              <Button onClick={start} className="gap-1.5">
                <Download className="!size-4" /> Şimdi güncelle
              </Button>
            ) : (
              <Button onClick={download} className="gap-1.5">
                <Download className="!size-4" /> Güncellemeyi indir
              </Button>
            )}
          </div>
        )}
        {opened && (
          <p className="text-xs text-primary">İndirme tarayıcında başladı. Bittiğinde Grainline-Setup.exe dosyasını çalıştır; ayarların ve fotoğrafların korunur.</p>
        )}
        {!info.canInstall && !busy && !opened && (
          <p className="text-[11px] text-muted-foreground">Bu sürüm kendini otomatik kuramıyor; kurulum dosyası tarayıcında indirilecek.</p>
        )}
      </DialogContent>
    </Dialog>
  )
}
