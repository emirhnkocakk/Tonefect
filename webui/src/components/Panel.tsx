import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { TONE_INFO } from "@/lib/constants"
import { words } from "@/lib/text"
import { cn } from "@/lib/utils"
import { ColorPanel } from "@/components/ColorPanel"
import type { Config, Fx, Item, PresetMeta } from "@/types"

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
}

export function Panel({ item, items, cfg, selected, setSelected, setText, patch, presets, groups, onPresetsChange }: Props) {
  const ws = item ? words(item.text) : []
  const max = cfg.limits.max_words
  const setFx = (p: Partial<Fx>, all = false) => item && patch({ fx: { ...item.fx, ...p } }, all)

  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col border-l bg-card/40">
      <Tabs defaultValue="text" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-4 mt-4 grid grid-cols-3">
          <TabsTrigger value="text">Metin</TabsTrigger>
          <TabsTrigger value="color">Renk</TabsTrigger>
          <TabsTrigger value="fx">Efekt</TabsTrigger>
        </TabsList>

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
          {!item ? (
            <p className="pt-6 text-sm text-muted-foreground">Önce bir fotoğraf ekle.</p>
          ) : (
            <ColorPanel item={item} presets={presets} groups={groups} setFx={setFx} onPresetsChange={onPresetsChange} />
          )}
        </TabsContent>

        <TabsContent value="fx" className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pb-4">
          {!item ? (
            <p className="pt-6 text-sm text-muted-foreground">Önce bir fotoğraf ekle.</p>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label>Siyah-beyaz</Label>
                  <p className="text-[11px] text-muted-foreground">Kapalıysa fotoğraf renkli kalır</p>
                </div>
                <Switch checked={item.fx.bw} onCheckedChange={(v) => setFx({ bw: v })} />
              </div>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <Label>Parazit (grain)</Label>
                  <span className="text-xs text-muted-foreground">{Math.round(item.fx.grain * 100)}%</span>
                </div>
                <Slider min={0} max={100} step={1} value={[Math.round(item.fx.grain * 100)]} onValueChange={([v]) => setFx({ grain: v / 100 })} />
                <p className="text-[11px] text-muted-foreground">0 = tamamen temiz</p>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <Label>Vinyet (kenar karartma)</Label>
                  <span className="text-xs text-muted-foreground">{Math.round(item.fx.vignette * 100)}%</span>
                </div>
                <Slider min={0} max={100} step={1} value={[Math.round(item.fx.vignette * 100)]} onValueChange={([v]) => setFx({ vignette: v / 100 })} />
              </div>
              <Button variant="secondary" size="sm" className="w-full" onClick={() => setFx({}, true)}>
                Renk ve efektleri tüm fotoğraflara uygula
              </Button>
            </>
          )}
        </TabsContent>

      </Tabs>
    </aside>
  )
}
