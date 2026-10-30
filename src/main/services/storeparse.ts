// Steam 스토어(로그인 세션) 응답을 다루는 순수 함수들. Electron 없이 테스트할 수 있게 분리했다.

/** steamLoginSecure 쿠키 값("7656...%7C%7C<토큰>")에서 SteamID64 를 꺼낸다 */
export function steamIdFromLoginCookie(value: string | null | undefined): string | null {
  if (!value) return null
  let v = value
  try {
    v = decodeURIComponent(value)
  } catch {
    /* 그대로 사용 */
  }
  const m = v.match(/^(7656\d{13})\|\|/)
  return m ? m[1] : null
}

export interface HistoryCursor {
  wallet_txnid: string
  timestamp_newest: string | number
  balance: string | number
  currency: string | number
}

/** 구매 내역 페이지의 `g_historyCursor = {...};` 를 읽는다. 더 불러올 내역이 없으면 null */
export function parseHistoryCursor(html: string): HistoryCursor | null {
  const m = html.match(/g_historyCursor\s*=\s*(\{[^;]*?\})\s*;/)
  if (!m) return null
  try {
    const c = JSON.parse(m[1]) as HistoryCursor | null
    return c && c.wallet_txnid != null ? c : null
  } catch {
    return null
  }
}

/** 페이지 안의 g_sessionID (AJAX 요청에 필요) */
export function parseSessionId(html: string): string | null {
  return html.match(/g_sessionID\s*=\s*"([^"]+)"/)?.[1] ?? null
}

export function loadMoreBody(sessionId: string, c: HistoryCursor): URLSearchParams {
  const p = new URLSearchParams()
  p.set('sessionid', sessionId)
  p.set('cursor[wallet_txnid]', String(c.wallet_txnid))
  p.set('cursor[timestamp_newest]', String(c.timestamp_newest))
  p.set('cursor[balance]', String(c.balance))
  p.set('cursor[currency]', String(c.currency))
  return p
}

/** 구매 내역 페이지에서 내역 표의 행(<tr class="wallet_table_row">…)만 잘라 낸다 */
export function extractHistoryRows(html: string): string {
  const start = html.search(/<tr[^>]*class="[^"]*wallet_table_row/)
  if (start < 0) return ''
  const tableEnd = html.indexOf('</table>', start)
  return html.slice(start, tableEnd < 0 ? undefined : tableEnd)
}

/** 잘라 낸 행들을 렌더러 파서가 읽을 수 있는 한 장의 페이지로 묶는다 */
export function wrapHistory(rows: string[]): string {
  return `<!doctype html><html><body><div class="wallet_history_page"><table class="wallet_history_table"><tbody>${rows.join('\n')}</tbody></table></div></body></html>`
}

/** dynamicstore/userdata 응답에서 보유 앱 목록 (게임 + DLC). 로그인이 풀렸으면 빈 배열 */
export function ownedAppsFromUserdata(json: unknown): number[] {
  const apps = (json as { rgOwnedApps?: unknown })?.rgOwnedApps
  return Array.isArray(apps) ? apps.map(Number).filter((n) => Number.isInteger(n) && n > 0) : []
}

/** appmanifest_*.acf 의 InstalledDepots 에 적힌 dlcappid (설치된 DLC) */
export function installedDlcFromManifest(acf: string): number[] {
  return [...acf.matchAll(/"dlcappid"\s+"(\d+)"/g)].map((m) => Number(m[1]))
}

/** libraryfolders.vdf 에서 라이브러리 경로 목록 */
export function libraryPaths(vdf: string): string[] {
  return [...vdf.matchAll(/"path"\s+"([^"]+)"/g)].map((m) => m[1].replace(/\\\\/g, '\\'))
}
