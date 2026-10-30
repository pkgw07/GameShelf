import { useEffect, useMemo, useState } from 'react'
import { LuSearch } from 'react-icons/lu'
import { dealVerdict, VERDICT_LABELS, type DealVerdict } from '@shared/analytics'
import type { LowInfo, PriceInfo, ReviewInfo } from '@shared/types'
import { Cover, LowLine, PriceLine, ReviewBadge, VERDICT_TONE } from '@/components/game'
import { PageBody, TopBar } from '@/components/Shell'
import { Badge, Empty, Input, Segmented, Switch } from '@/components/ui'
import { dateKo, parseWon, usd, won } from '@/lib/format'
import { useStore } from '@/lib/store'

interface DealRow {
  /** 검색용 (한국어·영어 이름) */
  search: string
  key: string
  appid: number
  name: string
  image: string
  priceKr: PriceInfo | null
  priceUs: PriceInfo | null
  lowKr: LowInfo | null
  verdict: DealVerdict
  owned: boolean
  addedAt: number | null
  review: ReviewInfo | null
  targetPrice: number | null
}

const VERDICT_ORDER: DealVerdict[] = ['lowest', 'near', 'wait', 'notOnSale', 'unknown']

export function Deals() {
  const { wishlist, games, openGame, openApp } = useStore()
  const [tab, setTab] = useState<'wish' | 'owned'>('wish')
  const [saleOnly, setSaleOnly] = useState(false)
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()

  const wishRows: DealRow[] = useMemo(
    () =>
      wishlist.map((w) => ({
        key: w.key,
        appid: w.appid,
        name: w.name,
        search: w.name.toLowerCase(),
        image: w.headerImage,
        priceKr: w.priceKr,
        priceUs: w.priceUs,
        lowKr: w.lowKr,
        verdict: dealVerdict(w.priceKr, w.lowKr),
        owned: false,
        addedAt: w.addedAt,
        review: w.review,
        targetPrice: w.targetPrice
      })),
    [wishlist]
  )
  const ownedRows: DealRow[] = useMemo(
    () =>
      games
        .filter((g) => g.appid != null && g.priceKr && g.priceKr.discount > 0)
        .map((g) => ({
          key: g.key,
          appid: g.appid!,
          name: g.nameKo || g.name,
          search: `${g.nameKo ?? ''} ${g.name}`.toLowerCase(),
          image: g.headerImage,
          priceKr: g.priceKr,
          priceUs: g.priceUs,
          lowKr: g.lowKr,
          verdict: dealVerdict(g.priceKr, g.lowKr),
          owned: true,
          addedAt: null,
          review: g.review,
          targetPrice: null
        })),
    [games]
  )

  const rows = (tab === 'wish' ? wishRows : ownedRows)
    .filter((r) => (!saleOnly || (r.priceKr && r.priceKr.discount > 0)) && (!needle || r.search.includes(needle)))
    .sort(
      (a, b) =>
        VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict) || (b.priceKr?.discount ?? 0) - (a.priceKr?.discount ?? 0)
    )
  const onSaleWish = wishRows.filter((r) => r.priceKr && r.priceKr.discount > 0).length
  const lowestWish = wishRows.filter((r) => r.verdict === 'lowest').length

  return (
    <>
      <TopBar title="할인 · 위시리스트" />
      <PageBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative">
            <LuSearch className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint" />
            <Input className="w-56 pl-9" placeholder="게임 이름 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Segmented<'wish' | 'owned'>
            value={tab}
            onChange={setTab}
            options={[
              { value: 'wish', label: '위시리스트', count: wishRows.length },
              { value: 'owned', label: '보유 게임 중 할인', count: ownedRows.length }
            ]}
          />
          {tab === 'wish' && (
            <span className="text-[13px] text-muted">
              할인 중 <b className="text-sale">{onSaleWish}</b>개 · 역대 최저가 <b className="text-good">{lowestWish}</b>개
            </span>
          )}
          <div className="ml-auto w-48">
            <Switch checked={saleOnly} onChange={setSaleOnly} label="할인 중만 보기" />
          </div>
        </div>
        {tab === 'owned' && (
          <p className="text-[13px] text-muted">이미 가진 게임의 할인 정보입니다. 선물하거나 친구에게 추천할 때 참고하세요.</p>
        )}
        {!rows.length ? (
          <Empty
            title={
              needle || saleOnly
                ? '조건에 맞는 게임이 없습니다'
                : tab === 'wish'
                  ? '위시리스트가 비어 있거나 아직 불러오지 않았습니다'
                  : '지금 할인 중인 보유 게임이 없습니다'
            }
          >
            {tab === 'wish' && !needle && !saleOnly && 'Steam 프로필의 위시리스트가 공개되어 있어야 불러올 수 있습니다. 동기화 후 다시 확인해 주세요.'}
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            {rows.map((r) => {
              const aboveLow = r.priceKr && r.lowKr && r.lowKr.amount > 0 ? r.priceKr.final / r.lowKr.amount - 1 : null
              return (
                <div key={r.key} className="flex items-center gap-4 border-b border-line px-4 py-3 last:border-b-0">
                  <Cover src={r.image} alt={r.name} className="h-[54px] w-[116px] shrink-0 rounded-md" />
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      className="block max-w-full truncate text-left text-[14px] font-semibold text-ink hover:underline"
                      onClick={() =>
                        r.owned ? openGame(r.key) : openApp(r.appid)
                      }
                    >
                      {r.name}
                    </button>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-faint">
                      <span>역대 최저</span>
                      <LowLine low={r.lowKr} fmt={won} className="text-[12px]" />
                      {r.lowKr?.date && r.lowKr.source !== 'estimate' && <span>({dateKo(r.lowKr.date)})</span>}
                      {aboveLow != null && aboveLow > 0.001 && <span>· 지금은 최저가보다 {(aboveLow * 100).toFixed(0)}% 비쌈</span>}
                      <ReviewBadge review={r.review} />
                      {r.addedAt && <span>· {dateKo(r.addedAt)} 추가</span>}
                    </div>
                  </div>
                  {tab === 'wish' && <TargetInput appid={r.appid} value={r.targetPrice} current={r.priceKr?.final ?? null} />}
                  <div className="text-right">
                    <PriceLine p={r.priceKr} className="text-[14px]" />
                    <div className="num text-[12px] text-faint">미국 {usd(r.priceUs?.final)}</div>
                  </div>
                  <div className="w-24 text-right">
                    {r.verdict !== 'unknown' && <Badge tone={VERDICT_TONE[r.verdict]}>{VERDICT_LABELS[r.verdict]}</Badge>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </PageBody>
    </>
  )
}

/** 목표가: 이 가격 이하가 되면 Windows 알림 */
function TargetInput({ appid, value, current }: { appid: number; value: number | null; current: number | null }) {
  const { reload, toast } = useStore()
  const [v, setV] = useState(value != null ? String(value) : '')
  useEffect(() => setV(value != null ? String(value) : ''), [value])
  const reached = value != null && current != null && current <= value
  return (
    <label className="flex flex-col items-end gap-0.5">
      <span className={reached ? 'text-[11px] font-semibold text-good' : 'text-[11px] text-faint'}>{reached ? '목표가 도달!' : '목표가'}</span>
      <Input
        className="num h-8 w-28 text-right text-[13px]"
        inputMode="numeric"
        placeholder="알림 받을 가격"
        value={v ? Number(v).toLocaleString('ko-KR') : ''}
        onChange={(e) => setV(String(parseWon(e.target.value) ?? ''))}
        onBlur={async () => {
          const n = v === '' ? null : Number(v)
          if (n === value) return
          await window.api.setTargetPrice(appid, n)
          await reload()
          if (n != null) toast(`₩${n.toLocaleString('ko-KR')} 이하가 되면 알려 드릴게요.`)
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  )
}
