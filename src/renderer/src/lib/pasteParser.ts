// 붙여넣은 텍스트(직접 만든 표, 엑셀, Steam 구매 내역 복사, 캡처 인식 결과)에서
// "게임 이름 + 금액 (+ 날짜)"를 찾아낸다. 결과는 화면에서 확인·수정한 뒤 적용한다.
import { parseSteamDate } from './parsers'

export interface PastedLine {
  id: number
  raw: string
  name: string
  amount: number | null
  currency: string | null
  date: string | null
  refund: boolean
  /** 한 결제에 여러 게임이 묶여 금액을 나눈 경우 */
  split: boolean
}

export interface MatchTarget {
  key: string
  label: string
  names: string[]
}

const NOISE =
  /(steam\s*지갑|steam wallet|wallet credit|지갑\s*(충전|잔액)?|구매|purchase|선물|gift|결제\s*수단|payment|visa|master\s*card|paypal|카카오페이|네이버페이|토스|신용카드|체크카드|합계|총액|total|금액|가격|price|날짜|date|항목|items?|유형|type|변경|잔액|balance)/gi

const MONEY_RE = /(₩|\$|USD|KRW)?\s*(\d{1,3}(?:[,.]\d{3})+|\d+)(?:\.(\d{2}))?\s*(원)?/g

function findMoney(line: string): { amount: number; currency: string | null; text: string } | null {
  let best: { amount: number; currency: string | null; text: string } | null = null
  for (const m of line.matchAll(MONEY_RE)) {
    const [text, sym, intPart, dec, wonSuffix] = m
    const hasMark = Boolean(sym || wonSuffix)
    const digits = intPart.replace(/[,.]/g, '')
    const n = Number(digits)
    if (!Number.isFinite(n)) continue
    // 표시가 없는 숫자는 100 이상이고 쉼표가 있거나 4자리 이상일 때만 금액으로 본다 (연도·수량 제외)
    if (!hasMark && (n < 100 || (!/[,.]/.test(intPart) && digits.length < 4) || /^(19|20)\d{2}$/.test(digits))) continue
    const currency = sym === '$' || sym === 'USD' ? 'USD' : 'KRW'
    const amount = currency === 'USD' ? n * 100 + Number(dec ?? 0) : n
    // 줄의 마지막 금액을 결제 금액으로 본다
    best = { amount, currency, text }
  }
  return best
}

function findDate(line: string): { date: string; text: string } | null {
  const pats = [
    /\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일/,
    /\d{4}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2}\.?/,
    /\d{1,2}\s+[A-Za-z]{3}[a-z]*\.?,?\s+\d{4}/,
    /[A-Za-z]{3}[a-z]*\.?\s+\d{1,2},?\s+\d{4}/
  ]
  for (const re of pats) {
    const m = line.match(re)
    if (m) {
      const d = parseSteamDate(m[0])
      if (d) return { date: d, text: m[0] }
    }
  }
  return null
}

function cleanName(s: string): string {
  return s
    .replace(NOISE, ' ')
    .replace(/[|•·\t]+/g, ' ')
    .replace(/^[\s\-–:,.]+|[\s\-–:,.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parsePasted(text: string): PastedLine[] {
  const out: PastedLine[] = []
  let id = 0
  let cur: { date: string | null; names: string[]; refund: boolean; raw: string[] } = { date: null, names: [], refund: false, raw: [] }

  const flush = (amount: number | null, currency: string | null) => {
    const names = cur.names.filter((n) => n.length >= 2 && /[a-zA-Z가-힣]/.test(n))
    if (names.length) {
      const each = amount != null && names.length > 1 ? Math.round(amount / names.length) : amount
      names.forEach((name, i) =>
        out.push({
          id: ++id,
          raw: cur.raw.join(' / '),
          name,
          amount: names.length > 1 && amount != null && i === names.length - 1 ? amount - (each ?? 0) * (names.length - 1) : each,
          currency,
          date: cur.date,
          refund: cur.refund,
          split: names.length > 1
        })
      )
    }
    cur = { date: null, names: [], refund: false, raw: [] }
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    let rest = line
    const d = findDate(rest)
    if (d) {
      if (cur.names.length) flush(null, null)
      cur.date = d.date
      rest = rest.replace(d.text, ' ')
    }
    const m = findMoney(rest)
    if (m) rest = rest.replace(m.text, ' ')
    if (/(환불|refund)/i.test(line)) cur.refund = true
    const name = cleanName(rest)
    cur.raw.push(line)
    if (name) cur.names.push(name)
    if (m) flush(m.amount, m.currency)
  }
  if (cur.names.length) flush(null, null)
  return out
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/[^a-z0-9가-힣]+/g, ' ')
    .trim()

function similarity(a: string, b: string): number {
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return 0
  if (x === y) return 1
  if (x.length > 3 && y.length > 3 && (x.includes(y) || y.includes(x))) return 0.85 * (Math.min(x.length, y.length) / Math.max(x.length, y.length)) + 0.15
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

/** 가장 비슷한 게임/DLC. 어느 정도 비슷해야 자동으로 연결한다 */
export function bestMatch(name: string, targets: MatchTarget[]): { target: MatchTarget; score: number } | null {
  let best: { target: MatchTarget; score: number } | null = null
  for (const t of targets) {
    for (const n of t.names) {
      const s = similarity(name, n)
      if (!best || s > best.score) best = { target: t, score: s }
    }
  }
  return best && best.score >= 0.72 ? best : null
}
