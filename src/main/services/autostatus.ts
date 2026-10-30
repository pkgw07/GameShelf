// 상태 태그 자동 제안.
// 사용자가 직접 고른 상태는 절대 바꾸지 않는다 (Repo.setAutoStatus 에서 보장).
import type { GameRow, GameStatus } from '@shared/types'
import type { Repo } from '../db/repo'

const RECENT_SEC = 14 * 86_400

export function suggestStatus(g: GameRow, nowSec = Math.floor(Date.now() / 1000)): GameStatus | null {
  if (g.achTotal && g.achTotal > 0 && g.achDone === g.achTotal) return 'completed'
  if (g.status === 'completed' || g.status === 'cleared') return null
  const recent = g.playtime2wMin > 0 || (g.lastPlayed != null && nowSec - g.lastPlayed < RECENT_SEC)
  if (recent && (g.playtimeMin > 0 || g.playtimeKnown === false)) return 'playing'
  return null
}

/** 자동 상태 적용. 바뀐 게임 수를 돌려준다 */
export function applyAutoStatus(repo: Repo, games: GameRow[]): number {
  let n = 0
  for (const g of games) {
    const s = suggestStatus(g)
    if (!s) continue
    // 직접 정한 태그가 있으면 건너뜀 (none 이거나 자동으로 붙은 태그만 갱신)
    if (!g.statusAuto && g.status !== 'none') continue
    if (repo.setAutoStatus(g.key, s)) n++
  }
  return n
}

/** "플레이 중"인데 오래 안 한 게임 (화면에서 포기/나중에로 바꿀지 물어봄) */
export const STALE_PLAYING_SEC = 90 * 86_400
