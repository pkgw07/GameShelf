import { useMemo, useState } from 'react'
import { LuExternalLink, LuSearch } from 'react-icons/lu'
import { dealVerdict, normalizeHistory, VERDICT_LABELS } from '@shared/analytics'
import type { PriceInspection, StoreSearchResult } from '@shared/types'
import { StepChart } from '@/components/charts'
import { Cover, LowLine, PriceLine, ReviewBadge, VERDICT_TONE } from '@/components/game'
import { PageBody, TopBar } from '@/components/Shell'
import { Badge, Button, Empty, Input, Panel, Segmented, Spinner } from '@/components/ui'
import { cn } from '@/lib/cn'
import { dateKo, price, usd, won } from '@/lib/format'
import { useStore } from '@/lib/store'

export function Search() {
  const { toast } = useStore()
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<StoreSearchResult[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [picked, setPicked] = useState<number | null>(null)
  const [info, setInfo] = useState<PriceInspection | null>(null)
  const [inspecting, setInspecting] = useState(false)

  const search = async () => {
    if (!term.trim()) return
    setLoading(true)
    try {
      setResults(await window.api.searchStore(term.trim()))
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const inspect = async (appid: number) => {
    setPicked(appid)
    setInspecting(true)
    setInfo(null)
    try {
      setInfo(await window.api.inspectPrice(appid))
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setInspecting(false)
    }
  }

  return (
    <>
      <TopBar title="게임 가격 검색" />
      <PageBody>
        <p className="mb-4 max-w-[70ch] text-[13px] text-muted">
          갖고 있지 않은 게임도 검색할 수 있습니다. 지금 할인이 Steam 역대 최저가 수준인지, 과거 할인 이력과 비교해 보여 줍니다.
        </p>
        <form
          className="mb-5 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void search()
          }}
        >
          <div className="relative">
            <LuSearch className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint" />
            <Input className="w-[420px] pl-9" placeholder="게임 이름 (한국어 또는 영어)" value={term} onChange={(e) => setTerm(e.target.value)} />
          </div>
          <Button variant="primary" type="submit" disabled={loading}>
            {loading ? <Spinner className="border-t-brand-ink" /> : null}
            검색
          </Button>
        </form>
        <div className="grid grid-cols-[340px_1fr] items-start gap-5">
          <div className="rounded-2xl border border-line bg-surface">
            {results == null ? (
              <p className="p-5 text-[13px] text-muted">검색 결과가 여기에 표시됩니다.</p>
            ) : results.length === 0 ? (
              <p className="p-5 text-[13px] text-muted">검색 결과가 없습니다. 영어 이름으로도 찾아보세요.</p>
            ) : (
              <ul>
                {results.map((r) => (
                  <li key={r.appid}>
                    <button
                      type="button"
                      onClick={() => void inspect(r.appid)}
                      className={cn(
                        'flex w-full items-center gap-3 border-b border-line px-3 py-2.5 text-left last:border-b-0 hover:bg-surface-2',
                        picked === r.appid && 'bg-brand-soft'
                      )}
                    >
                      <Cover src={r.image} alt="" className="h-[34px] w-[90px] shrink-0 rounded" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-ink">{r.name}</div>
                        <PriceLine p={r.priceKr} className="text-[12px]" />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            {inspecting && (
              <div className="flex items-center gap-2 p-6 text-[13px] text-muted">
                <Spinner /> 가격과 할인 이력을 불러오는 중
              </div>
            )}
            {!inspecting && info && <Inspection info={info} />}
            {!inspecting && !info && <Empty title="왼쪽 목록에서 게임을 고르세요">현재 가격, 역대 최저가, 할인 이력 그래프를 보여 줍니다.</Empty>}
          </div>
        </div>
      </PageBody>
    </>
  )
}

function Inspection({ info }: { info: PriceInspection }) {
  const [region, setRegion] = useState<'kr' | 'us'>(info.historyKr.length || !info.historyUs.length ? 'kr' : 'us')
  const hist = useMemo(() => normalizeHistory(region === 'kr' ? info.historyKr : info.historyUs), [info, region])
  const cur = region === 'kr' ? info.priceKr : info.priceUs
  const low = region === 'kr' ? info.lowKr : info.lowUs
  const fmt = region === 'kr' ? won : usd
  const verdict = dealVerdict(cur, low)
  const maxCut = hist.reduce((a, p) => Math.max(a, p.discount), 0)
  const saleCount = hist.filter((p) => p.discount > 0).length

  return (
    <Panel>
      <div className="flex gap-5">
        <Cover src={info.headerImage} alt={info.name} className="aspect-[460/215] w-[260px] shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl leading-tight font-bold text-ink">{info.name}</h2>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {info.owned && <Badge tone="brand">보유 중</Badge>}
            {info.inWishlist && <Badge tone="sale">위시리스트</Badge>}
            {info.genres.map((g) => (
              <Badge key={g.id}>{g.name}</Badge>
            ))}
          </div>
          {info.review && (
            <div className="mt-1.5 text-[13px]">
              <span className="text-muted">Steam 평가 </span>
              <ReviewBadge review={info.review} />
              <span className="num ml-1 text-faint">({info.review.count.toLocaleString()}개)</span>
            </div>
          )}
          <div className="mt-4 flex items-end gap-4">
            <div>
              <div className="text-[12px] text-muted">현재 가격 ({region === 'kr' ? '한국' : '미국'})</div>
              <PriceLine p={cur} className="text-2xl" />
            </div>
            {verdict !== 'unknown' && (
              <Badge tone={VERDICT_TONE[verdict]} className="mb-1 px-3 py-1 text-[13px]">
                {VERDICT_LABELS[verdict]}
              </Badge>
            )}
          </div>
          <Button
            size="sm"
            className="mt-3"
            icon={<LuExternalLink />}
            onClick={() => void window.api.openExternal(`https://store.steampowered.com/app/${info.appid}/`)}
          >
            Steam 상점에서 보기
          </Button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-4 gap-4 rounded-xl bg-surface-2 p-4">
        <div>
          <div className="text-[12px] text-muted">정가</div>
          <div className="num text-lg font-bold">{price(cur, 'initial')}</div>
        </div>
        <div>
          <div className="text-[12px] text-muted">Steam 역대 최저가</div>
          <div className="text-lg">
            <LowLine low={low} fmt={fmt} />
          </div>
          <div className="text-[11px] text-faint">
            {low?.source === 'estimate' ? '미국 최대 할인율 기준' : low?.date ? dateKo(low.date) : ''}
          </div>
        </div>
        <div>
          <div className="text-[12px] text-muted">역대 최대 할인율</div>
          <div className="num text-lg font-bold">{Math.max(maxCut, low?.cut ?? 0) ? `${Math.max(maxCut, low?.cut ?? 0)}%` : '—'}</div>
          <div className="text-[11px] text-faint">지금 {cur?.discount ?? 0}%</div>
        </div>
        <div>
          <div className="text-[12px] text-muted">기록된 할인 횟수</div>
          <div className="num text-lg font-bold">{saleCount ? `${saleCount}번` : '—'}</div>
          <div className="text-[11px] text-faint">{hist.length ? `${dateKo(hist[0].t)}부터` : '이력 없음'}</div>
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold">가격 변동 이력</h3>
          <Segmented<'kr' | 'us'>
            size="sm"
            value={region}
            onChange={setRegion}
            options={[
              { value: 'kr', label: '한국' },
              { value: 'us', label: '미국' }
            ]}
          />
        </div>
        <StepChart
          format={fmt}
          height={220}
          series={[{ name: region === 'kr' ? '한국 가격' : '미국 가격', color: 'var(--chart-1)', points: hist.map((p) => ({ t: p.t, v: p.final })) }]}
          markers={low ? [{ v: low.amount, label: '역대 최저', color: 'var(--good)' }] : []}
        />
      </div>
      {info.notes.length > 0 && (
        <ul className="mt-4 space-y-1 text-[12px] text-faint">
          {info.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {info.itadAvailable && <p className="mt-2 text-[11px] text-faint">가격 이력 제공: IsThereAnyDeal</p>}
    </Panel>
  )
}
