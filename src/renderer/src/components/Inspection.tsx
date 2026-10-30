import { useEffect, useMemo, useState } from 'react'
import { LuExternalLink, LuX } from 'react-icons/lu'
import { dealVerdict, normalizeHistory, VERDICT_LABELS } from '@shared/analytics'
import type { PriceInspection } from '@shared/types'
import { StepChart } from '@/components/charts'
import { Cover, LowLine, PriceLine, ReviewBadge, VERDICT_TONE } from '@/components/game'
import { Badge, Button, Segmented, Spinner } from '@/components/ui'
import { cn } from '@/lib/cn'
import { dateKo, price, usd, won } from '@/lib/format'
import { useStore } from '@/lib/store'

/** 상점 게임의 가격·할인 이력·소개. 게임 가격 검색 화면과 상세 창에서 함께 쓴다 */
export function Inspection({ info, drawer }: { info: PriceInspection; drawer?: boolean }) {
  const [region, setRegion] = useState<'kr' | 'us'>(info.historyKr.length || !info.historyUs.length ? 'kr' : 'us')
  const [shot, setShot] = useState<string | null>(null)
  const hist = useMemo(() => normalizeHistory(region === 'kr' ? info.historyKr : info.historyUs), [info, region])
  const cur = region === 'kr' ? info.priceKr : info.priceUs
  const low = region === 'kr' ? info.lowKr : info.lowUs
  const fmt = region === 'kr' ? won : usd
  const verdict = dealVerdict(cur, low)
  const maxCut = hist.reduce((a, p) => Math.max(a, p.discount), 0)
  const saleCount = hist.filter((p) => p.discount > 0).length

  return (
    <div>
      <div className={cn('flex gap-5', drawer && 'flex-col gap-4')}>
        <Cover src={info.headerImage} alt={info.name} className={cn('aspect-[460/215] shrink-0 rounded-xl', drawer ? 'w-full' : 'w-[260px]')} />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl leading-tight font-bold text-ink">{info.name}</h2>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {info.owned && <Badge tone="brand">보유 중</Badge>}
            {info.inWishlist && <Badge tone="sale">위시리스트</Badge>}
            {info.genres.map((g) => (
              <Badge key={g.id}>{g.name}</Badge>
            ))}
          </div>
          {(info.releaseDate || info.developers.length > 0) && (
            <div className="mt-1.5 text-[13px] text-muted">
              {[info.developers.slice(0, 2).join(', '), info.releaseDate && `출시 ${info.releaseDate}`].filter(Boolean).join(' · ')}
            </div>
          )}
          {info.review && (
            <div className="mt-1.5 text-[13px]">
              <span className="text-muted">Steam 평가 </span>
              <ReviewBadge review={info.review} />
              <span className="num ml-1 text-faint">({info.review.count.toLocaleString()}개)</span>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-end gap-4">
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

      {info.description && <p className="mt-5 text-[14px] leading-relaxed text-ink">{info.description}</p>}

      {info.screenshots.length > 0 && (
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {info.screenshots.map((s) => (
            <button key={s.thumb} type="button" className="shrink-0 overflow-hidden rounded-lg ring-1 ring-line" onClick={() => setShot(s.full)}>
              <img src={s.thumb} alt="" className="h-[84px] w-[150px] object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      <div className={cn('mt-6 grid gap-4 rounded-xl bg-surface-2 p-4', drawer ? 'grid-cols-2' : 'grid-cols-4')}>
        <div>
          <div className="text-[12px] text-muted">정가</div>
          <div className="num text-lg font-bold">{price(cur, 'initial')}</div>
        </div>
        <div>
          <div className="text-[12px] text-muted">Steam 역대 최저가</div>
          <div className="text-lg">
            <LowLine low={low} fmt={fmt} />
          </div>
          <div className="text-[11px] text-faint">{low?.source === 'estimate' ? '미국 최대 할인율 기준' : low?.date ? dateKo(low.date) : ''}</div>
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
          height={drawer ? 180 : 220}
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

      {shot && (
        <button type="button" aria-label="닫기" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8" onClick={() => setShot(null)}>
          <img src={shot} alt="" className="max-h-full max-w-full rounded-lg" />
        </button>
      )}
    </div>
  )
}

/** 보유하지 않은 게임의 상세 창 (추천, 위시리스트 등에서 열림) */
export function StoreDrawer() {
  const { openAppId, openApp, toast } = useStore()
  const [info, setInfo] = useState<PriceInspection | null>(null)
  useEffect(() => {
    if (openAppId == null) return
    let alive = true
    setInfo(null)
    window.api
      .inspectPrice(openAppId)
      .then((r) => alive && setInfo(r))
      .catch((e: Error) => {
        if (!alive) return
        toast(e.message, 'error')
        openApp(null)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openAppId])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && openApp(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openApp])
  if (openAppId == null) return null
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="닫기" className="absolute inset-0 bg-black/30" onClick={() => openApp(null)} />
      <aside className="drawer-in relative flex h-full w-[620px] max-w-[92vw] flex-col overflow-y-auto border-l border-line bg-paper">
        <button
          type="button"
          aria-label="닫기"
          className="absolute top-3 right-3 z-10 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70"
          onClick={() => openApp(null)}
        >
          <LuX className="h-4 w-4" />
        </button>
        <div className="p-6">
          {info && info.appid === openAppId ? (
            <Inspection key={info.appid} info={info} drawer />
          ) : (
            <div className="flex items-center gap-2 py-10 text-[13px] text-muted">
              <Spinner /> 게임 정보와 가격 이력을 불러오는 중
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
