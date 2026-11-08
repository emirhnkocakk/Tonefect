import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { X } from "lucide-react"
import { useEffect } from "react"
import { TOOLS } from "@/lib/tools"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { TONE_INFO } from "@/lib/constants"
import { words } from "@/lib/text"
import { cn } from "@/lib/utils"
import { ColorPanel } from "@/components/ColorPanel"
import { FxPanel } from "@/components/FxPanel"
import { FramePanel } from "@/components/FramePanel"
import { MaskPanel } from "@/components/MaskPanel"
import { SelectionPanel } from "@/components/SelectionPanel"
import { SlicePanel } from "@/components/SlicePanel"
import { BrushPanel } from "@/components/BrushPanel"
import { ErasePanel } from "@/components/ErasePanel"
import { RetouchPanel } from "@/components/RetouchPanel"
import { LayerPropsPanel } from "@/components/LayerPropsPanel"
import type { ColorPick } from "@/components/ColorTools"
import type { LiquifyTool } from "@/lib/filters"
import { TextStylePanel } from "@/components/TextStylePanel"
import { GeoPanel } from "@/components/GeoPanel"
import { canvasSize, legacyGeo } from "@/lib/geo"
import { DesignPanel } from "@/components/DesignPanel"
import type { BrushSettings, BrushTool, CloneSource, MaskPaintTool, Settings, Config, Fx, Geo, ImgLayer, Item, Mask, PresetMeta, SelectTool, Slice, XformMode } from "@/types"
import type { XformDelta } from "@/lib/transform"

type Props = {
  item?: Item
  items: Item[]
  cfg: Config
  selected: number[]
  setSelected: (s: number[]) => void
  setText: (t: string) => void
  patch: (p: Partial<Item>, all?: boolean) => void
  presets: PresetMeta[]
  groups: string[]
  onPresetsChange: () => Promise<void>
  tab: string
  setTab: (t: string) => void
  setGeo: (p: Partial<Geo>) => void
  applyAllGeo: () => void
  onCopy: () => void
  onPaste: () => void
  canPaste: boolean
  maskSel: string | null
  setMaskSel: (id: string | null) => void
  setMasks: (m: Mask[]) => void
  maskShow: boolean
  setMaskShow: (v: boolean) => void
  selTool: SelectTool
  setSelTool: (t: SelectTool) => void
  perspEdit: boolean
  setPerspEdit: (v: boolean) => void
  setLayers: (l: ImgLayer[]) => void
  layerSel: string[]
  setLayerSel: (ids: string[]) => void
  selectionToLayer: (cut: boolean) => Promise<void>
  lineMode: boolean
  setLineMode: (v: boolean) => void
  sliceTool: "draw" | "select"
  setSliceTool: (t: "draw" | "select") => void
  sliceSel: string | null
  setSliceSel: (id: string | null) => void
  setSlices: (s: Slice[]) => void
  exportSlices: () => void
  eraseMode: "" | "layermask" | "vector"
  setEraseMode: (m: "" | "layermask" | "vector") => void
  maskTool: MaskPaintTool
  setMaskTool: (t: MaskPaintTool) => void
  addSpecial: (t: "fillgaps" | "colorkey") => void
  command: (cmd: string) => void
  brushTool: BrushTool
  setBrushTool: (t: BrushTool) => void
  filterSel: string | null
  setFilterSel: (id: string | null) => void
  liquify: LiquifyTool
  setLiquify: (p: Partial<LiquifyTool>) => void
  previewImg: string | null
  setPick: (f: ColorPick | null) => void
  retouchTool: BrushTool
  setRetouchTool: (t: BrushTool) => void
  retouchBrush: BrushSettings
  setRetouchBrush: (p: Partial<BrushSettings>) => void
  cloneSource: CloneSource | null
  armSource: () => void
  patchMode: Record<string, string>
  setPatchMode: (tool: string, v: string) => void
  brush: BrushSettings
  setBrush: (p: Partial<BrushSettings>) => void
  smoothing: number
  setSmoothing: (v: number) => void
  settings: Settings
  setSettings: (s: Settings) => void
  xform: XformMode
  setXform: (m: XformMode) => void
  xformDelta: XformDelta | null
  section: { id: string; n: number } | null // menüden gelinen bölüm: oraya kaydırılır
  intent: { cmd: string; n: number } | null // menüden gelen işlem (örn. yeni seçim, görsel ekle)
  onClose: () => void
}

export function Panel({ item, items, cfg, selected, setSelected, setText, patch, presets, groups, onPresetsChange, tab, setTab, setGeo, applyAllGeo, onCopy, onPaste, canPaste, maskSel, setMaskSel, setMasks, maskShow, setMaskShow, selTool, setSelTool, perspEdit, setPerspEdit, setLayers, layerSel, setLayerSel, selectionToLayer, lineMode, setLineMode, sliceTool, setSliceTool, sliceSel, setSliceSel, setSlices, exportSlices, eraseMode, setEraseMode, maskTool, setMaskTool, addSpecial, command, brushTool, setBrushTool, filterSel, setFilterSel, liquify, setLiquify, previewImg, setPick, retouchTool, setRetouchTool, retouchBrush, setRetouchBrush, cloneSource, armSource, patchMode, setPatchMode, brush, setBrush, smoothing, setSmoothing, settings, setSettings, xform, setXform, xformDelta, section, intent, onClose }: Props) {
  const ws = item ? words(item.text) : []
  const max = cfg.limits.max_words
  const setFx = (p: Partial<Fx>, all = false) => item && patch({ fx: { ...item.fx, ...p } }, all)
  useEffect(() => {
    if (!section) return
    const t = setTimeout(() => {
      const el = document.getElementById("sec-" + section.id)
      if (!el) return
      el.scrollIntoView({ behavior: "smooth", block: "start" })
      el.classList.add("menu-flash")
      setTimeout(() => el.classList.remove("menu-flash"), 1200)
    }, 60)
    return () => clearTimeout(t)
  }, [section])

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-r bg-card/40">
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        {(() => {
          const t = TOOLS.find(([id]) => id === tab)
          return t ? (
            <div className="flex items-start justify-between px-4 pb-3 pt-4">
              <div>
                <p className="text-sm font-semibold">{t[1]}</p>
                <p className="text-[11px] text-muted-foreground">{t[2]}</p>
              </div>
              <button aria-label="Paneli kapat" title="Paneli kapat" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null
        })()}

        <TabsContent value="crop" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-1">
          {!item ? (
            <p className="pt-6 text-sm text-muted-foreground">Önce bir fotoğraf ekle.</p>
          ) : (
            <GeoPanel item={item} geo={item.geo ?? legacyGeo()} setGeo={setGeo} applyAll={applyAllGeo} perspEdit={perspEdit} setPerspEdit={setPerspEdit} lineMode={lineMode} setLineMode={setLineMode} />
          )}
        </TabsContent>

        <TabsContent value="text" className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
          {!item ? (
            <p className="pt-6 text-sm text-muted-foreground">Önce bir fotoğraf ekle.</p>
          ) : (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Cümle</Label>
                  <span className={cn("text-xs", max && ws.length > max ? "text-destructive" : "text-muted-foreground")}>
                    {ws.length}{max ? ` / ${max}` : ""} kelime
                  </span>
                </div>
                <Textarea
                  value={item.text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Vizyon cümleni yaz…"
                  className="min-h-[104px] resize-none text-sm"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Ton</Label>
                  <button className="text-xs text-muted-foreground hover:text-primary" onClick={() => patch({ tone: item.tone }, true)}>
                    hepsine uygula
                  </button>
                </div>
                <ToggleGroup type="single" value={item.tone} onValueChange={(v) => v && patch({ tone: v })} className="grid grid-cols-2 gap-2">
                  {cfg.tones.map((t) => (
                    <ToggleGroupItem key={t} value={t} className="h-auto flex-col items-start gap-0.5 rounded-lg border px-3 py-2 data-[state=on]:border-primary/60 data-[state=on]:bg-primary/15 data-[state=on]:text-foreground">
                      <span className="text-sm font-medium">{TONE_INFO[t]?.label ?? t}</span>
                      <span className="text-[11px] font-normal text-muted-foreground">{TONE_INFO[t]?.desc}</span>
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              <TextStylePanel item={item} patch={(p) => patch(p)} />

              <div className="space-y-2">
                <Label>Vurgu kelimesi (altın)</Label>
                <Input value={item.accent} onChange={(e) => patch({ accent: e.target.value })} placeholder="örn. discipline" />
              </div>

              {ws.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Kelimeler</Label>
                    <button className="text-xs text-muted-foreground hover:text-primary" onClick={() => setSelected(ws.map((_, i) => i))}>
                      tümünü seç
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {ws.map((w, i) => {
                      const on = selected.includes(i)
                      const st = item.styles[i] ?? {}
                      const styled = Object.keys(st).length > 0 || !!item.offsets[i]
                      return (
                        <button
                          key={i}
                          onClick={(e) =>
                            setSelected(e.shiftKey || e.ctrlKey || e.metaKey ? (on ? selected.filter((x) => x !== i) : [...selected, i]) : on && selected.length === 1 ? [] : [i])
                          }
                          className={cn(
                            "rounded-md border px-2 py-1 text-xs transition-colors hover:border-primary/60",
                            on ? "border-primary bg-primary/15 text-foreground" : "text-muted-foreground",
                            styled && !on && "border-primary/30"
                          )}
                        >
                          {w}
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground">Seç, sonra görselin üstündeki çubuktan renk/kalınlık/boyut ver. Shift ile çoklu seç.</p>
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="color" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-1">
          <ColorPanel item={item} presets={presets} groups={groups} setFx={setFx} onPresetsChange={onPresetsChange} onCopy={onCopy} onPaste={onPaste} canPaste={canPaste} items={items} preview={previewImg} setPick={setPick} intent={intent} />
        </TabsContent>

        <TabsContent value="erase" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-1">
          {!item ? (
            <p className="pt-6 text-sm text-muted-foreground">Önce bir fotoğraf ekle.</p>
          ) : (
            <ErasePanel item={item} setFx={(p) => setFx(p)} setMasks={setMasks} maskSel={maskSel} layers={item.layers ?? []} setLayers={setLayers} sel={layerSel} setSel={setLayerSel} mode={eraseMode} setMode={setEraseMode} tool={maskTool} setTool={setMaskTool} addSpecial={addSpecial} run={command} intent={intent} />
          )}
        </TabsContent>

        <TabsContent value="layers" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-1">
          {!item ? (
            <p className="pt-6 text-sm text-muted-foreground">Önce bir fotoğraf ekle.</p>
          ) : (
            <LayerPropsPanel item={item} items={items} layers={item.layers ?? []} sel={layerSel} setLayers={setLayers} patchItem={(p) => patch(p)} presets={presets} onPresetsChange={onPresetsChange} preview={previewImg} setPick={setPick} run={command} intent={intent} />
          )}
        </TabsContent>

        <TabsContent value="retouch" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-1">
          {!item ? (
            <p className="pt-6 text-sm text-muted-foreground">Önce bir fotoğraf ekle.</p>
          ) : (
            <RetouchPanel item={item} tool={retouchTool} setTool={setRetouchTool} brush={retouchBrush} setBrush={setRetouchBrush} setFx={(p) => setFx(p)} patchItem={(p) => patch(p)} maskSel={maskSel} source={cloneSource} armSource={armSource} patchMode={patchMode} setPatchMode={setPatchMode} settings={settings} setSettings={setSettings} intent={intent} />
          )}
        </TabsContent>

        <TabsContent value="brush" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-1">
          {!item ? (
            <p className="pt-6 text-sm text-muted-foreground">Önce bir fotoğraf ekle.</p>
          ) : (
            <BrushPanel item={item} tool={brushTool} setTool={setBrushTool} brush={brush} setBrush={setBrush} smoothing={smoothing} setSmoothing={setSmoothing} patchItem={(p) => patch(p)} settings={settings} setSettings={setSettings} intent={intent} target={item.layers?.find((l) => l.id === layerSel[0] && l.kind === "blank")?.name} />
          )}
        </TabsContent>

        <TabsContent value="slice" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-1">
          {!item ? (
            <p className="pt-6 text-sm text-muted-foreground">Önce bir fotoğraf ekle.</p>
          ) : (
            <SlicePanel item={item} tool={sliceTool} setTool={setSliceTool} sel={sliceSel} setSel={setSliceSel} setSlices={setSlices} onExport={exportSlices} />
          )}
        </TabsContent>

        <TabsContent value="select" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-1">
          {!item ? (
            <p className="pt-6 text-sm text-muted-foreground">Önce bir fotoğraf ekle.</p>
          ) : (
            <SelectionPanel item={item} selected={maskSel} select={setMaskSel} setMasks={setMasks} tool={selTool} setTool={setSelTool} toLayer={selectionToLayer} patchItem={(p) => patch(p)} intent={intent} />
          )}
        </TabsContent>

        <TabsContent value="local" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-1">
          {!item ? (
            <p className="pt-6 text-sm text-muted-foreground">Önce bir fotoğraf ekle.</p>
          ) : (
            <MaskPanel item={item} selected={maskSel} select={setMaskSel} setMasks={setMasks} show={maskShow} setShow={setMaskShow} intent={intent} />
          )}
        </TabsContent>

        <TabsContent value="design" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-1">
          {!item ? (
            <p className="pt-6 text-sm text-muted-foreground">Önce bir fotoğraf ekle.</p>
          ) : (
            <DesignPanel intent={intent} item={item} mode={xform} setMode={setXform} delta={xformDelta} layers={item.layers ?? []} setLayers={setLayers} sel={layerSel} setSel={setLayerSel} canvas={canvasSize(item.geo, item.src) ?? [1080, 1350]} />
          )}
        </TabsContent>

        <TabsContent value="frame" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-1">
          {!item ? <p className="pt-6 text-sm text-muted-foreground">Önce bir fotoğraf ekle.</p> : <FramePanel item={item} setFx={setFx} />}
        </TabsContent>

        <TabsContent value="fx" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-1">
          {!item ? <p className="pt-6 text-sm text-muted-foreground">Önce bir fotoğraf ekle.</p> : <FxPanel item={item} setFx={setFx} filterSel={filterSel} setFilterSel={setFilterSel} maskSel={maskSel} liquify={liquify} setLiquify={setLiquify} run={command} intent={intent} />}
        </TabsContent>

      </Tabs>
    </aside>
  )
}
