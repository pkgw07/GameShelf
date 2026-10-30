import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type ApiMethod, type GameShelfApi } from '@shared/api'

const call =
  (method: ApiMethod) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(IPC.invoke, method, args)

// Record 형태라서 ApiMethod 에 새 기능이 생겼는데 여기 빠뜨리면 타입 오류가 난다
const methodMap: Record<ApiMethod, true> = {
  getAppInfo: true,
  getSettings: true,
  saveSettings: true,
  resolveSteamId: true,
  getProfile: true,
  getLibrary: true,
  getWishlist: true,
  getDlcs: true,
  setDlcOwned: true,
  setTargetPrice: true,
  getRareAchievements: true,
  getYearReview: true,
  ocrImage: true,
  applyPurchases: true,
  testNotification: true,
  updateUserData: true,
  bulkUpdate: true,
  getGameDetail: true,
  loadGlobalAchievementPct: true,
  startSync: true,
  cancelSync: true,
  getSyncState: true,
  searchStore: true,
  inspectPrice: true,
  fetchItadHistory: true,
  lookupHltb: true,
  lookupHltbBulk: true,
  getRecommendations: true,
  getActivity: true,
  openTextFile: true,
  importPurchases: true,
  importLicenses: true,
  assignImported: true,
  getPurchases: true,
  resetPurchases: true,
  backup: true,
  restore: true,
  exportCsv: true,
  openExternal: true,
  openDataFolder: true,
  getNowPlaying: true,
  getUpdateState: true,
  checkForUpdates: true,
  downloadUpdate: true,
  installUpdate: true
}
const methods = Object.keys(methodMap) as ApiMethod[]

function listen<T>(channel: string, cb: (v: T) => void): () => void {
  const fn = (_e: unknown, v: T) => cb(v)
  ipcRenderer.on(channel, fn)
  return () => ipcRenderer.removeListener(channel, fn)
}

const api = Object.fromEntries(methods.map((m) => [m, call(m)])) as unknown as GameShelfApi
api.onSyncState = (cb) => listen(IPC.syncState, cb)
api.onNowPlaying = (cb) => listen(IPC.nowPlaying, cb)
api.onDataChanged = (cb) => listen(IPC.dataChanged, () => cb())
api.onUpdateState = (cb) => listen(IPC.updateState, cb)

contextBridge.exposeInMainWorld('api', api)
