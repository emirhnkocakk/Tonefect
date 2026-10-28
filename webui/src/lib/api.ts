import type { Config, Job, PresetMeta, UpdateInfo, UpdateStatus } from "@/types"

type PresetList = { presets: PresetMeta[]; groups: string[] }

const H = { "X-NV": "1" }

async function j<T = any>(r: Response): Promise<T> {
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((d as any).error || r.statusText)
  return d as T
}

const json = (method: string, body: unknown, signal?: AbortSignal) => ({
  method,
  headers: { ...H, "Content-Type": "application/json" },
  body: JSON.stringify(body),
  signal,
})

export const api = {
  config: () => fetch("/api/config").then((r) => j<Config>(r)),
  session: () => fetch("/api/session").then((r) => j<any>(r)),
  saveSession: (data: unknown) => fetch("/api/session", json("PUT", data)).then((r) => j(r)),
  upload: (file: File) =>
    fetch("/api/photos?name=" + encodeURIComponent(file.name), { method: "POST", headers: H, body: file }).then((r) =>
      j<{ id: string; name: string; width: number; height: number }>(r)
    ),
  remove: (id: string) => fetch("/api/photos/" + encodeURIComponent(id), { method: "DELETE", headers: H }).then((r) => j(r)),
  presets: () => fetch("/api/presets").then((r) => j<PresetList>(r)),
  presetThumbs: () => fetch("/api/presets/thumbs").then((r) => j<{ thumbs: Record<string, string> }>(r)),
  importPreset: (file: File) =>
    fetch("/api/presets/import?name=" + encodeURIComponent(file.name), { method: "POST", headers: H, body: file }).then((r) =>
      j<{ imported: PresetMeta[]; warnings: string[] }>(r)
    ),
  deletePreset: (id: string) => fetch("/api/presets/" + encodeURIComponent(id), { method: "DELETE", headers: H }).then((r) => j<PresetList>(r)),
  preview: (p: unknown) => fetch("/api/preview", json("POST", p)).then((r) => j<any>(r)),
  generate: (body: unknown) => fetch("/api/generate", json("POST", body)).then((r) => j<{ job: string }>(r)),
  job: (id: string) => fetch("/api/job/" + id).then((r) => j<Job>(r)),
  openFolder: (path: string) => fetch("/api/open-folder", json("POST", { path })).then((r) => j(r)),
  signature: (text: string) => fetch("/api/signature", json("PUT", { text })).then((r) => j<{ signature: string }>(r)),
  updateCheck: (force = false) => fetch("/api/update/check" + (force ? "?force=1" : "")).then((r) => j<UpdateInfo>(r)),
  updateInstall: () => fetch("/api/update/install", json("POST", {})).then((r) => j(r)),
  updateOpen: () => fetch("/api/update/open", json("POST", {})).then((r) => j(r)),
  updateStatus:() => fetch("/api/update/status").then((r) => j<UpdateStatus>(r)),
  heartbeat: () => fetch("/api/heartbeat", json("POST", {})).then((r) => j(r)),
  closing: () => fetch("/api/closing", { ...json("POST", {}), keepalive: true }).then((r) => j(r)),
  setPrefs: (p: { quitOnClose: boolean }) => fetch("/api/prefs", json("PUT", p)).then((r) => j(r)),
  quit: () => fetch("/api/quit", json("POST", {})).then((r) => j(r)),
}

export const thumbUrl = (id: string) => "/api/thumb/" + encodeURIComponent(id)
export const outputUrl = (job: string, name: string) => `/api/output/${job}/${encodeURIComponent(name)}`
