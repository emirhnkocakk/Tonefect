import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { KEY_HELP } from "@/lib/shortcuts"

export function KeysDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[86vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Klavye Kısayolları</DialogTitle>
          <DialogDescription>Photoshop kullanıcılarının alışkın olduğu tuşlar.</DialogDescription>
        </DialogHeader>
        <div className="columns-2 gap-6">
          {KEY_HELP.map(([group, rows]) => (
            <section key={group} className="mb-4 break-inside-avoid">
              <h3 className="mb-1 text-xs font-semibold">{group}</h3>
              {rows.map(([k, l]) => (
                <div key={k} className="flex justify-between gap-3 py-px text-[11px]">
                  <span className="text-muted-foreground">{l}</span>
                  <kbd className="shrink-0 font-sans text-foreground">{k}</kbd>
                </div>
              ))}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
