// 지금 플레이 중인 게임 감지 (디스코드의 "플레이 중" 표시와 비슷한 기능)
// Windows: Steam이 레지스트리에 남기는 RunningAppID 값을 30초마다 읽는다. 네트워크·CPU 사용이 거의 없다.
// 그 외 OS 또는 레지스트리를 읽을 수 없으면: Steam Web API(GetPlayerSummaries)를 90초마다 확인한다.
import { execFile } from 'node:child_process'
import type { NowPlaying, Settings } from '@shared/types'
import type { Repo } from '../db/repo'
import { keyOf } from '../db/repo'
import { getPlayerSummary } from '../providers/steam'

const REG_INTERVAL = 30_000
const API_INTERVAL = 90_000

export function parseRunningAppId(stdout: string): number | null {
  const m = stdout.match(/RunningAppID\s+REG_DWORD\s+0x([0-9a-f]+)/i)
  if (!m) return null
  const n = parseInt(m[1], 16)
  return n > 0 ? n : 0
}

function readRegistry(): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'RunningAppID'],
      { windowsHide: true, timeout: 5000 },
      (err, stdout) => resolve(err ? null : parseRunningAppId(String(stdout)))
    )
  })
}

export class NowPlayingService {
  private timer: NodeJS.Timeout | null = null
  private current: NowPlaying | null = null
  private sessionId: number | null = null
  private useRegistry = process.platform === 'win32'
  private busy = false

  constructor(
    private repo: Repo,
    private getSettings: () => Settings,
    private emit: (n: NowPlaying | null) => void,
    private onEnded: (appid: number) => void
  ) {}

  get(): NowPlaying | null {
    return this.current
  }

  start(): void {
    this.stop()
    this.repo.closeDanglingSessions(Date.now())
    const tick = () => void this.check()
    tick()
    this.timer = setInterval(tick, this.useRegistry ? REG_INTERVAL : API_INTERVAL)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.change(null)
  }

  private async detect(): Promise<number | null> {
    if (this.useRegistry) {
      const v = await readRegistry()
      if (v !== null) return v
      // Steam이 설치되지 않았거나 읽을 수 없으면 API 방식으로 전환
      this.useRegistry = false
      if (this.timer) {
        clearInterval(this.timer)
        this.timer = setInterval(() => void this.check(), API_INTERVAL)
      }
    }
    const s = this.getSettings()
    if (!s.steamApiKey || !s.steamId) return null
    try {
      const p = await getPlayerSummary(s.steamApiKey, s.steamId)
      return p?.gameid ? Number(p.gameid) : 0
    } catch {
      return null
    }
  }

  private async check(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      const appid = await this.detect()
      if (appid === null) return // 판단 불가: 상태 유지
      if (appid === (this.current?.appid ?? 0)) return
      this.change(appid > 0 ? appid : null)
    } finally {
      this.busy = false
    }
  }

  private change(appid: number | null): void {
    const now = Date.now()
    const prev = this.current
    if (prev && this.sessionId != null) {
      this.repo.endSession(this.sessionId, now)
      this.sessionId = null
    }
    if (appid) {
      const key = keyOf('steam', appid)
      const app = this.repo.getSteamApp(appid)
      const name = app?.nameKo || this.repo.gameName(key) || app?.name || `App ${appid}`
      this.current = { key, appid, name, since: now }
      this.sessionId = this.repo.startSession(key, name, now)
    } else {
      this.current = null
    }
    this.emit(this.current)
    // 게임을 끄면 2분 뒤(Steam 서버 반영 대기) 플레이타임과 도전과제 갱신
    if (prev && (!appid || appid !== prev.appid)) {
      const ended = prev.appid
      setTimeout(() => this.onEnded(ended), 120_000)
    }
  }
}
