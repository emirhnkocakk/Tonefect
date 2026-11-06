import { useEffect, useMemo, useState } from "react"
import { Clock, FolderOpen, ImagePlus, Loader2, Pencil, Plus, Power, Settings as Cog, Square, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api, projectThumbUrl } from "@/lib/api"
import { PLATFORMS, platformGroups, ratioBox } from "@/lib/platforms"
import { cn } from "@/lib/utils"
import type { ProjectMeta } from "@/types"

type Props = {
  onOpen: (id: string, pickPhotos?: boolean) => void
  onSettings: () => void
  onQuit: () => void
  version: string
}

const BG: [string, string][] = [
  ["#FFFFFF", "Beyaz"],
  ["#F4F1EA", "Krem"],
  ["#0E0E0E", "Siyah"],
  ["#1F2A44", "Lacivert"],
  ["#B89B5E", "Altın"],
]

const ago = (t: number) => {
  const s = Date.now() / 1000 - t
  if (s < 60) return "az önce"
  if (s < 3600) return `${Math.floor(s / 60)} dk önce`
  if (s < 86400) return `${Math.floor(s / 3600)} saat önce`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} gün önce`
  return new Date(t * 1000).toLocaleDateString("tr-TR")
}

/** Açılış: son projeler ve yeni proje (boyut seçerek boş tuval ya da fotoğraflarla). */
export function StartPage({ onOpen, onSettings, onQuit, version }: Props) {
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null)
  const [name, setName] = useState("")
  const [preset, setPreset] = useState("ig-portrait")
  const [custom, setCustom] = useState<[number, number]>([1080, 1080])
  const [color, setColor] = useState("#FFFFFF")
  const [group, setGroup] = useState("Instagram")
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)

  const load = () => api.projects().then((r) => setProjects(r.projects)).catch((e) => toast.error(e.message))
  useEffect(() => {
    load()
  }, [])

  const groups = useMemo(() => [...platformGroups(), "Özel"], [])
  const size: [number, number] | null =
    preset === "custom" ? custom : preset === "original" ? null : (() => { const p = PLATFORMS.find((x) => x.id === preset)!; return [p.w, p.h] as [number, number] })()

  const create = async (blank: boolean) => {
    setBusy(true)
    try {
      const { id } = await api.createProject({ name: name.trim() || "Yeni proje", size, preset, blank: blank && !!size, color })
      onOpen(id, !blank)
    } catch (e: any) {
      toast.error(e.message)
      setBusy(false)
    }
  }
  const remove = async (p: ProjectMeta) => {
    if (!window.confirm(`"${p.name}" silinsin mi? Bu geri alınamaz.`)) return
    await api.deleteProject(p.id).catch((e) => toast.error(e.message))
    load()
  }
  const rename = async (p: ProjectMeta, n: string) => {
    setRenaming(null)
    if (n.trim() && n.trim() !== p.name) await api.renameProject(p.id, n).catch((e) => toast.error(e.message))
    load()
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-6">
        <div className="flex items-center gap-2.5">
          <img src="/logo.png" alt="" className="h-8 w-8" />
          <span className="text-sm font-semibold tracking-[0.22em]">TONEFECT</span>
          <span className="text-[11px] text-muted-foreground">v{version}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Ayarlar" onClick={onSettings}><Cog className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon-sm" aria-label="Kapat" onClick={onQuit}><Power className="h-4 w-4" /></Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* yeni proje */}
        <section className="flex w-[460px] shrink-0 flex-col border-r bg-card/40">
          <div className="space-y-1 px-6 pb-3 pt-6">
            <h2 className="text-lg font-semibold">Yeni proje</h2>
            <p className="text-xs text-muted-foreground">Nerede paylaşacaksın? Boyutu seç, boş tuvalle ya da fotoğraflarınla başla.</p>
          </div>
          <div className="px-6 pb-3">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Proje adı (ör. Yaz kampanyası)" />
          </div>
          <div className="flex flex-wrap gap-1.5 px-6 pb-3">
            {groups.map((g) => (
              <button
                key={g}
                onClick={() => {
                  setGroup(g)
                  if (g === "Özel") setPreset("custom")
                  else setPreset(PLATFORMS.find((p) => p.group === g)!.id)
                }}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition-colors hover:border-primary/60",
                  group === g ? "border-primary/70 bg-primary/15 text-foreground" : "text-muted-foreground"
                )}
              >
                {g}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6">
            {group === "Özel" ? (
              <div className="space-y-4 pt-1">
                <div className="flex items-center gap-2">
                  <Input type="number" aria-label="Genişlik" value={custom[0]} onChange={(e) => setCustom([Math.max(16, Math.min(12000, Number(e.target.value) || 16)), custom[1]])} className="h-9 text-center" />
                  <span className="text-muted-foreground">×</span>
                  <Input type="number" aria-label="Yükseklik" value={custom[1]} onChange={(e) => setCustom([custom[0], Math.max(16, Math.min(12000, Number(e.target.value) || 16))])} className="h-9 text-center" />
                  <span className="text-xs text-muted-foreground">px</span>
                </div>
                <button
                  onClick={() => setPreset(preset === "original" ? "custom" : "original")}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:border-primary/60",
                    preset === "original" ? "border-primary/70 bg-primary/15" : ""
                  )}
                >
                  <ImagePlus className="h-5 w-5 text-muted-foreground" />
                  <span>
                    <span className="block text-sm font-medium">Fotoğrafın kendi boyutu</span>
                    <span className="block text-[11px] text-muted-foreground">Kırpmadan, fotoğraf neyse o boyutta çalış</span>
                  </span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 pt-1">
                {PLATFORMS.filter((p) => p.group === group).map((p) => {
                  const [bw, bh] = ratioBox(p.w, p.h)
                  return (
                    <button
                      key={p.id}
                      onClick={() => setPreset(p.id)}
                      className={cn(
                        "flex items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:border-primary/60",
                        preset === p.id ? "border-primary/70 bg-primary/15" : ""
                      )}
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center">
                        <span className="rounded-[3px] border-2 border-current text-primary" style={{ width: bw, height: bh }} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{p.label}</span>
                        <span className="block text-[11px] text-muted-foreground">{p.w} × {p.h}{p.hint ? ` · ${p.hint}` : ""}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <div className="space-y-3 border-t px-6 py-4">
            {size && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Tuval rengi</span>
                {BG.map(([hex, n]) => (
                  <button
                    key={hex}
                    title={n}
                    aria-label={n}
                    onClick={() => setColor(hex)}
                    className={cn("h-6 w-6 rounded-full border border-black/30 ring-offset-2 ring-offset-background", color === hex && "ring-2 ring-primary")}
                    style={{ background: hex }}
                  />
                ))}
                <label className="relative h-6 w-6 cursor-pointer overflow-hidden rounded-full border border-dashed border-muted-foreground/70" title="Özel renk">
                  <input type="color" className="absolute inset-0 cursor-pointer opacity-0" onChange={(e) => setColor(e.target.value.toUpperCase())} />
                </label>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={busy || !size} onClick={() => create(true)} className="h-10">
                <Square className="!size-4" /> Boş tuval
              </Button>
              <Button disabled={busy} onClick={() => create(false)} className="h-10">
                {busy ? <Loader2 className="!size-4 animate-spin" /> : <ImagePlus className="!size-4" />} Fotoğraflarla başla
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {size ? `${size[0]} × ${size[1]} px · eklediğin fotoğraflar bu orana ortadan kırpılır (sonra değiştirebilirsin).` : "Fotoğraflar kendi boyutunda açılır."}
            </p>
          </div>
        </section>

        {/* son projeler */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 px-8 pb-4 pt-6">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Son projeler</h2>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
            {projects === null ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : projects.length === 0 ? (
              <div className="grid h-64 place-items-center rounded-2xl border border-dashed text-center text-sm text-muted-foreground">
                <div className="space-y-2">
                  <FolderOpen className="mx-auto h-8 w-8" />
                  <p>Henüz proje yok. Soldan bir boyut seçip başla.</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-5">
                <button onClick={() => create(true)} disabled={busy || !size} className="flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground disabled:opacity-50">
                  <Plus className="h-7 w-7" /> Boş tuval
                </button>
                {projects.map((p) => (
                  <div key={p.id} className="group">
                    <button onClick={() => onOpen(p.id)} className="block aspect-square w-full overflow-hidden rounded-xl bg-muted ring-1 ring-border transition hover:ring-2 hover:ring-primary">
                      {p.count ? (
                        <img src={projectThumbUrl(p.id, p.updated)} alt="" className="h-full w-full object-contain" loading="lazy" draggable={false} />
                      ) : (
                        <span className="grid h-full place-items-center text-xs text-muted-foreground">Boş proje</span>
                      )}
                    </button>
                    <div className="mt-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {renaming === p.id ? (
                          <Input autoFocus defaultValue={p.name} className="h-7 text-sm" onBlur={(e) => rename(p, e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
                        ) : (
                          <p className="truncate text-sm font-medium">{p.name}</p>
                        )}
                        <p className="text-[11px] text-muted-foreground">
                          {ago(p.updated)} · {p.count} sayfa{p.size ? ` · ${p.size[0]}×${p.size[1]}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
                        <button aria-label="Yeniden adlandır" className="rounded p-1 text-muted-foreground hover:text-foreground" onClick={() => setRenaming(p.id)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button aria-label="Sil" className="rounded p-1 text-muted-foreground hover:text-destructive" onClick={() => remove(p)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
