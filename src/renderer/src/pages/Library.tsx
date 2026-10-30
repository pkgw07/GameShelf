import { useEffect, useMemo, useState } from 'react'
import { LuLayoutGrid, LuList, LuPlus, LuSearch } from 'react-icons/lu'
import { costPerHour, EXCLUDE_LABELS, hltbRemaining, isUnplayed } from '@shared/analytics'
import { GENRES } from '@shared/genres'
import { PLATFORM_LABELS, STATUS_LABELS, STATUS_ORDER, type GameRow, type GameStatus, type Platform } from '@shared/types'
import { Cover, LowLine, PriceLine, ReviewBadge, StatusBadge } from '@/components/game'
import { ManualGameDialog } from '@/components/ManualGameDialog'
import { OwnedDlcButton } from '@/components/SteamConnect'
import { PageBody, TopBar } from '@/components/Shell'
import { Badge, Button, Empty, Input, Progress, Segmented, Select } from '@/components/ui'
import { cn } from '@/lib/cn'
import { deviceLabel, groupAcrossPlatforms, type GameGroup } from '@/lib/platforms'
import { hours, hoursFromH, won } from '@/lib/format'
import { useStore } from '@/lib/store'

type Filter = 'all' | 'played' | 'unplayed' | 'sale' | 'excluded' | 'dlc'
type Sort = 'name' | 'playtime' | 'recent' | 'regular' | 'discount' | 'purchase' | 'cph' | 'remaining' | 'ach' | 'added' | 'review'

const SORTS: { value: Sort; label: string }[] = [
  { value: 'playtime', label: '플레이타임 많은 순' },
  { value: 'recent', label: '최근 플레이 순' },
  { value: 'name', label: '이름 순' },
  { value: 'added', label: '라이브러리 추가 순' },
  { value: 'regular', label: '정가 높은 순' },
  { value: 'discount', label: '할인율 높은 순' },
  { value: 'purchase', label: '구매가 높은 순' },
  { value: 'cph', label: '시간당 비용 낮은 순' },
  { value: 'remaining', label: '엔딩까지 적게 남은 순' },
  { value: 'ach', label: '도전과제 달성률 순' },
  { value: 'review', label: 'Steam 평가 높은 순' }
]

const PAGE = 120

function sortFn(sort: Sort): (a: GameRow, b: GameRow) => number {
  const byName = (a: GameRow, b: GameRow) => (a.nameKo || a.name).localeCompare(b.nameKo || b.name, 'ko')
  const desc = (f: (g: GameRow) => number | null) => (a: GameRow, b: GameRow) => (f(b) ?? -Infinity) - (f(a) ?? -Infinity) || byName(a, b)
  const asc = (f: (g: GameRow) => number | null) => (a: GameRow, b: GameRow) => (f(a) ?? Infinity) - (f(b) ?? Infinity) || byName(a, b)
  switch (sort) {
    case 'name':
      return byName
    case 'playtime':
      return desc((g) => g.playtimeMin)
    case 'recent':
      return desc((g) => g.lastPlayed)
    case 'added':
      return desc((g) => g.firstSeen)
    case 'regular':
      return desc((g) => g.priceKr?.initial ?? null)
    case 'discount':
      return desc((g) => g.priceKr?.discount ?? null)
    case 'purchase':
      return desc((g) => g.purchasePrice)
    case 'cph':
      return asc((g) => costPerHour(g))
    case 'remaining':
      return asc((g) => {
        const r = hltbRemaining(g)
        return r && r.remaining > 0 ? r.remaining : null
      })
    case 'ach':
      return desc((g) => (g.achTotal ? (g.achDone ?? 0) / g.achTotal : null))
    case 'review':
      return desc((g) => g.review?.percent ?? null)
  }
}

export function Library() {
  const { games, dlcs, settings, saveSettings, excludeOf, openGame, toast, reload } = useStore()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [status, setStatus] = useState<GameStatus | 'any'>('any')
  const [genre, setGenre] = useState('any')
  const [sort, setSort] = useState<Sort>('playtime')
  const [view, setView] = useState<'grid' | 'table'>('grid')
  const [limit, setLimit] = useState(PAGE)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [platform, setPlatform] = useState<Platform | 'any'>('any')
  const [merge, setMerge] = useState(true)
  const [adding, setAdding] = useState(false)
  const platforms = useMemo(() => [...new Set(games.map((g) => g.platform))], [games])
  const multi = platforms.length > 1
  const [minText, setMinText] = useState(String(settings?.unplayedMinutes ?? 30))
  useEffect(() => setMinText(String(settings?.unplayedMinutes ?? 30)), [settings?.unplayedMinutes])

  const unplayedMin = settings?.unplayedMinutes ?? 30
  const counts = useMemo(() => {
    const c = { all: games.length, played: 0, unplayed: 0, sale: 0, excluded: 0 }
    for (const g of games) {
      if (isUnplayed(g, unplayedMin)) c.unplayed++
      else c.played++
      if (g.priceKr && g.priceKr.discount > 0) c.sale++
      if (excludeOf(g)) c.excluded++
    }
    return c
  }, [games, unplayedMin, excludeOf])

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return games
      .filter((g) => {
        if (needle && !g.name.toLowerCase().includes(needle) && !(g.nameKo ?? '').toLowerCase().includes(needle)) return false
        if (filter === 'played' && isUnplayed(g, unplayedMin)) return false
        if (filter === 'unplayed' && !isUnplayed(g, unplayedMin)) return false
        if (filter === 'sale' && !(g.priceKr && g.priceKr.discount > 0)) return false
        if (filter === 'excluded' && !excludeOf(g)) return false
        if (platform !== 'any' && g.platform !== platform) return false
        if (status !== 'any' && g.status !== status) return false
        if (genre !== 'any' && !g.genres.some((x) => x.id === genre)) return false
        return true
      })
      .sort(sortFn(sort))
  }, [games, q, filter, status, genre, sort, unplayedMin, excludeOf, platform])

  // 여러 플랫폼에 있는 같은 게임은 한 장의 카드로
  const groups: GameGroup[] = useMemo(
    () => (multi && merge ? groupAcrossPlatforms(list) : list.map((g) => ({ primary: g, all: [g] }))),
    [list, multi, merge]
  )

  useEffect(() => setLimit(PAGE), [q, filter, status, genre, sort, platform, merge])

  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  const bulk = async (patch: Parameters<typeof window.api.bulkUpdate>[1], msg: string) => {
    await window.api.bulkUpdate([...selected], patch)
    await reload()
    toast(`${selected.size}개 게임: ${msg}`)
    setSelected(new Set())
  }

  const shownGroups = groups.slice(0, limit)
  const shown = shownGroups.map((x) => x.primary)

  return (
    <>
      <TopBar
        title="라이브러리"
        actions={
          <Button icon={<LuPlus />} onClick={() => setAdding(true)} title="Switch, 디스크 게임, 다른 런처 게임 등">
            게임 추가
          </Button>
        }
      />
      {adding && <ManualGameDialog onClose={() => setAdding(false)} />}
      <PageBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <LuSearch className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint" />
            <Input className="w-64 pl-9" placeholder="게임 이름 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: '전체', count: counts.all },
              { value: 'played', label: '플레이함', count: counts.played },
              { value: 'unplayed', label: '안 한 게임', count: counts.unplayed },
              { value: 'sale', label: '할인 중', count: counts.sale },
              { value: 'excluded', label: '제외됨', count: counts.excluded },
              { value: 'dlc', label: 'DLC', count: dlcs.length }
            ]}
          />
          <div className="flex-1" />
          <Segmented<'grid' | 'table'>
            value={view}
            onChange={setView}
            options={[
              { value: 'grid', label: <LuLayoutGrid className="h-4 w-4" /> },
              { value: 'table', label: <LuList className="h-4 w-4" /> }
            ]}
          />
        </div>
        {filter !== 'dlc' && (
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          {multi && (
            <Select value={platform} onChange={(e) => setPlatform(e.target.value as Platform | 'any')}>
              <option value="any">모든 플랫폼</option>
              {platforms.map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_LABELS[p]} ({games.filter((g) => g.platform === p).length})
                </option>
              ))}
            </Select>
          )}
          <Select value={status} onChange={(e) => setStatus(e.target.value as GameStatus | 'any')}>
            <option value="any">모든 상태</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select value={genre} onChange={(e) => setGenre(e.target.value)}>
            <option value="any">모든 장르</option>
            {GENRES.map((g) => (
              <option key={g.id} value={g.id}>
                {g.ko}
              </option>
            ))}
          </Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
          <label className="ml-2 inline-flex items-center gap-2 text-muted">
            안 한 게임 기준
            <Input
              className="num h-8 w-16 text-center"
              inputMode="numeric"
              value={minText}
              onChange={(e) => setMinText(e.target.value.replace(/\D/g, ''))}
              onBlur={() => {
                const v = Number(minText || 0)
                if (v !== unplayedMin) void saveSettings({ unplayedMinutes: v })
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            분 미만
          </label>
          {multi && (
            <label className="ml-2 inline-flex items-center gap-2 text-muted" title="이름이 같은 게임을 플랫폼에 상관없이 한 장으로 보여 줍니다">
              <input type="checkbox" className="accent-[var(--brand)]" checked={merge} onChange={(e) => setMerge(e.target.checked)} />
              같은 게임 묶기
            </label>
          )}
          <span className="ml-auto text-faint">{groups.length !== list.length ? `${groups.length}개 (${list.length}개 판)` : `${list.length}개`}</span>
        </div>
        )}

        {selected.size > 0 && (
          <div className="sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 shadow-[var(--shadow)]">
            <span className="text-[13px] font-semibold text-ink">{selected.size}개 선택</span>
            <Select
              className="h-8"
              value=""
              onChange={(e) => e.target.value && void bulk({ status: e.target.value as GameStatus }, `상태를 '${STATUS_LABELS[e.target.value as GameStatus]}'(으)로 변경`)}
            >
              <option value="">상태 변경…</option>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
            <Button size="sm" onClick={() => void bulk({ excluded: true }, '통계에서 제외')}>
              통계에서 제외
            </Button>
            <Button size="sm" onClick={() => void bulk({ excluded: false }, '통계에 포함')}>
              다시 포함
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              선택 해제
            </Button>
          </div>
        )}

        {filter === 'dlc' ? (
          <DlcTable q={q} onOpenGame={openGame} view={view} />
        ) : !list.length ? (
          <Empty title="조건에 맞는 게임이 없습니다">검색어나 필터를 바꿔 보세요.</Empty>
        ) : view === 'grid' ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
            {shownGroups.map(({ primary: g, all }) => {
              const ex = excludeOf(g)
              const unplayed = all.every((x) => isUnplayed(x, unplayedMin))
              const known = all.filter((x) => x.playtimeKnown)
              const minutes = known.reduce((a, x) => a + x.playtimeMin, 0)
              const devices = [...new Set(all.map(deviceLabel))]
              return (
                <div key={g.key} className={cn('group relative', ex && 'opacity-55')}>
                  <button type="button" className="block w-full text-left" onClick={() => openGame(g.key)}>
                    <div className="relative overflow-hidden rounded-xl ring-1 ring-line">
                      <Cover src={g.headerImage} alt={g.name} className="aspect-[460/215] w-full transition-transform group-hover:scale-[1.03]" />
                      {unplayed && <span className="absolute top-2 left-2 rounded-md bg-black/65 px-1.5 py-0.5 text-[11px] font-medium text-white">안 한 게임</span>}
                      {multi && (
                        <span className="absolute bottom-2 left-2 rounded-md bg-black/65 px-1.5 py-0.5 text-[11px] font-medium text-white">{devices.join(' · ')}</span>
                      )}
                    </div>
                    <div className="mt-2 flex items-start justify-between gap-2">
                      <div className="min-w-0 truncate text-[14px] font-semibold text-ink">{g.nameKo || g.name}</div>
                      <StatusBadge status={g.status} />
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[13px]">
                      <span className="num flex min-w-0 items-center gap-2 whitespace-nowrap text-muted">
                        {known.length ? hours(minutes) : g.gamerscore ? `${g.gamerscore.done}G` : '시간 정보 없음'}
                        <ReviewBadge review={g.review} compact />
                        {g.dlcCount > 0 && <span className="text-[12px] text-faint">DLC {g.dlcOwned}/{g.dlcCount}</span>}
                      </span>
                      {g.platform === 'steam' || g.priceKr ? (
                        <PriceLine p={g.priceKr} className="ml-auto text-[13px]" compact />
                      ) : g.trophies?.platinum ? (
                        <span className="ml-auto text-[12px] font-semibold text-[#7aa7d9]">플래티넘</span>
                      ) : null}
                    </div>
                    {g.achTotal ? <Progress className="mt-2" value={(g.achDone ?? 0) / g.achTotal} /> : null}
                  </button>
                  <input
                    type="checkbox"
                    aria-label="선택"
                    checked={selected.has(g.key)}
                    onChange={() => toggle(g.key)}
                    className={cn(
                      'absolute top-2 right-2 h-4 w-4 accent-[var(--brand)]',
                      selected.size ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
                    )}
                  />
                </div>
              )
            })}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[12px] text-muted">
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="모두 선택"
                      className="accent-[var(--brand)]"
                      checked={shown.length > 0 && shown.every((g) => selected.has(g.key))}
                      onChange={(e) => setSelected(e.target.checked ? new Set(shown.map((g) => g.key)) : new Set())}
                    />
                  </th>
                  <th className="px-2 py-2.5 font-medium">게임</th>
                  <th className="px-2 py-2.5 text-right font-medium">플레이</th>
                  <th className="px-2 py-2.5 font-medium">상태</th>
                  <th className="px-2 py-2.5 text-right font-medium">평가</th>
                  <th className="px-2 py-2.5 text-right font-medium">정가</th>
                  <th className="px-2 py-2.5 text-right font-medium">현재가</th>
                  <th className="px-2 py-2.5 text-right font-medium">역대 최저 (최대 할인)</th>
                  <th className="px-2 py-2.5 text-right font-medium">구매가</th>
                  <th className="px-2 py-2.5 text-right font-medium">시간당</th>
                  <th className="px-2 py-2.5 text-right font-medium">도전과제</th>
                  <th className="px-3 py-2.5 text-right font-medium">엔딩까지</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((g) => {
                  const ex = excludeOf(g)
                  const cph = costPerHour(g)
                  const rem = hltbRemaining(g)
                  return (
                    <tr
                      key={g.key}
                      className={cn('cursor-pointer border-b border-line last:border-b-0 hover:bg-surface-2', ex && 'text-faint')}
                      onClick={() => openGame(g.key)}
                    >
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label="선택" className="accent-[var(--brand)]" checked={selected.has(g.key)} onChange={() => toggle(g.key)} />
                      </td>
                      <td className="max-w-[320px] px-2 py-2">
                        <div className="flex items-center gap-2.5">
                          <Cover src={g.headerImage} alt="" className="h-8 w-[68px] shrink-0 rounded" />
                          <span className={cn('truncate font-medium', ex ? 'text-faint' : 'text-ink')}>{g.nameKo || g.name}</span>
                          {multi && <Badge tone="muted">{shownGroups.find((x) => x.primary === g)?.all.map(deviceLabel).join(' · ') ?? deviceLabel(g)}</Badge>}
                          {ex && <Badge tone="muted">{EXCLUDE_LABELS[ex]}</Badge>}
                        </div>
                      </td>
                      <td className="num px-2 py-2 text-right">{g.playtimeKnown ? hours(g.playtimeMin) : '—'}</td>
                      <td className="px-2 py-2">
                        <StatusBadge status={g.status} />
                      </td>
                      <td className="px-2 py-2 text-right">
                        <ReviewBadge review={g.review} compact />
                      </td>
                      <td className="num px-2 py-2 text-right">{won(g.priceKr?.initial)}</td>
                      <td className="px-2 py-2 text-right">
                        <PriceLine p={g.priceKr} className="text-[13px]" />
                      </td>
                      <td className="px-2 py-2 text-right">
                        <LowLine low={g.lowKr} fmt={won} />
                      </td>
                      <td className="num px-2 py-2 text-right">{won(g.purchasePrice)}</td>
                      <td className="num px-2 py-2 text-right">{cph != null ? won(cph) : '—'}</td>
                      <td className="num px-2 py-2 text-right">{g.achTotal ? `${g.achDone}/${g.achTotal}` : '—'}</td>
                      <td className="num px-3 py-2 text-right">{rem ? (rem.remaining > 0 ? hoursFromH(rem.remaining) : '도달') : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {filter !== 'dlc' && groups.length > limit && (
          <div className="flex justify-center">
            <Button onClick={() => setLimit((l) => l + PAGE)}>더 보기 ({groups.length - limit}개 남음)</Button>
          </div>
        )}
      </PageBody>
    </>
  )
}

function DlcTable({ q, onOpenGame, view }: { q: string; onOpenGame(key: string): void; view: 'grid' | 'table' }) {
  const { dlcs, reload, toast, openApp } = useStore()
  const [ownedOnly, setOwnedOnly] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const needle = q.trim().toLowerCase()
  const rows = useMemo(
    () =>
      dlcs
        .filter((d) => (!ownedOnly || d.owned) && (!needle || d.name.toLowerCase().includes(needle) || d.parentName.toLowerCase().includes(needle)))
        .sort((a, b) => Number(b.owned) - Number(a.owned) || a.parentName.localeCompare(b.parentName, 'ko') || a.name.localeCompare(b.name, 'ko')),
    [dlcs, ownedOnly, needle]
  )
  const owned = dlcs.filter((d) => d.owned)
  const toggle = async (appid: number, v: boolean) => {
    try {
      await window.api.setDlcOwned(appid, v)
      await reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  if (!dlcs.length) {
    return (
      <Empty title="DLC 목록이 아직 없습니다" action={<Button onClick={() => void window.api.startSync()}>지금 동기화</Button>}>
        동기화하면 보유 게임의 DLC 목록을 받아 옵니다. 업데이트 직후라면 한 번 동기화해 주세요.
      </Empty>
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 text-[13px] text-muted">
        <span>
          보유 표시 <b className="text-ink">{owned.length}</b> / 전체 {dlcs.length}개 · 보유 DLC 정가 합계{' '}
          <b className="num text-ink">{won(owned.reduce((a, d) => a + (d.priceKr?.initial ?? 0), 0))}</b>
        </span>
        <label className="ml-auto inline-flex items-center gap-2">
          <input type="checkbox" className="accent-[var(--brand)]" checked={ownedOnly} onChange={(e) => setOwnedOnly(e.target.checked)} />
          보유한 DLC만
        </label>
        <OwnedDlcButton />
      </div>
      <p className="text-[12px] text-faint">
        설정에서 Steam에 로그인해 두면 동기화할 때 보유 DLC가 자동으로 체크됩니다. 로그인하지 않으면 이 PC에 설치된 게임의 DLC만 찾아 체크합니다. 여기서 직접 체크·해제할 수도 있고, 직접 바꾼 표시는 자동 확인이 덮어쓰지 않습니다.
      </p>
      {view === 'grid' ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
          {rows.slice(0, limit).map((d) => (
            <div key={d.appid} className={cn('group relative', !d.owned && 'opacity-70 hover:opacity-100')}>
              <button type="button" className="block w-full text-left" onClick={() => openApp(d.appid, { name: d.name, headerImage: d.headerImage, priceKr: d.priceKr })}>
                <div className="overflow-hidden rounded-xl ring-1 ring-line">
                  <Cover src={d.headerImage} alt={d.name} className="aspect-[460/215] w-full transition-transform group-hover:scale-[1.03]" />
                </div>
                <div className="mt-2 truncate text-[14px] font-semibold text-ink">{d.name}</div>
              </button>
              <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[13px]">
                <button type="button" className="min-w-0 truncate text-[12px] text-faint hover:underline" onClick={() => onOpenGame(d.parentKey)}>
                  {d.parentName}
                </button>
                {d.isFree ? <span className="ml-auto text-faint">무료</span> : <PriceLine p={d.priceKr} className="ml-auto text-[13px]" compact />}
              </div>
              <label className="absolute top-2 left-2 inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[11px] font-medium text-white">
                <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--brand)]" checked={d.owned} onChange={(e) => void toggle(d.appid, e.target.checked)} />
                보유
              </label>
            </div>
          ))}
        </div>
      ) : (
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[12px] text-muted">
              <th className="w-14 px-3 py-2.5 font-medium">보유</th>
              <th className="px-2 py-2.5 font-medium">DLC</th>
              <th className="px-2 py-2.5 font-medium">게임</th>
              <th className="px-2 py-2.5 text-right font-medium">현재가</th>
              <th className="px-2 py-2.5 text-right font-medium">역대 최저 (최대 할인)</th>
              <th className="px-2 py-2.5 text-right font-medium">평가</th>
              <th className="px-3 py-2.5 text-right font-medium">구매가</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((d) => (
              <tr key={d.appid} className={cn('border-b border-line last:border-b-0', !d.owned && 'text-muted')}>
                <td className="px-3 py-2">
                  <input type="checkbox" aria-label="보유" className="h-4 w-4 accent-[var(--brand)]" checked={d.owned} onChange={(e) => void toggle(d.appid, e.target.checked)} />
                </td>
                <td className="max-w-[380px] px-2 py-1.5">
                  <button
                    type="button"
                    className={cn('flex max-w-full items-center gap-2.5 text-left hover:underline', d.owned ? 'font-medium text-ink' : '')}
                    onClick={() => openApp(d.appid, { name: d.name, headerImage: d.headerImage, priceKr: d.priceKr })}
                  >
                    <Cover src={d.headerImage} alt="" className="h-8 w-[68px] shrink-0 rounded" />
                    <span className="truncate">{d.name}</span>
                  </button>
                </td>
                <td className="max-w-[220px] px-2 py-2">
                  <button type="button" className="block max-w-full truncate text-left hover:underline" onClick={() => onOpenGame(d.parentKey)}>
                    {d.parentName}
                  </button>
                </td>
                <td className="px-2 py-2 text-right">{d.isFree ? <span className="text-faint">무료</span> : <PriceLine p={d.priceKr} className="text-[13px]" />}</td>
                <td className="px-2 py-2 text-right">{d.isFree ? '—' : <LowLine low={d.lowKr} fmt={won} />}</td>
                <td className="px-2 py-2 text-right">
                  <ReviewBadge review={d.review} compact />
                </td>
                <td className="num px-3 py-2 text-right">{won(d.purchasePrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      {rows.length > limit && (
        <div className="flex justify-center">
          <Button onClick={() => setLimit((l) => l + PAGE)}>더 보기 ({rows.length - limit}개 남음)</Button>
        </div>
      )}
    </div>
  )
}
