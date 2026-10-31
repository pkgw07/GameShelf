// 앱의 핵심 객체 묶음. Electron 의존성 없이 만들 수 있어 테스트에서도 그대로 쓴다.
import type { NowPlaying, Settings, SyncState } from '@shared/types'
import { openDatabase, type Db } from './db/driver'
import { Repo } from './db/repo'
import { migrate } from './db/schema'
import { Insights } from './services/insights'
import { NowPlayingService } from './services/nowplaying'
import { psnAccess, psnPresence } from './providers/psn'
import { xboxPresence } from './providers/xbox'
import { SyncService } from './services/sync'
import { SettingsStore, type SecretCodec } from './settings'

export interface CoreEvents {
  syncState(s: SyncState): void
  nowPlaying(n: NowPlaying | null): void
  dataChanged(): void
  notify?(title: string, body: string, appid?: number): void
}

export class Core {
  readonly db: Db
  readonly repo: Repo
  readonly settings: SettingsStore
  readonly sync: SyncService
  readonly insights: Insights
  readonly nowPlaying: NowPlayingService

  constructor(
    readonly dbPath: string,
    codec: SecretCodec,
    events: CoreEvents
  ) {
    this.db = openDatabase(dbPath)
    migrate(this.db)
    this.repo = new Repo(this.db)
    this.settings = new SettingsStore(this.repo, codec)
    const get = (): Settings => this.settings.get()
    this.sync = new SyncService(this.repo, get, events.syncState, events.dataChanged, events.notify)
    this.sync.saveSettings = (patch) => void this.settings.save(patch)
    this.insights = new Insights(this.repo, get)
    this.nowPlaying = new NowPlayingService(this.repo, get, events.nowPlaying, (appid) => void this.sync.quickRefresh(appid))
    // 연결한 콘솔의 "지금 플레이 중" (연결 안 했으면 null)
    this.nowPlaying.consoleSources = [
      async () => {
        const s = get()
        if (!s.psnRefreshToken) return null
        return psnPresence(await psnAccess(s.psnRefreshToken, (p) => void this.settings.save(p)))
      },
      async () => {
        const s = get()
        return s.xblApiKey ? xboxPresence(s.xblApiKey) : null
      }
    ]
  }

  close(): void {
    this.nowPlaying.stop()
    this.sync.cancel()
    this.db.close()
  }
}
