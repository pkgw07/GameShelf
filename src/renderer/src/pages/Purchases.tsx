import { useEffect, useMemo, useState } from 'react'
import { LuRotateCcw, LuSearch, LuTrash2 } from 'react-icons/lu'
import { Columns } from '@/components/charts'
import { Cover } from '@/components/game'
import { PageBody, TopBar } from '@/components/Shell'
import { Badge, Button, Empty, Input, Panel, Segmented, Select, Stat } from '@/components/ui'
import { cn } from '@/lib/cn'
import { dateKo, parseWon, pct, won } from '@/lib/format'
import { useStore } from '@/lib/store'

interface Item {
  key: string
  name: string
  parent: string | null
  isDlc: boolean
  image: string
  price: number | null
  /** 구매일, 없으면 라이선스 획득일 */
  date: string | null
  dateIsAcquired: boolean
  regular: number | null
  source: 'manual' | 'history' | 'license' | 'purchase' | null
}

type Sort = 'dateDesc' | 'dateAsc' | 'priceDesc' | 'priceAsc' | 'name' | 'saved'
type Show = 'priced' | 'all'

const PAGE = 150

export function Purchases() {
  const { games, dlcs, openGame, updateGame, reload, toast } = useStore()
  const [sort, setSort] = useState<Sort>('dateDesc')
  const [show, setShow] = useState<Show>('priced')
  const [year, setYear] = useState('all')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(PAGE)

  const items: Item[] = useMemo(() => {
    const g: Item[] = games.map((x) => ({
      key: x.key,
      name: x.nameKo || x.name,
      parent: null,
      isDlc: false,
      image: x.headerImage,
      price: x.purchasePrice,
      date: x.purchaseDate ?? x.acquiredDate,
      dateIsAcquired: !x.purchaseDate && Boolean(x.acquiredDate),
      regular: x.priceKr?.initial ?? null,
      source: x.purchaseSource
    }))
    const d: Item[] = dlcs
      .filter((x) => x.owned || x.purchasePrice != null)
      .map((x) => ({
        key: x.key,
        name: x.name,
        parent: x.parentName,
        isDlc: true,
        image: x.headerImage,
        price: x.purchasePrice,
        date: x.purchaseDate,
        dateIsAcquired: false,
        regular: x.priceKr?.initial ?? null,
        // DLC 의 ownedSource 는 '보유' 출처라, 라이선스만으로는 구매가 출처를 알 수 없음
        source: x.ownedSource === 'license' ? null : x.ownedSource
      }))
    return [...g, ...d]
  }, [games, dlcs])

  const priced = useMemo(() => items.filter((i) => i.price != null), [items])
  const years = useMemo(
    () => [...new Set(priced.map((i) => i.date?.slice(0, 4)).filter((y): y is string => Boolean(y)))].sort().reverse(),
    [priced]
  )

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = (show === 'priced' ? priced : items).filter((i) => {
      if (year !== 'all' && i.date?.slice(0, 4) !== year) return false
      if (needle && !i.name.toLowerCase().includes(needle) && !(i.parent ?? '').toLowerCase().includes(needle)) return false
      return true
    })
    const byName = (a: Item, b: Item) => a.name.localeCompare(b.name, 'ko')
    const num = (v: number | null, empty: number) => (v == null ? empty : v)
    const saved = (i: Item) => (i.price != null && i.regular != null ? i.regular - i.price : null)
    const cmp: Record<Sort, (a: Item, b: Item) => number> = {
      dateDesc: (a, b) => (b.date ?? '').localeCompare(a.date ?? '') || byName(a, b),
      dateAsc: (a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || byName(a, b),
      priceDesc: (a, b) => num(b.price, -1) - num(a.price, -1) || byName(a, b),
      priceAsc: (a, b) => num(a.price, Infinity) - num(b.price, Infinity) || byName(a, b),
      name: byName,
      saved: (a, b) => num(saved(b), -Infinity) - num(saved(a), -Infinity) || byName(a, b)
    }
    return list.sort(cmp[sort])
  }, [items, priced, show, year, q, sort])

  useEffect(() => setLimit(PAGE), [sort, show, year, q])

  const sum = useMemo(() => {
    const p = rows.filter((r) => r.price != null)
    const total = p.reduce((a, r) => a + (r.price ?? 0), 0)
    const withReg = p.filter((r) => r.regular != null && r.regular > 0)
    const reg = withReg.reduce((a, r) => a + (r.regular ?? 0), 0)
    const paid = withReg.reduce((a, r) => a + (r.price ?? 0), 0)
    const top = p.reduce<Item | null>((a, r) => (!a || (r.price ?? 0) > (a.price ?? 0) ? r : a), null)
    return { total, count: p.length, avg: p.length ? total / p.length : 0, saved: reg - paid, savedRate: reg ? 1 - paid / reg : 0, top }
  }, [rows])

  const byYear = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of priced) if (i.date) m.set(i.date.slice(0, 4), (m.get(i.date.slice(0, 4)) ?? 0) + (i.price ?? 0))
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [priced])

  const save = async (it: Item, patch: { purchasePrice?: number | null; purchaseDate?: string | null }) => {
    try {
      if (it.isDlc) {
        await window.api.updateUserData(it.key, patch)
        if (patch.purchasePrice != null) await window.api.setDlcOwned(Number(it.key.split(':')[1]), true)
        await reload()
      } else {
        await updateGame(it.key, patch)
      }
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  return (
    <>
      <TopBar title="구매 기록" />
      <PageBody className="space-y-5">
        <div className="grid grid-cols-[1fr_340px] gap-5">
          <div className="grid grid-cols-4 gap-5 rounded-2xl border border-line bg-surface px-6 py-5">
            <Stat label={year === 'all' ? '총 지출' : `${year}년 지출`} value={won(sum.total)} sub={`${sum.count}건`} />
            <Stat label="평균 구매가" value={sum.count ? won(sum.avg) : '—'} />
            <Stat label="정가 대비 아낀 금액" value={won(sum.saved)} sub={sum.savedRate ? `평균 ${pct(sum.savedRate)} 할인` : undefined} tone="good" />
            <Stat label="가장 비싼 구매" value={sum.top ? won(sum.top.price) : '—'} sub={sum.top?.name} />
          </div>
          <div className="rounded-2xl border border-line bg-surface px-5 pt-4 pb-3">
            <div className="mb-2 text-[13px] text-muted">연도별 지출</div>
            {byYear.length ? (
              <Columns data={byYear.map(([y, v]) => ({ label: y.slice(2), value: v, title: `${y}년` }))} format={won} height={70} />
            ) : (
              <p className="text-[12px] text-faint">구매일이 있는 기록이 없습니다.</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <LuSearch className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint" />
            <Input className="w-60 pl-9" placeholder="게임·DLC 이름 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Segmented<Show>
            value={show}
            onChange={setShow}
            options={[
              { value: 'priced', label: '구매가 있는 항목', count: priced.length },
              { value: 'all', label: '전체 (입력하기)', count: items.length }
            ]}
          />
          <Select value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="all">모든 연도</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="dateDesc">날짜 최신순</option>
            <option value="dateAsc">날짜 오래된순</option>
            <option value="priceDesc">가격 높은순</option>
            <option value="priceAsc">가격 낮은순</option>
            <option value="saved">아낀 금액 많은순</option>
            <option value="name">이름순</option>
          </Select>
          <span className="ml-auto text-[13px] text-faint">{rows.length}건</span>
        </div>

        {!rows.length ? (
          <Empty title={show === 'priced' ? '구매가가 입력된 기록이 없습니다' : '조건에 맞는 항목이 없습니다'}>
            {show === 'priced' && '"전체 (입력하기)"를 눌러 바로 입력하거나, 가격·지출 화면에서 구매 내역을 가져오세요.'}
          </Empty>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[12px] text-muted">
                  <th className="px-3 py-2.5 font-medium">게임·DLC</th>
                  <th className="px-2 py-2.5 font-medium">구매일</th>
                  <th className="px-2 py-2.5 text-right font-medium">구매가</th>
                  <th className="px-2 py-2.5 text-right font-medium">지금 정가</th>
                  <th className="px-2 py-2.5 text-right font-medium">할인받은 비율</th>
                  <th className="px-2 py-2.5 font-medium">출처</th>
                  <th className="w-10 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((it) => (
                  <PurchaseRow key={it.key} it={it} onSave={save} onOpen={() => openGame(it.isDlc ? null : it.key)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > limit && (
          <div className="flex justify-center">
            <Button onClick={() => setLimit((l) => l + PAGE)}>더 보기 ({rows.length - limit}건 남음)</Button>
          </div>
        )}

        <ResetPanel />
      </PageBody>
    </>
  )
}

const SOURCE_LABEL: Record<string, string> = { manual: '직접 입력', history: '구매 내역', license: '라이선스', purchase: '구매 내역' }

function PurchaseRow({ it, onSave, onOpen }: { it: Item; onSave(it: Item, p: { purchasePrice?: number | null; purchaseDate?: string | null }): Promise<void>; onOpen(): void }) {
  const [price, setPrice] = useState(it.price != null ? String(it.price) : '')
  const [date, setDate] = useState(it.dateIsAcquired ? '' : (it.date ?? ''))
  useEffect(() => setPrice(it.price != null ? String(it.price) : ''), [it.price])
  useEffect(() => setDate(it.dateIsAcquired ? '' : (it.date ?? '')), [it.date, it.dateIsAcquired])
  const off = it.price != null && it.regular ? 1 - it.price / it.regular : null
  return (
    <tr className={cn('border-b border-line last:border-b-0', it.price == null && 'text-muted')}>
      <td className="max-w-[340px] px-3 py-1.5">
        <div className="flex items-center gap-2.5">
          <Cover src={it.image} alt="" className="h-8 w-[68px] shrink-0 rounded" />
          <div className="min-w-0">
            <button type="button" disabled={it.isDlc} onClick={onOpen} className={cn('block max-w-full truncate text-left font-medium text-ink', !it.isDlc && 'hover:underline')}>
              {it.name}
            </button>
            {it.isDlc && <div className="truncate text-[11px] text-faint">DLC · {it.parent}</div>}
          </div>
        </div>
      </td>
      <td className="px-2 py-1.5">
        <Input
          type="date"
          className="h-8"
          value={date}
          title={it.dateIsAcquired ? `라이선스 획득일 ${dateKo(it.date)}` : undefined}
          onChange={(e) => setDate(e.target.value)}
          onBlur={() => {
            const v = date || null
            if (v !== (it.dateIsAcquired ? null : it.date)) void onSave(it, { purchaseDate: v })
          }}
        />
        {it.dateIsAcquired && <div className="text-[11px] text-faint">획득일 {dateKo(it.date)}</div>}
      </td>
      <td className="px-2 py-1.5 text-right">
        <Input
          className="num h-8 w-28 text-right"
          inputMode="numeric"
          placeholder="구매가"
          value={price ? Number(price).toLocaleString('ko-KR') : ''}
          onChange={(e) => setPrice(String(parseWon(e.target.value) ?? ''))}
          onBlur={() => {
            const v = price === '' ? null : Number(price)
            if (v !== it.price) void onSave(it, { purchasePrice: v })
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </td>
      <td className="num px-2 py-1.5 text-right">{won(it.regular)}</td>
      <td className="num px-2 py-1.5 text-right">{off != null ? <span className={off > 0 ? 'text-good' : 'text-muted'}>{off > 0 ? `-${Math.round(off * 100)}%` : '정가'}</span> : '—'}</td>
      <td className="px-2 py-1.5">{it.price != null && it.source ? <Badge tone="muted">{SOURCE_LABEL[it.source] ?? it.source}</Badge> : null}</td>
      <td className="px-3 py-1.5 text-right">
        {(it.price != null || (!it.dateIsAcquired && it.date)) && (
          <button
            type="button"
            title="이 기록 지우기"
            className="rounded-md p-1.5 text-faint hover:bg-bad-soft hover:text-bad"
            onClick={() => void onSave(it, { purchasePrice: null, purchaseDate: null })}
          >
            <LuTrash2 className="h-4 w-4" />
          </button>
        )}
      </td>
    </tr>
  )
}

function ResetPanel() {
  const { reload, toast } = useStore()
  const [confirm, setConfirm] = useState<'imported' | 'all' | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async (scope: 'imported' | 'all') => {
    setBusy(true)
    try {
      const r = await window.api.resetPurchases(scope)
      await reload()
      toast(r.message)
      setConfirm(null)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel title="지출 기록 초기화">
      <p className="text-[13px] text-muted">
        구매가를 처음부터 다시 넣고 싶을 때 사용하세요. 지우기 직전 데이터는 데이터 폴더의 backups에 자동으로 백업됩니다. 되돌리려면 설정 → 백업에서 복원을 누르고 그 파일을 고르세요.
      </p>
      {confirm == null ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="danger" icon={<LuRotateCcw />} onClick={() => setConfirm('imported')}>
            가져온 구매가만 지우기
          </Button>
          <Button variant="danger" icon={<LuTrash2 />} onClick={() => setConfirm('all')}>
            모든 지출 기록 지우기
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-bad/30 bg-bad-soft px-4 py-3 text-[13px]">
          <span className="text-ink">
            {confirm === 'all'
              ? '직접 입력한 구매가·구매일, 가져온 구매 내역, 라이선스 획득일을 모두 지웁니다.'
              : '구매 내역 페이지에서 가져온 구매가만 지웁니다. 직접 입력한 값은 남습니다.'}{' '}
            계속할까요?
          </span>
          <Button variant="danger" disabled={busy} onClick={() => void run(confirm)}>
            지우기
          </Button>
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            취소
          </Button>
        </div>
      )}
    </Panel>
  )
}
