export const PALETTE: [string, string][] = [
  ["Beyaz", "#EDEAE4"],
  ["Altın", "#B89B5E"],
  ["Parlak altın", "#E3C77A"],
  ["Gri", "#9A9A9A"],
  ["Kırmızı", "#B3262B"],
  ["Turuncu", "#D9822B"],
  ["Mavi", "#4F86C6"],
  ["Yeşil", "#4E9F6E"],
]

export const WEIGHTS: [string, string][] = [
  ["İnce", "light"],
  ["Normal", "regular"],
  ["Orta", "medium"],
  ["Kalın", "bold"],
  ["Ekstra", "extrabold"],
]

export const CSS_WEIGHT: Record<string, number> = { light: 300, regular: 400, medium: 500, bold: 700, extrabold: 800 }

// [boyut çarpanı, düğmedeki harf boyutu (px)]
export const SIZES: [number, number][] = [
  [0.6, 10],
  [0.8, 12],
  [1, 14],
  [1.3, 17],
  [1.7, 20],
  [2.2, 24],
]

export const TONE_INFO: Record<string, { label: string; desc: string }> = {
  quiet: { label: "Sessiz", desc: "altta, serif" },
  hard: { label: "Sert", desc: "ortada, büyük harf" },
}

export const SNAP = 10
