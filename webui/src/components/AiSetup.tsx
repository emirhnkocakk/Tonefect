import { useEffect, useState } from "react"
import { Download, ShieldCheck, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { api } from "@/lib/api"
import type { AiStatus } from "@/types"

// Tüm paneller aynı durumu görsün diye modül düzeyinde tutulur.
let shared: AiStatus | null = null
const subs = new Set<(s: AiStatus) => void>()
let timer: number | undefined

function publish(s: AiStatus) {
  shared = s
  subs.forEach((f) => f(s))
  window.clearTimeout(timer)
  if (s.state === "downloading") timer = window.setTimeout(() => api.aiStatus().then(publish).catch(() => {}), 700)
}

/** Yapay zekâ modelinin durumu (kurulu mu, iniyor mu). */
export function useAi() {
  const [s, setS] = useState<AiStatus | null>(shared)
  useEffect(() => {
    subs.add(setS)
    if (!shared) api.aiStatus().then(publish).catch(() => {})
    return () => {
      subs.delete(setS)
    }
  }, [])
  const install = () => api.aiInstall().then(publish).catch((e) => publish({ ...(shared as AiStatus), state: "error", error: String(e.message ?? e) }))
  return { status: s, ready: s?.state === "ready", install }
}

const mb = (n: number) => `${Math.round(n / 1e6)} MB`

/** Model kurulu değilse açıklama + onay ile indirme kartı; kuruluysa hiçbir şey göstermez. */
export function AiSetup({ what }: { what: string }) {
  const { status, ready, install } = useAi()
  if (!status || ready) return null
  const pct = status.total ? Math.round((status.done / status.total) * 100) : 0
  return (
    <div className="space-y-2.5 rounded-lg border border-primary/40 bg-primary/5 p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Sparkles className="h-4 w-4 text-primary" /> Yapay zekâ gerekli
      </p>
      <p className="text-[11px] text-muted-foreground">
        {what} için konuyu (insan, hayvan, nesne) bulan bir model bir kez indirilir ({mb(status.size)}). Sonra internetsiz çalışır.
      </p>
      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" /> Fotoğrafların bilgisayarından çıkmaz; her şey burada hesaplanır.
      </p>
      {status.state === "downloading" ? (
        <div className="space-y-1">
          <Progress value={pct} />
          <p className="text-[11px] text-muted-foreground">
            İndiriliyor… {mb(status.done)} / {mb(status.total)} ({pct}%)
          </p>
        </div>
      ) : (
        <>
          {status.state === "error" && <p className="text-[11px] text-destructive">İndirilemedi: {status.error}</p>}
          <Button size="sm" className="w-full" onClick={install}>
            <Download className="!size-4" /> {status.state === "error" ? "Tekrar dene" : `Modeli indir (${mb(status.size)})`}
          </Button>
        </>
      )}
    </div>
  )
}
