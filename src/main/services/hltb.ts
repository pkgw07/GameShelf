// HowLongToBeat 평균 엔딩 시간 조회 (비공식).
// 공식 API가 없어 사이트의 검색 기능을 사용한다. 사이트 구조가 바뀌면 실패할 수 있으며,
// 그때는 화면에서 엔딩 시간을 직접 입력하면 된다.
import { limiters, request } from '../util/http'

const BASE = 'https://howlongtobeat.com'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

interface Auth {
  endpoint: string
  token: string | null
  extra: Record<string, string>
  at: number
}

let auth: Auth | null = null

export interface HltbResult {
  hltbId: number
  name: string
  /** 시간 단위 */
  main: number | null
  extra: number | null
  complete: number | null
  steamAppid: number | null
}

const headers = () => ({ 'User-Agent': UA, Referer: `${BASE}/`, Origin: BASE, Accept: '*/*' })

/** 홈페이지 스크립트에서 검색 엔드포인트를 찾는다 */
export function findSearchEndpoint(script: string): string | null {
  // 예: fetch("/api/seek/".concat(key),{method:"POST",...}) 또는 fetch("/api/s/"+k,{method:"POST"})
  const re =
    /fetch\s*\(\s*["'`](\/api\/[a-zA-Z0-9_/]+)[^"'`]*["'`](?:\.concat\([^)]*\)|\s*\+\s*[^,]+)?\s*,\s*\{[^}]*?method\s*:\s*["']POST["']/g
  let m: RegExpExecArray | null
  while ((m = re.exec(script))) {
    const p = m[1]
    if (!/\/(user|log|error|track|report)/i.test(p)) return p.replace(/\/+$/, '')
  }
  return null
}

async function getAuth(force = false): Promise<Auth> {
  if (auth && !force && Date.now() - auth.at < 30 * 60_000) return auth
  let endpoint = '/api/s'
  try {
    const home = await request<string>(`${BASE}/`, { text: true, headers: headers(), limiter: limiters.hltb, retries: 1 })
    const scripts = [...home.matchAll(/<script[^>]+src=["']([^"']*\/_next\/static\/chunks\/[^"']+\.js)["']/g)].map((m) => m[1])
    // 페이지 스크립트를 우선 확인
    scripts.sort((a, b) => Number(/pages|_app/.test(b)) - Number(/pages|_app/.test(a)))
    for (const src of scripts.slice(0, 25)) {
      const url = src.startsWith('http') ? src : `${BASE}${src}`
      const js = await request<string>(url, { text: true, headers: headers(), limiter: limiters.hltb, retries: 0 }).catch(() => '')
      const ep = js && findSearchEndpoint(js)
      if (ep) {
        endpoint = ep
        break
      }
    }
  } catch {
    // 기본 엔드포인트로 시도
  }
  let token: string | null = null
  const extra: Record<string, string> = {}
  try {
    const init = await request<Record<string, unknown>>(`${BASE}${endpoint}/init?t=${Date.now()}`, {
      headers: headers(),
      limiter: limiters.hltb,
      retries: 1
    })
    if (init && typeof init === 'object') {
      for (const [k, v] of Object.entries(init)) {
        if (typeof v !== 'string') continue
        if (k === 'token') token = v
        else if (/key/i.test(k)) extra.key = v
        else if (/val/i.test(k)) extra.val = v
      }
    }
  } catch {
    // 토큰 없이 시도
  }
  auth = { endpoint, token, extra, at: Date.now() }
  return auth
}

export function cleanTitle(name: string): string {
  return name
    .replace(/[™®©]/g, '')
    .replace(/\s*[-–:]\s*(game of the year|goty|definitive|complete|deluxe|enhanced|remastered|director'?s cut)( edition)?$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/[^a-z0-9가-힣]+/g, ' ')
    .trim()

/** 0~1 문자열 유사도 (레벤슈타인 기반) */
export function similarity(a: string, b: string): number {
  const x = norm(a)
  const y = norm(b)
  if (!x.length || !y.length) return 0
  if (x === y) return 1
  const dp = Array.from({ length: y.length + 1 }, (_, i) => i)
  for (let i = 1; i <= x.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= y.length; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return 1 - dp[y.length] / Math.max(x.length, y.length)
}

const hours = (sec: unknown) => {
  const n = Number(sec)
  return Number.isFinite(n) && n > 0 ? Math.round((n / 3600) * 10) / 10 : null
}

async function rawSearch(title: string, a: Auth): Promise<HltbResult[]> {
  const payload: Record<string, unknown> = {
    searchType: 'games',
    searchTerms: title.split(' '),
    searchPage: 1,
    size: 20,
    searchOptions: {
      games: {
        userId: 0,
        platform: '',
        sortCategory: 'popular',
        rangeCategory: 'main',
        rangeTime: { min: null, max: null },
        gameplay: { perspective: '', flow: '', genre: '', difficulty: '' },
        rangeYear: { min: '', max: '' },
        modifier: 'hide_dlc'
      },
      users: { sortCategory: 'postcount' },
      lists: { sortCategory: 'follows' },
      filter: '',
      sort: 0,
      randomizer: 0
    },
    useCache: true
  }
  const h: Record<string, string> = { ...headers(), 'Content-Type': 'application/json' }
  if (a.token) h['x-auth-token'] = a.token
  if (a.extra.key) {
    h['x-hp-key'] = a.extra.key
    payload.hpKey = a.extra.key
  }
  if (a.extra.val) {
    h['x-hp-val'] = a.extra.val
    payload.hpVal = a.extra.val
  }
  const r = await request<{ data?: Record<string, unknown>[] }>(`${BASE}${a.endpoint}`, {
    method: 'POST',
    body: payload,
    headers: h,
    limiter: limiters.hltb,
    retries: 1
  })
  return (r?.data ?? []).map((d) => ({
    hltbId: Number(d.game_id),
    name: String(d.game_name ?? ''),
    main: hours(d.comp_main),
    extra: hours(d.comp_plus),
    complete: hours(d.comp_100),
    steamAppid: Number(d.profile_steam) || null
  }))
}

export async function searchHltb(title: string): Promise<HltbResult[]> {
  const q = cleanTitle(title)
  try {
    return await rawSearch(q, await getAuth())
  } catch {
    // 토큰 만료 등: 한 번 새로 받아서 재시도
    return await rawSearch(q, await getAuth(true))
  }
}

/** 게임 하나의 엔딩 시간 찾기. Steam appid가 일치하는 결과를 우선한다 */
export function pickBest(results: HltbResult[], title: string, appid: number | null): HltbResult | null {
  if (appid != null) {
    const exact = results.find((r) => r.steamAppid === appid)
    if (exact) return exact
  }
  let best: HltbResult | null = null
  let bestScore = 0
  for (const r of results) {
    const s = Math.max(similarity(r.name, title), similarity(r.name, cleanTitle(title)))
    if (s > bestScore) {
      best = r
      bestScore = s
    }
  }
  return bestScore >= 0.72 ? best : null
}

export async function findHltb(title: string, appid: number | null): Promise<HltbResult | null> {
  const results = await searchHltb(title)
  return pickBest(results, title, appid)
}
