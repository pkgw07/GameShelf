// 동기화 파이프라인
// full : 설정 화면의 "지금 동기화" 버튼. 상세 정보까지 전부 확인
// daily: 하루 한 번 자동 실행. 플레이타임 스냅샷, 가격 기록, 도전과제 변경분만 확인
import type { Settings, SyncState } from '@shared/types'
import type { Repo } from '../db/repo'
import { keyOf } from '../db/repo'
import { providers } from '../providers'
import {
  getAchievements,
  getAppDetails,
  getDlcForApps,
  getDlcForOwnedGames,
  getGlobalAchievementPct,
  getOwnedGames,
  getPricesBatch,
  getStoreItems,
  getWishlist
} from '../providers/steam'
import { chunk, mapLimit } from '../util/http'
import { recordDate } from '../util/time'
import { applyAutoStatus } from './autostatus'
import { lookupSteamIds, steamStoreLows } from './itad'

const DETAILS_MAX_AGE = 30 * 86_400_000
const ITAD_MAP_MAX_AGE = 30 * 86_400_000
const REVIEW_MAX_AGE = 7 * 86_400_000
const GLOBAL_PCT_MAX_AGE = 30 * 86_400_000

export type Notify = (title: string, body: string, appid?: number) => void

export type SyncKind = 'full' | 'daily'

export class SyncService {
  private state: SyncState
  private ctrl: AbortController | null = null

  constructor(
    private repo: Repo,
    private getSettings: () => Settings,
    private emit: (s: SyncState) => void,
    private dataChanged: () => void,
    private notify: Notify = () => {}
  ) {
    const last = repo.getMeta('last_sync_at')
    const daily = repo.getMeta('last_daily_at')
    this.state = {
      running: false,
      phase: 'idle',
      label: '',
      current: 0,
      total: 0,
      error: null,
      warnings: [],
      lastFinishedAt: last ? Number(last) : null,
      lastDailyAt: daily ? Number(daily) : null
    }
  }

  getState(): SyncState {
    return this.state
  }

  private set(p: Partial<SyncState>): void {
    this.state = { ...this.state, ...p }
    this.emit(this.state)
  }

  private progress(phase: string, label: string, current = 0, total = 0): void {
    this.set({ phase, label, current, total })
  }

  cancel(): void {
    this.ctrl?.abort()
  }

  /** 오늘 자동 기록을 이미 했는지 */
  dailyDoneToday(): boolean {
    return this.repo.getMeta('last_daily_date') === recordDate()
  }

  async run(kind: SyncKind): Promise<void> {
    if (this.state.running) return
    const s = this.getSettings()
    if (!s.steamApiKey || !s.steamId) {
      this.set({ error: '설정에서 Steam API 키와 계정을 먼저 입력해 주세요.' })
      return
    }
    this.ctrl = new AbortController()
    const signal = this.ctrl.signal
    const warnings: string[] = []
    this.set({ running: true, error: null, warnings: [], phase: 'start', label: '동기화 준비 중', current: 0, total: 0 })
    const warn = (where: string, e: unknown) => {
      if (signal.aborted) return
      warnings.push(`${where}: ${(e as Error).message}`)
      this.set({ warnings: [...warnings] })
    }

    try {
      // 1) 보유 게임 + 플레이타임
      this.progress('owned', '보유 게임 목록 불러오는 중')
      for (const p of providers) {
        if (!p.isConfigured(s)) continue
        const list = await p.fetchOwnedGames({ settings: s, signal })
        this.repo.upsertOwnedGames(p.platform, list)
      }
      this.dataChanged()

      // 2) 플레이타임 스냅샷 (하루 1회 기준이지만 같은 날 다시 실행하면 그날 값을 갱신)
      this.progress('snapshot', '플레이타임 기록 중')
      const date = recordDate()
      const games = this.repo.listGames()
      this.repo.saveSnapshot(
        date,
        games.map((g) => ({ platform: g.platform, gameId: g.gameId, minutes: g.playtimeMin }))
      )

      // 3) 위시리스트
      this.progress('wishlist', '위시리스트 불러오는 중')
      try {
        const wl = await getWishlist(s.steamApiKey, s.steamId, signal)
        this.repo.replaceWishlist(wl)
      } catch (e) {
        warn('위시리스트', e)
      }

      const owned = this.repo.ownedSteamAppids()
      const wish = this.repo.wishlistAppids()
      const all = [...new Set([...owned, ...wish])]

      // 4) 상점 상세 정보 (장르, 이미지, 무료 여부) - 상점 API 제한 때문에 천천히
      const need = this.repo.appidsNeedingDetails(all, kind === 'full' ? DETAILS_MAX_AGE : DETAILS_MAX_AGE * 2)
      let i = 0
      for (const appid of need) {
        if (signal.aborted) throw new Error('취소됨')
        this.progress('details', '게임 정보 불러오는 중', ++i, need.length)
        try {
          const { app, priceKr } = await getAppDetails(appid, signal)
          this.repo.upsertSteamApp(app)
          if (app.status === 'ok') this.repo.savePrice(appid, 'kr', priceKr)
        } catch (e) {
          warn(`게임 정보(${appid})`, e)
          if (warnings.length > 30) break
        }
        if (i % 20 === 0) this.dataChanged()
      }
      this.dataChanged()

      // 4-1) DLC 목록 (보유 게임 전체를 한 번에). 실패하면 아직 확인 안 한 게임만 상세 정보를 다시 받는다
      const unchecked = this.repo.ownedGamesUncheckedDlc()
      if (kind === 'full' || unchecked.length) {
        this.progress('dlc', 'DLC 목록 확인 중')
        let lists = new Map<number, number[]>()
        try {
          lists = await getDlcForOwnedGames(s.steamApiKey, s.steamId, owned, signal)
        } catch (e) {
          if (signal.aborted) throw e
        }
        if (!lists.size && unchecked.length) {
          try {
            lists = await getDlcForApps(s.steamApiKey, unchecked, signal)
          } catch (e) {
            if (signal.aborted) throw e
          }
        }
        if (lists.size) {
          this.repo.db.tx(() => {
            for (const appid of owned) this.repo.setDlcList(appid, lists.get(appid) ?? [])
          })
        } else if (unchecked.length) {
          // 마지막 방법: 게임 상세 정보를 다시 받아 DLC 목록을 채운다 (상점 요청 제한 때문에 느림)
          let k = 0
          for (const appid of unchecked) {
            if (signal.aborted) throw new Error('취소됨')
            this.progress('dlc', 'DLC 목록 확인 중 (게임별)', ++k, unchecked.length)
            try {
              const { app, priceKr } = await getAppDetails(appid, signal)
              this.repo.upsertSteamApp(app)
              if (app.status === 'ok') this.repo.savePrice(appid, 'kr', priceKr)
              else this.repo.setDlcList(appid, [])
            } catch (e) {
              warn(`DLC 목록(${appid})`, e)
              if (warnings.length > 30) break
            }
          }
        }
        this.dataChanged()
      }

      // 4-2) DLC 이름과 Steam 평가 (200개씩 한 번에)
      const dlcPairs = this.repo.ownedGamesDlc()
      const dlcParent = new Map(dlcPairs.map((d) => [d.dlc, d.parent]))
      const dlcIds = [...dlcParent.keys()]
      const ownedDlc = new Set(this.repo.ownedDlcAppids())
      const itemTargets = [
        ...new Set([...this.repo.appidsNeedingReviews([...all, ...dlcIds], REVIEW_MAX_AGE), ...this.repo.appidsWithoutApp(dlcIds)])
      ]
      if (itemTargets.length) {
        this.progress('reviews', 'DLC 정보와 Steam 평가 불러오는 중', 0, itemTargets.length)
        try {
          const items = await getStoreItems(itemTargets, signal)
          this.repo.db.tx(() => {
            for (const id of itemTargets) {
              const it = items.get(id)
              const parent = dlcParent.get(id)
              if (parent != null && it) this.repo.saveDlcBasic(id, parent, it.name, it.isFree)
              this.repo.saveReview(id, it?.review ?? { percent: null, count: 0, label: null })
            }
          })
        } catch (e) {
          warn('DLC·평가', e)
        }
        this.dataChanged()
      }

      // 5) 가격 (한국 + 미국) - 바뀐 경우만 이력에 남는다. DLC는 한국 가격, 보유 DLC는 미국 가격도
      const krTargets = [...new Set([...all, ...dlcIds])]
      const usTargets = [...new Set([...all, ...dlcIds.filter((d) => ownedDlc.has(d))])]
      const regionParts = { kr: chunk(krTargets, 50), us: chunk(usTargets, 50) }
      const totalParts = regionParts.kr.length + regionParts.us.length
      let done = 0
      for (const region of ['kr', 'us'] as const) {
        for (const part of regionParts[region]) {
          if (signal.aborted) throw new Error('취소됨')
          this.progress('prices', region === 'kr' ? '한국 가격 확인 중' : '미국 가격 확인 중', ++done, totalParts)
          try {
            const prices = await getPricesBatch(part, region, signal)
            this.repo.db.tx(() => {
              for (const [appid, p] of prices) this.repo.savePrice(appid, region, p)
            })
          } catch (e) {
            warn(`가격(${region})`, e)
          }
        }
      }
      this.repo.setMeta('last_price_record', String(Date.now()))
      this.dataChanged()

      // 5-2) 위시리스트 목표가·역대 최저가 알림
      try {
        this.checkWishlistAlerts(s)
      } catch (e) {
        warn('알림', e)
      }

      // 6) 역대 최저가 (IsThereAnyDeal)
      if (s.itadApiKey) {
        try {
          await this.syncItad(s.itadApiKey, [...all, ...ownedDlc], signal)
        } catch (e) {
          warn('역대 최저가(ITAD)', e)
        }
        this.dataChanged()
      }

      // 7) 도전과제 - 처음이거나 플레이타임이 바뀐 게임만
      const achTargets = this.repo
        .steamGamesForAchievements()
        .filter((g) => g.fetchedPlaytime == null || g.fetchedPlaytime !== g.playtimeMin)
      let a = 0
      await mapLimit(achTargets, 4, async (g) => {
        if (signal.aborted) return
        try {
          const list = await getAchievements(s.steamApiKey, s.steamId, g.appid, signal)
          if (list && list.length) this.repo.saveAchievements(g.appid, list, g.playtimeMin)
          else this.repo.markNoAchievements(g.appid, g.playtimeMin)
        } catch (e) {
          warn(`도전과제(${g.appid})`, e)
        }
        this.progress('achievements', '도전과제 확인 중', ++a, achTargets.length)
      })
      if (signal.aborted) throw new Error('취소됨')

      // 7-2) 도전과제 전체 유저 달성률 (희귀 도전과제 모음용, 30일마다)
      const pctTargets = this.repo.appidsNeedingGlobalPct(GLOBAL_PCT_MAX_AGE).slice(0, 150)
      let pi = 0
      for (const appid of pctTargets) {
        if (signal.aborted) throw new Error('취소됨')
        this.progress('rarity', '도전과제 희귀도 확인 중', ++pi, pctTargets.length)
        try {
          this.repo.setGlobalPct(appid, await getGlobalAchievementPct(appid))
          this.repo.markGlobalPctFetched(appid)
        } catch (e) {
          warn(`희귀도(${appid})`, e)
        }
      }

      // 8) 상태 태그 자동 제안
      if (s.autoStatus) applyAutoStatus(this.repo, this.repo.listGames())

      const now = Date.now()
      this.repo.setMeta('last_sync_at', String(now))
      this.repo.setMeta('last_daily_at', String(now))
      this.repo.setMeta('last_daily_date', date)
      this.set({ lastFinishedAt: now, lastDailyAt: now })
    } catch (e) {
      const msg = signal.aborted ? '동기화를 취소했습니다.' : (e as Error).message
      this.set({ error: msg })
    } finally {
      this.ctrl = null
      this.set({ running: false, phase: 'idle', label: '', current: 0, total: 0, warnings })
      this.dataChanged()
    }
  }

  /** 위시리스트가 목표가 이하이거나 역대 최저가가 되면 Windows 알림 (같은 가격으로는 한 번만) */
  checkWishlistAlerts(s: Settings): void {
    for (const w of this.repo.listWishlist()) {
      const p = w.priceKr
      const state = this.repo.wishUser(w.appid)
      if (!p) continue
      if (p.discount === 0) {
        if (state.notifiedLow != null) this.repo.markNotified(w.appid, 'low', null)
      }
      if (s.notifyTargetPrice && state.target != null) {
        if (p.final <= state.target && state.notifiedTarget !== p.final) {
          this.notify('목표가 도달', `${w.name}: ₩${p.final.toLocaleString('ko-KR')} (목표 ₩${state.target.toLocaleString('ko-KR')})`, w.appid)
          this.repo.markNotified(w.appid, 'target', p.final)
        } else if (p.final > state.target && state.notifiedTarget != null) {
          this.repo.markNotified(w.appid, 'target', null)
        }
      }
      if (s.notifyHistoricalLow && p.discount > 0 && w.lowKr && p.final <= w.lowKr.amount && state.notifiedLow !== p.final) {
        this.notify('역대 최저가', `${w.name}: ₩${p.final.toLocaleString('ko-KR')} (-${p.discount}%)`, w.appid)
        this.repo.markNotified(w.appid, 'low', p.final)
      }
    }
  }

  private async syncItad(key: string, appids: number[], signal: AbortSignal): Promise<void> {
    const now = Date.now()
    const unknown = appids.filter((id) => {
      const m = this.repo.getItadId(id)
      return !m || (!m.itadId && now - m.fetchedAt > ITAD_MAP_MAX_AGE)
    })
    if (unknown.length) {
      this.progress('itad', '최저가 데이터 연결 중', 0, unknown.length)
      const map = await lookupSteamIds(key, unknown, signal)
      this.repo.db.tx(() => {
        for (const [appid, id] of map) this.repo.setItadId(appid, id)
      })
    }
    const pairs = appids
      .map((appid) => ({ appid, id: this.repo.getItadId(appid)?.itadId ?? null }))
      .filter((p): p is { appid: number; id: string } => Boolean(p.id))
    const byId = new Map(pairs.map((p) => [p.id, p.appid]))
    for (const region of ['kr', 'us'] as const) {
      this.progress('itad', region === 'kr' ? '역대 최저가(한국) 확인 중' : '역대 최저가(미국) 확인 중')
      const lows = await steamStoreLows(key, [...byId.keys()], region, signal)
      this.repo.db.tx(() => {
        for (const [id, appid] of byId) {
          const low = lows.get(id)
          if (low) this.repo.saveLow(appid, region, low)
        }
      })
    }
  }

  /** 동기화 외의 긴 작업(엔딩 시간 일괄 조회 등)을 같은 진행 표시줄로 보여준다 */
  async runTask(
    phase: string,
    label: string,
    fn: (progress: (cur: number, total: number) => void, signal: AbortSignal) => Promise<string | void>
  ): Promise<void> {
    if (this.state.running) throw new Error('다른 작업이 진행 중입니다. 끝난 뒤 다시 시도해 주세요.')
    this.ctrl = new AbortController()
    this.set({ running: true, error: null, warnings: [], phase, label, current: 0, total: 0 })
    try {
      const msg = await fn((cur, total) => this.progress(phase, label, cur, total), this.ctrl.signal)
      if (msg) this.set({ warnings: [msg] })
    } catch (e) {
      this.set({ error: (e as Error).message })
    } finally {
      this.ctrl = null
      this.set({ running: false, phase: 'idle', label: '', current: 0, total: 0 })
      this.dataChanged()
    }
  }

  /** 게임을 끈 직후 해당 게임의 플레이타임과 도전과제만 빠르게 갱신 */
  async quickRefresh(appid: number): Promise<void> {
    const s = this.getSettings()
    if (!s.steamApiKey || !s.steamId || this.state.running) return
    try {
      const list = await getOwnedGames(s.steamApiKey, s.steamId)
      this.repo.upsertOwnedGames('steam', list)
      const g = list.find((x) => x.gameId === String(appid))
      if (g?.hasStats) {
        const ach = await getAchievements(s.steamApiKey, s.steamId, appid)
        if (ach && ach.length) this.repo.saveAchievements(appid, ach, g.playtimeMin)
      }
      this.repo.saveSnapshot(
        recordDate(),
        this.repo.listGames().map((x) => ({ platform: x.platform, gameId: x.gameId, minutes: x.playtimeMin }))
      )
      if (s.autoStatus) {
        const row = this.repo.getGame(keyOf('steam', appid))
        if (row) applyAutoStatus(this.repo, [row])
      }
      this.dataChanged()
    } catch {
      // 다음 정기 동기화 때 다시 시도
    }
  }
}
