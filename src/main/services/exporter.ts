// CSV 내보내기 (엑셀에서 한글이 깨지지 않도록 BOM 포함)
import { STATUS_LABELS, type GameRow, type Settings } from '@shared/types'
import { costPerHour, excludeReason, EXCLUDE_LABELS, hltbRemaining, isUnplayed } from '@shared/analytics'

function cell(v: unknown): string {
  if (v == null) return ''
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function libraryCsv(games: GameRow[], s: Settings): string {
  const header = [
    'appid',
    '이름',
    '한국어 이름',
    '플레이타임(시간)',
    '안 한 게임',
    '상태',
    '제외',
    '장르',
    '정가(원)',
    '현재가(원)',
    '할인율(%)',
    '역대 최저가(원)',
    '정가(USD)',
    '현재가(USD)',
    '구매가(원)',
    '구매일',
    '시간당 비용(원)',
    '도전과제',
    '엔딩 시간(시간)',
    '엔딩까지 남은 시간',
    '평점',
    '메모'
  ]
  const lines = [header.map(cell).join(',')]
  for (const g of games) {
    const ex = excludeReason(g, s)
    const cph = costPerHour(g)
    const rem = hltbRemaining(g)
    lines.push(
      [
        g.appid,
        g.name,
        g.nameKo,
        (g.playtimeMin / 60).toFixed(1),
        isUnplayed(g, s.unplayedMinutes) ? 'O' : '',
        STATUS_LABELS[g.status],
        ex ? EXCLUDE_LABELS[ex] : '',
        g.genres.map((x) => x.name).join(' / '),
        g.priceKr?.initial,
        g.priceKr?.final,
        g.priceKr?.discount,
        g.lowKr?.amount,
        g.priceUs ? (g.priceUs.initial / 100).toFixed(2) : '',
        g.priceUs ? (g.priceUs.final / 100).toFixed(2) : '',
        g.purchasePrice,
        g.purchaseDate ?? g.acquiredDate,
        cph != null ? Math.round(cph) : '',
        g.achTotal ? `${g.achDone}/${g.achTotal}` : '',
        g.hltb?.main,
        rem ? rem.remaining.toFixed(1) : '',
        g.rating,
        g.notes
      ]
        .map(cell)
        .join(',')
    )
  }
  return '﻿' + lines.join('\r\n')
}
