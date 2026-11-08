// Klavye kısayolları: Photoshop kullanıcılarının alışkın olduğu tuşlar. Menüdeki yazılar da buradan gelir.
// Tuşlar fiziksel konumdan okunur (e.code): Türkçe klavyede de aynı yerdedir.
export const SHORTCUTS: Record<string, string> = {
  "Ctrl+O": "addPhotos", "Ctrl+S": "save", "Ctrl+Shift+S": "saveAs", "Ctrl+Alt+S": "saveCopy", "Ctrl+Q": "quit", "Ctrl+K": "settings",
  "Ctrl+Z": "undo", "Ctrl+Y": "redo", "Ctrl+Shift+Z": "redo", "Ctrl+Alt+Z": "undo", "Ctrl+C": "copyFx", "Ctrl+V": "pasteFx",
  "Shift+F5": "erase:fill", "Ctrl+T": "xf:free", "Ctrl+Shift+T": "design:again",
  "Ctrl+A": "sel:all", "Ctrl+D": "sel:none", "Ctrl+Shift+I": "sel:invert", "Shift+F6": "sel:feather", "Ctrl+Alt+R": "sel:refine", Q: "layer:quickmask",
  "Ctrl+L": "color:tool:levels", "Ctrl+M": "color:tool:curves", "Ctrl+U": "color:tool:hue", "Ctrl+B": "color:tool:balance", "Ctrl+I": "color:tool:invert",
  "Ctrl+Shift+U": "color:tool:desat", "Ctrl+Alt+Shift+B": "color:tool:bw", "Ctrl+Shift+L": "color:auto:tone", "Ctrl+Alt+Shift+L": "color:auto:contrast", "Ctrl+Shift+B": "color:auto:color",
  "Ctrl+Alt+I": "tool:crop:size", "Ctrl+Alt+C": "tool:crop:canvas",
  "Ctrl+Shift+N": "layer:new:blank", "Ctrl+J": "layer:via:copy", "Ctrl+Shift+J": "layer:via:cut", "Ctrl+G": "layer:group", "Ctrl+Shift+G": "layer:ungroup",
  "Ctrl+E": "layer:merge", "Ctrl+Shift+E": "layer:mergevis", "Ctrl+Alt+G": "layer:clip", "Ctrl+,": "layer:toggle",
  "Ctrl+]": "layer:forward", "Ctrl+[": "layer:backward", "Ctrl+Shift+]": "layer:front", "Ctrl+Shift+[": "layer:back", Delete: "layer:del",
  "Ctrl+Shift+X": "filter:add:liquify", "Ctrl+Shift+R": "filter:add:lenscor", "Ctrl+Shift+A": "color:tool:basic", "Ctrl+Alt+V": "filter:vanish", "Ctrl+Alt+Shift+A": "filter:add:wideangle",
  "Ctrl+;": "guides", "Ctrl+'": "view:grid", "Ctrl+Enter": "path:selection", Tab: "panels", D: "color:reset", X: "color:swap", F1: "help:keys", F7: "win:layers", "Alt+F9": "tool:actions",
}

// Stage kendi okuduğu için burada yalnızca menüde görünenler
const SHOWN: Record<string, string> = { "view:in": "Ctrl++", "view:out": "Ctrl+-", "view:fit": "Ctrl+0", "view:100": "Ctrl+1", "view:before": "Ö" }

/** Komutun menüde yazacak kısayolu (birden çok varsa ilki). */
export const keyOf = (cmd: string) => SHOWN[cmd] ?? Object.keys(SHORTCUTS).find((k) => SHORTCUTS[k] === cmd)

const CODE: Record<string, string> = { BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'", Comma: ",", Tab: "Tab", Delete: "Delete", Enter: "Enter" }

/** Klavye olayı -> "Ctrl+Alt+Shift+J" biçimi. */
export function comboOf(e: KeyboardEvent) {
  const key = CODE[e.code] ?? (e.code.startsWith("Key") ? e.code.slice(3) : /^F\d+$/.test(e.code) ? e.code : e.code.startsWith("Digit") ? e.code.slice(5) : "")
  if (!key) return ""
  return [e.ctrlKey || e.metaKey ? "Ctrl" : "", e.altKey ? "Alt" : "", e.shiftKey ? "Shift" : "", key].filter(Boolean).join("+")
}

export const TYPING = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)
}

// Yardım penceresindeki gruplar
export const KEY_HELP: [string, [string, string][]][] = [
  ["Araçlar", [["V", "Taşı"], ["M", "Çerçeve Seçim"], ["L", "Kement"], ["W", "Akıllı Seçim, Sihirli Değnek"], ["C", "Kırp, Dilim"], ["I", "Damlalık"], ["J", "İyileştirme"], ["B", "Fırça, Kalem"], ["S", "Damga"], ["Y", "Geçmiş Fırçası"], ["E", "Silgi"], ["G", "Dolgu ve Degrade"], ["R", "Bulanıklaştır, Keskinleştir, Parmak"], ["O", "Açıcı, Yakıcı, Sünger"], ["P", "Kalem"], ["A", "Yol Seçimi"], ["T", "Yazı"], ["U", "Şekil"], ["H", "El"], ["Z", "Yakınlaştır"], ["Shift+harf", "Gruptaki sonraki araç"]]],
  ["Düzenleme", [["Ctrl+Z / Ctrl+Y", "Geri Al / Yinele"], ["Ctrl+T", "Serbest Dönüştür"], ["Ctrl+Shift+T", "Dönüşümü Tekrarla"], ["Shift+F5", "İçeriğe Duyarlı Dolgu"], ["D", "Varsayılan Renkler"], ["X", "Renkleri Değiştir"], ["[ ve ]", "Fırça Boyutu"], ["1 … 0", "Fırça Opaklığı"]]],
  ["Seçim", [["Ctrl+A", "Tümünü Seç"], ["Ctrl+D", "Seçimi Kaldır"], ["Ctrl+Shift+I", "Seçimi Ters Çevir"], ["Shift+F6", "Kenar Yumuşat"], ["Ctrl+Alt+R", "Seç ve Maskele"], ["Q", "Hızlı Maske"]]],
  ["Görüntü", [["Ctrl+L", "Seviyeler"], ["Ctrl+M", "Eğriler"], ["Ctrl+U", "Ton ve Doygunluk"], ["Ctrl+B", "Renk Dengesi"], ["Ctrl+I", "Tersine Çevir"], ["Ctrl+Shift+U", "Doygunluğu Kaldır"], ["Ctrl+Alt+Shift+B", "Siyah Beyaz"], ["Ctrl+Shift+L", "Otomatik Ton"], ["Ctrl+Shift+B", "Otomatik Renk"], ["Ctrl+Alt+I", "Görüntü Boyutu"], ["Ctrl+Alt+C", "Tuval Boyutu"]]],
  ["Katman", [["Ctrl+Shift+N", "Yeni Katman"], ["Ctrl+J", "Çoğalt ya da Seçimi Kopyala"], ["Ctrl+Shift+J", "Seçimi Kes"], ["Ctrl+G", "Grupla"], ["Ctrl+Shift+G", "Grubu Çöz"], ["Ctrl+E", "Aşağı Birleştir"], ["Ctrl+Shift+E", "Görünenleri Birleştir"], ["Ctrl+Alt+G", "Kırpma Maskesi"], ["Ctrl+] / Ctrl+[", "Öne / Arkaya"], ["Ok tuşları", "Katmanı 1 piksel taşı (Shift: 10)"], ["Delete", "Katmanı Sil"]]],
  ["Görünüm", [["Ctrl+ + / -", "Yakınlaştır / Uzaklaştır"], ["Ctrl+0", "Ekrana Sığdır"], ["Ctrl+1", "%100"], ["Boşluk+sürükle", "Gez"], ["Ö", "Düzenlenmemiş Hali"], ["Ctrl+;", "Kılavuzlar"], ["Ctrl+'", "Izgara"], ["Tab", "Panelleri Gizle / Göster"], ["F7", "Katmanlar"], ["Alt+F9", "Eylemler"], ["F1", "Bu Liste"]]],
  ["Dosya", [["Ctrl+O", "Fotoğraf Aç"], ["Ctrl+S", "Kaydet"], ["Ctrl+Shift+S", "Farklı Kaydet"], ["Ctrl+Alt+S", "Kopya Kaydet"], ["Ctrl+K", "Tercihler"], ["Ctrl+Q", "Çıkış"]]],
]
