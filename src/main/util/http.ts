// HTTP 요청 도우미: 호스트별 요청 간격 제한, 429 재시도, 타임아웃

type FetchFn = typeof fetch
let fetchImpl: FetchFn = (...a) => fetch(...a)

/** 테스트에서 가짜 fetch를 주입할 때 사용 */
export function setFetch(fn: FetchFn): void {
  fetchImpl = fn
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 요청 사이 최소 간격을 지키는 직렬 큐 */
export class RateLimiter {
  private chain: Promise<void> = Promise.resolve()
  private last = 0
  constructor(private minIntervalMs: number) {}

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const wait = this.last + this.minIntervalMs - Date.now()
      if (wait > 0) await sleep(wait)
      this.last = Date.now()
    })
    this.chain = run.catch(() => undefined)
    return run.then(fn)
  }

  /** 서버가 요청을 막았을 때 다음 요청까지 추가로 쉬게 한다 */
  penalize(ms: number): void {
    this.last = Math.max(this.last, Date.now() + ms - this.minIntervalMs)
  }
}

export const limiters = {
  steamApi: new RateLimiter(120),
  steamStore: new RateLimiter(1600),
  itad: new RateLimiter(350),
  hltb: new RateLimiter(1500),
  steamspy: new RateLimiter(1100)
}

export interface RequestOpts {
  method?: 'GET' | 'POST'
  body?: unknown
  headers?: Record<string, string>
  limiter?: RateLimiter
  timeoutMs?: number
  retries?: number
  signal?: AbortSignal
  /** true 면 텍스트로 받는다 */
  text?: boolean
}

export async function request<T = unknown>(url: string, opts: RequestOpts = {}): Promise<T> {
  const retries = opts.retries ?? 3
  for (let attempt = 0; ; attempt++) {
    if (opts.signal?.aborted) throw new Error('취소됨')
    const doFetch = async () => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000)
      const onAbort = () => ctrl.abort()
      opts.signal?.addEventListener('abort', onAbort)
      try {
        return await fetchImpl(url, {
          method: opts.method ?? 'GET',
          headers: {
            'User-Agent': 'SteamShelf/1.0 (+desktop app)',
            ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...opts.headers
          },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: ctrl.signal
        })
      } finally {
        clearTimeout(timer)
        opts.signal?.removeEventListener('abort', onAbort)
      }
    }
    let res: Response
    try {
      res = opts.limiter ? await opts.limiter.schedule(doFetch) : await doFetch()
    } catch (e) {
      if (opts.signal?.aborted) throw new Error('취소됨')
      if (attempt < retries) {
        await sleep(1000 * (attempt + 1))
        continue
      }
      throw new Error(`네트워크 오류: ${(e as Error).message}`)
    }
    if (res.status === 429 || res.status === 503) {
      const ra = Number(res.headers.get('retry-after'))
      const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(60_000, 5000 * 2 ** attempt)
      opts.limiter?.penalize(wait)
      if (attempt < retries) {
        await sleep(wait)
        continue
      }
      throw new HttpError(res.status, `요청이 너무 많아 잠시 막혔습니다 (${res.status})`)
    }
    if (!res.ok) {
      if (res.status >= 500 && attempt < retries) {
        await sleep(1500 * (attempt + 1))
        continue
      }
      throw new HttpError(res.status, `HTTP ${res.status}: ${url.replace(/key=[^&]+/i, 'key=***')}`)
    }
    if (opts.text) return (await res.text()) as T
    const txt = await res.text()
    if (!txt) return null as T
    try {
      return JSON.parse(txt) as T
    } catch {
      throw new Error(`응답을 해석할 수 없습니다: ${url.replace(/key=[^&]+/i, 'key=***')}`)
    }
  }
}

/** 동시 실행 개수를 제한해 비동기 작업 실행 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
