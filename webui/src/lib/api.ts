import type { ColorEdits, Adjust, AiStatus, Config, ProjectMeta, Fx, Job, PresetMeta, UpdateInfo, UpdateStatus, Watermark } from "@/types"

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
  projects: () => fetch("/api/projects").then((r) => j<{ projects: ProjectMeta[] }>(r)),
  createProject: (body: { name: string; size: [number, number] | null; preset: string; blank: boolean; color?: string; dpi?: number }) =>
    fetch("/api/projects", json("POST", body)).then((r) => j<{ id: string }>(r)),
  project: (id: string) => fetch("/api/projects/" + id).then((r) => j<any>(r)),
  saveProject: (id: string, data: unknown) => fetch("/api/projects/" + id, json("PUT", data)).then((r) => j(r)),
  renameProject: (id: string, name: string) => fetch(`/api/projects/${id}/rename`, json("POST", { name })).then((r) => j(r)),
  deleteProject: (id: string) => fetch("/api/projects/" + id, { method: "DELETE", headers: H }).then((r) => j(r)),
  fxThumbs: () => fetch("/api/fx/thumbs").then((r) => j<{ thumbs: Record<string, string> }>(r)),
  session: () => fetch("/api/session").then((r) => j<any>(r)),
  saveSession: (data: unknown) => fetch("/api/session", json("PUT", data)).then((r) => j(r)),
  upload: (file: File) =>
    fetch("/api/photos?name=" + encodeURIComponent(file.name), { method: "POST", headers: H, body: file }).then((r) =>
      j<{ id: string; name: string; width: number; height: number }>(r)
    ),
  duplicate: (id: string) => fetch("/api/photos/" + encodeURIComponent(id) + "/duplicate", json("POST", {})).then((r) => j<{ id: string }>(r)),
  remove: (id: string) => fetch("/api/photos/" + encodeURIComponent(id), { method: "DELETE", headers: H }).then((r) => j(r)),
  presets: () => fetch("/api/presets").then((r) => j<PresetList>(r)),
  presetThumbs: () => fetch("/api/presets/thumbs").then((r) => j<{ thumbs: Record<string, string> }>(r)),
  importPreset: (file: File) =>
    fetch("/api/presets/import?name=" + encodeURIComponent(file.name), { method: "POST", headers: H, body: file }).then((r) =>
      j<{ imported: PresetMeta[]; warnings: string[] }>(r)
    ),
  savePreset: (name: string, fx: Fx) => fetch("/api/presets/save", json("POST", { name, fx })).then((r) => j<PresetMeta>(r)),
  deletePreset: (id: string) => fetch("/api/presets/" + encodeURIComponent(id), { method: "DELETE", headers: H }).then((r) => j<PresetList>(r)),
  preview: (p: unknown) => fetch("/api/preview", json("POST", p)).then((r) => j<any>(r)),
  brushThumb: (body: unknown) => fetch("/api/brush/thumb", json("POST", body)).then((r) => j<{ image: string }>(r)),
  autoAlign: (body: unknown) => fetch("/api/layers/autoalign", json("POST", body)).then((r) => j<{ layers: Record<string, { x: number; y: number; w: number; rot: number }>; tried: number }>(r)),
  extractSelection: (body: unknown) =>
    fetch("/api/selection/extract", json("POST", body)).then((r) =>
      j<{ id: string; name: string; width: number; height: number; x: number; y: number; w: number }>(r)
    ),
  renderFile: (body: unknown) =>
    fetch("/api/render-file", json("POST", body)).then(async (r) => {
      if (!r.ok) await j(r)
      return r.blob()
    }),
  generate: (body: unknown) => fetch("/api/generate", json("POST", body)).then((r) => j<{ job: string }>(r)),
  job: (id: string) => fetch("/api/job/" + id).then((r) => j<Job>(r)),
  openFolder: (path: string) => fetch("/api/open-folder", json("POST", { path })).then((r) => j(r)),
  watermark: (w: Watermark) => fetch("/api/watermark", json("PUT", w)).then((r) => j<Watermark>(r)),
  maskView: (body: unknown) => fetch("/api/mask/view", json("POST", body)).then((r) => j<{ image: string; coverage: number }>(r)),
  aiStatus: (model = "isnet") => fetch("/api/ai/status?model=" + model).then((r) => j<AiStatus>(r)),
  aiInstall: (model = "isnet") => fetch("/api/ai/install", json("POST", { model })).then((r) => j<AiStatus>(r)),
  fonts: () => fetch("/api/fonts").then((r) => j<{ bundled: string[]; system: string[] }>(r)),
  layerSpec: () => fetch("/api/layers/spec").then((r) => j<unknown>(r)),
  layersMerge: (body: unknown) => fetch("/api/layers/merge", json("POST", body)).then((r) => j<{ id: string; name: string; width: number; height: number }>(r)),
  layersFlatten: (body: unknown) => fetch("/api/layers/flatten", json("POST", body)).then((r) => j<{ id: string; name: string; width: number; height: number }>(r)),
  filterSpec: () => fetch("/api/filters/spec").then((r) => j<import("@/lib/filters").FilterSpec>(r)),
  filterThumbs: () => fetch("/api/filters/thumbs").then((r) => j<{ thumbs: Record<string, string> }>(r)),
  colorAuto: (body: unknown) => fetch("/api/color/auto", json("POST", body)).then((r) => j<{ levels: NonNullable<ColorEdits["levels"]> }>(r)),
  auto: (body: unknown) => fetch("/api/auto", json("POST", body)).then((r) => j<{ adjust: Adjust }>(r)),
  geoAuto: (body: unknown) => fetch("/api/geo/auto", json("POST", body)).then((r) => j<{ straighten?: number; v?: number; h?: number; crop?: [number, number, number, number] | null }>(r)),
  geoSource: (body: unknown) =>
    fetch("/api/geo/source", json("POST", body)).then((r) => j<{ image: string; inner: [number, number]; source: [number, number] }>(r)),
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

export const projectThumbUrl = (id: string, v: number) => `/api/projects/${id}/thumb?v=${Math.round(v)}`
export const thumbUrl = (id: string) => "/api/thumb/" + encodeURIComponent(id)
export const outputUrl = (job: string, name: string) => `/api/output/${job}/${encodeURIComponent(name)}`
