import { useEffect, useMemo, useState } from 'react'
import type { GameRow, RareAchievement } from '@shared/types'
import { Ring } from '@/components/charts'
import { Cover } from '@/components/game'
import { PageBody, TopBar } from '@/components/Shell'
import { Panel, Progress, Segmented, Stat } from '@/components/ui'
import { cn } from '@/lib/cn'
import { dateKo, pct } from '@/lib/format'
import { useStore } from '@/lib/store'

export function Achievements() {
  const { games, openGame } = useStore()
  const [rare, setRare] = useState<RareAchievement[] | null>(null)
  const [nearMin, setNearMin] = useState<'80' | '60'>('80')

  useEffect(() => {
    void window.api.getRareAchievements(60).then(setRare)
  }, [games])

  const stats = useMemo(() => {
    const withAch = games.filter((g) => (g.achTotal ?? 0) > 0)
    const total = withAch.reduce((a, g) => a + (g.achTotal ?? 0), 0)
    const done = withAch.reduce((a, g) => a + (g.achDone ?? 0), 0)
    const perfect = withAch.filter((g) => g.achDone === g.achTotal).length
    const started = withAch.filter((g) => (g.achDone ?? 0) > 0)
    const avg = started.length ? started.reduce((a, g) => a + (g.achDone ?? 0) / (g.achTotal ?? 1), 0) / started.length : 0
    return { games: withAch.length, total, done, perfect, avg }
  }, [games])

  const near = useMemo(() => {
    const min = Number(nearMin) / 100
    return games
      .filter((g) => (g.achTotal ?? 0) > 0 && g.achDone !== g.achTotal && (g.achDone ?? 0) / (g.achTotal ?? 1) >= min)
      .map((g) => ({ g, left: (g.achTotal ?? 0) - (g.achDone ?? 0), ratio: (g.achDone ?? 0) / (g.achTotal ?? 1) }))
      .sort((a, b) => a.left - b.left || b.ratio - a.ratio)
  }, [games, nearMin])

  return (
    <>
      <TopBar title="도전과제" />
      <PageBody className="space-y-5">
        <div className="grid grid-cols-[auto_1fr] items-center gap-8 rounded-2xl border border-line bg-surface px-6 py-5">
          <Ring value={stats.total ? stats.done / stats.total : 0} size={96} stroke={9}>
            <span className="num text-[15px]">{pct(stats.total ? stats.done / stats.total : 0)}</span>
          </Ring>
          <div className="grid grid-cols-4 gap-5">
            <Stat label="달성한 도전과제" value={stats.done.toLocaleString()} sub={`전체 ${stats.total.toLocaleString()}개`} />
            <Stat label="100% 달성 게임" value={`${stats.perfect}개`} sub={`도전과제가 있는 ${stats.games}개 중`} tone="good" />
            <Stat label="시작한 게임 평균 달성률" value={pct(stats.avg)} />
            <Stat label="100% 근접 게임" value={`${near.length}개`} sub={`${nearMin}% 이상 달성`} tone="sale" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-5">
          <Panel
            title="100%까지 얼마 안 남은 게임"
            action={
              <Segmented<'80' | '60'>
                size="sm"
                value={nearMin}
                onChange={setNearMin}
                options={[
                  { value: '80', label: '80% 이상' },
                  { value: '60', label: '60% 이상' }
                ]}
              />
            }
          >
            {near.length ? (
              <ul className="space-y-3">
                {near.slice(0, 15).map(({ g, left, ratio }) => (
                  <NearRow key={g.key} g={g} left={left} ratio={ratio} onOpen={openGame} />
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">조건에 맞는 게임이 없습니다.</p>
            )}
          </Panel>

          <Panel title="희귀 도전과제 모음" action={<span className="text-[12px] text-faint">전체 유저 달성률 낮은 순</span>}>
            {rare == null ? null : rare.length ? (
              <ul className="space-y-2">
                {rare.slice(0, 15).map((a) => (
                  <li key={a.key + a.apiname} className="flex items-center gap-3">
                    {a.icon ? <img src={a.icon} alt="" className="h-10 w-10 shrink-0 rounded-md" /> : <div className="h-10 w-10 shrink-0 rounded-md bg-surface-2" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-ink">{a.name}</div>
                      <button type="button" className="truncate text-[12px] text-muted hover:underline" onClick={() => openGame(a.key)}>
                        {a.gameName}
                        {a.unlockTime ? ` · ${dateKo(a.unlockTime * 1000)}` : ''}
                      </button>
                    </div>
                    <span
                      className={cn(
                        'num shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold',
                        a.globalPct < 1 ? 'bg-sale-soft text-sale' : a.globalPct < 5 ? 'bg-brand-soft text-brand' : 'text-muted ring-1 ring-line'
                      )}
                    >
                      상위 {a.globalPct < 1 ? a.globalPct.toFixed(1) : Math.round(a.globalPct)}%
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">
                아직 희귀도 정보가 없습니다. 동기화하면 달성한 도전과제가 있는 게임의 전체 유저 달성률을 받아 옵니다 (30일마다 갱신).
              </p>
            )}
          </Panel>
        </div>
      </PageBody>
    </>
  )
}

function NearRow({ g, left, ratio, onOpen }: { g: GameRow; left: number; ratio: number; onOpen(k: string): void }) {
  return (
    <li>
      <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => onOpen(g.key)}>
        <Cover src={g.headerImage} alt="" className="h-9 w-[78px] shrink-0 rounded" />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex justify-between gap-3 text-[13px]">
            <span className="truncate font-medium text-ink">{g.nameKo || g.name}</span>
            <span className="num shrink-0 text-muted">
              {g.achDone}/{g.achTotal} · <b className="text-ink">{left}개 남음</b>
            </span>
          </div>
          <Progress value={ratio} />
        </div>
      </button>
    </li>
  )
}
