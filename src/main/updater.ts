// 자동 업데이트: GitHub Releases(pkgw07/GameShelf)에 올라온 새 버전을 확인한다.
// 설치된 프로그램에서만 동작하고, 개발 모드(npm run dev)에서는 꺼진다.
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '@shared/types'

const CHECK_EVERY_MS = 6 * 3600_000

export class Updater {
  private state: UpdateState
  private timer: NodeJS.Timeout | null = null

  constructor(private emit: (s: UpdateState) => void) {
    this.state = {
      status: app.isPackaged ? 'idle' : 'disabled',
      currentVersion: app.getVersion(),
      version: null,
      percent: null,
      error: null,
      checkedAt: null
    }
    if (!app.isPackaged) return
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking', error: null }))
    autoUpdater.on('update-available', (info) => this.set({ status: 'available', version: info.version, checkedAt: Date.now() }))
    autoUpdater.on('update-not-available', () => this.set({ status: 'not-available', version: null, checkedAt: Date.now() }))
    autoUpdater.on('download-progress', (p) => this.set({ status: 'downloading', percent: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', (info) => this.set({ status: 'downloaded', version: info.version, percent: 100 }))
    autoUpdater.on('error', (e) =>
      this.set({ status: 'error', error: friendly(e instanceof Error ? e.message : String(e)), checkedAt: Date.now() })
    )
  }

  get(): UpdateState {
    return this.state
  }

  private set(p: Partial<UpdateState>): void {
    this.state = { ...this.state, ...p }
    this.emit(this.state)
  }

  start(): void {
    if (!app.isPackaged) return
    setTimeout(() => void this.check(), 10_000)
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  async check(): Promise<UpdateState> {
    if (!app.isPackaged) return this.state
    // 이미 받는 중이거나 받아 둔 상태면 다시 확인하지 않는다
    if (this.state.status === 'downloading' || this.state.status === 'downloaded') return this.state
    try {
      await autoUpdater.checkForUpdates()
    } catch (e) {
      this.set({ status: 'error', error: friendly((e as Error).message), checkedAt: Date.now() })
    }
    return this.state
  }

  async download(): Promise<void> {
    if (this.state.status !== 'available' && this.state.status !== 'error') return
    this.set({ status: 'downloading', percent: 0, error: null })
    try {
      await autoUpdater.downloadUpdate()
    } catch (e) {
      this.set({ status: 'error', error: friendly((e as Error).message) })
    }
  }

  install(): void {
    if (this.state.status !== 'downloaded') return
    // 트레이로 숨지 않고 완전히 종료한 뒤 새 버전을 설치·실행한다
    setImmediate(() => autoUpdater.quitAndInstall(false, true))
  }
}

function friendly(msg: string): string {
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|net::/i.test(msg)) return '인터넷 연결을 확인해 주세요.'
  if (/404|latest\.yml/i.test(msg)) return '아직 올라온 업데이트 정보가 없습니다.'
  return msg.split('\n')[0].slice(0, 200)
}
