import { useState } from "react"
import { ChevronDown, ChevronRight, Circle, Copy, Layers, Loader2, Play, Plus, Square, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { newActionId, stepLabel, type Action, type ActionStep } from "@/lib/actions"
import { cn } from "@/lib/utils"

type Props = {
  actions: Action[]
  setActions: (a: Action[]) => void
  recording: string | null
  startRecord: (id: string) => void
  stopRecord: () => void
  play: (a: Action, batch: boolean, exportAfter: boolean) => void
  busy: string | null
  count: number
  hasItem: boolean
}

/** Photoshop'taki Eylemler paneli: kaydet, oynat, adımları aç/kapat, toplu uygula. */
export function ActionsPanel({ actions, setActions, recording, startRecord, stopRecord, play, busy, count, hasItem }: Props) {
  const [sel, setSel] = useState<string | null>(actions[0]?.id ?? null)
  const [open, setOpen] = useState<string | null>(null)
  const [naming, setNaming] = useState<string | null>(null)
  const [exportAfter, setExportAfter] = useState(false)
  const cur = actions.find((a) => a.id === sel) ?? null
  const put = (a: Action) => setActions(actions.map((x) => (x.id === a.id ? a : x)))
  const putSteps = (a: Action, steps: ActionStep[]) => put({ ...a, steps })
  const create = () => {
    const a: Action = { id: newActionId(), name: `Eylem ${actions.length + 1}`, steps: [] }
    setActions([...actions, a])
    setSel(a.id)
    setOpen(a.id)
    startRecord(a.id)
  }
  const copy = (a: Action) => {
    const c: Action = { ...structuredClone(a), id: newActionId(), name: `${a.name} kopya` }
    setActions([...actions, c])
    setSel(c.id)
  }
  const remove = (a: Action) => {
    if (!window.confirm(`"${a.name}" eylemi silinsin mi?`)) return
    setActions(actions.filter((x) => x.id !== a.id))
    setSel(null)
  }
  const tool = "grid h-7 w-7 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
  const usable = cur && cur.steps.some((s) => !s.off)

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="min-h-[120px] flex-1 space-y-px overflow-y-auto">
        {actions.length === 0 && <p className="px-1 pt-2 text-[11px] text-muted-foreground">Henüz eylem yok. Aşağıdaki + ile yeni bir eylem başlat, düzenlemelerini yap, durdur. Sonra aynı adımları tek tıkla başka fotoğraflara uygula.</p>}
        {actions.map((a) => {
          const expanded = open === a.id
          return (
            <div key={a.id}>
              <div onClick={() => setSel(a.id)} onDoubleClick={() => setNaming(a.id)} className={cn("flex cursor-pointer items-center gap-1 rounded-sm px-1 py-1 text-xs", sel === a.id ? "bg-primary/20" : "hover:bg-accent/60")}>
                <button aria-label={expanded ? "Adımları gizle" : "Adımları göster"} onClick={(e) => { e.stopPropagation(); setOpen(expanded ? null : a.id) }} className="text-muted-foreground">
                  {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </button>
                {naming === a.id ? (
                  <Input autoFocus aria-label="Eylem adı" defaultValue={a.name} className="h-5 flex-1 px-1 text-xs" onClick={(e) => e.stopPropagation()} onBlur={(e) => { put({ ...a, name: e.target.value.trim().slice(0, 60) || a.name }); setNaming(null) }} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
                ) : (
                  <span className="flex-1 truncate">{a.name}</span>
                )}
                {recording === a.id && <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" aria-label="Kaydediliyor" />}
                <span className="text-[10px] text-muted-foreground">{a.steps.length} adım</span>
              </div>
              {expanded && (
                <div className="ml-4 space-y-px border-l pl-1">
                  {a.steps.map((s) => (
                    <div key={s.id} className="group flex items-center gap-1 rounded-sm px-1 py-0.5 text-[11px] hover:bg-accent/60">
                      <input type="checkbox" aria-label={`${stepLabel(s)} adımını kullan`} checked={!s.off} onChange={(e) => putSteps(a, a.steps.map((x) => (x.id === s.id ? { ...x, off: !e.target.checked } : x)))} className="h-3 w-3 accent-[hsl(var(--primary))]" />
                      <span className={cn("flex-1 truncate", s.off && "text-muted-foreground line-through")} title={stepLabel(s)}>{stepLabel(s)}</span>
                      <button aria-label="Adımı sil" onClick={() => putSteps(a, a.steps.filter((x) => x.id !== s.id))} className="text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"><Trash2 className="h-3 w-3" /></button>
                    </div>
                  ))}
                  {!a.steps.length && <p className="px-1 py-0.5 text-[10px] text-muted-foreground">Adım yok.</p>}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="space-y-2 border-t pt-2">
        {recording && <p className="text-[11px] text-destructive">Kaydediliyor: düzenlemelerin adım olarak ekleniyor.</p>}
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" className="gap-1 text-xs" disabled={!usable || !hasItem || !!recording || !!busy} onClick={() => cur && play(cur, false, false)}>
            {busy === "one" ? <Loader2 className="!size-3.5 animate-spin" /> : <Play className="!size-3.5" />} Oynat
          </Button>
          <Button variant="secondary" size="sm" className="gap-1 text-xs" disabled={!usable || !count || !!recording || !!busy} onClick={() => cur && play(cur, true, exportAfter)} title="Batch: açık fotoğrafların tümüne uygular">
            {busy === "batch" ? <Loader2 className="!size-3.5 animate-spin" /> : <Layers className="!size-3.5" />} Toplu ({count})
          </Button>
        </div>
        <label className="flex items-center justify-between text-[11px] text-muted-foreground">Toplu işlemden sonra dışa aktar <Switch checked={exportAfter} onCheckedChange={setExportAfter} /></label>
      </div>

      <div className="flex items-center justify-between border-t pt-1">
        <button aria-label="Durdur" title="Kaydı Durdur" disabled={!recording} onClick={stopRecord} className={tool}><Square className="h-3.5 w-3.5" /></button>
        <button aria-label="Kaydet" title="Seçili Eyleme Kayıt Ekle" disabled={!!recording || !cur || !hasItem} onClick={() => cur && startRecord(cur.id)} className={cn(tool, "text-destructive hover:text-destructive")}><Circle className="h-3.5 w-3.5 fill-current" /></button>
        <button aria-label="Oynat" title="Oynat" disabled={!usable || !hasItem || !!recording || !!busy} onClick={() => cur && play(cur, false, false)} className={tool}><Play className="h-3.5 w-3.5" /></button>
        <button aria-label="Eylemi kopyala" title="Çoğalt" disabled={!cur || !!recording} onClick={() => cur && copy(cur)} className={tool}><Copy className="h-3.5 w-3.5" /></button>
        <button aria-label="Yeni eylem" title="Yeni Eylem ve Kaydı Başlat" disabled={!!recording || !hasItem} onClick={create} className={tool}><Plus className="h-3.5 w-3.5" /></button>
        <button aria-label="Eylemi sil" title="Eylemi Sil" disabled={!cur || !!recording} onClick={() => cur && remove(cur)} className={tool}><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
      <p className="text-[10px] text-muted-foreground">Adı değiştirmek için çift tıkla. Seviye gibi Otomatik işlemler her fotoğrafta yeniden hesaplanır.</p>
    </div>
  )
}
