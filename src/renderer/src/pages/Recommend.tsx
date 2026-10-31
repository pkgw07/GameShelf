import { useCallback, useEffect, useState } from 'react'
import { LuChevronDown, LuRefreshCw } from 'react-icons/lu'
import { PLATFORM_LABELS, type GenreWeight, type Recommendation, type RecommendationResult } from '@shared/types'
import { Cover, PriceLine } from '@/components/game'
import { PageBody, TopBar } from '@/components/Shell'
import { Badge, Button, Empty, Panel, Spinner } from '@/components/ui'
import { cn } from '@/lib/cn'
import { hours, hoursFromH, relative } from '@/lib/format'
import { useStore } from '@/lib/store'

const compact = new Intl.NumberFormat('ko-KR', { notation: 'compact' })

let lastResult: RecommendationResult | null = null

export function Recommend() {
  const { games, openGame, openApp, toast } = useStore()
  // 다른 화면에 갔다 와도 지난 결과를 바로 보여 주고, 뒤에서 새로 받는다
  const [data, setData] = useState<RecommendationResult | null>(lastResult)
  const [loading, setLoading] = useState(false)

  const load = useCallback(
    async (refresh: boolean) => {
      setLoading(true)
      try {
        const r = await window.api.getRecommendations(refresh)
        lastResult = r
        setData(r)
        if (r.error) toast(r.error, 'error')
      } catch (e) {
        toast((e as Error).message, 'error')
      } finally {
        setLoading(false)
      }
    },
    [toast]
  )

  useEffect(() => {
    if (games.length) void load(false)
  }, [games.length, load])

  return (
    <>
      <TopBar
        title="추천"
        actions={
          <Button size="sm" variant="ghost" icon={<LuRefreshCw />} disabled={loading} onClick={() => void load(true)}>
            추천 후보 새로 받기
          </Button>
        }
      />
      <PageBody className="space-y-5">
        {!games.length ? (
          <Empty title="먼저 게임 목록을 동기화해 주세요" />
        ) : !data ? (
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <Spinner /> 장르 취향을 분석하고 추천 후보를 불러오는 중입니다. 처음 한 번은 30초 정도 걸릴 수 있고, 다음부터는 바로 열립니다.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[320px_1fr] gap-5">
              <Panel title="나의 장르 취향">
                {data.profile.length ? (
                  <GenreTaste profile={data.profile} onOpen={openGame} />
                ) : (
                  <p className="text-[13px] text-muted">플레이한 게임의 장르 정보가 아직 없습니다.</p>
                )}
                <p className="mt-4 text-[12px] text-faint">
                  장르를 누르면 점수에 반영된 게임을 볼 수 있습니다. 플레이타임이 긴 장르일수록 점수가 높고, 한 게임이 독식하지 않도록 로그 스케일로 계산합니다. 인디·무료·앞서 해보기는 비중을 낮춥니다. PlayStation 게임의 장르도 반영됩니다.
                </p>
              </Panel>
              <Panel
                title="이미 가진 게임 중 먼저 해볼 만한 것"
                action={<span className="text-[12px] text-faint">안 한 게임 중 취향 일치 순</span>}
              >
                {data.backlog.length ? (
                  <div className="grid grid-cols-3 gap-4">
                    {data.backlog.slice(0, 6).map((r) => (
                      <RecCard key={r.key ?? r.appid} r={r} onClick={() => openGame(r.key ?? `steam:${r.appid}`)} onOpenGame={openGame} owned />
                    ))}
                  </div>
                ) : (
                  <p className="text-[13px] text-muted">취향에 맞는 안 한 게임이 없습니다.</p>
                )}
              </Panel>
            </div>
            <Panel
              title="새로 사 볼 만한 게임"
              action={
                <span className="text-[12px] text-faint">
                  평가 75% 이상 · 리뷰 2,000개 이상 · 후보 갱신 {relative(data.poolFetchedAt)}
                </span>
              }
            >
              {loading && (
                <div className="mb-3 flex items-center gap-2 text-[13px] text-muted">
                  <Spinner /> 불러오는 중
                </div>
              )}
              {data.candidates.length ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
                  {data.candidates.map((r) => (
                    <RecCard
                      key={r.appid}
                      r={r}
                      onClick={() => openApp(r.appid, { name: r.name, headerImage: r.headerImage, priceKr: r.priceKr })}
                      onOpenGame={openGame}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-muted">추천 후보가 없습니다. 오른쪽 위 버튼으로 다시 받아 보세요.</p>
              )}
              <p className="mt-4 text-[11px] text-faint">추천 후보 데이터: SteamSpy</p>
            </Panel>
          </>
        )}
      </PageBody>
    </>
  )
}

function RecCard({ r, onClick, onOpenGame, owned }: { r: Recommendation; onClick(): void; onOpenGame(key: string): void; owned?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="self-start">
      <button type="button" onClick={onClick} className="group block w-full text-left">
        <div className="overflow-hidden rounded-xl ring-1 ring-line">
          <Cover src={r.headerImage} alt={r.name} className="aspect-[460/215] w-full transition-transform group-hover:scale-[1.03]" />
        </div>
        <div className="mt-2 truncate text-[14px] font-semibold text-ink">{r.name}</div>
      </button>
      <div className="mt-1 flex flex-wrap gap-1">
        {r.matched.slice(0, 3).map((m) => (
          <Badge key={m} tone="brand">
            {m}
          </Badge>
        ))}
        {r.inWishlist && <Badge tone="sale">위시리스트</Badge>}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 text-[12px]">
        {owned ? (
          <span className="text-muted">{r.playtimeMin ? `플레이 ${hours(r.playtimeMin)}` : '아직 안 함'}</span>
        ) : (
          <span className="num whitespace-nowrap text-muted">
            {r.positivePct != null ? `긍정 ${r.positivePct}%` : ''} {r.reviews ? `· 리뷰 ${compact.format(r.reviews)}` : ''}
          </span>
        )}
        {!owned && <PriceLine p={r.priceKr} className="ml-auto text-[13px]" compact />}
      </div>
      {r.reason && (
        <button
          type="button"
          className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <LuChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
          추천 이유 · {Math.round(r.score * 100)}점
        </button>
      )}
      {open && r.reason && <ReasonPanel r={r} onOpenGame={onOpenGame} />}
    </div>
  )
}

/** 추천 점수 풀어 보기: 취향 일치(장르) + 평가 */
function ReasonPanel({ r, onOpenGame }: { r: Recommendation; onOpenGame(key: string): void }) {
  const why = r.reason!
  const matchPts = Math.round(why.match * (why.quality == null ? 100 : 65))
  const qualityPts = why.quality == null ? null : Math.round(why.quality * 35)
  return (
    <div className="mt-2 space-y-3 rounded-xl border border-line bg-surface-2 p-3 text-[12px]">
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <span className="font-semibold text-ink">점수 {Math.round(r.score * 100)}</span>
          <span className="text-faint">{qualityPts == null ? '취향 일치만으로 계산' : `취향 일치 ${matchPts} + 평가 ${qualityPts}`}</span>
        </div>
        {qualityPts != null && (
          <div className="flex h-1.5 overflow-hidden rounded-full bg-surface">
            <div className="bg-[var(--chart-2)]" style={{ width: `${(matchPts / Math.max(1, matchPts + qualityPts)) * 100}%` }} />
            <div className="bg-[var(--chart-1)]" style={{ width: `${(qualityPts / Math.max(1, matchPts + qualityPts)) * 100}%` }} />
          </div>
        )}
      </div>
      <div>
        <div className="mb-1 text-muted">장르별 내 취향 점수</div>
        <ul className="space-y-1">
          {why.genres.map((g) => (
            <li key={g.id} className="flex items-center gap-2">
              <span className={cn('w-20 shrink-0 truncate', g.weight > 0.15 ? 'text-ink' : 'text-faint')}>{g.name}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface">
                <span className="block h-full rounded-full bg-[var(--chart-2)]" style={{ width: `${Math.round(g.weight * 100)}%` }} />
              </span>
              <span className="num w-8 text-right text-muted">{Math.round(g.weight * 100)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-faint">취향 일치 = 장르 점수 합 ÷ √장르 수{why.genres.length > 1 ? ` (√${why.genres.length})` : ''}. 장르가 많다고 유리하지 않게 나눕니다.</p>
      </div>
      {why.because.length > 0 && (
        <div>
          <div className="mb-1 text-muted">이 장르를 많이 한 내 게임</div>
          <ul className="space-y-0.5">
            {why.because.map((b) => (
              <li key={b.key}>
                <button type="button" className="flex w-full items-baseline gap-2 text-left hover:underline" onClick={() => onOpenGame(b.key)}>
                  <span className="min-w-0 flex-1 truncate text-ink">{b.name}</span>
                  <span className="shrink-0 text-faint">{b.shared.join('·')}</span>
                  <span className="num w-14 shrink-0 text-right text-muted">{hoursFromH(b.hours)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {why.quality != null && (
        <div className="text-muted">
          평가 점수 {qualityPts}/35 = 긍정 {r.positivePct}% × 리뷰 수 신뢰도 {Math.round(Math.min(1, Math.log10(Math.max(10, r.reviews ?? 0)) / 5.5) * 100)}% (리뷰{' '}
          {r.reviews ? compact.format(r.reviews) : 0}개, 30만 개 이상이면 100%)
        </div>
      )}
    </div>
  )
}

/** 나의 장르 취향: 장르를 누르면 점수에 반영된 게임 */
function GenreTaste({ profile, onOpen }: { profile: GenreWeight[]; onOpen(key: string): void }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <ul className="space-y-1">
      {profile.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-[13px] hover:bg-surface-2"
            aria-expanded={open === p.id}
            onClick={() => setOpen((v) => (v === p.id ? null : p.id))}
          >
            <LuChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-faint transition-transform', open === p.id && 'rotate-180')} />
            <span className="w-24 shrink-0 truncate text-ink">{p.name}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
              <span className="block h-full rounded-full bg-[var(--chart-2)]" style={{ width: `${Math.round(p.weight * 100)}%` }} />
            </span>
            <span className="num w-8 text-right font-semibold text-ink">{Math.round(p.weight * 100)}</span>
          </button>
          {open === p.id && (
            <div className="mt-1 mb-2 ml-6 rounded-lg bg-surface-2 p-2 text-[12px]">
              <div className="mb-1 text-muted">
                {p.count}개 게임 · 총 {hoursFromH(p.hours)} · 많이 반영된 순
              </div>
              <ul className="space-y-0.5">
                {p.top.map((t) => (
                  <li key={t.key}>
                    <button type="button" className="flex w-full items-baseline gap-2 text-left hover:underline" onClick={() => onOpen(t.key)}>
                      <span className="min-w-0 flex-1 truncate text-ink">{t.name}</span>
                      {t.platform !== 'steam' && <span className="shrink-0 text-faint">{PLATFORM_LABELS[t.platform]}</span>}
                      <span className="num w-14 shrink-0 text-right text-muted">{hoursFromH(t.hours)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
