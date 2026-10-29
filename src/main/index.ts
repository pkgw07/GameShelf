import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, Menu, nativeImage, nativeTheme, Notification, safeStorage, shell, Tray } from 'electron'
import { IPC } from '@shared/api'
import type { NowPlaying, Settings } from '@shared/types'
import icon from '../../resources/icon.png?asset'
import trayIcon from '../../resources/tray.png?asset'
import { Core } from './core'
import { registerIpc } from './ipc'
import { plainCodec, type SecretCodec } from './settings'
import { Updater } from './updater'

const DAILY_CHECK_MS = 20 * 60_000

let core: Core | null = null
let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let nowPlaying: NowPlaying | null = null
let dailyTimer: NodeJS.Timeout | null = null
let updater: Updater | null = null

const startHidden = process.argv.includes('--hidden')
const selfTest = process.argv.includes('--selftest')

/** 빌드 검증용: Electron 안에서 DB를 열고 기본 동작을 확인한 뒤 결과를 파일로 남기고 종료 */
async function runSelfTest(): Promise<void> {
  const out = join(process.cwd(), 'selftest-result.json')
  try {
    const dir = mkdtempSync(join(tmpdir(), 'gameshelf-'))
    const c = new Core(join(dir, 'test.db'), plainCodec, { syncState: () => {}, nowPlaying: () => {}, dataChanged: () => {} })
    c.settings.save({ unplayedMinutes: 45 })
    c.repo.upsertOwnedGames('steam', [{ gameId: '620', name: 'Portal 2', playtimeMin: 100, playtime2wMin: 0, lastPlayed: null, hasStats: true }])
    c.repo.savePrice(620, 'kr', { currency: 'KRW', initial: 11500, final: 2300, discount: 80 })
    const games = c.repo.listGames()
    const ok = games.length === 1 && games[0].lowKr?.amount === 2300 && c.settings.get().unplayedMinutes === 45
    writeFileSync(out, JSON.stringify({ ok, driver: c.db.driver, electron: process.versions.electron, node: process.versions.node }))
    c.close()
    app.exit(ok ? 0 : 1)
  } catch (e) {
    writeFileSync(out, JSON.stringify({ ok: false, error: String((e as Error).stack ?? e) }))
    app.exit(1)
  }
}

const codec: SecretCodec = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (s) => safeStorage.encryptString(s).toString('base64'),
  decrypt: (s) => safeStorage.decryptString(Buffer.from(s, 'base64'))
}

function send(channel: string, payload?: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function settings(): Settings {
  return core!.settings.get()
}

function createWindow(show: boolean): void {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: 'GameShelf',
    icon,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1115' : '#f6f7f9',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.on('ready-to-show', () => {
    if (show) win?.show()
  })
  win.on('close', (e) => {
    if (!quitting && settings().minimizeToTray) {
      e.preventDefault()
      win?.hide()
    }
  })
  win.on('closed', () => {
    win = null
  })
  // 외부 링크는 기본 브라우저로
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function notify(title: string, body: string, appid?: number): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body, icon })
  n.on('click', () => {
    if (appid) void shell.openExternal(`https://store.steampowered.com/app/${appid}/`)
    else showWindow()
  })
  n.show()
}

function showWindow(): void {
  if (!win) createWindow(true)
  else {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}

function updateTray(): void {
  if (!tray) return
  const s = core?.sync.getState()
  const playing = nowPlaying ? `플레이 중: ${nowPlaying.name}` : '플레이 중인 게임 없음'
  tray.setToolTip(nowPlaying ? `GameShelf · ${nowPlaying.name} 플레이 중` : 'GameShelf')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: playing, enabled: false },
      { type: 'separator' },
      { label: 'GameShelf 열기', click: showWindow },
      {
        label: s?.running ? '동기화 중…' : '지금 동기화',
        enabled: !s?.running,
        click: () => void core?.sync.run('full')
      },
      { type: 'separator' },
      {
        label: '종료',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
}

function setupTray(): void {
  if (tray) return
  const img = nativeImage.createFromPath(trayIcon)
  tray = new Tray(img.isEmpty() ? nativeImage.createFromPath(icon) : img)
  tray.on('click', showWindow)
  tray.on('double-click', showWindow)
  updateTray()
}

function applySettings(prev: Settings | null, next: Settings): void {
  nativeTheme.themeSource = next.theme
  if (process.platform === 'win32' || process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: next.launchAtLogin, args: ['--hidden'] })
  }
  if (next.minimizeToTray || next.nowPlaying) setupTray()
  else if (tray) {
    tray.destroy()
    tray = null
  }
  if (!prev || prev.nowPlaying !== next.nowPlaying) {
    if (next.nowPlaying) core?.nowPlaying.start()
    else core?.nowPlaying.stop()
  }
}

function scheduleDaily(): void {
  const check = () => {
    if (!core) return
    const s = settings()
    if (!s.steamApiKey || !s.steamId) return
    if (!core.sync.dailyDoneToday() && !core.sync.getState().running) void core.sync.run('daily')
  }
  setTimeout(check, 15_000)
  dailyTimer = setInterval(check, DAILY_CHECK_MS)
}

if (selfTest) {
  app.whenReady().then(runSelfTest)
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)

  app.whenReady().then(() => {
    app.setAppUserModelId('com.pkgw07.gameshelf')
    const dbPath = join(app.getPath('userData'), 'gameshelf.db')
    core = new Core(dbPath, codec, {
      syncState: (s) => {
        send(IPC.syncState, s)
        updateTray()
      },
      nowPlaying: (n) => {
        nowPlaying = n
        send(IPC.nowPlaying, n)
        updateTray()
      },
      dataChanged: () => send(IPC.dataChanged),
      notify
    })
    updater = new Updater((u) => send(IPC.updateState, u))
    registerIpc(core, updater, {
      onSettingsChanged: (prev, next) => applySettings(prev, next),
      getWindow: () => win,
      notify
    })
    applySettings(null, settings())
    createWindow(!startHidden)
    scheduleDaily()
    updater.start()
  })

  app.on('activate', showWindow)

  app.on('before-quit', () => {
    quitting = true
    if (dailyTimer) clearInterval(dailyTimer)
    updater?.stop()
    core?.close()
    core = null
  })

  app.on('window-all-closed', () => {
    // 트레이에 남는 설정이면 종료하지 않는다
    if (!tray && process.platform !== 'darwin') app.quit()
  })
}
