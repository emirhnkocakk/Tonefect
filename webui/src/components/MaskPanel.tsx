import { useEffect, useState } from "react"
import { Brush, Circle, Copy, Eraser, Loader2, Move, Image as ImageIcon, RotateCcw, SquareSplitVertical, Trash2, Undo2, User, Wand2 } from "lucide-react"
import { AiSetup, useAi } from "@/components/AiSetup"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { photoSize } from "@/lib/geo"
import { cn } from "@/lib/utils"
import type { Item, Mask, MaskAdjust, SelectOp, SelectTool } from "@/types"

type Props = {
  item: Item
  selected: string | null
  select: (id: string | null) => void
  setMasks: (m: Mask[]) => void
  show: boolean
  setShow: (v: boolean) => void
  tool: SelectTool
  setTool: (t: SelectTool) => void
  toLayer: (cut: boolean) => Promise<void>
  intent?: { cmd: string; n: number } | null
}

const KEYS: [keyof MaskAdjust, string][] = [
  ["exposure", "Pozlama"],
  ["contrast", "Kontrast"],
  ["highlights", "Parlak alanlar"],
  ["shadows", "Gölgeler"],
  ["temperature", "Sıcaklık"],
  ["tint", "Renk tonu"],
  ["saturation", "Doygunluk"],
  ["clarity", "Netlik"],
]
export const MAX_MASKS = 8

const label = (m: Mask, i: number) => `${m.type === "linear" ? "Degrade" : m.type === "select" ? "Seçim" : "Daire"} ${i + 1}`
const MODES: [SelectTool["mode"], string, typeof Wand2][] = [
  ["wand", "Değnek", Wand2],
  ["brush", "Fırça", Brush],
  ["erase", "Silgi", Eraser],
]
const MODE_HINT: Record<SelectTool["mode"], string> = {
  wand: "Fotoğrafta bir yere tıkla: benzer renkteki bölge seçilir. Alt + tıkla: seçimden çıkar.",
  brush: "Seçime eklemek için boya. Alt basılıyken boyarsan çıkarır.",
  erase: "Seçimden çıkarmak için boya.",
}

export function MaskPanel({ item, selected, select, setMasks, show, setShow, tool, setTool, toLayer, intent }: Props) {
  const [moving, setMoving] = useState(false)
  const runLayer = (cut: boolean) => {
    setMoving(true)
    toLayer(cut).finally(() => setMoving(false))
  }
  const masks = item.fx.masks ?? []
  const cur = masks.find((m) => m.id === selected) ?? null
  const set = (p: Partial<Mask>) => cur && setMasks(masks.map((m) => (m.id === cur.id ? { ...m, ...p } : m)))
  const ai = useAi()
  const subject = (inverse: boolean): SelectOp => ({ kind: "subject", add: true, inverse })
  const hasSubject = (inverse: boolean) => !!cur?.ops?.some((o) => o.kind === "subject" && o.inverse === inverse)

  const add = (type: Mask["type"], ops: SelectOp[] = []) => {
    const [w, h] = photoSize(item.geo, item.src) ?? [1080, 1350]
    const id = Math.random().toString(36).slice(2, 9)
    const m: Mask =
      type === "linear"
        ? { id, type, a: [0.5, 0.05], b: [0.5, 0.5], invert: false, adjust: { exposure: -0.3 } }
        : type === "select"
        ? { id, type, ops, feather: 0.1, invert: false, adjust: {} }
        : { id, type, c: [0.5, 0.5], r: [0.25, (0.25 * w) / h], feather: 0.5, invert: false, adjust: { exposure: 0.3 } }
    if (type === "select") setTool({ ...tool, mode: "wand" })
    setMasks([...masks, m])
    select(id)
  }

  // üst menüden: Seçim → Akıllı seçim / Konuyu seç / Degrade / Daire
  useEffect(() => {
    if (!intent || masks.length >= MAX_MASKS) return
    if (intent.cmd === "mask:select") add("select")
    else if (intent.cmd === "mask:linear") add("linear")
    else if (intent.cmd === "mask:radial") add("radial")
    else if (intent.cmd === "mask:subject" && ai.ready) add("select", [subject(false)])
    else if (intent.cmd === "mask:background" && ai.ready) add("select", [subject(true)])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent])

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label id="sec-select">Yerel düzenlemeler</Label>
        <p className="text-[11px] text-muted-foreground">
          Yalnızca bir bölgeyi değiştir. Akıllı seçim ile tıklayarak ya da boyayarak seç; degrade gökyüzü için, daire bir yüzü öne çıkarmak için.
        </p>
        <Button className="w-full" disabled={masks.length >= MAX_MASKS} onClick={() => add("select")}>
          <Wand2 className="!size-4" /> Akıllı seçim
        </Button>
        {ai.ready && (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="sm" disabled={masks.length >= MAX_MASKS} onClick={() => add("select", [subject(false)])}>
              <User className="!size-4" /> Konuyu seç
            </Button>
            <Button variant="secondary" size="sm" disabled={masks.length >= MAX_MASKS} onClick={() => add("select", [subject(true)])}>
              <ImageIcon className="!size-4" /> Arka planı seç
            </Button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="sm" disabled={masks.length >= MAX_MASKS} onClick={() => add("linear")}>
            <SquareSplitVertical className="!size-4" /> Degrade
          </Button>
          <Button variant="secondary" size="sm" disabled={masks.length >= MAX_MASKS} onClick={() => add("radial")}>
            <Circle className="!size-4" /> Daire
          </Button>
        </div>
      </div>

      {masks.length > 0 && (
        <div className="space-y-1.5">
          {masks.map((m, i) => (
            <div
              key={m.id}
              onClick={() => select(m.id === selected ? null : m.id)}
              className={cn(
                "group flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors hover:border-primary/60",
                m.id === selected ? "border-primary/70 bg-primary/15" : "text-muted-foreground"
              )}
            >
              <span className="flex items-center gap-2">
                {m.type === "linear" ? <SquareSplitVertical className="h-4 w-4" /> : m.type === "select" ? <Wand2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                {label(m, i)}
                {m.invert && <span className="text-[10px] opacity-70">(ters)</span>}
              </span>
              <button
                aria-label="Sil"
                onClick={(e) => {
                  e.stopPropagation()
                  setMasks(masks.filter((x) => x.id !== m.id))
                  if (m.id === selected) select(null)
                }}
                className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {cur ? (
        <div className="space-y-4">
          {cur.type === "select" && (
            <div className="space-y-3 rounded-lg border p-3">
              {ai.ready ? (
                <div className="grid grid-cols-2 gap-1.5">
                  <Button variant="secondary" size="sm" className="text-xs" disabled={hasSubject(false)} onClick={() => set({ ops: [...(cur.ops ?? []), subject(false)] })}>
                    <User className="!size-3.5" /> Konuyu seç
                  </Button>
                  <Button variant="secondary" size="sm" className="text-xs" disabled={hasSubject(true)} onClick={() => set({ ops: [...(cur.ops ?? []), subject(true)] })}>
                    <ImageIcon className="!size-3.5" /> Arka planı seç
                  </Button>
                </div>
              ) : (
                <AiSetup what="Konuyu ya da arka planı tek tıkla seçmek" />
              )}
              <div className="grid grid-cols-3 gap-1.5">
                {MODES.map(([m, name, Icon]) => (
                  <button
                    key={m}
                    onClick={() => setTool({ ...tool, mode: m })}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-md border py-2 text-[11px] transition-colors hover:border-primary/60",
                      tool.mode === m ? "border-primary/70 bg-primary/15 text-foreground" : "text-muted-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4" /> {name}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">{MODE_HINT[tool.mode]}</p>
              {tool.mode === "wand" ? (
                <>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs"><span className="text-muted-foreground">Tolerans</span><span>{Math.round(tool.tol * 100)}</span></div>
                    <Slider min={1} max={100} step={1} value={[Math.round(tool.tol * 100)]} onValueChange={([v]) => setTool({ ...tool, tol: v / 100 })} />
                    <p className="text-[10px] text-muted-foreground">Düşük: yalnızca çok benzer renkler · Yüksek: geniş bir alan</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Yalnızca bitişik alan</span>
                    <Switch checked={tool.contiguous} onCheckedChange={(v) => setTool({ ...tool, contiguous: v })} />
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs"><span className="text-muted-foreground">Fırça boyutu</span><span>{Math.round(tool.size * 100)}</span></div>
                    <Slider min={1} max={30} step={1} value={[Math.round(tool.size * 100)]} onValueChange={([v]) => setTool({ ...tool, size: v / 100 })} />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs"><span className="text-muted-foreground">Sertlik</span><span>{Math.round(tool.hard * 100)}%</span></div>
                    <Slider min={0} max={100} step={1} value={[Math.round(tool.hard * 100)]} onValueChange={([v]) => setTool({ ...tool, hard: v / 100 })} />
                  </div>
                </>
              )}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs"><span className="text-muted-foreground">Kenar yumuşatma</span><span>{Math.round((cur.feather ?? 0.1) * 100)}%</span></div>
                <Slider min={0} max={100} step={1} value={[Math.round((cur.feather ?? 0.1) * 100)]} onValueChange={([v]) => set({ feather: v / 100 })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="ghost" size="sm" className="text-xs" disabled={!cur.ops?.length} onClick={() => set({ ops: (cur.ops ?? []).slice(0, -1) })}>
                  <Undo2 className="!size-3.5" /> Son adım
                </Button>
                <Button variant="ghost" size="sm" className="text-xs" disabled={!cur.ops?.length} onClick={() => set({ ops: [] })}>
                  <RotateCcw className="!size-3.5" /> Temizle
                </Button>
              </div>
              {!!cur.ops?.length && (
                <div className="space-y-1.5 border-t pt-3">
                  <div className="grid grid-cols-2 gap-1.5">
                    <Button variant="secondary" size="sm" className="text-xs" disabled={moving} onClick={() => runLayer(false)} title="Seçili alanı yeni bir katmana kopyala; taşıyıp boyutlandırabilirsin">
                      {moving ? <Loader2 className="!size-3.5 animate-spin" /> : <Copy className="!size-3.5" />} Katmana kopyala
                    </Button>
                    <Button variant="secondary" size="sm" className="text-xs" disabled={moving} onClick={() => runLayer(true)} title="Seçili alanı taşı: yeni katman olur, eski yeri çevresinden doldurulur">
                      {moving ? <Loader2 className="!size-3.5 animate-spin" /> : <Move className="!size-3.5" />} Taşı
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Alan Tasarım aracında katman olur: sürükleyip taşı, köşeden büyüt ya da küçült, döndür.</p>
                  {cur.fill && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Eski yeri doldur</span>
                      <Switch checked onCheckedChange={(v) => set({ fill: v })} />
                    </div>
                  )}
                </div>
              )}
              {!cur.ops?.length && <p className="text-[11px] font-medium text-primary">Başlamak için fotoğrafta seçmek istediğin yere tıkla{ai.ready ? " ya da konuyu yapay zekâyla seç" : ""}.</p>}
              {hasSubject(false) || hasSubject(true) ? <p className="text-[11px] text-muted-foreground">Kaçan yerleri fırçayla ekle, fazlasını silgiyle çıkar.</p> : null}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            {cur.type === "select"
              ? "Seçilen bölge kırmızıyla gösterilir. Aşağıdaki ayarlar yalnızca o bölgeye uygulanır."
              : cur.type === "linear"
              ? "Önizlemedeki tutamaçları sürükle: dolu çizgide tam etki, kesikli çizgide etki biter. Ortadaki tutamaç ikisini birlikte taşır."
              : "Ortadaki tutamaçla taşı, kenardakilerle genişlet. İçte tam etki, kesikli çizgiden sonra yumuşakça azalır."}
          </p>
          {cur.type !== "select" && (
            <div className="flex items-center justify-between">
              <Label>Maskeyi göster</Label>
              <Switch checked={show} onCheckedChange={setShow} />
            </div>
          )}
          <div className="flex items-center justify-between">
            <div>
              <Label>Tersine çevir</Label>
              <p className="text-[11px] text-muted-foreground">Seçili bölgenin dışını etkiler</p>
            </div>
            <Switch checked={cur.invert} onCheckedChange={(v) => set({ invert: v })} />
          </div>
          {cur.type === "radial" && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Yumuşaklık</span>
                <span>{Math.round((cur.feather ?? 0.5) * 100)}%</span>
              </div>
              <Slider min={0} max={100} step={1} value={[Math.round((cur.feather ?? 0.5) * 100)]} onValueChange={([v]) => set({ feather: v / 100 })} />
            </div>
          )}
          <div className="flex items-center justify-between">
            <Label>Bu bölgenin ayarları</Label>
            <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary" onClick={() => set({ adjust: {} })}>
              <RotateCcw className="h-3 w-3" /> sıfırla
            </button>
          </div>
          {KEYS.map(([k, name]) => {
            const v = Math.round((cur.adjust[k] ?? 0) * 100)
            return (
              <div key={k} className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="cursor-default text-muted-foreground" onDoubleClick={() => set({ adjust: { ...cur.adjust, [k]: 0 } })} title="Çift tıkla: sıfırla">
                    {name}
                  </span>
                  <span className={cn(v ? "text-foreground" : "text-muted-foreground")}>{v > 0 ? `+${v}` : v}</span>
                </div>
                <Slider min={-100} max={100} step={1} value={[v]} onValueChange={([x]) => set({ adjust: { ...cur.adjust, [k]: x / 100 } })} />
              </div>
            )
          })}
          <p className="text-[11px] text-muted-foreground">Ayarı hep sıfır olan maske görsele etki etmez.</p>
        </div>
      ) : (
        masks.length > 0 && <p className="text-[11px] text-muted-foreground">Düzenlemek için bir maske seç.</p>
      )}
    </div>
  )
}
