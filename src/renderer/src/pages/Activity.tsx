import { useEffect, useState } from 'react'
import type { ActivityData } from '@shared/types'
import { BarList, Columns } from '@/components/charts'
import { PageBody, TopBar } from '@/components/Shell'
import { Panel, Segmented, Spinner } from '@/components/ui'
import { dateKo, duration, hours } from '@/lib/format'
import { useStore } from '@/lib/store'

export function Activity() {
  const { games, openGame, nowPlaying } = useStore()
  const [days, setDays] = useState(30)
  const [data, setData] = useState<ActivityData | null>(null)

  useEffect(() => {
    void window.api.getActivity(days).then(setData)
  }, [days, games, nowPlaying])

  const total = data?.daily.reduce((a, d) => a + d.minutes, 0) ?? 0
  const activeDays = data?.daily.filter((d) => d.minutes > 0).length ?? 0

  return (
    <>
      <TopBar
        title="활동 기록"
        actions={
          <Segmented
            size="sm"
            value={String(days)}
            onChange={(v) => setDays(Number(v))}
            options={[
              { value: '7', label: '7일' },
              { value: '30', label: '30일' },
              { value: '90', label: '90일' },
              { value: '365', label: '1년' }
            ]}
          />
        }
      />
      <PageBody className="space-y-5">
        {!data ? (
          <Spinner />
        ) : (
          <>
            <Panel
              title="하루 플레이타임"
              action={
                <span className="num text-[13px] text-muted">
                  합계 <b className="text-ink">{hours(total, 0)}</b> · 플레이한 날 {activeDays}일
                </span>
              }
            >
              <Columns
                data={data.daily.map((d) => ({ label: d.date.slice(5).replace('-', '.'), value: d.minutes, title: dateKo(d.date) }))}
                format={(v) => hours(v)}
                height={170}
                labelEvery={days <= 7 ? 1 : days <= 30 ? 5 : days <= 90 ? 15 : 60}
              />
              <p className="mt-3 text-[12px] text-faint">
                프로그램이 하루 한 번 플레이타임을 기록해서 차이를 계산합니다 (지금까지 {data.snapshotDays}일 기록). 프로그램을 며칠 켜지 않으면 그 기간의 플레이는 다음 기록일에 합쳐서 표시됩니다.
              </p>
            </Panel>

            <div className="grid grid-cols-2 gap-5">
              <Panel title="이 기간에 많이 한 게임">
                {data.topGames.length ? (
                  <BarList items={data.topGames.map((g) => ({ key: g.key, label: g.name, value: g.minutes }))} format={(v) => hours(v)} onClick={openGame} />
                ) : (
                  <p className="text-[13px] text-muted">기록된 플레이가 없습니다. 기록은 설치한 다음 날부터 쌓입니다.</p>
                )}
              </Panel>
              <Panel title="월별 도전과제 달성" action={<span className="text-[12px] text-faint">최근 12개월</span>}>
                <Columns
                  data={data.achByMonth.map((m) => ({ label: m.month.slice(2).replace('-', '.'), value: m.count, title: m.month }))}
                  format={(v) => `${v}개`}
                  height={150}
                  color="var(--chart-3)"
                  labelEvery={2}
                />
              </Panel>
            </div>

            <div className="grid grid-cols-2 gap-5">
              <Panel title="플레이 세션" action={<span className="text-[12px] text-faint">트레이에서 감지한 기록</span>}>
                {data.sessions.length ? (
                  <ul className="space-y-1.5">
                    {data.sessions.slice(0, 15).map((s) => (
                      <li key={s.id} className="flex items-center gap-3 text-[13px]">
                        <button type="button" className="min-w-0 flex-1 truncate text-left text-ink hover:underline" onClick={() => openGame(s.key)}>
                          {s.name}
                        </button>
                        <span className="text-faint">{new Date(s.startedAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                        <span className="num w-20 text-right font-medium text-ink">{s.endedAt ? duration(s.endedAt - s.startedAt) : '플레이 중'}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-muted">
                    아직 감지된 플레이가 없습니다. 설정에서 "플레이 중인 게임 감지"를 켜 두면 게임을 실행할 때마다 시작·종료 시각이 기록됩니다.
                  </p>
                )}
              </Panel>
              <Panel title="달성한 도전과제">
                {data.achievements.length ? (
                  <ul className="space-y-2">
                    {data.achievements.slice(0, 12).map((a) => (
                      <li key={a.key + a.apiname} className="flex items-center gap-3">
                        {a.icon ? <img src={a.icon} alt="" className="h-8 w-8 rounded-md" /> : <div className="h-8 w-8 rounded-md bg-surface-2" />}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium text-ink">{a.name}</div>
                          <div className="truncate text-[12px] text-muted">{a.gameName}</div>
                        </div>
                        <span className="text-[12px] text-faint">{dateKo(a.unlockTime * 1000)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-muted">이 기간에 달성한 도전과제가 없습니다.</p>
                )}
              </Panel>
            </div>
          </>
        )}
      </PageBody>
    </>
  )
}
