// 연말 결산: 한 해 동안의 플레이, 도전과제, 지출 정리
import { genreName } from '@shared/genres'
import type { RareAchievement, YearReview } from '@shared/types'
import type { Repo } from '../db/repo'
import { keyOf } from '../db/repo'
import { kstDate } from '../util/time'

type Row = Record<string, unknown>

export function yearReview(repo: Repo, year: number): YearReview {
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const games = repo.listGames()
  const byKey = new Map(games.map((g) => [g.key, g]))
  const nameOf = (key: string) => {
    const g = byKey.get(key)
    return g ? g.nameKo || g.name : key
  }

  // ── 플레이타임: 스냅샷 사이의 증가분
  const baseline = repo.snapshotBaseline(from)
  const snaps = repo.snapshotsSince(from).filter((s) => s.date <= to)
  const last = new Map(baseline)
  const perGame = new Map<string, number>()
  const perMonth = new Map<string, number>()
  const perDay = new Map<string, number>()
  const days = new Set<string>()
  for (const s of snaps) {
    days.add(s.date)
    const prev = last.get(s.key)
    last.set(s.key, s.minutes)
    if (prev === undefined) continue
    const d = Math.max(0, s.minutes - prev)
    if (!d) continue
    perGame.set(s.key, (perGame.get(s.key) ?? 0) + d)
    perMonth.set(s.date.slice(0, 7), (perMonth.get(s.date.slice(0, 7)) ?? 0) + d)
    perDay.set(s.date, (perDay.get(s.date) ?? 0) + d)
  }
  const playMinutes = [...perGame.values()].reduce((a, b) => a + b, 0)
  const genreMin = new Map<string, number>()
  for (const [key, m] of perGame) {
    for (const gr of byKey.get(key)?.genres ?? []) genreMin.set(gr.id, (genreMin.get(gr.id) ?? 0) + m)
  }

  // ── 도전과제
  const start = Math.floor(Date.parse(`${from}T00:00:00+09:00`) / 1000)
  const end = Math.floor(Date.parse(`${year + 1}-01-01T00:00:00+09:00`) / 1000)
  const unlocks = repo.db
    .prepare(
      `SELECT appid, apiname, name, description, icon, global_pct, unlock_time FROM steam_ach
       WHERE achieved = 1 AND unlock_time >= ? AND unlock_time < ?`
    )
    .all<Row>(start, end)
  const achMonth = new Map<string, number>()
  for (const u of unlocks) {
    const m = kstDate(Number(u.unlock_time) * 1000).slice(0, 7)
    achMonth.set(m, (achMonth.get(m) ?? 0) + 1)
  }
  const rarest: RareAchievement[] = unlocks
    .filter((u) => u.global_pct != null)
    .sort((a, b) => Number(a.global_pct) - Number(b.global_pct))
    .slice(0, 5)
    .map((u) => ({
      key: keyOf('steam', Number(u.appid)),
      gameName: nameOf(keyOf('steam', Number(u.appid))),
      apiname: String(u.apiname),
      name: String(u.name ?? u.apiname),
      description: String(u.description ?? ''),
      icon: String(u.icon ?? ''),
      globalPct: Number(u.global_pct),
      unlockTime: Number(u.unlock_time)
    }))
  // 그해에 마지막 도전과제를 달성해서 100%가 된 게임
  const completedGames = repo.db
    .prepare(
      `SELECT s.appid, MAX(a.unlock_time) AS last FROM steam_ach_summary s JOIN steam_ach a ON a.appid = s.appid
       WHERE s.total > 0 AND s.done = s.total AND a.achieved = 1 GROUP BY s.appid HAVING last >= ? AND last < ?`
    )
    .all<Row>(start, end)
    .map((r) => ({ key: keyOf('steam', Number(r.appid)), name: nameOf(keyOf('steam', Number(r.appid))) }))

  // ── 지출 (게임 + DLC)
  const bought: YearReview['bought'] = []
  for (const g of games) {
    const date = g.purchaseDate ?? g.acquiredDate
    if (date && date.startsWith(String(year))) bought.push({ key: g.key, name: g.nameKo || g.name, price: g.purchasePrice, date })
  }
  for (const d of repo.listDlcs()) {
    if (d.owned && d.purchaseDate?.startsWith(String(year))) bought.push({ key: d.key, name: d.name, price: d.purchasePrice, date: d.purchaseDate })
  }
  bought.sort((a, b) => a.date.localeCompare(b.date))

  // ── 플레이 세션
  const sessions = repo
    .sessions({ since: Date.parse(`${from}T00:00:00+09:00`), limit: 100_000 })
    .filter((s) => s.startedAt < Date.parse(`${year + 1}-01-01T00:00:00+09:00`) && s.endedAt)
  let longest: YearReview['longestSession'] = null
  for (const s of sessions) {
    const m = Math.round(((s.endedAt as number) - s.startedAt) / 60_000)
    if (!longest || m > longest.minutes) longest = { name: s.name, minutes: m }
  }

  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
  return {
    year,
    recordedDays: days.size,
    playMinutes,
    activeDays: [...perDay.values()].filter((v) => v > 0).length,
    topGames: [...perGame.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key, minutes]) => ({ key, name: nameOf(key), minutes })),
    monthlyMinutes: months.map((m) => ({ month: m, minutes: perMonth.get(m) ?? 0 })),
    achievements: unlocks.length,
    monthlyAchievements: months.map((m) => ({ month: m, count: achMonth.get(m) ?? 0 })),
    rarest,
    completedGames,
    spent: bought.reduce((a, b) => a + (b.price ?? 0), 0),
    boughtCount: bought.length,
    bought,
    sessions: sessions.length,
    longestSession: longest,
    genreMinutes: [...genreMin.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id, minutes]) => ({ id, name: genreName(id), minutes }))
  }
}
