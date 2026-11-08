import { Move, Type } from "lucide-react"
import { BRUSH_MODES } from "@/lib/brushes"
import { ASPECTS, canvasSize, photoSize } from "@/lib/geo"
import { RETOUCH_MODES } from "@/lib/retouch"
import { selectEntry } from "@/lib/selection"
import { XFORM_MODES } from "@/lib/transform"
import { TOOLS } from "@/lib/tools"
import { PEN_TOOLS } from "@/lib/paths"
import { cn } from "@/lib/utils"
import type { BrushSettings, BrushTool, CloneSource, Geo, ImgLayer, Item, MaskPaintTool, Mode, PenTool, SelectTool, XformMode } from "@/types"

type Props = {
  tab: string
  item?: Item
  run: (cmd: string) => void
  brushTool: BrushTool
  brush: BrushSettings
  setBrush: (p: Partial<BrushSettings>) => void
  retouchTool: BrushTool
  retouchBrush: BrushSettings
  setRetouchBrush: (p: Partial<BrushSettings>) => void
  cloneSource: CloneSource | null
  armSource: () => void
  selTool: SelectTool
  setSelTool: (t: SelectTool) => void
  xform: XformMode
  setXform: (m: XformMode) => void
  layerSel: string[]
  putLayer: (id: string, p: Partial<ImgLayer>) => void
  setGeo: (p: Partial<Geo>) => void
  sliceTool: "draw" | "select"
  mode: Mode
  setMode: (m: Mode) => void
  eraseMode: "" | "layermask" | "vector"
  maskTool: MaskPaintTool
  setMaskTool: (t: MaskPaintTool) => void
  textColor: string
  setTextColor: (c: string | undefined) => void
  penTool: PenTool
  setPenTool: (t: PenTool) => void
}

function Num({ label, v, min, max, unit = "", set, slider = true, title }: { label: string; v: number; min: number; max: number; unit?: string; set: (x: number) => void; slider?: boolean; title?: string }) {
  const clamp = (x: number) => Math.max(min, Math.min(max, x))
  return (
    <label className="flex items-center gap-1 text-[11px] text-muted-foreground" title={title}>
      {label}
      <input aria-label={label} type="number" min={min} max={max} value={v} onChange={(e) => e.target.value !== "" && set(clamp(Number(e.target.value)))} className="h-6 w-[46px] rounded-sm border bg-background px-1 text-center text-[11px] text-foreground" />
      {unit && <span>{unit}</span>}
      {slider && <input aria-hidden tabIndex={-1} type="range" min={min} max={max} value={v} onChange={(e) => set(Number(e.target.value))} className="h-1 w-16 accent-[hsl(var(--primary))]" />}
    </label>
  )
}
const Chip = ({ on, onClick, children, title }: { on?: boolean; onClick: () => void; children: React.ReactNode; title?: string }) => (
  <button title={title} onClick={onClick} className={cn("h-6 whitespace-nowrap rounded-sm border px-2 text-[11px] transition-colors hover:border-primary/60", on ? "border-primary/70 bg-primary/20 text-foreground" : "text-muted-foreground")}>{children}</button>
)
const Sep = () => <span className="mx-1 h-4 w-px shrink-0 bg-border" />
const Name = ({ children }: { children: React.ReactNode }) => <span className="shrink-0 text-[11px] font-medium">{children}</span>
const Hint = ({ children }: { children: React.ReactNode }) => <span className="truncate text-[11px] text-muted-foreground">{children}</span>
const pct = (v: number) => Math.round(v * 100)

const TOLERANT = new Set(["replace", "bgerase", "magic"])
const STRENGTH = new Set(["dodge", "burn", "blemish", "wrinkle", "eye", "sharpen"])
const SOURCE = new Set(["clone", "heal"])

/** Photoshop'taki üst seçenekler çubuğu: etkin aracın en sık kullanılan ayarları. Ayrıntılar sağdaki panelde. */
export function OptionsBar(p: Props) {
  const { tab, item } = p
  const short = Math.min(...((item && photoSize(item.geo, item.src)) ?? [1080, 1350]))
  const brushOpts = (b: BrushSettings, set: (x: Partial<BrushSettings>) => void, tool: BrushTool, name?: string) => (
    <>
      <Name>{name}</Name>
      <Sep />
      <Num label="Boyut" unit="px" min={1} max={Math.round(short * 0.6)} v={Math.max(1, Math.round(b.size * short))} set={(x) => set({ size: x / short })} />
      <Num label="Sertlik" unit="%" min={0} max={100} v={pct(b.hard)} set={(x) => set({ hard: x / 100 })} />
      <Num label="Opaklık" unit="%" min={0} max={100} v={pct(b.opacity)} set={(x) => set({ opacity: x / 100 })} />
      <Num label="Akış" unit="%" min={0} max={100} v={pct(b.flow)} set={(x) => set({ flow: x / 100 })} />
      {TOLERANT.has(tool) && <Num label="Tolerans" unit="%" min={0} max={100} v={pct(b.tol)} set={(x) => set({ tol: x / 100 })} />}
      {STRENGTH.has(tool) && <Num label="Güç" unit="%" min={0} max={100} v={pct(b.amount)} set={(x) => set({ amount: x / 100 })} />}
      {SOURCE.has(tool) && <><Sep /><Chip on={b.aligned} onClick={() => set({ aligned: !b.aligned })}>Hizalı</Chip><Chip on={!!p.cloneSource} onClick={p.armSource} title="Alt+tıkla ile de seçebilirsin">Kaynak Seç</Chip></>}
    </>
  )

  let body: React.ReactNode
  if (!item && tab !== "") body = <Hint>Önce bir fotoğraf aç (Ctrl+O).</Hint>
  else if (tab === "brush") body = brushOpts(p.brush, p.setBrush, p.brushTool, BRUSH_MODES.find((t) => t.tool === p.brushTool)?.label)
  else if (tab === "retouch") body = brushOpts(p.retouchBrush, p.setRetouchBrush, p.retouchTool, RETOUCH_MODES.find((t) => t.tool === p.retouchTool)?.label)
  else if (tab === "design" && item) {
    const [W, H] = canvasSize(item.geo, item.src) ?? [1080, 1350]
    const cur = p.layerSel.length === 1 ? item.layers?.find((l) => l.id === p.layerSel[0]) : undefined
    const entry = XFORM_MODES.find((t) => t.mode === p.xform)
    body = (
      <>
        <div className="flex shrink-0 gap-px">
          {XFORM_MODES.map((t) => {
            const I = t.icon
            return <button key={t.cmd} aria-label={t.label} title={`${t.label} · ${t.en}`} onClick={() => p.setXform(t.mode!)} className={cn("grid h-6 w-6 place-items-center rounded-sm", p.xform === t.mode ? "bg-primary/25 text-foreground" : "text-muted-foreground hover:bg-accent")}><I className="h-3.5 w-3.5" strokeWidth={1.8} /></button>
          })}
        </div>
        <Sep />
        {cur ? (
          <>
            <Num slider={false} label="X" unit="px" min={-20000} max={20000} v={Math.round(cur.x * W)} set={(x) => p.putLayer(cur.id, { x: x / W })} />
            <Num slider={false} label="Y" unit="px" min={-20000} max={20000} v={Math.round(cur.y * H)} set={(y) => p.putLayer(cur.id, { y: y / H })} />
            <Num slider={false} label="G" unit="%" title="Genişlik (tuvale göre)" min={1} max={500} v={pct(cur.w)} set={(w) => p.putLayer(cur.id, { w: w / 100 })} />
            <Num slider={false} label="Açı" unit="°" min={-180} max={180} v={Math.round(cur.rot)} set={(rot) => p.putLayer(cur.id, { rot })} />
            <Num label="Opaklık" unit="%" min={0} max={100} v={pct(cur.opacity)} set={(x) => p.putLayer(cur.id, { opacity: x / 100 })} />
            <Sep />
          </>
        ) : null}
        <Hint>{entry?.hint}</Hint>
      </>
    )
  } else if (tab === "select") {
    const t = p.selTool
    const entry = selectEntry(t.mode)
    const usesTol = t.mode === "wand" || t.mode === "quick" || t.mode === "range"
    const usesBrush = t.mode === "quick" || t.mode === "brush" || t.mode === "erase"
    body = (
      <>
        <Name>{entry?.label}</Name>
        <Sep />
        {([["add", "Ekle"], ["sub", "Çıkar"], ["intersect", "Kesiştir"]] as const).map(([c, l]) => <Chip key={c} on={t.combine === c} onClick={() => p.setSelTool({ ...t, combine: c })}>{l}</Chip>)}
        <Sep />
        {usesTol && <Num label="Tolerans" min={1} max={100} v={pct(t.tol)} set={(x) => p.setSelTool({ ...t, tol: x / 100 })} />}
        {t.mode === "wand" && <Chip on={t.contiguous} onClick={() => p.setSelTool({ ...t, contiguous: !t.contiguous })}>Bitişik</Chip>}
        {usesBrush && <Num label="Boyut" unit="%" min={1} max={30} v={pct(t.size)} set={(x) => p.setSelTool({ ...t, size: x / 100 })} />}
        {(t.mode === "rect" || t.mode === "ellipse" || t.mode === "lasso" || t.mode === "poly" || t.mode === "magnetic") && (
          <>
            <Chip on={!t.noObject} title="Açıkken çizdiğin alan hemen ayrı bir katman olur. Kapalıyken seçim olarak kalır." onClick={() => p.setSelTool({ ...t, noObject: !t.noObject })}>Nesne Yap</Chip>
            {!t.noObject && <Chip on={!!t.cutObject} title="Alanı kopyalamak yerine fotoğraftan alır, boşluğu çevreden doldurur" onClick={() => p.setSelTool({ ...t, cutObject: !t.cutObject })}>Yerinden Kes</Chip>}
            <Sep />
          </>
        )}
        <Chip onClick={() => p.run("sel:subject")}>Konuyu Seç</Chip>
        <Chip onClick={() => p.run("sel:refine")}>Seç ve Maskele</Chip>
      </>
    )
  } else if (tab === "crop" && item) {
    const g = item.geo
    body = (
      <>
        <Name>Kırp</Name>
        <Sep />
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">Oran
          <select aria-label="Kırpma oranı" value={g?.aspect ?? "original"} onChange={(e) => p.setGeo({ aspect: e.target.value, crop: null, outW: null, outH: null, lock: true })} className="h-6 rounded-sm border bg-background px-1 text-[11px] text-foreground">
            {[...ASPECTS.map(([v, l]) => [v, l]), ...(ASPECTS.some(([v]) => v === g?.aspect) || !g?.aspect ? [] : [[g.aspect, g.aspect]])].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <Chip onClick={() => p.run("crop:line")}>Düzelt</Chip>
        <Chip onClick={() => p.run("crop:persp")}>Perspektif</Chip>
        <Chip onClick={() => p.setGeo({ crop: null })}>Sıfırla</Chip>
        <Sep />
        <Hint>Çerçeveyi sürükle, köşelerden boyutlandır. Bitince başka bir araca geç.</Hint>
      </>
    )
  } else if (tab === "slice") {
    body = <><Name>Dilim</Name><Sep /><Chip on={p.sliceTool === "draw"} onClick={() => p.run("slice:draw")}>Çiz</Chip><Chip on={p.sliceTool === "select"} onClick={() => p.run("slice:select")}>Seç</Chip></>
  } else if (tab === "text") {
    body = (
      <>
        <Name>Yazı</Name>
        <Sep />
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground" title="Kelime seçiliyse yalnızca onlara, değilse tüm yazıya">Renk
          <span className="relative h-5 w-5 overflow-hidden rounded-sm border" style={{ background: p.textColor }}>
            <input aria-label="Yazı rengi" type="color" value={p.textColor.toLowerCase()} onChange={(e) => p.setTextColor(e.target.value.toUpperCase())} className="absolute inset-0 cursor-pointer opacity-0" />
          </span>
        </label>
        <Sep />
        <Chip on={p.mode === "block"} onClick={() => p.setMode("block")}><span className="flex items-center gap-1"><Move className="h-3 w-3" /> Tüm Metin</span></Chip>
        <Chip on={p.mode === "word"} onClick={() => p.setMode("word")}><span className="flex items-center gap-1"><Type className="h-3 w-3" /> Tek Kelime</span></Chip>
        <Sep />
        <Chip onClick={() => p.run("layer:new:text")}>Metin Katmanı Ekle</Chip>
      </>
    )
  } else if (tab === "erase" && p.eraseMode === "layermask") {
    const t = p.maskTool
    body = (
      <>
        <Name>Katman Maskesi</Name>
        <Sep />
        <Chip on={t.paint === "hide"} onClick={() => p.setMaskTool({ ...t, paint: "hide" })}>Gizle</Chip>
        <Chip on={t.paint === "show"} onClick={() => p.setMaskTool({ ...t, paint: "show" })}>Göster</Chip>
        <Num label="Boyut" unit="%" min={1} max={100} v={pct(t.size)} set={(x) => p.setMaskTool({ ...t, size: x / 100 })} />
        <Num label="Sertlik" unit="%" min={0} max={100} v={pct(t.hard)} set={(x) => p.setMaskTool({ ...t, hard: x / 100 })} />
      </>
    )
  } else if (tab === "paths") {
    const has = !!item?.paths?.length
    body = (
      <>
        <div className="flex shrink-0 gap-px">
          {PEN_TOOLS.map((t) => {
            const I = t.icon
            return <button key={t.id} aria-label={t.label} title={`${t.label} · ${t.en}`} onClick={() => p.setPenTool(t.id)} className={cn("grid h-6 w-6 place-items-center rounded-sm", p.penTool === t.id ? "bg-primary/25 text-foreground" : "text-muted-foreground hover:bg-accent")}><I className="h-3.5 w-3.5" strokeWidth={1.8} /></button>
          })}
        </div>
        <Sep />
        {has && <><Chip onClick={() => p.run("path:selection")} title="Ctrl+Enter">Seçim</Chip><Chip onClick={() => p.run("path:mask")}>Maske</Chip><Chip onClick={() => p.run("path:fill")}>Doldur</Chip><Chip onClick={() => p.run("path:stroke")}>Kontur</Chip><Sep /></>}
        <Hint>{PEN_TOOLS.find((t) => t.id === p.penTool)?.hint}</Hint>
      </>
    )
  } else if (tab === "eyedrop") body = <><Name>Damlalık</Name><Sep /><Hint>Görüntüye tıkla: renk ön plan rengi olur.</Hint></>
  else if (tab === "hand") body = <><Name>El</Name><Sep /><Chip onClick={() => p.run("view:100")}>%100</Chip><Chip onClick={() => p.run("view:fit")}>Ekrana Sığdır</Chip><Sep /><Hint>Yakınlaştırılmış görüntüyü sürükleyerek gez.</Hint></>
  else if (tab === "zoom") body = <><Name>Yakınlaştırma</Name><Sep /><Chip onClick={() => p.run("view:100")}>%100</Chip><Chip onClick={() => p.run("view:fit")}>Ekrana Sığdır</Chip><Sep /><Hint>Tıkla: yakınlaştır. Alt+tıkla: uzaklaştır.</Hint></>
  else {
    const t = TOOLS.find(([id]) => id === tab)
    body = t ? <><Name>{t[1]}</Name><Sep /><Hint>{t[2]}</Hint></> : <Hint>Soldan bir araç seç. Kısayol listesi için F1.</Hint>
  }
  return <div className="flex h-8 shrink-0 items-center gap-1.5 overflow-x-auto border-b bg-card px-2">{body}</div>
}
