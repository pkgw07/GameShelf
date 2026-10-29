// 화면 → 메인 프로세스 요청 처리
import { closeSync, copyFileSync, existsSync, openSync, readFileSync, readSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC, type ApiMethod, type GameShelfApi } from '@shared/api'
import { APP_VERSION, type BackupResult, type Settings } from '@shared/types'
import type { Core } from './core'
import type { Updater } from './updater'
import { getPlayerSummary, resolveSteamId, storeSearch, toProfile } from './providers/steam'
import { applyPurchases, importLicenses, importPurchases } from './services/imports'
import { recognize } from './services/ocr'
import { yearReview } from './services/yearreview'
import { libraryCsv } from './services/exporter'

type Handlers = { [K in ApiMethod]: (...args: Parameters<GameShelfApi[K]>) => ReturnType<GameShelfApi[K]> | Awaited<ReturnType<GameShelfApi[K]>> }

export interface IpcHooks {
  onSettingsChanged(prev: Settings, next: Settings): void
  getWindow(): BrowserWindow | null
  notify(title: string, body: string): void
}

function isSqliteFile(path: string): boolean {
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(16)
    readSync(fd, buf, 0, 16, 0)
    return buf.toString('utf8', 0, 15) === 'SQLite format 3'
  } finally {
    closeSync(fd)
  }
}

export function registerIpc(core: Core, updater: Updater, hooks: IpcHooks): void {
  const { repo, settings, sync, insights } = core
  let cachedProfile: Awaited<ReturnType<GameShelfApi['getProfile']>> = null

  const h: Handlers = {
    getAppInfo: () => ({ version: APP_VERSION, dataPath: dirname(core.dbPath), dbDriver: core.db.driver, platform: process.platform }),
    getSettings: () => settings.get(),
    saveSettings: (patch) => {
      const prev = settings.get()
      const next = settings.save(patch)
      if (patch.steamId !== undefined && patch.steamId !== prev.steamId) cachedProfile = null
      hooks.onSettingsChanged(prev, next)
      return next
    },
    resolveSteamId: async (input) => {
      const s = settings.get()
      const id = await resolveSteamId(input, s.steamApiKey)
      const p = await getPlayerSummary(s.steamApiKey, id)
      if (!p) throw new Error('프로필 정보를 받지 못했습니다.')
      cachedProfile = toProfile(p)
      return cachedProfile
    },
    getProfile: async () => {
      if (cachedProfile) return cachedProfile
      const s = settings.get()
      if (!s.steamApiKey || !s.steamId) return null
      try {
        const p = await getPlayerSummary(s.steamApiKey, s.steamId)
        cachedProfile = p ? toProfile(p) : null
      } catch {
        return null
      }
      return cachedProfile
    },

    getLibrary: () => repo.listGames(),
    getWishlist: () => repo.listWishlist(),
    getDlcs: () => repo.listDlcs(),
    setDlcOwned: (appid, owned) => repo.setDlcOwned(appid, owned, 'manual'),
    setTargetPrice: (appid, price) => repo.setTargetPrice(appid, price),
    getRareAchievements: (limit) => repo.rareAchievements(limit),
    getYearReview: (year) => yearReview(repo, year),
    ocrImage: (dataUrl) => recognize(dataUrl, join(app.getPath('userData'), 'ocr')),
    applyPurchases: (items) => applyPurchases(repo, items),
    testNotification: () => hooks.notify('GameShelf 알림 테스트', '위시리스트 게임이 목표가나 역대 최저가가 되면 이렇게 알려 드립니다.'),
    updateUserData: (key, patch) => {
      repo.patchUserData(key, patch)
      return repo.getGame(key)
    },
    bulkUpdate: (keys, patch) => {
      repo.db.tx(() => {
        for (const k of keys) repo.patchUserData(k, patch)
      })
    },
    getGameDetail: (key) => insights.gameDetail(key),
    loadGlobalAchievementPct: (key) => insights.loadGlobalPct(key),

    startSync: () => {
      void sync.run('full')
    },
    cancelSync: () => sync.cancel(),
    getSyncState: () => sync.getState(),

    searchStore: (term) => storeSearch(term),
    inspectPrice: (appid) => insights.inspectPrice(appid),
    fetchItadHistory: (appid) => insights.itadHistory(appid),

    lookupHltb: (key) => insights.lookupHltb(key),
    lookupHltbBulk: () => {
      void sync.runTask('hltb', '평균 엔딩 시간 찾는 중', async (progress, signal) => {
        const r = await insights.lookupHltbBulk(progress, signal)
        return `엔딩 시간: ${r.total}개 중 ${r.found}개를 찾았습니다.`
      })
    },

    getRecommendations: (refresh) => insights.recommendations(refresh),
    getActivity: (days) => insights.activity(days),

    openTextFile: async () => {
      const win = hooks.getWindow()
      const opts = {
        title: '저장한 Steam 페이지 열기',
        filters: [{ name: 'HTML 페이지', extensions: ['html', 'htm', 'txt'] }],
        properties: ['openFile' as const]
      }
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      if (r.canceled || !r.filePaths[0]) return null
      return { name: basename(r.filePaths[0]), text: readFileSync(r.filePaths[0], 'utf8') }
    },
    importPurchases: (rows) => importPurchases(repo, rows),
    importLicenses: (rows) => importLicenses(repo, rows),
    assignImported: (key, amount, date) => {
      repo.setImportedPurchase(key, amount, date)
    },
    getPurchases: () => repo.purchases(),

    backup: async (): Promise<BackupResult> => {
      const win = hooks.getWindow()
      const stamp = new Date().toISOString().slice(0, 10)
      const opts = {
        title: '백업 파일 저장',
        defaultPath: `GameShelf-백업-${stamp}.db`,
        filters: [{ name: 'GameShelf 백업', extensions: ['db'] }]
      }
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (r.canceled || !r.filePath) return { ok: false, path: null, message: '취소했습니다.' }
      if (existsSync(r.filePath)) {
        try {
          unlinkSync(r.filePath)
        } catch {
          return { ok: false, path: null, message: '같은 이름의 파일을 덮어쓸 수 없습니다.' }
        }
      }
      core.db.exec(`VACUUM INTO '${r.filePath.replace(/'/g, "''")}'`)
      return { ok: true, path: r.filePath, message: '백업을 저장했습니다.' }
    },
    restore: async (): Promise<BackupResult> => {
      const win = hooks.getWindow()
      const opts = {
        title: '백업 파일 불러오기',
        filters: [{ name: 'GameShelf 백업', extensions: ['db'] }],
        properties: ['openFile' as const]
      }
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      const file = r.filePaths?.[0]
      if (r.canceled || !file) return { ok: false, path: null, message: '취소했습니다.' }
      if (!isSqliteFile(file)) return { ok: false, path: null, message: 'GameShelf 백업 파일이 아닙니다.' }
      // 현재 데이터는 안전하게 한 번 더 남겨 둔다
      const safety = core.dbPath.replace(/\.db$/, `.before-restore-${Date.now()}.db`)
      core.db.exec(`VACUUM INTO '${safety.replace(/'/g, "''")}'`)
      core.close()
      copyFileSync(file, core.dbPath)
      for (const ext of ['-wal', '-shm']) {
        try {
          unlinkSync(core.dbPath + ext)
        } catch {
          // 없으면 무시
        }
      }
      setTimeout(() => {
        app.relaunch()
        app.exit(0)
      }, 300)
      return { ok: true, path: file, message: '복원했습니다. 프로그램을 다시 시작합니다.' }
    },
    exportCsv: async (): Promise<BackupResult> => {
      const win = hooks.getWindow()
      const stamp = new Date().toISOString().slice(0, 10)
      const opts = {
        title: 'CSV로 내보내기',
        defaultPath: `GameShelf-라이브러리-${stamp}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      }
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (r.canceled || !r.filePath) return { ok: false, path: null, message: '취소했습니다.' }
      writeFileSync(r.filePath, libraryCsv(repo.listGames(), settings.get()), 'utf8')
      return { ok: true, path: r.filePath, message: 'CSV 파일을 저장했습니다.' }
    },
    openExternal: async (url) => {
      if (/^https:\/\//.test(url) || /^steam:\/\//.test(url)) await shell.openExternal(url)
    },
    openDataFolder: async () => {
      await shell.openPath(dirname(core.dbPath))
    },

    getNowPlaying: () => core.nowPlaying.get(),

    getUpdateState: () => updater.get(),
    checkForUpdates: () => updater.check(),
    downloadUpdate: () => updater.download(),
    installUpdate: () => updater.install()
  }

  ipcMain.handle(IPC.invoke, async (_e, method: ApiMethod, args: unknown[]) => {
    const fn = h[method] as ((...a: unknown[]) => unknown) | undefined
    if (!fn) throw new Error(`알 수 없는 요청: ${method}`)
    return await fn(...(args ?? []))
  })
}
