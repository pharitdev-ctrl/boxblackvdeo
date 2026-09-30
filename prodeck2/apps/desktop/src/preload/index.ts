import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"
import { API_METHODS, type AppEvent, type DesktopApi, type RendererApi } from "../shared/api.ts"

const api = Object.fromEntries(
  API_METHODS.map((method) => [method, (...args: unknown[]) => ipcRenderer.invoke(`api:${method}`, ...args)]),
) as unknown as DesktopApi

const exposed: RendererApi = {
  ...api,
  onEvent(listener) {
    const handler = (_event: IpcRendererEvent, event: AppEvent) => listener(event)
    ipcRenderer.on("app:event", handler)
    return () => ipcRenderer.removeListener("app:event", handler)
  },
}

contextBridge.exposeInMainWorld("boxblack", exposed)
