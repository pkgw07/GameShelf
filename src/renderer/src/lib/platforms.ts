import { titleKey } from '@shared/analytics'
import { PLATFORM_LABELS, type GameRow } from '@shared/types'

/** 카드·표에 쓰는 기기 이름 (PS5, Xbox Series, Switch …). Steam 은 'Steam' */
export function deviceLabel(g: Pick<GameRow, 'platform' | 'device'>): string {
  return g.device ?? PLATFORM_LABELS[g.platform]
}

export interface GameGroup {
  /** 대표 (플레이타임이 가장 긴 것) */
  primary: GameRow
  all: GameRow[]
}

/**
 * 여러 플랫폼에 있는 같은 게임 묶기. 이름(영어·한국어)을 정규화한 값이 하나라도 같으면 같은 게임으로 본다.
 * 순서는 입력 목록에서 처음 나온 순서를 따른다.
 */
export function groupAcrossPlatforms(list: GameRow[]): GameGroup[] {
  const parent = list.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const seen = new Map<string, number>()
  list.forEach((g, i) => {
    for (const n of [g.name, g.nameKo]) {
      if (!n) continue
      const k = titleKey(n)
      if (k.length < 2) continue
      const j = seen.get(k)
      if (j == null) seen.set(k, i)
      else parent[find(i)] = find(j)
    }
  })
  const groups = new Map<number, GameRow[]>()
  const order: number[] = []
  list.forEach((g, i) => {
    const r = find(i)
    if (!groups.has(r)) {
      groups.set(r, [])
      order.push(r)
    }
    groups.get(r)!.push(g)
  })
  return order.map((r) => {
    const all = groups.get(r)!
    const primary = all.reduce((a, b) => (b.playtimeMin > a.playtimeMin ? b : a))
    return { primary, all }
  })
}

/** 같은 게임의 다른 플랫폼 판 */
export function siblingsOf(g: GameRow, games: GameRow[]): GameRow[] {
  const keys = new Set([g.name, g.nameKo].filter((n): n is string => Boolean(n)).map(titleKey).filter((k) => k.length >= 2))
  if (!keys.size) return []
  return games.filter((x) => x.key !== g.key && [x.name, x.nameKo].some((n) => n && keys.has(titleKey(n))))
}
