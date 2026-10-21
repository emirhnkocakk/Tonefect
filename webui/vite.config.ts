import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "path"

export default defineConfig({
  plugins: [react()],
  base: "/",
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1200 },
  server: { proxy: { "/api": "http://127.0.0.1:8791" } },
})
