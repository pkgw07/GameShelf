// 저장한 Steam 페이지(HTML)를 파싱한다.
// - 구매 내역: https://store.steampowered.com/account/history/
// - 라이선스: https://store.steampowered.com/account/licenses/
import type { ParsedLicenseRow, ParsedPurchaseRow } from '@shared/types'

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

/** "2023년 5월 3일", "3 May, 2023", "May 3, 2023", "2023. 5. 3." → 2023-05-03 */
export function parseSteamDate(s: string): string | null {
  const t = s.trim()
  let m = t.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/)
  if (m) return iso(+m[1], +m[2], +m[3])
  m = t.match(/(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/)
  if (m) return iso(+m[1], +m[2], +m[3])
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  m = t.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})/)
  if (m) {
    const mo = months.indexOf(m[2].toLowerCase())
    if (mo >= 0) return iso(+m[3], mo + 1, +m[1])
  }
  m = t.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/)
  if (m) {
    const mo = months.indexOf(m[1].toLowerCase())
    if (mo >= 0) return iso(+m[3], mo + 1, +m[2])
  }
  return null
}

function iso(y: number, m: number, d: number): string | null {
  if (!y || !m || !d || m > 12 || d > 31) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** "₩ 32,000" → { 32000, KRW }, "$12.99" → { 1299, USD } */
export function parseMoney(s: string): { amount: number | null; currency: string | null } {
  const t = s.replace(/\s+/g, ' ').trim()
  if (!t) return { amount: null, currency: null }
  let currency: string | null = null
  if (/₩|원|KRW/i.test(t)) currency = 'KRW'
  else if (/\$|USD/.test(t)) currency = 'USD'
  else if (/€/.test(t)) currency = 'EUR'
  const m = t.match(/[\d.,]+/)
  if (!m) return { amount: null, currency }
  let digits = m[0]
  if (currency === 'KRW') return { amount: Number(digits.replace(/[^\d]/g, '')), currency }
  // 소수점 통화: 마지막 구분자가 소수점
  digits = digits.replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.')
  const v = Number(digits)
  return { amount: Number.isFinite(v) ? Math.round(v * 100) : null, currency }
}

const NON_GAME = /(게임 내|in-game|마켓|market|지갑|wallet|선물|gift|교환|trade|환불|refund)/i
const PURCHASE = /(구매|purchase)/i
const REFUND = /(환불|refund)/i

export function parsePurchaseHistory(html: string): ParsedPurchaseRow[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const rows = [...doc.querySelectorAll('tr.wallet_table_row')]
  return rows.map((tr) => {
    const date = parseSteamDate(text(tr.querySelector('.wht_date')))
    const itemsEl = tr.querySelector('.wht_items')
    // 결제 수단(wth_payment) 같은 부가 줄은 게임 이름이 아니다
    const itemDivs = itemsEl ? [...itemsEl.querySelectorAll(':scope > div')].filter((d) => !/payment/i.test(d.className)) : []
    let items = itemDivs.map((d) => text(d)).filter(Boolean)
    // 결제 수단 등 부가 정보 줄 제거
    items = items.filter((x) => !/^(steam 지갑|wallet|결제|payment)/i.test(x))
    if (!items.length && itemsEl) items = [text(itemsEl)].filter(Boolean)
    const typeEl = tr.querySelector('.wht_type')
    const type = text(typeEl?.querySelector('div') ?? typeEl)
    const totalText = text(tr.querySelector('.wht_total'))
    const { amount, currency } = parseMoney(totalText)
    const isRefund = REFUND.test(type)
    return {
      date,
      items,
      type,
      total: amount,
      currency,
      isRefund,
      isGamePurchase: PURCHASE.test(type) && !NON_GAME.test(type)
    }
  })
}

export function parseLicenses(html: string): ParsedLicenseRow[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const rows = [...doc.querySelectorAll('table.account_table tr')]
  const out: ParsedLicenseRow[] = []
  for (const tr of rows) {
    const dateCell = tr.querySelector('td.license_date_col')
    if (!dateCell) continue
    const cells = [...tr.querySelectorAll('td')]
    const nameCell = cells.find((c) => !c.classList.contains('license_date_col') && !c.classList.contains('license_acquisition_col'))
    if (!nameCell) continue
    // "삭제" 링크 등 부가 요소 제거
    const clone = nameCell.cloneNode(true) as Element
    clone.querySelectorAll('.free_license_remove_link, a, div').forEach((n) => n.remove())
    const name = text(clone)
    if (!name) continue
    out.push({
      date: parseSteamDate(text(dateCell)),
      name,
      acquisition: text(tr.querySelector('td.license_acquisition_col'))
    })
  }
  return out
}

/** 어떤 페이지인지 판별 */
export function detectPage(html: string): 'purchases' | 'licenses' | null {
  if (html.includes('wallet_table_row')) return 'purchases'
  if (html.includes('license_date_col')) return 'licenses'
  return null
}
