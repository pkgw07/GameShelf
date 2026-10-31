// 지금 플레이 중인 게임 감지 (디스코드의 "플레이 중" 표시와 비슷한 기능)
// Windows: Steam이 레지스트리에 남기는 RunningAppID 값을 30초마다 읽는다. 네트워크·CPU 사용이 거의 없다.
// 그 외 OS 또는 레지스트리를 읽을 수 없으면: Steam Web API(GetPlayerSummaries)를 90초마다 확인한다.
// Steam 에서 플레이 중이 아니면 연결된 PS5·Xbox 의 온라인 상태를 2분마다 확인한다.
import { execFile } from 'node:child_process'
import { titleKey } from '@shared/analytics'
import type { NowPlaying, Platform, Settings } from '@shared/types'
import type { Repo } from '../db/repo'
import { keyOf } from '../db/repo'
import { getPlayerSummary } from '../providers/steam'

const REG_INTERVAL = 30_000
const API_INTERVAL = 90_000
const CONSOLE_INTERVAL = 120_000

/** 콘솔에서 지금 하는 게임. 안 하면 null, 알 수 없으면 undefined */
export interface ConsolePlaying {
  platform: Platform
  gameId: string | null
  name: string
  device?: string | null
}
export type ConsoleSource = () => Promise<ConsolePlaying | null | undefined>

type Playing = { key: string; appid: number | null; name: string; platform: Platform; device?: string | null }

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
  /** PS5·Xbox 상태 확인 (core 에서 연결). 연결 안 된 플랫폼은 null 을 돌려준다 */
  consoleSources: ConsoleSource[] = []
  private consoleAt = 0
  private consoleLast: Playing | null = null

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

  private async detectSteam(): Promise<number | null> {
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

  /** 콘솔 확인은 2분에 한 번만 (요청 수 제한) */
  private async detectConsole(): Promise<Playing | null | undefined> {
    if (!this.consoleSources.length) return null
    if (Date.now() - this.consoleAt < CONSOLE_INTERVAL - 5000) return this.consoleLast
    this.consoleAt = Date.now()
    let unknown = false
    for (const src of this.consoleSources) {
      const r = await src().catch(() => undefined)
      if (r === undefined) unknown = true
      if (r) {
        this.consoleLast = this.resolveConsole(r)
        return this.consoleLast
      }
    }
    if (unknown) return undefined
    this.consoleLast = null
    return null
  }

  /** 콘솔 게임을 라이브러리 게임과 맞춘다 (ID → 이름 순) */
  resolveConsole(r: ConsolePlaying): Playing {
    const games = this.repo.listGamesLite().filter((g) => g.platform === r.platform)
    const byId = r.gameId ? games.find((g) => g.gameId === r.gameId) : undefined
    const k = titleKey(r.name)
    const byName = byId ?? games.find((g) => titleKey(g.name) === k)
    const key = byName?.key ?? keyOf(r.platform, r.gameId ?? `live-${k}`)
    return { key, appid: null, name: byName?.name ?? r.name, platform: r.platform, device: r.device }
  }

  async check(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      const appid = await this.detectSteam()
      let next: Playing | null | undefined
      if (appid && appid > 0) next = this.steamPlaying(appid)
      else {
        const c = await this.detectConsole()
        if (c) next = c
        else if (appid === null && c === undefined) return // 판단 불가: 상태 유지
        else next = null
      }
      if ((next?.key ?? null) === (this.current?.key ?? null)) return
      this.change(next)
    } finally {
      this.busy = false
    }
  }

  private steamPlaying(appid: number): Playing {
    const key = keyOf('steam', appid)
    const app = this.repo.getSteamApp(appid)
    const name = app?.nameKo || this.repo.gameName(key) || app?.name || `App ${appid}`
    return { key, appid, name, platform: 'steam' }
  }

  private change(next: Playing | null | undefined): void {
    const now = Date.now()
    const prev = this.current
    if (prev && this.sessionId != null) {
      this.repo.endSession(this.sessionId, now)
      this.sessionId = null
    }
    if (next) {
      this.current = { key: next.key, appid: next.appid, name: next.name, since: now, platform: next.platform, device: next.device ?? null }
      this.sessionId = this.repo.startSession(next.key, next.name, now)
    } else {
      this.current = null
    }
    this.emit(this.current)
    // Steam 게임을 끄면 2분 뒤(Steam 서버 반영 대기) 플레이타임과 도전과제 갱신
    if (prev?.appid && prev.key !== next?.key) {
      const ended = prev.appid
      setTimeout(() => this.onEnded(ended), 120_000)
    }
  }
}
