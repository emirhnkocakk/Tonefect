// Tema renkleri index.css içinde [data-theme] altında; burada ad, açıklama ve ayar kartlarındaki renk örnekleri.
export type Theme = { id: string; name: string; desc: string; light?: boolean; swatch: string[] }

export const THEMES: Theme[] = [
  { id: "dark", name: "Koyu", desc: "Fotoğrafa odaklanan koyu arayüz", swatch: ["#1C1C1C", "#242424", "#3A3A3A", "#2388FF"] },
  { id: "light", name: "Açık", desc: "Aydınlık ortamlar için", light: true, swatch: ["#F5F5F5", "#FFFFFF", "#D6D6D6", "#0073E6"] },
]

const KEY = "tf-theme"

/** Kaldırılan temalarla kaydedilmiş projeler en yakın temaya düşer. */
export const themeId = (id?: string) => (id === "light" || id === "retro" ? "light" : "dark")

export function applyTheme(id?: string) {
  const theme = themeId(id)
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(KEY, theme) // açılışta renk zıplamasın diye index.html okur
  } catch {
    // tarayıcı depolaması kapalıysa önemli değil
  }
}

export const isLightTheme = (id?: string) => themeId(id) === "light"
