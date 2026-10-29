import { useCallback, useEffect, useState } from 'react'
import { LuRefreshCw } from 'react-icons/lu'
import type { Recommendation, RecommendationResult } from '@shared/types'
import { BarList } from '@/components/charts'
import { Cover, PriceLine } from '@/components/game'
import { PageBody, TopBar } from '@/components/Shell'
import { Badge, Button, Empty, Panel, Spinner } from '@/components/ui'
import { hours, relative } from '@/lib/format'
import { useStore } from '@/lib/store'

const compact = new Intl.NumberFormat('ko-KR', { notation: 'compact' })

export function Recommend() {
  const { games, openGame, toast } = useStore()
  const [data, setData] = useState<RecommendationResult | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(
    async (refresh: boolean) => {
      setLoading(true)
      try {
        const r = await window.api.getRecommendations(refresh)
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
            <Spinner /> 장르 취향을 분석하고 추천 후보를 불러오는 중입니다. 처음에는 1분 정도 걸릴 수 있습니다.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[320px_1fr] gap-5">
              <Panel title="나의 장르 취향">
                {data.profile.length ? (
                  <BarList
                    items={data.profile.map((p) => ({ key: p.id, label: p.name, value: p.weight, sub: `${p.count}개` }))}
                    format={(v) => `${Math.round(v * 100)}`}
                    color="var(--chart-2)"
                  />
                ) : (
                  <p className="text-[13px] text-muted">플레이한 게임의 장르 정보가 아직 없습니다.</p>
                )}
                <p className="mt-4 text-[12px] text-faint">
                  플레이타임이 긴 장르일수록 점수가 높습니다. 한 게임이 독식하지 않도록 로그 스케일로 계산하고, 인디·무료·앞서 해보기는 비중을 낮춥니다.
                </p>
              </Panel>
              <Panel
                title="이미 가진 게임 중 먼저 해볼 만한 것"
                action={<span className="text-[12px] text-faint">안 한 게임 중 취향 일치 순</span>}
              >
                {data.backlog.length ? (
                  <div className="grid grid-cols-3 gap-4">
                    {data.backlog.slice(0, 6).map((r) => (
                      <RecCard key={r.appid} r={r} onClick={() => openGame(`steam:${r.appid}`)} owned />
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
                    <RecCard key={r.appid} r={r} onClick={() => void window.api.openExternal(`https://store.steampowered.com/app/${r.appid}/`)} />
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

function RecCard({ r, onClick, owned }: { r: Recommendation; onClick(): void; owned?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="group block self-start text-left">
      <div className="overflow-hidden rounded-xl ring-1 ring-line">
        <Cover src={r.headerImage} alt={r.name} className="aspect-[460/215] w-full transition-transform group-hover:scale-[1.03]" />
      </div>
      <div className="mt-2 truncate text-[14px] font-semibold text-ink">{r.name}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {r.matched.slice(0, 3).map((m) => (
          <Badge key={m} tone="brand">
            {m}
          </Badge>
        ))}
        {r.inWishlist && <Badge tone="sale">위시리스트</Badge>}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[12px]">
        {owned ? (
          <span className="text-muted">{r.playtimeMin ? `플레이 ${hours(r.playtimeMin)}` : '아직 안 함'}</span>
        ) : (
          <span className="num text-muted">
            {r.positivePct != null ? `긍정 ${r.positivePct}%` : ''} {r.reviews ? `· 리뷰 ${compact.format(r.reviews)}` : ''}
          </span>
        )}
        {!owned && <PriceLine p={r.priceKr} className="text-[13px]" />}
      </div>
    </button>
  )
}
