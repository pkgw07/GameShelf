// 화면에 보여줄 분석 데이터: 게임 상세, 활동 기록, 추천, 가격 검색, 엔딩 시간
import { becauseOf, effectiveLow, genreProfile, excludeReason, isUnplayed, titleKey } from '@shared/analytics'
import { genreByEn, genreById, genreName } from '@shared/genres'
import type {
  ActivityData,
  GameDetail,
  HltbInfo,
  PriceInspection,
  PricePoint,
  Recommendation,
  RecommendationResult,
  RecoReason,
  Settings
} from '@shared/types'
import type { Repo } from '../db/repo'
import { keyOf, parseKey, steamHeader } from '../db/repo'
import { getAppDetails, getAppReview, getGlobalAchievementPct, getPricesBatch, getStoreItems } from '../providers/steam'
import { limiters, request } from '../util/http'
import { addDays, dateRange, kstDate, recordDate } from '../util/time'
import { findHltb } from './hltb'
import { lookupSteamIds, steamHistory, steamStoreLows } from './itad'

export class Insights {
  constructor(
    private repo: Repo,
    private getSettings: () => Settings
  ) {}

  // ───────── 게임 상세 ─────────
  gameDetail(key: string): GameDetail {
    const { appid } = parseKey(key)
    return {
      key,
      achievements: appid != null ? this.repo.achievements(appid) : [],
      historyKr: appid != null ? this.repo.priceHistory(appid, 'kr') : [],
      historyUs: appid != null ? this.repo.priceHistory(appid, 'us') : [],
      sessions: this.repo.sessions({ key, limit: 50 }),
      playtimeSeries: this.repo.playtimeSeries(key),
      dlcs: this.repo.listDlcs(key)
    }
  }

  async loadGlobalPct(key: string): Promise<GameDetail> {
    const { appid } = parseKey(key)
    if (appid != null) {
      const pct = await getGlobalAchievementPct(appid)
      this.repo.setGlobalPct(appid, pct)
    }
    return this.gameDetail(key)
  }

  // ───────── 활동 기록 ─────────
  activity(days: number): ActivityData {
    const today = recordDate()
    const from = addDays(today, -(days - 1))
    const baseline = this.repo.snapshotBaseline(from)
    const snaps = this.repo.snapshotsSince(from)
    const names = new Map(this.repo.listGames().map((g) => [g.key, g.nameKo || g.name]))

    const perDay = new Map<string, number>()
    const perGame = new Map<string, number>()
    const last = new Map(baseline)
    for (const s of snaps) {
      const prev = last.get(s.key)
      last.set(s.key, s.minutes)
      // 첫 기록은 그동안의 누적값이라 플레이 시간으로 치지 않는다
      if (prev === undefined) continue
      const delta = Math.max(0, s.minutes - prev)
      if (!delta) continue
      perDay.set(s.date, (perDay.get(s.date) ?? 0) + delta)
      perGame.set(s.key, (perGame.get(s.key) ?? 0) + delta)
    }
    const daily = dateRange(from, today).map((d) => ({ date: d, minutes: perDay.get(d) ?? 0 }))
    const topGames = [...perGame.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key, minutes]) => ({ key, name: names.get(key) ?? key, minutes }))

    const fromMs = Date.parse(from + 'T00:00:00+09:00')
    const unlockSince = Math.floor(Date.now() / 1000) - 365 * 86_400
    const unlocks = this.repo.recentUnlocks(unlockSince)
    const achByMonthMap = new Map<string, number>()
    for (const u of unlocks) {
      const m = kstDate(u.unlockTime * 1000).slice(0, 7)
      achByMonthMap.set(m, (achByMonthMap.get(m) ?? 0) + 1)
    }
    const months: string[] = []
    const now = new Date()
    for (let k = 11; k >= 0; k--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1))
      months.push(d.toISOString().slice(0, 7))
    }
    return {
      daily,
      topGames,
      sessions: this.repo.sessions({ since: fromMs, limit: 100 }),
      achievements: unlocks
        .filter((u) => u.unlockTime * 1000 >= fromMs)
        .slice(0, 100)
        .map((u) => ({
          key: keyOf('steam', u.appid),
          gameName: names.get(keyOf('steam', u.appid)) ?? `App ${u.appid}`,
          apiname: u.apiname,
          name: u.name,
          icon: u.icon,
          unlockTime: u.unlockTime
        })),
      achByMonth: months.map((m) => ({ month: m, count: achByMonthMap.get(m) ?? 0 })),
      snapshotDays: this.repo.snapshotCount()
    }
  }

  // ───────── 추천 ─────────
  async recommendations(refreshPool: boolean): Promise<RecommendationResult> {
    const s = this.getSettings()
    const games = this.repo.listGames()
    const included = games.filter((g) => !excludeReason(g, { ...s, excludeUnplayed: false }))
    const profile = genreProfile(included, s.unplayedMinutes)
    const weight = new Map(profile.map((p) => [p.id, p.weight]))
    let error: string | null = null

    let pool = this.repo.recoPool()
    const stale = !pool.length || Date.now() - pool[0].fetchedAt > 7 * 86_400_000
    const genreIds = profile.filter((p) => genreById(p.id)?.spy).slice(0, 5).map((p) => p.id)
    if (profile.length && (refreshPool || !pool.length)) {
      // 직접 새로 고침했거나 후보가 하나도 없을 때만 기다린다
      try {
        pool = await this.buildPool(genreIds)
      } catch (e) {
        error = `추천 후보를 불러오지 못했습니다: ${(e as Error).message}`
      }
    } else if (profile.length && stale && !this.poolBuilding) {
      // 오래된 후보는 일단 그대로 보여 주고 뒤에서 새로 받는다 (다음에 열 때 반영)
      this.poolBuilding = this.buildPool(genreIds)
        .catch(() => [])
        .finally(() => {
          this.poolBuilding = null
          this.recoCache = null
        }) as Promise<unknown>
    }
    if (!refreshPool && this.recoCache && Date.now() - this.recoCache.at < 10 * 60_000 && this.recoCache.poolAt === (pool[0]?.fetchedAt ?? 0)) {
      return this.recoCache.v
    }

    const owned = new Set(games.map((g) => g.appid).filter((x): x is number => x != null))
    // 다른 플랫폼(PS·Xbox·Switch)에 이미 있는 게임도 빼기 위해 이름으로도 비교한다
    const ownedNames = new Set(
      games.flatMap((g) => [g.name, g.nameKo]).filter((n): n is string => Boolean(n)).map(titleKey).filter((k) => k.length >= 2)
    )
    const wish = new Set(this.repo.wishlistAppids())
    const reasonFor = (ids: string[], match: number, quality: number | null): RecoReason => ({
      genres: ids.map((id) => ({ id, name: genreName(id), weight: weight.get(id) ?? 0 })).sort((a, b) => b.weight - a.weight),
      match,
      quality,
      because: becauseOf(ids, profile)
    })
    const scored: Recommendation[] = []
    for (const c of pool) {
      if (owned.has(c.appid) || ownedNames.has(titleKey(c.name))) continue
      const ids = c.genres.map((en) => genreByEn(en)?.id).filter((x): x is string => Boolean(x))
      const matched = ids.filter((id) => (weight.get(id) ?? 0) > 0.15)
      if (!matched.length) continue
      const match = ids.reduce((acc, id) => acc + (weight.get(id) ?? 0), 0) / Math.sqrt(ids.length)
      const reviews = c.positive + c.negative
      const pct = reviews ? c.positive / reviews : 0
      const quality = pct * Math.min(1, Math.log10(Math.max(10, reviews)) / 5.5)
      scored.push({
        appid: c.appid,
        name: c.name,
        score: match * 0.65 + quality * 0.35,
        matched: matched.map((id) => genreName(id)),
        positivePct: Math.round(pct * 100),
        reviews,
        headerImage: steamHeader(c.appid),
        priceKr: null,
        inWishlist: wish.has(c.appid),
        reason: reasonFor(ids, match, quality)
      })
    }
    scored.sort((a, b) => b.score - a.score)
    const top = scored.slice(0, 30)
    if (top.length) {
      try {
        const prices = await getPricesBatch(
          top.map((t) => t.appid),
          'kr',
          undefined,
          limiters.steamStoreUi
        )
        for (const t of top) {
          const p = prices.get(t.appid)
          t.priceKr = p ? { ...p, fetchedAt: Date.now() } : null
        }
      } catch {
        // 가격 없이 표시
      }
    }

    // 이미 가진 게임 중 아직 안 한 게임에서 취향에 맞는 것
    const backlog: Recommendation[] = included
      .filter((g) => isUnplayed(g, s.unplayedMinutes) && g.genres.length > 0)
      .map((g) => {
        const ids = g.genres.map((x) => x.id)
        const match = ids.length ? ids.reduce((acc, id) => acc + (weight.get(id) ?? 0), 0) / Math.sqrt(ids.length) : 0
        return {
          appid: g.appid ?? 0,
          key: g.key,
          reason: reasonFor(ids, match, null),
          name: g.nameKo || g.name,
          score: match,
          matched: ids.filter((id) => (weight.get(id) ?? 0) > 0.15).map((id) => genreName(id)),
          positivePct: null,
          reviews: null,
          headerImage: g.headerImage,
          priceKr: g.priceKr,
          playtimeMin: g.playtimeMin
        }
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)

    const poolAt = pool[0]?.fetchedAt ?? null
    const result: RecommendationResult = { profile: profile.slice(0, 12), candidates: top, backlog, poolFetchedAt: poolAt, error }
    if (!error) this.recoCache = { at: Date.now(), poolAt: pool[0]?.fetchedAt ?? 0, v: result }
    return result
  }

  /** SteamSpy 장르별 목록에서 평가가 좋은 게임만 후보로 저장 */
  private poolBuilding: Promise<unknown> | null = null
  private recoCache: { at: number; poolAt: number; v: RecommendationResult } | null = null

  private async buildPool(genreIds: string[]) {
    const merged = new Map<number, { appid: number; name: string; genres: string[]; positive: number; negative: number }>()
    // 장르별 목록을 동시에 받는다 (요청 시작만 1.1초 간격, 내려받기는 겹쳐서)
    const lists = await Promise.all(
      genreIds.map(async (id) => {
        const g = genreById(id)
        if (!g) return null
        try {
          const r = await request<Record<string, { appid: number; name: string; positive: number; negative: number }>>(
            `https://steamspy.com/api.php?request=genre&genre=${encodeURIComponent(g.en)}`,
            { limiter: limiters.steamspy, timeoutMs: 90_000 }
          )
          return { g, r }
        } catch {
          return null
        }
      })
    )
    if (genreIds.length && lists.every((x) => x == null)) throw new Error('SteamSpy 응답이 없습니다.')
    for (const item of lists) {
      if (!item) continue
      const { g, r } = item
      for (const v of Object.values(r ?? {})) {
        const reviews = (v.positive ?? 0) + (v.negative ?? 0)
        if (reviews < 2000 || v.positive / reviews < 0.75 || !v.name) continue
        const cur = merged.get(v.appid) ?? { appid: v.appid, name: v.name, genres: [], positive: v.positive, negative: v.negative }
        if (!cur.genres.includes(g.en)) cur.genres.push(g.en)
        merged.set(v.appid, cur)
      }
    }
    const list = [...merged.values()]
    if (list.length) this.repo.replaceRecoPool(list)
    return this.repo.recoPool()
  }

  // ───────── 가격 검색 (보유하지 않은 게임 포함) ─────────
  private inspectCache = new Map<number, { at: number; v: Promise<PriceInspection> }>()

  /** 가격 검색·상세 창. 같은 게임은 15분 동안 다시 받지 않는다 */
  inspectPrice(appid: number): Promise<PriceInspection> {
    const hit = this.inspectCache.get(appid)
    if (hit && Date.now() - hit.at < 15 * 60_000) return hit.v
    const v = this.inspectPriceFresh(appid)
    this.inspectCache.set(appid, { at: Date.now(), v })
    v.catch(() => this.inspectCache.delete(appid))
    if (this.inspectCache.size > 80) this.inspectCache.delete(this.inspectCache.keys().next().value as number)
    return v
  }

  private async inspectPriceFresh(appid: number): Promise<PriceInspection> {
    const s = this.getSettings()
    const notes: string[] = []
    const ui = limiters.steamStoreUi
    // 서로 기다릴 필요가 없는 요청은 한꺼번에 보낸다
    const detailsP = getAppDetails(appid, undefined, ui)
    const usP = getPricesBatch([appid], 'us', undefined, ui).then(
      (m) => m.get(appid) ?? null,
      () => {
        notes.push('미국 가격을 불러오지 못했습니다.')
        return null
      }
    )
    const reviewP = getStoreItems([appid])
      .then((m) => m.get(appid)?.review ?? null)
      .catch(() => null)
      .then(async (r) => r ?? this.repo.getReview(appid) ?? (await getAppReview(appid).catch(() => null)))
    const itadP = (async () => {
      if (!s.itadApiKey) {
        notes.push('설정에서 IsThereAnyDeal API 키를 넣으면 역대 최저가와 할인 이력을 볼 수 있습니다.')
        return { available: false, hk: [] as PricePoint[], hu: [] as PricePoint[] }
      }
      try {
        const itadId = await this.itadId(s.itadApiKey, appid)
        if (!itadId) {
          notes.push('IsThereAnyDeal에서 이 게임을 찾지 못했습니다.')
          return { available: false, hk: [], hu: [] }
        }
        const [lowKr, lowUs, hk, hu] = await Promise.all([
          steamStoreLows(s.itadApiKey, [itadId], 'kr'),
          steamStoreLows(s.itadApiKey, [itadId], 'us'),
          steamHistory(s.itadApiKey, itadId, 'kr'),
          steamHistory(s.itadApiKey, itadId, 'us')
        ])
        const lk = lowKr.get(itadId)
        const lu = lowUs.get(itadId)
        if (lk) this.repo.saveLow(appid, 'kr', lk)
        if (lu) this.repo.saveLow(appid, 'us', lu)
        if (!hk.length) notes.push('한국 가격 이력이 IsThereAnyDeal에 없어 프로그램이 기록한 값만 표시합니다.')
        return { available: true, hk, hu }
      } catch (e) {
        notes.push(`역대 가격을 불러오지 못했습니다: ${(e as Error).message}`)
        return { available: false, hk: [], hu: [] }
      }
    })()

    const [{ app, priceKr, extra }, priceUs, review, itad] = await Promise.all([detailsP, usP, reviewP, itadP])
    if (app.status === 'ok') this.repo.upsertSteamApp(app)
    else notes.push('한국 상점에서 판매하지 않거나 정보를 받을 수 없는 게임입니다.')
    if (review) this.repo.saveReview(appid, review)

    const now = Date.now()
    const owned = this.repo.ownedSteamAppids().includes(appid)
    const inWishlist = this.repo.wishlistAppids().includes(appid)
    // 보유/위시리스트 게임만 가격 이력을 계속 기록한다
    if (owned || inWishlist) {
      if (app.status === 'ok') this.repo.savePrice(appid, 'kr', priceKr)
      this.repo.savePrice(appid, 'us', priceUs)
    }
    const historyKr: PricePoint[] = [...itad.hk, ...this.repo.priceHistory(appid, 'kr')]
    const historyUs: PricePoint[] = [...itad.hu, ...this.repo.priceHistory(appid, 'us')]

    const pk = app.status === 'ok' && priceKr ? { ...priceKr, fetchedAt: now } : null
    const pu = priceUs ? { ...priceUs, fetchedAt: now } : null
    return {
      appid,
      name: app.nameKo || this.repo.getSteamApp(appid)?.name || `App ${appid}`,
      headerImage: app.headerImage || steamHeader(appid),
      genres: app.genres ?? [],
      priceKr: pk,
      priceUs: pu,
      lowKr: this.lowFrom(appid, 'kr', pk, historyKr),
      lowUs: this.lowFrom(appid, 'us', pu, historyUs),
      historyKr,
      historyUs,
      owned,
      inWishlist,
      itadAvailable: itad.available,
      notes,
      review: review ?? null,
      description: extra?.description ?? null,
      releaseDate: app.status === 'ok' ? (app.releaseDate ?? null) : null,
      developers: extra?.developers ?? [],
      screenshots: extra?.screenshots ?? []
    }
  }

  private lowFrom(appid: number, region: 'kr' | 'us', cur: PriceInspection['priceKr'], hist: PricePoint[]) {
    const itad = this.repo.getItadLow(appid, region)
    const other = this.repo.getItadLow(appid, region === 'kr' ? 'us' : 'kr')
    const fromHist = hist.filter((p) => p.final > 0).reduce<PricePoint | null>((a, b) => (!a || b.final < a.final ? b : a), null)
    const histLow = fromHist
      ? { amount: fromHist.final, regular: fromHist.initial, cut: fromHist.discount, date: new Date(fromHist.t).toISOString(), source: fromHist.source }
      : null
    // 다른 지역 이력의 최대 할인율도 추정에 사용
    const otherHist = Math.max(other?.cut ?? 0, 0)
    return effectiveLow(itad, cur, histLow, otherHist || null)
  }

  private async itadId(key: string, appid: number): Promise<string | null> {
    const m = this.repo.getItadId(appid)
    if (m?.itadId) return m.itadId
    const map = await lookupSteamIds(key, [appid])
    const id = map.get(appid) ?? null
    this.repo.setItadId(appid, id)
    return id
  }

  async itadHistory(appid: number): Promise<{ kr: PricePoint[]; us: PricePoint[] }> {
    const s = this.getSettings()
    if (!s.itadApiKey) throw new Error('IsThereAnyDeal API 키가 필요합니다.')
    const id = await this.itadId(s.itadApiKey, appid)
    if (!id) return { kr: [], us: [] }
    const [kr, us] = await Promise.all([steamHistory(s.itadApiKey, id, 'kr'), steamHistory(s.itadApiKey, id, 'us')])
    return { kr, us }
  }

  // ───────── 엔딩 시간 ─────────
  async lookupHltb(key: string): Promise<HltbInfo | null> {
    const g = this.repo.getGame(key)
    if (!g) return null
    const r = await findHltb(g.name, g.appid)
    this.repo.saveHltb(key, {
      hltbId: r?.hltbId ?? null,
      matchedName: r?.name ?? null,
      main: r?.main ?? null,
      extra: r?.extra ?? null,
      complete: r?.complete ?? null
    })
    return this.repo.getGame(key)?.hltb ?? null
  }

  /** 아직 엔딩 시간을 찾지 않은 게임 일괄 조회 (완료/포기/제외 게임은 건너뜀) */
  async lookupHltbBulk(onProgress: (cur: number, total: number) => void, signal: AbortSignal): Promise<{ found: number; total: number }> {
    const s = this.getSettings()
    const fetched = this.repo.hltbFetchedKeys()
    const targets = this.repo
      .listGames()
      .filter((g) => !fetched.has(g.key) && !excludeReason(g, s) && !['completed', 'dropped'].includes(g.status))
    let found = 0
    for (let i = 0; i < targets.length; i++) {
      if (signal.aborted) break
      onProgress(i + 1, targets.length)
      try {
        const h = await this.lookupHltb(targets[i].key)
        if (h?.main) found++
      } catch {
        // 개별 실패는 넘어감
      }
    }
    return { found, total: targets.length }
  }
}
