import { useEffect, useMemo, useState } from 'react'
import { DONE_STATUSES, genreProfile, hltbRemaining, isUnplayed, moneyTotals } from '@shared/analytics'
import type { ActivityData, GameRow } from '@shared/types'
import { BarList } from '@/components/charts'
import { Cover, PriceLine, VerdictBadge } from '@/components/game'
import { PageBody, TopBar } from '@/components/Shell'
import { Button, Empty, Panel, Progress, Stat } from '@/components/ui'
import { dateKo, hours, hoursFromH, pct, relative, usd, won } from '@/lib/format'
import { useStore } from '@/lib/store'

const STALE_SEC = 90 * 86_400

export function Dashboard() {
  const { games, included, priced, ownedDlcs, settings, go, openGame, updateGame, wishlist, sync } = useStore()
  const [activity, setActivity] = useState<ActivityData | null>(null)
  useEffect(() => {
    void window.api.getActivity(30).then(setActivity)
  }, [games])

  const unplayedMin = settings?.unplayedMinutes ?? 30
  const t = useMemo(() => moneyTotals(priced), [priced])
  const stats = useMemo(() => {
    const unplayed = included.filter((g) => isUnplayed(g, unplayedMin))
    const totalMin = included.reduce((a, g) => a + g.playtimeMin, 0)
    const achT = included.reduce((a, g) => a + (g.achTotal ?? 0), 0)
    const achD = included.reduce((a, g) => a + (g.achDone ?? 0), 0)
    return { unplayed: unplayed.length, totalMin, achT, achD }
  }, [included, unplayedMin])
  const top = useMemo(() => [...included].sort((a, b) => b.playtimeMin - a.playtimeMin).slice(0, 8), [included])
  const genres = useMemo(() => genreProfile(included, unplayedMin).slice(0, 8), [included, unplayedMin])
  const backlog = useMemo(() => {
    const list = included
      .filter((g) => !DONE_STATUSES.has(g.status))
      .map((g) => ({ g, r: hltbRemaining(g) }))
      .filter((x): x is { g: GameRow; r: NonNullable<ReturnType<typeof hltbRemaining>> } => Boolean(x.r && x.r.remaining > 0))
    const totalRemain = list.reduce((a, x) => a + x.r.remaining, 0)
    const playing = list.filter((x) => x.g.status === 'playing').sort((a, b) => a.r.remaining - b.r.remaining)
    const rest = list.filter((x) => x.g.status !== 'playing').sort((a, b) => a.r.remaining - b.r.remaining)
    return { totalRemain, count: list.length, items: [...playing, ...rest].slice(0, 6) }
  }, [included])
  const stale = useMemo(() => {
    const now = Date.now() / 1000
    return games.filter((g) => g.status === 'playing' && g.lastPlayed != null && now - g.lastPlayed > STALE_SEC).slice(0, 4)
  }, [games])
  const wishDeals = useMemo(() => wishlist.filter((w) => w.priceKr && w.priceKr.discount > 0).slice(0, 4), [wishlist])

  if (!games.length) {
    return (
      <>
        <TopBar title="대시보드" />
        <PageBody>
          <Empty
            title={sync?.running ? '게임 목록을 불러오는 중입니다' : '아직 불러온 게임이 없습니다'}
            action={
              !sync?.running && (
                <div className="flex gap-2">
                  <Button variant="primary" onClick={() => go('settings')}>
                    Steam 계정 연결
                  </Button>
                  <Button onClick={() => void window.api.startSync()}>지금 동기화</Button>
                </div>
              )
            }
          >
            설정에서 Steam API 키와 계정을 연결한 뒤 동기화하면 보유 게임, 플레이타임, 가격, 도전과제를 불러옵니다. 첫 동기화는 게임 수에 따라 몇 분 걸릴 수 있습니다.
          </Empty>
        </PageBody>
      </>
    )
  }

  const ledger = [
    { label: '정가 총합', amount: t.regularKr, sub: `미국 정가 ${usd(t.regularUs)}`, color: 'var(--line-strong)' },
    { label: '현재가 총합', amount: t.currentKr, sub: `할인 중 ${t.onSale}개 반영 · 미국 ${usd(t.currentUs)}`, color: 'var(--sale)' },
    { label: 'Steam 역대 최저가 총합', amount: t.lowKr, sub: `각 게임 최대 할인율 기준 · 미국 ${usd(t.lowUs)}`, color: 'var(--good)' },
    {
      label: '실제 지출',
      amount: t.spentCount ? t.spent : null,
      sub: t.spentCount ? `구매가가 입력된 ${t.spentCount}개 게임 기준` : '구매가를 입력하거나 구매 내역을 가져오면 표시됩니다',
      color: 'var(--chart-4)'
    }
  ]

  return (
    <>
      <TopBar title="대시보드" />
      <PageBody className="space-y-5">
        {/* 장부: 이 화면의 핵심 */}
        <section className="rounded-2xl border border-line bg-surface">
          <div className="flex items-baseline justify-between px-6 pt-5">
            <h2 className="text-[15px] font-semibold">라이브러리 장부</h2>
            <button type="button" className="text-[13px] text-muted hover:text-ink" onClick={() => go('money')}>
              자세히 보기
            </button>
          </div>
          <div className="px-6 pt-2 pb-5">
            {ledger.map((row) => (
              <div key={row.label} className="grid grid-cols-[180px_1fr_auto] items-center gap-5 border-b border-dashed border-line py-3 last:border-b-0">
                <div className="text-[13px] text-muted">{row.label}</div>
                <div className="h-2.5 rounded-full bg-surface-2">
                  {row.amount != null && t.regularKr > 0 && (
                    <div className="h-2.5 rounded-full" style={{ width: `${Math.min(100, (row.amount / t.regularKr) * 100)}%`, background: row.color }} />
                  )}
                </div>
                <div className="min-w-[200px] text-right">
                  <div className="num text-[26px] leading-tight font-extrabold text-ink">{row.amount != null ? won(row.amount) : '—'}</div>
                  <div className="text-[12px] text-faint">{row.sub}</div>
                </div>
              </div>
            ))}
            <p className="mt-2 text-[12px] text-faint">
              가격이 있는 {t.pricedKr}개 기준{settings?.includeDlcInTotals && ownedDlcs.length ? ` (보유 DLC ${ownedDlcs.length}개 포함)` : ''} · 통계 제외 {games.length - included.length}개
              {t.spentCount > 0 && t.savedBase > 0 && ` · 정가 대비 ${won(t.saved)} 아낌`}
            </p>
          </div>
        </section>

        <div className="grid grid-cols-5 gap-5 rounded-2xl border border-line bg-surface px-6 py-5">
          <Stat label="보유 게임" value={`${games.length}개`} sub={`통계 포함 ${included.length}개`} />
          <Stat
            label="샀는데 안 한 게임"
            value={`${stats.unplayed}개`}
            sub={`${pct(stats.unplayed / Math.max(1, included.length))} · ${unplayedMin}분 미만 기준`}
            tone={stats.unplayed ? 'sale' : undefined}
          />
          <Stat label="총 플레이타임" value={hours(stats.totalMin, 0)} sub={`게임당 평균 ${hours(stats.totalMin / Math.max(1, included.length - stats.unplayed))}`} />
          <Stat label="도전과제 달성" value={stats.achT ? pct(stats.achD / stats.achT) : '—'} sub={`${stats.achD.toLocaleString()} / ${stats.achT.toLocaleString()}`} />
          <Stat label="엔딩까지 남은 시간" value={backlog.count ? hoursFromH(backlog.totalRemain) : '—'} sub={`엔딩 시간이 있는 ${backlog.count}개 게임`} />
        </div>

        {stale.length > 0 && (
          <Panel title="오래 안 한 '플레이 중' 게임" action={<span className="text-[12px] text-faint">90일 넘게 플레이하지 않았어요</span>}>
            <ul className="divide-y divide-line">
              {stale.map((g) => (
                <li key={g.key} className="flex items-center gap-3 py-2">
                  <button type="button" className="min-w-0 flex-1 truncate text-left text-sm text-ink hover:underline" onClick={() => openGame(g.key)}>
                    {g.nameKo || g.name}
                  </button>
                  <span className="text-[12px] text-faint">{relative((g.lastPlayed ?? 0) * 1000)}</span>
                  <Button size="sm" onClick={() => void updateGame(g.key, { status: 'later' })}>
                    나중에
                  </Button>
                  <Button size="sm" onClick={() => void updateGame(g.key, { status: 'dropped' })}>
                    포기
                  </Button>
                  <Button size="sm" onClick={() => void updateGame(g.key, { status: 'cleared' })}>
                    클리어
                  </Button>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <div className="grid grid-cols-2 gap-5">
          <Panel title="가장 많이 한 게임">
            <BarList
              items={top.map((g) => ({ key: g.key, label: g.nameKo || g.name, value: g.playtimeMin }))}
              format={(v) => hours(v, 0)}
              onClick={openGame}
            />
          </Panel>
          <Panel title="장르 취향" action={<span className="text-[12px] text-faint">플레이타임 가중</span>}>
            {genres.length ? (
              <BarList
                items={genres.map((x) => ({ key: x.id, label: x.name, value: x.hours, sub: `${x.count}개` }))}
                format={(v) => hoursFromH(v)}
                color="var(--chart-2)"
              />
            ) : (
              <p className="text-[13px] text-muted">장르 정보는 동기화 후 표시됩니다.</p>
            )}
          </Panel>
        </div>

        <div className="grid grid-cols-2 gap-5">
          <Panel title="엔딩까지 얼마 남았나" action={<button type="button" className="text-[13px] text-muted hover:text-ink" onClick={() => void window.api.lookupHltbBulk()}>엔딩 시간 한꺼번에 찾기</button>}>
            {backlog.items.length ? (
              <ul className="space-y-3">
                {backlog.items.map(({ g, r }) => (
                  <li key={g.key}>
                    <button type="button" className="block w-full text-left" onClick={() => openGame(g.key)}>
                      <div className="mb-1 flex justify-between gap-3 text-[13px]">
                        <span className="truncate text-ink">{g.nameKo || g.name}</span>
                        <span className="num shrink-0 text-muted">
                          {hours(g.playtimeMin)} / {hoursFromH(r.total)} · <span className="font-semibold text-ink">{hoursFromH(r.remaining)} 남음</span>
                        </span>
                      </div>
                      <Progress value={r.progress} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">
                평균 엔딩 시간을 찾은 게임이 없습니다. 오른쪽 위 버튼으로 한꺼번에 찾거나, 게임 상세에서 직접 입력하세요.
              </p>
            )}
          </Panel>
          <Panel title="최근 달성한 도전과제" action={<button type="button" className="text-[13px] text-muted hover:text-ink" onClick={() => go('activity')}>활동 기록</button>}>
            {activity?.achievements.length ? (
              <ul className="space-y-2">
                {activity.achievements.slice(0, 6).map((a) => (
                  <li key={a.key + a.apiname} className="flex items-center gap-3">
                    {a.icon ? <img src={a.icon} alt="" className="h-9 w-9 rounded-md" /> : <div className="h-9 w-9 rounded-md bg-surface-2" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-ink">{a.name}</div>
                      <button type="button" className="truncate text-[12px] text-muted hover:underline" onClick={() => openGame(a.key)}>
                        {a.gameName}
                      </button>
                    </div>
                    <span className="text-[12px] text-faint">{dateKo(a.unlockTime * 1000)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">최근 30일 동안 달성한 도전과제가 없습니다.</p>
            )}
          </Panel>
        </div>

        {wishDeals.length > 0 && (
          <Panel title="할인 중인 위시리스트" action={<button type="button" className="text-[13px] text-muted hover:text-ink" onClick={() => go('deals')}>모두 보기</button>}>
            <div className="grid grid-cols-4 gap-4">
              {wishDeals.map((w) => (
                <button
                  key={w.appid}
                  type="button"
                  className="self-start text-left"
                  onClick={() => void window.api.openExternal(`https://store.steampowered.com/app/${w.appid}/`)}
                >
                  <Cover src={w.headerImage} alt={w.name} className="aspect-[460/215] w-full rounded-lg" />
                  <div className="mt-2 truncate text-[13px] font-medium text-ink">{w.name}</div>
                  <PriceLine p={w.priceKr} className="text-[13px]" />
                  <div className="mt-1">
                    <VerdictBadge p={w.priceKr} low={w.lowKr} />
                  </div>
                </button>
              ))}
            </div>
          </Panel>
        )}
      </PageBody>
    </>
  )
}
