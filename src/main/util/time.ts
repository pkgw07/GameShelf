// 날짜 계산. 기록 기준일은 한국 시간이고, Steam 할인 교체 시간(새벽)을 고려해
// 새벽 4시 이전은 전날로 친다.

const KST_OFFSET_MS = 9 * 3600_000
const DAY_ROLLOVER_HOUR = 4

/** YYYY-MM-DD (KST, 새벽 4시 기준) */
export function recordDate(now = Date.now()): string {
  const d = new Date(now + KST_OFFSET_MS - DAY_ROLLOVER_HOUR * 3600_000)
  return d.toISOString().slice(0, 10)
}

/** KST 기준 YYYY-MM-DD (자정 기준) */
export function kstDate(ms: number): string {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10)
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}
