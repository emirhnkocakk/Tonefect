import { legacyGeo, newGeo } from "@/lib/geo"
import type { Geo } from "@/types"

// Proje / çıktı boyutları: sosyal medya, video, baskı. id ayarlarda (settings.aspect) saklanır.
export type Platform = { id: string; group: string; label: string; w: number; h: number; hint?: string }

export const PLATFORMS: Platform[] = [
  { id: "ig-portrait", group: "Instagram", label: "Gönderi (dikey)", w: 1080, h: 1350, hint: "4:5 · en çok görünen" },
  { id: "ig-square", group: "Instagram", label: "Gönderi (kare)", w: 1080, h: 1080, hint: "1:1" },
  { id: "ig-story", group: "Instagram", label: "Hikâye / Reels", w: 1080, h: 1920, hint: "9:16" },
  { id: "tiktok", group: "TikTok", label: "Video kapağı", w: 1080, h: 1920, hint: "9:16" },
  { id: "yt-thumb", group: "YouTube", label: "Küçük resim", w: 1280, h: 720, hint: "16:9" },
  { id: "yt-shorts", group: "YouTube", label: "Shorts", w: 1080, h: 1920, hint: "9:16" },
  { id: "yt-banner", group: "YouTube", label: "Kanal kapağı", w: 2560, h: 1440 },
  { id: "fb-post", group: "Facebook", label: "Gönderi", w: 1200, h: 630 },
  { id: "fb-story", group: "Facebook", label: "Hikâye", w: 1080, h: 1920 },
  { id: "fb-cover", group: "Facebook", label: "Kapak", w: 1640, h: 624 },
  { id: "x-post", group: "X (Twitter)", label: "Gönderi", w: 1600, h: 900, hint: "16:9" },
  { id: "x-header", group: "X (Twitter)", label: "Kapak", w: 1500, h: 500, hint: "3:1" },
  { id: "li-post", group: "LinkedIn", label: "Gönderi", w: 1200, h: 627 },
  { id: "li-banner", group: "LinkedIn", label: "Kapak", w: 1584, h: 396 },
  { id: "pin", group: "Pinterest", label: "Pin", w: 1000, h: 1500, hint: "2:3" },
  { id: "wa-status", group: "WhatsApp", label: "Durum", w: 1080, h: 1920 },
  { id: "a4", group: "Baskı (300 DPI)", label: "A4", w: 2480, h: 3508 },
  { id: "a5", group: "Baskı (300 DPI)", label: "A5", w: 1748, h: 2480 },
  { id: "card", group: "Baskı (300 DPI)", label: "Kartvizit", w: 1050, h: 600, hint: "85×55 mm" },
  { id: "poster", group: "Baskı (300 DPI)", label: "Poster 50×70", w: 5906, h: 8268 },
  { id: "fhd", group: "Ekran", label: "Full HD", w: 1920, h: 1080 },
  { id: "4k", group: "Ekran", label: "4K", w: 3840, h: 2160 },
]

export const platformGroups = () => [...new Set(PLATFORMS.map((p) => p.group))]
export const platformOf = (id?: string | null) => (id === "insta" ? PLATFORMS[0] : PLATFORMS.find((p) => p.id === id) ?? null)

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
/** "1080:1350" -> "4:5" (oran düğmeleri tanısın). */
export const ratioText = (w: number, h: number) => `${w / gcd(w, h)}:${h / gcd(w, h)}`

/** Yeni eklenen fotoğrafın kırpma/boyutu: platform seçiliyse ortadan o orana kırpılır ve o boyutta çıkar. */
export function geoForPreset(id?: string | null): Geo {
  if (id === "insta") return legacyGeo() // eski ayar: birebir aynı sonuç
  const p = platformOf(id)
  return p ? { ...newGeo(ratioText(p.w, p.h)), outW: p.w, outH: p.h, lock: true } : newGeo()
}

/** Küçük oran simgesi için kutu (en uzun kenar = max). */
export const ratioBox = (w: number, h: number, max = 28) => (w >= h ? [max, Math.max(4, Math.round((max * h) / w))] : [Math.max(4, Math.round((max * w) / h)), max])
