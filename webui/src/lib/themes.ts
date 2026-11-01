// Tema renkleri index.css içinde [data-theme] altında; burada ad, açıklama ve kartlardaki renk örnekleri.
export type Theme = { id: string; name: string; desc: string; light?: boolean; swatch: string[] }

export const THEMES: Theme[] = [
  { id: "tonefect", name: "Tonefect", desc: "Logonun renkleri, koyu", swatch: ["#0A0A10", "#00D4FF", "#7B2FFF", "#FF2E8A", "#FF9A1F"] },
  { id: "light", name: "Gündüz", desc: "Açık ve sade", light: true, swatch: ["#FAFAFC", "#FFFFFF", "#8B3DF0", "#1A1A24", "#E6E6EE"] },
  { id: "classic", name: "Klasik altın", desc: "İlk sürümün siyah-altını", swatch: ["#0B0B0B", "#121212", "#B89B5E", "#EDEAE4", "#262626"] },
  { id: "cyberpunk", name: "Cyberpunk", desc: "Neon pembe ve camgöbeği", swatch: ["#0D0620", "#FF2A8A", "#00F0FF", "#F5E663", "#2A1650"] },
  { id: "retro", name: "Retro 70'ler", desc: "Krem, turuncu, hardal", light: true, swatch: ["#F3E6C9", "#E2671F", "#E9B44C", "#2A9D8F", "#4A2A16"] },
  { id: "pixel", name: "Pixel", desc: "8-bit oyun konsolu", swatch: ["#1A1C2C", "#38B764", "#FFCD75", "#41A6F6", "#333C57"] },
]

const KEY = "tf-theme"

export function applyTheme(id?: string) {
  const theme = THEMES.some((t) => t.id === id) ? id! : THEMES[0].id
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(KEY, theme) // açılışta renk zıplamasın diye index.html okur
  } catch {
    // tarayıcı depolaması kapalıysa önemli değil
  }
}

export const isLightTheme = (id?: string) => !!THEMES.find((t) => t.id === id)?.light
