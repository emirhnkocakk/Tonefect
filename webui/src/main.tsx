import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import "./index.css"

// Uygulama penceresinde hiçbir şey yeni sekme/pencere açmasın:
// sürükle-bırak ile dosyanın tarayıcıda açılması, dış bağlantılar ve window.open engellenir.
const stop = (e: Event) => e.preventDefault()
window.addEventListener("dragover", stop)
window.addEventListener("drop", stop)
window.open = () => null
document.addEventListener(
  "click",
  (e) => {
    const a = (e.target as HTMLElement | null)?.closest?.("a")
    if (a) e.preventDefault()
  },
  true
)
document.addEventListener("auxclick", (e) => e.button === 1 && e.preventDefault(), true)

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
