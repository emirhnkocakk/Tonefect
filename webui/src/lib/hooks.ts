import { RefObject, useEffect, useLayoutEffect, useRef, useState } from "react"
import { api } from "@/lib/api"
import type { Item, PreviewData, Watermark } from "@/types"

/** Sunucudan önizleme ister; hızlı değişimlerde sadece en son isteği gönderir (aynı anda tek istek). */
/** wm: filigran; istekle gönderilir ki ayar kaydedilmeden de önizleme doğru olsun.
 *  original: önce/sonra için düzenlenmemiş hali (yalnızca kırpma/döndürme uygulanır). */
export function usePreview(item: Item | undefined, width: number, wm: Watermark | null = null, original = false) {
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef<any>(null)
  const running = useRef(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const key = !item
    ? ""
    : original
    ? JSON.stringify([item.id, item.geo ?? null, width, "original"])
    : JSON.stringify([item.id, item.text, item.tone, item.accent, item.styles, item.block, item.offsets, item.fx, item.geo ?? null, item.font ?? null, item.textFx ?? null, item.layers ?? [], item.paint ?? null, width, wm])

  async function pump() {
    if (running.current) return
    running.current = true
    setBusy(true)
    try {
      while (pending.current) {
        const p = pending.current
        pending.current = null
        try {
          const r = await api.preview(p)
          if (alive.current) {
            setPreview({ ...r, photo: p.photo, used: { text: p.text, block: p.block, offsets: p.offsets } })
            setError(null)
          }
        } catch (e: any) {
          if (alive.current) setError(e?.message || "Önizleme alınamadı")
        }
      }
    } finally {
      running.current = false
      if (alive.current) setBusy(false)
    }
  }

  useEffect(() => {
    if (!item) {
      setPreview(null)
      return
    }
    pending.current = {
      photo: item.id, text: item.text, tone: item.tone, accent: item.accent, styles: item.styles,
      block: item.block, offsets: item.offsets, fx: item.fx, geo: item.geo ?? null, font: item.font ?? null, textfx: item.textFx ?? null, layers: item.layers ?? [], paint: item.paint ?? null, wm, w: width, original,
    }
    const t = setTimeout(pump, 30)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { preview, busy, error }
}

/** Kapsayıcıya sığan, verilen en-boy oranında (w/h) bir kutu boyutu hesaplar. */
export function useFit(ref: RefObject<HTMLElement>, ratio: number, pad = 0) {
  const [size, setSize] = useState({ w: 360, h: 450 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const calc = () => {
      const cw = el.clientWidth - pad * 2
      const ch = el.clientHeight - pad * 2
      let w = cw
      let h = cw / ratio
      if (h > ch) {
        h = ch
        w = ch * ratio
      }
      setSize({ w: Math.max(160, Math.floor(w)), h: Math.max(200, Math.floor(h)) })
    }
    calc()
    const ro = new ResizeObserver(calc)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ratio, pad, ref])
  return size
}

let lastIntent = 0
/** Üst menü / araç kutusundan gelen komutu bir kez çalıştırır (panel yeniden açılınca eski komut tekrarlanmaz).
 *  prefix: panel yalnızca kendi komutunu alır; sekme değişirken kapanmakta olan panel başkasının komutunu tüketmesin. */
export function useIntent(intent: { cmd: string; n: number } | null | undefined, prefix: string, run: (cmd: string) => void) {
  useEffect(() => {
    if (!intent || intent.n <= lastIntent || !intent.cmd.startsWith(prefix)) return
    lastIntent = intent.n
    run(intent.cmd)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent])
}
