import { useMemo, useState } from 'react'
import { LuFileUp } from 'react-icons/lu'
import { costPerHour, moneyTotals, purchaseTiming, regionRatio, spendBy, TIMING_LABELS, type TimingGrade } from '@shared/analytics'
import type { GameRow, ImportResult } from '@shared/types'
import { Columns } from '@/components/charts'
import { PasteImport } from '@/components/PasteImport'
import { PageBody, TopBar } from '@/components/Shell'
import { Badge, Button, Empty, Input, Panel, Segmented, Stat } from '@/components/ui'
import { cn } from '@/lib/cn'
import { hours, parseWon, pct, usd, won } from '@/lib/format'
import { detectPage, parseLicenses, parsePurchaseHistory } from '@/lib/parsers'
import { useStore } from '@/lib/store'

const GRADE_TONE: Record<TimingGrade, 'good' | 'sale' | 'bad' | 'muted'> = {
  best: 'good',
  good: 'good',
  fair: 'sale',
  pricey: 'bad',
  unknown: 'muted'
}

export function Money() {
  const { included, priced, ownedDlcs, games, settings, openGame } = useStore()
  const [unit, setUnit] = useState<'year' | 'month'>('year')
  const t = useMemo(() => moneyTotals(priced), [priced])
  const spend = useMemo(() => {
    const s = spendBy([...included, ...ownedDlcs], unit)
    return unit === 'month' ? s.slice(-24) : s
  }, [included, ownedDlcs, unit])

  const cph = useMemo(() => {
    const list = included.map((g) => ({ g, v: costPerHour(g) })).filter((x): x is { g: GameRow; v: number } => x.v != null)
    list.sort((a, b) => a.v - b.v)
    return { best: list.slice(0, 8), worst: list.slice(-8).reverse(), count: list.length }
  }, [included])

  const timing = useMemo(() => {
    const rows = included.filter((g) => g.purchasePrice != null).map((g) => ({ g, t: purchaseTiming(g) }))
    const counts: Record<TimingGrade, number> = { best: 0, good: 0, fair: 0, pricey: 0, unknown: 0 }
    rows.forEach((r) => counts[r.t.grade]++)
    const order: TimingGrade[] = ['pricey', 'fair', 'good', 'best', 'unknown']
    rows.sort((a, b) => order.indexOf(a.t.grade) - order.indexOf(b.t.grade) || (b.g.purchasePrice ?? 0) - (a.g.purchasePrice ?? 0))
    return { rows: rows.slice(0, 12), counts, total: rows.length }
  }, [included])

  const region = useMemo(() => {
    const rate = settings?.usdKrwRate ?? 1400
    const rows = included.map((g) => ({ g, r: regionRatio(g, rate) })).filter((x): x is { g: GameRow; r: number } => x.r != null)
    const avg = rows.length ? rows.reduce((a, x) => a + x.r, 0) / rows.length : null
    rows.sort((a, b) => a.r - b.r)
    return { avg, cheaper: rows.slice(0, 5), pricier: rows.slice(-5).reverse(), n: rows.length, rate }
  }, [included, settings?.usdKrwRate])

  return (
    <>
      <TopBar title="가격 · 지출" />
      <PageBody className="space-y-5">
        <div className="grid grid-cols-4 gap-5 rounded-2xl border border-line bg-surface px-6 py-5">
          <Stat label="정가 총합" value={won(t.regularKr)} sub={`미국 정가 ${usd(t.regularUs)}`} />
          <Stat label="현재가 총합" value={won(t.currentKr)} sub={`할인 중 ${t.onSale}개 · 미국 ${usd(t.currentUs)}`} tone={t.onSale ? 'sale' : undefined} />
          <Stat label="Steam 역대 최저가 총합" value={won(t.lowKr)} sub={`최대 할인율 기준 · 정가의 ${pct(t.lowKr / Math.max(1, t.regularKr))} · 미국 ${usd(t.lowUs)}`} tone="good" />
          <Stat
            label="실제 지출"
            value={t.spentCount ? won(t.spent) : '—'}
            sub={t.spentCount ? `${t.spentCount}개 입력 · 정가 대비 ${won(t.saved)} 아낌` : '구매가를 입력하면 표시됩니다'}
          />
        </div>
        <p className="-mt-2 text-[12px] text-faint">
          무료·제외 게임은 빠지고, 가격이 있는 {t.pricedKr}개 기준입니다{settings?.includeDlcInTotals && ownedDlcs.length ? ` (보유 DLC ${ownedDlcs.length}개 포함)` : ''}. 역대 최저가는 각 게임이 역대 최대 할인율로 팔렸던 가격이며, 지금 할인 중인지와 상관없습니다. 한국 기록이 없는 게임은 미국에서 기록된 최대 할인율을 한국 정가에 적용해 계산합니다.
        </p>

        <div className="grid grid-cols-[3fr_2fr] gap-5">
          <Panel
            title="지출 추이"
            action={
              <Segmented<'year' | 'month'>
                size="sm"
                value={unit}
                onChange={setUnit}
                options={[
                  { value: 'year', label: '연도별' },
                  { value: 'month', label: '월별' }
                ]}
              />
            }
          >
            {spend.length ? (
              <Columns
                data={spend.map((s) => ({ label: unit === 'year' ? s.label : s.label.slice(2).replace('-', '.'), value: s.amount, title: `${s.label} · ${s.count}개` }))}
                format={won}
                height={180}
                labelEvery={unit === 'month' && spend.length > 12 ? 3 : 1}
              />
            ) : (
              <p className="text-[13px] text-muted">구매가와 구매일(또는 라이선스 획득일)이 있는 게임이 있어야 그래프가 그려집니다.</p>
            )}
          </Panel>
          <Panel title="구매 타이밍" action={<span className="text-[12px] text-faint">구매가 vs Steam 역대 최저가</span>}>
            {timing.total ? (
              <>
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {(['best', 'good', 'fair', 'pricey'] as TimingGrade[]).map((k) => (
                    <Badge key={k} tone={GRADE_TONE[k]}>
                      {TIMING_LABELS[k]} {timing.counts[k]}
                    </Badge>
                  ))}
                </div>
                <ul className="space-y-1.5">
                  {timing.rows.slice(0, 7).map(({ g, t: tm }) => (
                    <li key={g.key} className="flex items-center gap-2 text-[13px]">
                      <button type="button" className="min-w-0 flex-1 truncate text-left text-ink hover:underline" onClick={() => openGame(g.key)}>
                        {g.nameKo || g.name}
                      </button>
                      <span className="num text-muted">
                        {won(g.purchasePrice)} <span className="text-faint">/ 최저 {won(g.lowKr?.amount)}</span>
                      </span>
                      <Badge tone={GRADE_TONE[tm.grade]}>{TIMING_LABELS[tm.grade]}</Badge>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-[13px] text-muted">구매가가 입력된 게임이 없습니다.</p>
            )}
          </Panel>
        </div>

        <div className="grid grid-cols-2 gap-5">
          <Panel title="가성비 좋은 게임" action={<span className="text-[12px] text-faint">시간당 비용 낮은 순 · 1시간 이상</span>}>
            <CphList rows={cph.best} onOpen={openGame} />
          </Panel>
          <Panel title="본전 못 뽑은 게임" action={<span className="text-[12px] text-faint">시간당 비용 높은 순</span>}>
            <CphList rows={cph.worst} onOpen={openGame} />
          </Panel>
        </div>

        <Panel
          title="한국 vs 미국 정가"
          action={<span className="text-[12px] text-faint">게임별 미국 정가 × 환율 {region.rate.toLocaleString()}원 기준 · 설정에서 변경</span>}
        >
          {region.n ? (
            <div className="grid grid-cols-[200px_1fr_1fr] gap-6">
              <div>
                <div className="text-[13px] text-muted">평균 비율</div>
                <div className="num text-3xl font-extrabold text-ink">{pct(region.avg)}</div>
                <div className="text-[12px] text-faint">100%보다 낮으면 한국이 더 저렴 · {region.n}개 게임</div>
              </div>
              <RegionList title="한국이 특히 저렴" rows={region.cheaper} onOpen={openGame} />
              <RegionList title="한국이 상대적으로 비쌈" rows={region.pricier} onOpen={openGame} />
            </div>
          ) : (
            <p className="text-[13px] text-muted">두 지역 가격이 모두 있는 게임이 없습니다.</p>
          )}
        </Panel>

        <ImportPanel />
        <MissingPrices games={games} />
      </PageBody>
    </>
  )
}

function CphList({ rows, onOpen }: { rows: { g: GameRow; v: number }[]; onOpen(k: string): void }) {
  if (!rows.length) return <p className="text-[13px] text-muted">구매가가 입력되고 1시간 이상 플레이한 게임이 필요합니다.</p>
  return (
    <ul className="space-y-1.5">
      {rows.map(({ g, v }) => (
        <li key={g.key} className="flex items-center gap-3 text-[13px]">
          <button type="button" className="min-w-0 flex-1 truncate text-left text-ink hover:underline" onClick={() => onOpen(g.key)}>
            {g.nameKo || g.name}
          </button>
          <span className="num text-faint">
            {won(g.purchasePrice)} · {hours(g.playtimeMin, 0)}
          </span>
          <span className="num w-24 text-right font-semibold text-ink">{won(v)}/시간</span>
        </li>
      ))}
    </ul>
  )
}

function RegionList({ title, rows, onOpen }: { title: string; rows: { g: GameRow; r: number }[]; onOpen(k: string): void }) {
  return (
    <div>
      <div className="mb-2 text-[13px] font-medium text-muted">{title}</div>
      <ul className="space-y-1.5">
        {rows.map(({ g, r }) => (
          <li key={g.key} className="flex items-center gap-2 text-[13px]">
            <button type="button" className="min-w-0 flex-1 truncate text-left text-ink hover:underline" onClick={() => onOpen(g.key)}>
              {g.nameKo || g.name}
            </button>
            <span className="num text-faint">
              {won(g.priceKr?.initial)} / {usd(g.priceUs?.initial)}
            </span>
            <span className={cn('num w-12 text-right font-semibold', r < 1 ? 'text-good' : 'text-bad')}>{pct(r)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ImportPanel() {
  const { games, reload, toast } = useStore()
  const [result, setResult] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [assigned, setAssigned] = useState<Set<number>>(new Set())
  const [tab, setTab] = useState<'page' | 'text' | 'image'>('page')

  const pick = async () => {
    setBusy(true)
    try {
      const f = await window.api.openTextFile()
      if (!f) return
      const kind = detectPage(f.text)
      if (!kind) {
        toast('Steam 구매 내역 또는 라이선스 페이지가 아닙니다. 페이지를 "다른 이름으로 저장"한 HTML 파일을 골라 주세요.', 'error')
        return
      }
      const r =
        kind === 'purchases'
          ? await window.api.importPurchases(parsePurchaseHistory(f.text))
          : await window.api.importLicenses(parseLicenses(f.text))
      setResult(r)
      setAssigned(new Set())
      await reload()
      toast(`${kind === 'purchases' ? '구매 내역' : '라이선스'}에서 ${r.matched}개 게임에 반영했습니다.`)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const byName = useMemo(() => new Map(games.map((g) => [(g.nameKo || g.name).toLowerCase(), g])), [games])

  return (
    <Panel
      title="구매가 가져오기"
      action={
        <Segmented<'page' | 'text' | 'image'>
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'page', label: '저장한 Steam 페이지' },
            { value: 'text', label: '표·텍스트 붙여넣기' },
            { value: 'image', label: '캡처 이미지' }
          ]}
        />
      }
    >
      {tab !== 'page' ? (
        <PasteImport key={tab} mode={tab} />
      ) : (
      <>
      <div className="mb-3">
        <Button variant="primary" icon={<LuFileUp />} disabled={busy} onClick={() => void pick()}>
          저장한 페이지 열기
        </Button>
      </div>
      <ol className="max-w-[72ch] list-decimal space-y-1 pl-5 text-[13px] text-muted">
        <li>
          브라우저에서 Steam에 로그인한 뒤{' '}
          <button type="button" className="text-brand underline" onClick={() => void window.api.openExternal('https://store.steampowered.com/account/history/')}>
            구매 내역
          </button>{' '}
          페이지를 엽니다. 아래쪽 "더 보기"를 끝까지 눌러 전체 내역을 펼쳐 주세요.
        </li>
        <li>Ctrl+S로 "웹페이지, HTML만" 저장한 뒤 위 버튼으로 엽니다. 날짜와 결제 금액이 게임별로 들어갑니다.</li>
        <li>
          구매 내역에 없는 게임(키 등록, 무료 배포 등)은{' '}
          <button type="button" className="text-brand underline" onClick={() => void window.api.openExternal('https://store.steampowered.com/account/licenses/')}>
            라이선스
          </button>{' '}
          페이지를 같은 방법으로 저장해 열면 획득일이 채워집니다.
        </li>
      </ol>
      <p className="mt-2 text-[12px] text-faint">
        로그인 정보는 프로그램에 입력하지 않습니다. 직접 입력한 구매가는 가져오기가 덮어쓰지 않으며, 여러 게임을 한 번에 결제한 경우 각 게임의 정가 비율로 나눕니다.
      </p>
      {result && (
        <div className="mt-4 rounded-xl bg-surface-2 p-4">
          <div className="text-[13px] text-ink">
            {result.totalRows}건 중 <b>{result.matched}개 게임</b>에 반영
            {result.skippedManual > 0 && ` · 직접 입력값이 있어 건너뜀 ${result.skippedManual}개`}
            {result.unmatched.length > 0 && ` · 이름을 못 맞춘 항목 ${result.unmatched.length}개`}
          </div>
          {result.kind === 'purchases' && result.unmatched.length > 0 && (
            <>
            <datalist id="game-names">
              {games.map((g) => (
                <option key={g.key} value={g.nameKo || g.name} />
              ))}
            </datalist>
            <ul className="mt-3 space-y-1.5">
              {result.unmatched.slice(0, 40).map((u, i) => (
                <li key={i} className={cn('flex items-center gap-2 text-[13px]', assigned.has(i) && 'opacity-50')}>
                  <span className="min-w-0 flex-1 truncate text-ink">{u.itemName}</span>
                  <span className="num text-faint">
                    {u.date} · {won(u.amount)}
                  </span>
                  <Input
                    list="game-names"
                    className="h-8 w-56"
                    placeholder="보유 게임과 연결"
                    disabled={assigned.has(i)}
                    onChange={async (e) => {
                      const g = byName.get(e.target.value.toLowerCase())
                      if (!g) return
                      await window.api.assignImported(g.key, u.amount, u.date)
                      setAssigned((s) => new Set(s).add(i))
                      await reload()
                    }}
                  />
                </li>
              ))}
            </ul>
            </>
          )}
        </div>
      )}
      </>
      )}
    </Panel>
  )
}

function MissingPrices({ games }: { games: GameRow[] }) {
  const { updateGame } = useStore()
  const rows = useMemo(
    () =>
      games
        .filter((g) => g.purchasePrice == null && !g.isFree && g.playtimeMin > 0)
        .sort((a, b) => b.playtimeMin - a.playtimeMin)
        .slice(0, 12),
    [games]
  )
  const [vals, setVals] = useState<Record<string, string>>({})
  if (!rows.length) return null
  return (
    <Panel title="구매가 빠르게 입력" action={<span className="text-[12px] text-faint">많이 플레이한 게임부터 · 입력 후 칸을 벗어나면 저장</span>}>
      {rows.length === 0 ? (
        <Empty title="모든 게임에 구매가가 있습니다" />
      ) : (
        <div className="grid grid-cols-2 gap-x-8 gap-y-1.5">
          {rows.map((g) => (
            <label key={g.key} className="flex items-center gap-3 text-[13px]">
              <span className="min-w-0 flex-1 truncate text-ink">{g.nameKo || g.name}</span>
              <span className="num text-faint">정가 {won(g.priceKr?.initial)}</span>
              <Input
                className="num h-8 w-28 text-right"
                inputMode="numeric"
                placeholder="구매가"
                value={vals[g.key] ? Number(vals[g.key]).toLocaleString('ko-KR') : ''}
                onChange={(e) => setVals((v) => ({ ...v, [g.key]: String(parseWon(e.target.value) ?? '') }))}
                onBlur={() => vals[g.key] && void updateGame(g.key, { purchasePrice: Number(vals[g.key]) })}
              />
            </label>
          ))}
        </div>
      )}
    </Panel>
  )
}
