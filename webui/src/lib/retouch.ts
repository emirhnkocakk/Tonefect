import {
  Bandage, Blend, Droplet, Droplets, Eye, EyeOff, Grid2x2, Hand, ImageUp, Layers2, Move, Moon, PaintbrushVertical, Scan, ScanFace, Smile, Sparkle, Sparkles, Stamp, Sun, Triangle, Waves,
} from "lucide-react"
import { DEFAULT_BRUSH } from "@/lib/brushes"
import type { BrushSettings, BrushTool } from "@/types"

// Rötuş ve Onarım kategorisi: sol araç kutusu, üst menü ve panel aynı listeyi kullanır.
export type RetouchEntry = { cmd: string; label: string; en: string; section: string; icon: typeof Bandage; key?: string; tool?: BrushTool; hint?: string; b?: Partial<BrushSettings> }

const t = (tool: BrushTool) => `retouch:tool:${tool}`

export const RETOUCH_TOOLS: RetouchEntry[] = [
  { cmd: t("spot"), label: "Nokta İyileştirme Fırçası", en: "Spot Healing Brush Tool", section: "Onarım", icon: Bandage, tool: "spot", hint: "Küçük kusurun üzerinden geç; çevresindeki dokuyla kapanır.", b: { size: 0.04, hard: 0.8 } },
  { cmd: t("heal"), label: "İyileştirme Fırçası", en: "Healing Brush Tool", section: "Onarım", icon: PaintbrushVertical, tool: "heal", hint: "Alt+tıkla: temiz bir kaynak seç. Boyadığın yere o dokusu gelir, ton ve renk yerinde kalır.", b: { size: 0.05, hard: 0.7 } },
  { cmd: t("patch"), label: "Yama Aracı", en: "Patch Tool", section: "Onarım", icon: Scan, tool: "patch", hint: "Düzeltilecek alanın etrafını çiz, sonra içinden tutup temiz bir yere sürükle." },
  { cmd: t("camove"), label: "İçeriğe Duyarlı Taşıma", en: "Content-Aware Move Tool", section: "Onarım", icon: Move, tool: "camove", hint: "Nesnenin etrafını çiz, içinden tutup yeni yerine sürükle. Eski yeri çevresinden kapanır." },
  { cmd: t("remove"), label: "Kaldırma Aracı", en: "Remove Tool", section: "Onarım", icon: Sparkle, tool: "remove", hint: "Silmek istediğin nesnenin üzerini boya; yerel model kuruluysa onunla, değilse dokuyla kapanır.", b: { size: 0.07, hard: 0.9 } },
  { cmd: "erase:object", label: "Nesne Kaldırma", en: "Object Removal", section: "Onarım", icon: ScanFace },

  { cmd: t("clone"), label: "Klonlama Damgası", en: "Clone Stamp Tool", section: "Damga", icon: Stamp, key: "S", tool: "clone", hint: "Alt+tıkla: kaynak seç. Boyadığın yere kaynak birebir kopyalanır.", b: { size: 0.05, hard: 0.7 } },
  { cmd: t("patstamp"), label: "Desen Damgası", en: "Pattern Stamp Tool", section: "Damga", icon: Grid2x2, tool: "patstamp", hint: "Seçtiğin deseni boyar; hazır desen ya da kendi görselin.", b: { size: 0.08, hard: 0.8 } },

  { cmd: t("dodge"), label: "Açıcı", en: "Dodge Tool", section: "Ton ve Odak", icon: Sun, key: "O", tool: "dodge", hint: "Boyadığın yeri aydınlatır.", b: { size: 0.1, hard: 0.1, amount: 0.3 } },
  { cmd: t("burn"), label: "Yakıcı", en: "Burn Tool", section: "Ton ve Odak", icon: Moon, tool: "burn", hint: "Boyadığın yeri koyulaştırır.", b: { size: 0.1, hard: 0.1, amount: 0.3 } },
  { cmd: t("sponge"), label: "Sünger", en: "Sponge Tool", section: "Ton ve Odak", icon: Droplets, tool: "sponge", hint: "Boyadığın yerin rengini soldurur ya da canlandırır.", b: { size: 0.1, hard: 0.2 } },
  { cmd: t("blur"), label: "Bulanıklaştırma", en: "Blur Tool", section: "Ton ve Odak", icon: Droplet, tool: "blur", hint: "Boyadığın yeri yumuşatır.", b: { size: 0.08, hard: 0.3 } },
  { cmd: t("sharpen"), label: "Keskinleştirme", en: "Sharpen Tool", section: "Ton ve Odak", icon: Triangle, tool: "sharpen", hint: "Boyadığın yerdeki ayrıntıyı belirginleştirir.", b: { size: 0.08, hard: 0.3, amount: 0.4 } },
  { cmd: t("smudge"), label: "Parmak", en: "Smudge Tool", section: "Ton ve Odak", icon: Hand, tool: "smudge", hint: "Pikselleri sürüklediğin yöne ıslak boya gibi uzatır.", b: { size: 0.05, hard: 0.5 } },

  { cmd: "retouch:sec:skin", label: "Cilt Rötuşu", en: "Skin Retouching", section: "Yüz ve Cilt", icon: Smile },
  { cmd: t("skin"), label: "Cilt Yumuşatma", en: "Skin Smoothing", section: "Yüz ve Cilt", icon: Blend, tool: "skin", hint: "Boyadığın ciltte gözenek ve pürüz yumuşar, ince doku kalır. Tüm cilt için Cilt Rötuşu'nu kullan.", b: { size: 0.1, hard: 0.2 } },
  { cmd: t("blemish"), label: "Leke Giderme", en: "Blemish Removal", section: "Yüz ve Cilt", icon: Sparkles, tool: "blemish", hint: "Ciltte gezdir; yalnızca koyu ya da kırmızı küçük noktalar gider, cilt olduğu gibi kalır.", b: { size: 0.12, hard: 0.4, amount: 0.6 } },
  { cmd: t("wrinkle"), label: "Kırışıklık Giderme", en: "Wrinkle Removal", section: "Yüz ve Cilt", icon: Waves, tool: "wrinkle", hint: "Kırışıklığın üzerinden geç; koyu çizgi çevresindeki cilt tonuna kalkar.", b: { size: 0.04, hard: 0.4, amount: 0.6 } },
  { cmd: t("teeth"), label: "Diş Beyazlatma", en: "Teeth Whitening", section: "Yüz ve Cilt", icon: Smile, tool: "teeth", hint: "Dişlerin üzerini boya; sarılık gider, dudak ve koyu boşluklar korunur.", b: { size: 0.03, hard: 0.6 } },
  { cmd: t("eye"), label: "Göz Belirginleştirme", en: "Eye Enhancement", section: "Yüz ve Cilt", icon: Eye, tool: "eye", hint: "İrisin üzerini boya; aydınlanır, rengi ve keskinliği artar.", b: { size: 0.025, hard: 0.5, amount: 0.4 } },
  { cmd: t("redeye"), label: "Kırmızı Göz", en: "Red Eye Tool", section: "Yüz ve Cilt", icon: EyeOff, tool: "redeye", hint: "Fırçayı gözbebeğine denk getirip tıkla.", b: { size: 0.04, hard: 0.9 } },
  { cmd: t("freq"), label: "Frekans Ayırma", en: "Frequency Separation", section: "Yüz ve Cilt", icon: Layers2, tool: "freq", hint: "Boyadığın yerde ton düzelir, ince doku korunur. Tüm görsel için aşağıdaki Frekans Ayırma ayarları.", b: { size: 0.08, hard: 0.2 } },

  { cmd: "retouch:sec:restore", label: "Fotoğraf Onarımı", en: "Photo Restoration", section: "Onarma", icon: ImageUp },
]

export const RETOUCH_ICON = Bandage
export const RETOUCH_SECTIONS = [...new Set(RETOUCH_TOOLS.map((x) => x.section))]
export const RETOUCH_MODES = RETOUCH_TOOLS.filter((x) => x.tool)

const RETOUCH_DEFAULT: BrushSettings = { ...DEFAULT_BRUSH, size: 0.05, hard: 0.6, spacing: 0.1, amount: 0.5 }

/** Her aracın kendi fırçası var; ilk seçildiğinde kendine uygun ayarla başlar. */
export const retouchDefaults = (tool: BrushTool): BrushSettings => ({ ...RETOUCH_DEFAULT, ...RETOUCH_MODES.find((x) => x.tool === tool)?.b })

export const RETOUCH_STROKES = new Set<string>(RETOUCH_MODES.map((x) => x.tool!))
