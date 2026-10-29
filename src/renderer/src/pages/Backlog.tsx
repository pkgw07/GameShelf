import { useEffect, useMemo, useRef, useState } from 'react'
import { LuDices, LuPlay } from 'react-icons/lu'
import { DONE_STATUSES, genreProfile, hltbRemaining, isUnplayed } from '@shared/analytics'
import type { GameRow } from '@shared/types'
import { Cover, ReviewBadge, StatusBadge } from '@/components/game'
import { PageBody, TopBar } from '@/components/Shell'
import { Badge, Button, Empty, Panel, Progress, Segmented, Stat, Switch } from '@/components/ui'
import { cn } from '@/lib/cn'
import { dateKo, hours, hoursFromH } from '@/lib/format'
import { useStore } from '@/lib/store'

/** 구매일부터 지금까지 "N년 M개월" */
function ageText(date: string): { text: string; months: number } {
  const d = new Date(date + 'T00:00:00')
  const now = new Date()
  let months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth())
  if (now.getDate() < d.getDate()) months--
  months = Math.max(0, months)
  const y = Math.floor(months / 12)
  const m = months % 12
  const text = y > 0 ? `${y}년${m ? ` ${m}개월` : ''}째` : m > 0 ? `${m}개월째` : '한 달 안 됨'
  return { text, months }
}

export function Backlog() {
  const { included, settings, openGame } = useStore()
  const unplayedMin = settings?.unplayedMinutes ?? 30
  const [avgDaily, setAvgDaily] = useState<number | null>(null)
  const [hoursPerDay, setHoursPerDay] = useState<number | null>(null)

  useEffect(() => {
    void window.api.getActivity(90).then((a) => {
      const total = a.daily.reduce((s, d) => s + d.minutes, 0)
      const days = Math.min(a.daily.length, Math.max(1, a.snapshotDays))
      setAvgDaily(a.snapshotDays >= 7 ? total / days / 60 : null)
    })
  }, [included])

  // ── 백로그 소진 예상
  const backlog = useMemo(() => {
    const open = included.filter((g) => !DONE_STATUSES.has(g.status))
    let remain = 0
    let withTime = 0
    const missing: GameRow[] = []
    for (const g of open) {
      const r = hltbRemaining(g)
      if (r) {
        remain += r.remaining
        withTime++
      } else missing.push(g)
    }
    return { open: open.length, remain, withTime, missing: missing.length }
  }, [included])
  const perDay = hoursPerDay ?? (avgDaily && avgDaily > 0.05 ? Math.round(avgDaily * 10) / 10 : 1)
  const days = perDay > 0 ? backlog.remain / perDay : null

  // ── 사놓고 오래 안 한 게임
  const aging = useMemo(() => {
    const list = included.filter((g) => isUnplayed(g, unplayedMin))
    const dated = list
      .map((g) => ({ g, date: g.purchaseDate ?? g.acquiredDate }))
      .filter((x): x is { g: GameRow; date: string } => Boolean(x.date))
      .map((x) => ({ ...x, age: ageText(x.date) }))
      .sort((a, b) => b.age.months - a.age.months)
    return { dated, undated: list.length - dated.length }
  }, [included, unplayedMin])

  return (
    <>
      <TopBar title="백로그" />
      <PageBody className="space-y-5">
        <Panel title="백로그를 다 하려면">
          <div className="grid grid-cols-4 gap-5">
            <Stat label="아직 안 끝낸 게임" value={`${backlog.open}개`} sub="클리어·100%·포기 제외" />
            <Stat label="남은 플레이 시간" value={hoursFromH(backlog.remain)} sub={`엔딩 시간이 있는 ${backlog.withTime}개 기준`} />
            <Stat
              label="예상 소요 기간"
              value={days != null ? (days >= 365 ? `${(days / 365).toFixed(1)}년` : `${Math.ceil(days)}일`) : '—'}
              sub={`하루 ${perDay}시간 플레이 기준`}
              tone="sale"
            />
            <Stat label="엔딩 시간 모름" value={`${backlog.missing}개`} sub="계산에서 빠짐" />
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3 text-[13px] text-muted">
            <span>하루에</span>
            <input
              type="range"
              min={0.5}
              max={8}
              step={0.5}
              value={perDay}
              onChange={(e) => setHoursPerDay(Number(e.target.value))}
              className="w-56 accent-[var(--brand)]"
              aria-label="하루 플레이 시간"
            />
            <span className="num w-14 font-semibold text-ink">{perDay}시간</span>
            <span>
              {avgDaily != null
                ? `최근 90일 기록으로는 하루 평균 ${avgDaily.toFixed(1)}시간 플레이했어요.`
                : '플레이 기록이 7일 넘게 쌓이면 실제 평균으로 계산합니다.'}
            </span>
            {hoursPerDay != null && (
              <button type="button" className="text-brand underline" onClick={() => setHoursPerDay(null)}>
                기록 기준으로 되돌리기
              </button>
            )}
            {backlog.missing > 0 && (
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void window.api.lookupHltbBulk()}>
                엔딩 시간 한꺼번에 찾기
              </Button>
            )}
          </div>
        </Panel>

        <Roulette games={included} />

        <Panel
          title="사 놓고 오래 안 한 게임"
          action={<span className="text-[12px] text-faint">{unplayedMin}분 미만 플레이 · 구매일 또는 라이선스 획득일 기준</span>}
        >
          {aging.dated.length ? (
            <ul className="divide-y divide-line">
              {aging.dated.slice(0, 30).map(({ g, date, age }) => (
                <li key={g.key}>
                  <button type="button" className="flex w-full items-center gap-3 py-2 text-left hover:bg-surface-2" onClick={() => openGame(g.key)}>
                    <Cover src={g.headerImage} alt="" className="h-8 w-[68px] shrink-0 rounded" />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{g.nameKo || g.name}</span>
                    <ReviewBadge review={g.review} compact />
                    <span className="text-[12px] text-faint">{dateKo(date)}</span>
                    <Badge tone={age.months >= 24 ? 'bad' : age.months >= 12 ? 'sale' : 'muted'} className="w-24 justify-center">
                      {age.text}
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">구매일이 있는 안 한 게임이 없습니다.</p>
          )}
          {aging.undated > 0 && (
            <p className="mt-3 text-[12px] text-faint">
              구매일을 모르는 안 한 게임 {aging.undated}개는 빠졌습니다. 가격·지출 화면에서 구매 내역이나 라이선스 페이지를 가져오면 채워집니다.
            </p>
          )}
        </Panel>
      </PageBody>
    </>
  )
}

type Pool = 'unplayed' | 'open'
type Limit = 'any' | '10' | '25'

function Roulette({ games }: { games: GameRow[] }) {
  const { settings, openGame } = useStore()
  const unplayedMin = settings?.unplayedMinutes ?? 30
  const [pool, setPool] = useState<Pool>('unplayed')
  const [limit, setLimit] = useState<Limit>('any')
  const [taste, setTaste] = useState(true)
  const [shown, setShown] = useState<GameRow | null>(null)
  const [picked, setPicked] = useState<GameRow | null>(null)
  const [spinning, setSpinning] = useState(false)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const weights = useMemo(() => new Map(genreProfile(games, unplayedMin).map((g) => [g.id, g.weight])), [games, unplayedMin])
  const candidates = useMemo(
    () =>
      games.filter((g) => {
        if (g.isFree && g.playtimeMin === 0 && pool === 'unplayed') return false
        if (pool === 'unplayed' && !isUnplayed(g, unplayedMin)) return false
        if (pool === 'open' && DONE_STATUSES.has(g.status)) return false
        if (limit !== 'any') {
          const main = g.hltb?.main
          if (!main || main > Number(limit)) return false
        }
        return true
      }),
    [games, pool, limit, unplayedMin]
  )

  const weightOf = (g: GameRow) => {
    if (!taste || !g.genres.length) return 1
    const w = g.genres.reduce((a, x) => a + (weights.get(x.id) ?? 0), 0) / Math.sqrt(g.genres.length)
    return 0.15 + w
  }

  const spin = () => {
    if (!candidates.length) return
    timers.current.forEach(clearTimeout)
    timers.current = []
    const total = candidates.reduce((a, g) => a + weightOf(g), 0)
    let r = Math.random() * total
    let final = candidates[candidates.length - 1]
    for (const g of candidates) {
      r -= weightOf(g)
      if (r <= 0) {
        final = g
        break
      }
    }
    setPicked(null)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || candidates.length === 1) {
      setShown(final)
      setPicked(final)
      return
    }
    setSpinning(true)
    // 점점 느려지는 슬롯 효과
    let t = 0
    const steps = 18
    for (let i = 0; i < steps; i++) {
      t += 30 + i * i
      const last = i === steps - 1
      timers.current.push(
        window.setTimeout(() => {
          setShown(last ? final : candidates[Math.floor(Math.random() * candidates.length)])
          if (last) {
            setPicked(final)
            setSpinning(false)
          }
        }, t)
      )
    }
  }

  const g = shown
  return (
    <Panel
      title="오늘 뭐 하지?"
      action={<span className="num text-[12px] text-faint">후보 {candidates.length}개</span>}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Segmented<Pool>
          size="sm"
          value={pool}
          onChange={setPool}
          options={[
            { value: 'unplayed', label: '안 한 게임' },
            { value: 'open', label: '아직 안 끝낸 게임' }
          ]}
        />
        <Segmented<Limit>
          size="sm"
          value={limit}
          onChange={setLimit}
          options={[
            { value: 'any', label: '길이 상관없음' },
            { value: '10', label: '10시간 이내' },
            { value: '25', label: '25시간 이내' }
          ]}
        />
        <div className="w-56">
          <Switch checked={taste} onChange={setTaste} label="내 장르 취향 반영" />
        </div>
        <Button variant="primary" className="ml-auto" icon={<LuDices />} disabled={!candidates.length || spinning} onClick={spin}>
          {picked ? '다시 돌리기' : '돌리기'}
        </Button>
      </div>
      <div className="mt-4 rounded-xl border border-dashed border-line-strong p-4">
        {g ? (
          <div className={cn('flex items-center gap-5', spinning && 'opacity-80')}>
            <Cover src={g.headerImage} alt={g.name} className="aspect-[460/215] w-[260px] shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xl font-bold text-ink">{g.nameKo || g.name}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {g.genres.slice(0, 4).map((x) => (
                  <Badge key={x.id}>{x.name}</Badge>
                ))}
                <StatusBadge status={g.status} />
                <ReviewBadge review={g.review} />
              </div>
              <div className="mt-2 text-[13px] text-muted">
                지금까지 {hours(g.playtimeMin)} · 평균 엔딩 {hoursFromH(g.hltb?.main)}
              </div>
              {g.hltb?.main ? <Progress className="mt-2 max-w-sm" value={Math.min(1, g.playtimeMin / 60 / g.hltb.main)} /> : null}
              {picked && !spinning && (
                <div className="mt-3 flex gap-2">
                  {g.appid != null && (
                    <Button size="sm" variant="primary" icon={<LuPlay />} onClick={() => void window.api.openExternal(`steam://run/${g.appid}`)}>
                      바로 실행
                    </Button>
                  )}
                  <Button size="sm" onClick={() => openGame(g.key)}>
                    게임 정보
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : candidates.length ? (
          <p className="text-[13px] text-muted">버튼을 누르면 후보 중에서 하나를 골라 드립니다. 취향 반영을 켜면 많이 한 장르일수록 더 잘 나와요.</p>
        ) : (
          <Empty title="조건에 맞는 게임이 없습니다">다른 조건을 골라 보세요. 엔딩 시간 조건은 엔딩 시간을 찾은 게임만 해당합니다.</Empty>
        )}
      </div>
    </Panel>
  )
}
