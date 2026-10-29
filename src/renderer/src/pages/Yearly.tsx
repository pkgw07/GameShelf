import { useEffect, useState } from 'react'
import type { YearReview } from '@shared/types'
import { BarList, Columns } from '@/components/charts'
import { PageBody, TopBar } from '@/components/Shell'
import { Panel, Select, Spinner } from '@/components/ui'
import { dateKo, hours, won } from '@/lib/format'
import { useStore } from '@/lib/store'

export function Yearly() {
  const { games, openGame } = useStore()
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const [data, setData] = useState<YearReview | null>(null)

  useEffect(() => {
    setData(null)
    void window.api.getYearReview(year).then(setData)
  }, [year, games])

  const years = Array.from({ length: 12 }, (_, i) => thisYear - i)

  return (
    <>
      <TopBar
        title="연말 결산"
        actions={
          <Select className="h-9" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </Select>
        }
      />
      <PageBody className="space-y-5">
        {!data ? (
          <Spinner />
        ) : (
          <>
            <section className="rounded-2xl border border-line bg-surface px-8 py-7">
              <div className="text-[13px] text-muted">{data.year}년의 게임 생활</div>
              <div className="mt-4 grid grid-cols-4 gap-6">
                <Big label="플레이한 시간" value={data.recordedDays ? hours(data.playMinutes, 0) : '—'} sub={`플레이한 날 ${data.activeDays}일`} />
                <Big label="달성한 도전과제" value={`${data.achievements.toLocaleString()}개`} sub={`100% 달성 ${data.completedGames.length}개 게임`} />
                <Big label="새로 들인 게임·DLC" value={`${data.boughtCount}개`} sub={data.spent ? `지출 ${won(data.spent)}` : '구매가 입력 시 지출 표시'} />
                <Big
                  label="가장 길게 한 세션"
                  value={data.longestSession ? hours(data.longestSession.minutes) : '—'}
                  sub={data.longestSession?.name ?? `기록된 세션 ${data.sessions}개`}
                />
              </div>
              {data.recordedDays < 365 && (
                <p className="mt-5 text-[12px] text-faint">
                  플레이타임은 프로그램이 기록한 {data.recordedDays}일 동안의 값입니다. 도전과제와 구매는 Steam 기록이라 1년 전체가 반영됩니다.
                </p>
              )}
            </section>

            <div className="grid grid-cols-2 gap-5">
              <Panel title="가장 많이 한 게임">
                {data.topGames.length ? (
                  <BarList items={data.topGames.map((g) => ({ key: g.key, label: g.name, value: g.minutes }))} format={(v) => hours(v, 0)} onClick={openGame} />
                ) : (
                  <p className="text-[13px] text-muted">이 해의 플레이타임 기록이 없습니다.</p>
                )}
              </Panel>
              <Panel title="많이 한 장르">
                {data.genreMinutes.length ? (
                  <BarList items={data.genreMinutes.map((g) => ({ key: g.id, label: g.name, value: g.minutes }))} format={(v) => hours(v, 0)} color="var(--chart-2)" />
                ) : (
                  <p className="text-[13px] text-muted">이 해의 플레이타임 기록이 없습니다.</p>
                )}
              </Panel>
            </div>

            <div className="grid grid-cols-2 gap-5">
              <Panel title="월별 플레이타임">
                <Columns
                  data={data.monthlyMinutes.map((m) => ({ label: `${Number(m.month.slice(5))}월`, value: m.minutes, title: m.month }))}
                  format={(v) => hours(v, 0)}
                  height={150}
                />
              </Panel>
              <Panel title="월별 도전과제">
                <Columns
                  data={data.monthlyAchievements.map((m) => ({ label: `${Number(m.month.slice(5))}월`, value: m.count, title: m.month }))}
                  format={(v) => `${v}개`}
                  height={150}
                  color="var(--chart-3)"
                />
              </Panel>
            </div>

            <div className="grid grid-cols-2 gap-5">
              <Panel title="올해 달성한 가장 희귀한 도전과제">
                {data.rarest.length ? (
                  <ul className="space-y-2">
                    {data.rarest.map((a) => (
                      <li key={a.key + a.apiname} className="flex items-center gap-3">
                        {a.icon ? <img src={a.icon} alt="" className="h-10 w-10 rounded-md" /> : <div className="h-10 w-10 rounded-md bg-surface-2" />}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-semibold text-ink">{a.name}</div>
                          <div className="truncate text-[12px] text-muted">{a.gameName}</div>
                        </div>
                        <span className="num rounded-full bg-sale-soft px-2 py-0.5 text-[12px] font-semibold text-sale">상위 {a.globalPct.toFixed(1)}%</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-muted">희귀도 정보가 있는 달성 도전과제가 없습니다.</p>
                )}
                {data.completedGames.length > 0 && (
                  <div className="mt-4 border-t border-line pt-3">
                    <div className="mb-1.5 text-[13px] font-medium text-muted">100% 달성한 게임</div>
                    <div className="flex flex-wrap gap-1.5">
                      {data.completedGames.map((g) => (
                        <button key={g.key} type="button" onClick={() => openGame(g.key)} className="rounded-full bg-brand-soft px-2.5 py-0.5 text-[12px] font-medium text-brand">
                          {g.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </Panel>
              <Panel title="새로 들인 게임·DLC" action={data.spent ? <span className="num text-[13px] font-semibold text-ink">{won(data.spent)}</span> : null}>
                {data.bought.length ? (
                  <ul className="max-h-[320px] space-y-1 overflow-y-auto pr-1">
                    {data.bought.map((b) => (
                      <li key={b.key + b.date} className="flex items-center gap-3 text-[13px]">
                        <span className="w-24 shrink-0 text-faint">{dateKo(b.date)}</span>
                        <span className="min-w-0 flex-1 truncate text-ink">{b.name}</span>
                        <span className="num text-muted">{b.price != null ? won(b.price) : '—'}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-muted">이 해의 구매일이 있는 게임이 없습니다.</p>
                )}
              </Panel>
            </div>
          </>
        )}
      </PageBody>
    </>
  )
}

function Big({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[13px] text-muted">{label}</div>
      <div className="num mt-1 truncate text-[32px] leading-tight font-extrabold text-ink">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[12px] text-faint">{sub}</div>}
    </div>
  )
}
