// Steam 구매 내역 / 라이선스 페이지 가져오기
// 화면에서 저장된 HTML을 파싱해 행 목록으로 보내면, 여기서 보유 게임과 이름을 맞춘다.
import type { GameRow, ImportItemResult, ImportResult, ParsedLicenseRow, ParsedPurchaseRow } from '@shared/types'
import type { Repo } from '../db/repo'
import { similarity } from './hltb'

const SUFFIXES = [
  /\s*-\s*commercial license$/i,
  /\s*-\s*limited free promotional package.*$/i,
  /\s*\(?\s*retail\s*\)?$/i,
  /\s*\[?\s*steam\s*\]?$/i,
  /\s*-\s*complimentary$/i
]

export function normalizeName(s: string): string {
  let x = s.replace(/[™®©]/g, '').trim()
  for (const re of SUFFIXES) x = x.replace(re, '')
  return x
    .toLowerCase()
    .replace(/[''`´]/g, '')
    .replace(/[^a-z0-9가-힣ぁ-んァ-ン一-龥]+/g, ' ')
    .trim()
}

export class NameIndex {
  private exact = new Map<string, GameRow>()
  constructor(private games: GameRow[]) {
    for (const g of games) {
      for (const n of [g.name, g.nameKo]) {
        if (!n) continue
        const k = normalizeName(n)
        if (k && !this.exact.has(k)) this.exact.set(k, g)
      }
    }
  }

  match(name: string): GameRow | null {
    const k = normalizeName(name)
    if (!k) return null
    const hit = this.exact.get(k)
    if (hit) return hit
    let best: GameRow | null = null
    let score = 0
    for (const g of this.games) {
      for (const n of [g.name, g.nameKo]) {
        if (!n) continue
        const s = similarity(n, name)
        if (s > score) {
          score = s
          best = g
        }
      }
    }
    return score >= 0.9 ? best : null
  }
}

/** 한 결제에 여러 게임이 있으면 각 게임의 정가 비율로 금액을 나눈다 */
export function splitAmount(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (sum <= 0) {
    const each = Math.floor(total / weights.length)
    return weights.map((_, i) => (i === weights.length - 1 ? total - each * (weights.length - 1) : each))
  }
  const parts = weights.map((w) => Math.round((total * w) / sum))
  const diff = total - parts.reduce((a, b) => a + b, 0)
  parts[parts.length - 1] += diff
  return parts
}

export function importPurchases(repo: Repo, rows: ParsedPurchaseRow[]): ImportResult {
  const games = repo.listGames()
  const idx = new NameIndex(games)
  const unmatched: ImportItemResult[] = []
  let matched = 0
  let skippedManual = 0

  // 오래된 결제부터 처리해서, 같은 게임을 여러 번 산 경우 가장 최근 값이 남게 한다
  const sorted = [...rows].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
  const refunded = new Set<string>()
  for (const r of sorted) if (r.isRefund) for (const it of r.items) refunded.add(normalizeName(it))

  repo.db.tx(() => {
    for (const r of sorted) {
      repo.insertPurchase({
        date: r.date,
        type: r.type,
        items: r.items,
        total: r.total,
        currency: r.currency,
        refunded: r.isRefund
      })
      if (!r.isGamePurchase || r.isRefund || !r.items.length) continue
      const krw = r.currency === 'KRW' || r.currency == null
      const hits = r.items.map((it) => ({ item: it, game: idx.match(it) }))
      const weights = hits.map((h) => h.game?.priceKr?.initial ?? 0)
      const avg = weights.filter((w) => w > 0).reduce((a, b, _, arr) => a + b / arr.length, 0) || 1
      const shares = r.total != null && krw ? splitAmount(r.total, weights.map((w) => (w > 0 ? w : avg))) : hits.map(() => null)
      hits.forEach((h, i) => {
        const amount = shares[i]
        if (refunded.has(normalizeName(h.item))) return
        if (!h.game) {
          unmatched.push({ itemName: h.item, date: r.date, amount, matchedKey: null, matchedName: null })
          return
        }
        if (repo.setImportedPurchase(h.game.key, amount, r.date)) matched++
        else skippedManual++
      })
    }
  })
  return { kind: 'purchases', totalRows: rows.length, matched, skippedManual, unmatched }
}

export function importLicenses(repo: Repo, rows: ParsedLicenseRow[]): ImportResult {
  const idx = new NameIndex(repo.listGames())
  const unmatched: ImportItemResult[] = []
  let matched = 0
  repo.db.tx(() => {
    for (const r of rows) {
      const g = idx.match(r.name)
      if (!g) {
        unmatched.push({ itemName: r.name, date: r.date, amount: null, matchedKey: null, matchedName: null })
        continue
      }
      if (r.date) {
        repo.setAcquiredDate(g.key, r.date)
        matched++
      }
    }
  })
  return { kind: 'licenses', totalRows: rows.length, matched, skippedManual: 0, unmatched }
}
