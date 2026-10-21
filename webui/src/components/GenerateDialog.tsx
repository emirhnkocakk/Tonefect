import { CheckCircle2, FolderOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { api, outputUrl } from "@/lib/api"
import type { Job } from "@/types"

type Props = { open: boolean; onClose: () => void; job: Job | null; jobId: string | null }

export function GenerateDialog({ open, onClose, job, jobId }: Props) {
  const pct = job && job.total ? Math.round((job.done / job.total) * 100) : 0
  return (
    <Dialog open={open} onOpenChange={(o) => !o && job?.finished && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{job?.finished ? "Görseller hazır" : "Görseller üretiliyor…"}</DialogTitle>
          <DialogDescription>
            {job ? `${job.done} / ${job.total}` : "Başlatılıyor"}
            {job?.finished && job.outDir ? ` · ${job.outDir}` : ""}
          </DialogDescription>
        </DialogHeader>
        <Progress value={pct} />
        {job && job.files.length > 0 && jobId && (
          <div className="grid max-h-[46vh] grid-cols-4 gap-2 overflow-y-auto pr-1">
            {job.files.map((f) => (
              <img key={f.name} src={outputUrl(jobId, f.name)} alt="" className="aspect-[4/5] w-full rounded-md object-cover" loading="lazy" />
            ))}
          </div>
        )}
        {job && job.errors.length > 0 && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
            {job.errors.map((e, i) => <p key={i}>{e}</p>)}
          </div>
        )}
        {job?.finished && (
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm text-primary"><CheckCircle2 className="h-4 w-4" /> Tamamlandı</span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => api.openFolder(job.outDir).catch(() => {})}>
                <FolderOpen className="h-4 w-4" /> Klasörü aç
              </Button>
              <Button onClick={onClose}>Kapat</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
