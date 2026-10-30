import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { LuExternalLink, LuPlay, LuStar, LuX } from 'react-icons/lu'
import {
  costPerHour,
  EXCLUDE_LABELS,
  hltbRemaining,
  normalizeHistory,
  purchaseTiming,
  regionRatio,
  TIMING_LABELS
} from '@shared/analytics'
import type { DlcRow, GameDetail, GameRow, PricePoint } from '@shared/types'
import { cn } from '@/lib/cn'
import { dateKo, duration, hours, hoursFromH, parseWon, price, relative, usd, won } from '@/lib/format'
import { useStore } from '@/lib/store'
import { StepChart } from './charts'
import { Cover, LowLine, PriceLine, ReviewBadge, StatusPicker, VerdictBadge } from './game'
import { Badge, Button, Input, Progress, Spinner, Switch } from './ui'

export function GameDrawer() {
  const { openKey, openGame, games } = useStore()
  const game = games.find((g) => g.key === openKey) ?? null
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && openGame(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openGame])
  if (!openKey) return null
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="닫기" className="absolute inset-0 bg-black/30" onClick={() => openGame(null)} />
      <aside className="drawer-in relative flex h-full w-[620px] max-w-[92vw] flex-col overflow-y-auto border-l border-line bg-paper">
        {game ? <DrawerBody key={game.key} game={game} /> : <div className="p-8 text-muted">게임 정보를 찾을 수 없습니다.</div>}
      </aside>
    </div>
  )
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="border-t border-line px-6 py-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-[13px]">
      <span className="text-muted">{label}</span>
      <span className="num text-right text-ink">{children}</span>
    </div>
  )
}

function DrawerBody({ game: g }: { game: GameRow }) {
  const { openGame, updateGame, excludeOf, settings, toast } = useStore()
  const [detail, setDetail] = useState<GameDetail | null>(null)
  const [itad, setItad] = useState<{ kr: PricePoint[]; us: PricePoint[] } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [priceText, setPriceText] = useState(g.purchasePrice != null ? String(g.purchasePrice) : '')
  const [dateText, setDateText] = useState(g.purchaseDate ?? '')
  const [notes, setNotes] = useState(g.notes)
  const [manualMain, setManualMain] = useState(g.hltb?.source === 'manual' && g.hltb.main != null ? String(g.hltb.main) : '')

  useEffect(() => {
    void window.api.getGameDetail(g.key).then(setDetail)
  }, [g.key])

  const reason = excludeOf(g)
  const timing = purchaseTiming(g)
  const cph = costPerHour(g)
  const rem = hltbRemaining(g)
  const ratio = settings ? regionRatio(g, settings.usdKrwRate) : null

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    try {
      await fn()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const historyKr = useMemo(
    () => normalizeHistory([...(itad?.kr ?? []), ...(detail?.historyKr ?? [])]),
    [itad, detail]
  )

  const achieved = detail?.achievements.filter((a) => a.achieved) ?? []
  const locked = detail?.achievements.filter((a) => !a.achieved) ?? []

  return (
    <>
      <div className="relative">
        <Cover src={g.headerImage} alt={g.name} className="aspect-[460/215] w-full" />
        <button
          type="button"
          onClick={() => openGame(null)}
          className="absolute top-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/70"
          aria-label="닫기"
        >
          <LuX />
        </button>
      </div>
      <div className="px-6 pt-5 pb-4">
        <h2 className="text-2xl leading-tight font-bold text-ink">{g.nameKo || g.name}</h2>
        {g.nameKo && g.nameKo !== g.name && <div className="mt-0.5 text-[13px] text-muted">{g.name}</div>}
        {g.review && (
          <div className="mt-1.5 text-[13px]">
            <span className="text-muted">Steam 평가 </span>
            <ReviewBadge review={g.review} />
            <span className="num ml-1 text-faint">({g.review.count.toLocaleString()}개)</span>
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {g.genres.map((x) => (
            <Badge key={x.id}>{x.name}</Badge>
          ))}
          {reason && <Badge tone="muted">통계 제외 · {EXCLUDE_LABELS[reason]}</Badge>}
          {g.detailsStatus === 'unavailable' && <Badge tone="muted">한국 상점 미판매</Badge>}
        </div>
        {g.appid != null && (
          <div className="mt-4 flex gap-2">
            <Button size="sm" icon={<LuPlay />} onClick={() => void window.api.openExternal(`steam://run/${g.appid}`)}>
              실행
            </Button>
            <Button size="sm" icon={<LuExternalLink />} onClick={() => void window.api.openExternal(`https://store.steampowered.com/app/${g.appid}/`)}>
              Steam 상점
            </Button>
          </div>
        )}
        <div className="mt-5 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-line bg-surface p-3">
            <div className="text-[12px] text-muted">플레이타임</div>
            <div className="num text-lg font-bold">{hours(g.playtimeMin)}</div>
            <div className="text-[12px] text-faint">최근 2주 {hours(g.playtime2wMin)}</div>
          </div>
          <div className="rounded-xl border border-line bg-surface p-3">
            <div className="text-[12px] text-muted">마지막 플레이</div>
            <div className="text-lg font-bold">{g.lastPlayed ? relative(g.lastPlayed * 1000) : '없음'}</div>
            <div className="text-[12px] text-faint">{g.lastPlayed ? dateKo(g.lastPlayed * 1000) : '—'}</div>
          </div>
          <div className="rounded-xl border border-line bg-surface p-3">
            <div className="text-[12px] text-muted">도전과제</div>
            <div className="num text-lg font-bold">{g.achTotal ? `${g.achDone}/${g.achTotal}` : '없음'}</div>
            {g.achTotal ? <Progress className="mt-1.5" value={(g.achDone ?? 0) / g.achTotal} /> : <div className="text-[12px] text-faint">—</div>}
          </div>
        </div>
      </div>

      <Section title="상태">
        <StatusPicker value={g.status} onChange={(s) => void updateGame(g.key, { status: s })} />
        {g.statusAuto && g.status !== 'none' && (
          <p className="mt-2 text-[12px] text-faint">자동으로 붙은 태그입니다. 직접 고르면 자동 기능이 더 이상 바꾸지 않습니다.</p>
        )}
        <div className="mt-3">
          <Switch
            checked={g.excludedManual}
            onChange={(v) => void updateGame(g.key, { excluded: v })}
            label="통계에서 제외"
            hint="가격 총합, 플레이 분석, 추천 계산에서 빠집니다. 라이브러리에는 계속 보입니다."
          />
        </div>
      </Section>

      <Section title="구매 정보">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-[12px] text-muted">구매가 (원)</span>
            <Input
              className="num w-full"
              inputMode="numeric"
              placeholder="예: 16000"
              value={priceText ? Number(priceText).toLocaleString('ko-KR') : ''}
              onChange={(e) => setPriceText(String(parseWon(e.target.value) ?? ''))}
              onBlur={() => {
                const v = priceText === '' ? null : Number(priceText)
                if (v !== g.purchasePrice) void updateGame(g.key, { purchasePrice: v })
              }}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] text-muted">구매일</span>
            <Input
              type="date"
              className="w-full"
              value={dateText}
              onChange={(e) => setDateText(e.target.value)}
              onBlur={() => dateText !== (g.purchaseDate ?? '') && void updateGame(g.key, { purchaseDate: dateText || null })}
            />
          </label>
        </div>
        <div className="mt-3 space-y-0.5">
          {g.purchaseSource && <Row label="출처">{g.purchaseSource === 'manual' ? '직접 입력' : '구매 내역에서 가져옴'}</Row>}
          {g.acquiredDate && <Row label="라이선스 획득일">{dateKo(g.acquiredDate)}</Row>}
          <Row label="시간당 비용">{cph != null ? `${won(cph)} / 시간` : '구매가 입력 + 1시간 이상 플레이 시 계산'}</Row>
          {g.purchasePrice != null && g.priceKr && <Row label="정가 대비 아낀 금액">{won(g.priceKr.initial - g.purchasePrice)}</Row>}
          <Row label="구매 타이밍">
            {timing.grade === 'unknown' ? (
              <span className="text-faint">구매가와 최저가가 있어야 평가합니다</span>
            ) : (
              <Badge tone={timing.grade === 'pricey' ? 'bad' : timing.grade === 'fair' ? 'sale' : 'good'}>{TIMING_LABELS[timing.grade]}</Badge>
            )}
          </Row>
        </div>
      </Section>

      <Section
        title="가격"
        action={
          g.appid != null && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy === 'itad' || !settings?.itadApiKey}
              title={settings?.itadApiKey ? undefined : '설정에서 IsThereAnyDeal API 키를 넣어야 합니다'}
              onClick={() => run('itad', async () => setItad(await window.api.fetchItadHistory(g.appid!)))}
            >
              {busy === 'itad' ? <Spinner /> : null}
              과거 할인 이력 불러오기
            </Button>
          )
        }
      >
        <div className="grid grid-cols-2 gap-x-6">
          <div>
            <div className="mb-1 text-[12px] font-semibold text-muted">한국 (원)</div>
            <Row label="정가">{price(g.priceKr, 'initial')}</Row>
            <Row label="현재가">
              <PriceLine p={g.priceKr} />
            </Row>
            <Row label="Steam 역대 최저가">
              <LowLine low={g.lowKr} fmt={won} />
            </Row>
            {g.lowKr && (
              <div className="text-right text-[11px] text-faint">
                {g.lowKr.source === 'estimate'
                  ? '미국 최대 할인율을 한국 정가에 적용'
                  : `${g.lowKr.date ? dateKo(g.lowKr.date) + ' · ' : ''}${g.lowKr.source === 'itad' ? 'IsThereAnyDeal' : '프로그램 기록'}`}
              </div>
            )}
          </div>
          <div>
            <div className="mb-1 text-[12px] font-semibold text-muted">미국 (달러)</div>
            <Row label="정가">{usd(g.priceUs?.initial)}</Row>
            <Row label="현재가">
              <PriceLine p={g.priceUs} />
            </Row>
            <Row label="Steam 역대 최저가">
              <LowLine low={g.lowUs} fmt={usd} />
            </Row>
            {ratio != null && (
              <div className="text-right text-[11px] text-faint">
                한국 정가가 미국의 {(ratio * 100).toFixed(0)}% 수준 (환율 {settings?.usdKrwRate.toLocaleString()}원)
              </div>
            )}
          </div>
        </div>
        <div className="mt-3">
          <VerdictBadge p={g.priceKr} low={g.lowKr} />
        </div>
        <div className="mt-4">
          <StepChart
            height={150}
            format={won}
            series={[{ name: '한국 가격', color: 'var(--chart-1)', points: historyKr.map((p) => ({ t: p.t, v: p.final })) }]}
            markers={[
              ...(g.lowKr ? [{ v: g.lowKr.amount, label: '역대 최저', color: 'var(--good)' }] : []),
              ...(g.purchasePrice != null ? [{ v: g.purchasePrice, label: '내 구매가', color: 'var(--chart-4)' }] : [])
            ]}
          />
          {!itad && (
            <p className="mt-2 text-[12px] text-faint">설치 이후 프로그램이 기록한 가격입니다. 과거 이력은 위 버튼으로 불러올 수 있습니다.</p>
          )}
        </div>
      </Section>

      {detail && detail.dlcs.length > 0 && <DlcSection dlcs={detail.dlcs} onChanged={async () => setDetail(await window.api.getGameDetail(g.key))} />}

      <Section
        title="엔딩까지"
        action={
          <Button size="sm" variant="ghost" disabled={busy === 'hltb'} onClick={() => run('hltb', async () => {
            const h = await window.api.lookupHltb(g.key)
            if (!h?.main) toast('HowLongToBeat에서 엔딩 시간을 찾지 못했습니다. 직접 입력해 주세요.')
          })}>
            {busy === 'hltb' ? <Spinner /> : null}
            평균 엔딩 시간 찾기
          </Button>
        }
      >
        {g.hltb ? (
          <div className="space-y-0.5">
            <Row label="메인 스토리">{hoursFromH(g.hltb.main)}</Row>
            <Row label="메인 + 추가 요소">{hoursFromH(g.hltb.extra)}</Row>
            <Row label="완벽 클리어">{hoursFromH(g.hltb.complete)}</Row>
            <div className="text-right text-[11px] text-faint">
              {g.hltb.source === 'manual' ? '메인 스토리 시간 직접 입력' : `HowLongToBeat · ${g.hltb.matchedName ?? ''}`}
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-muted">엔딩 시간 정보가 없습니다. 찾기 버튼을 누르거나 아래에 직접 입력하세요.</p>
        )}
        {rem && (
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-[13px]">
              <span className="text-muted">진행도 (플레이타임 기준)</span>
              <span className="num font-semibold text-ink">
                {rem.remaining > 0 ? `약 ${hoursFromH(rem.remaining)} 남음` : '평균 엔딩 시간 도달'}
              </span>
            </div>
            <Progress value={rem.progress} />
          </div>
        )}
        <label className="mt-3 flex items-center gap-2 text-[13px]">
          <span className="text-muted">메인 스토리 시간 직접 입력</span>
          <Input
            className="num w-24"
            inputMode="decimal"
            placeholder="시간"
            value={manualMain}
            onChange={(e) => setManualMain(e.target.value.replace(/[^\d.]/g, ''))}
            onBlur={() => {
              const v = manualMain === '' ? null : Number(manualMain)
              void updateGame(g.key, { hltbMainManual: v != null && Number.isFinite(v) ? v : null })
            }}
          />
          <span className="text-faint">비우면 찾은 값 사용</span>
        </label>
      </Section>

      <Section title="메모 · 평점">
        <div className="mb-3 flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-label={`${n}점`}
              onClick={() => void updateGame(g.key, { rating: g.rating === n ? null : n })}
              className={cn('text-xl', (g.rating ?? 0) >= n ? 'text-sale' : 'text-line-strong hover:text-faint')}
            >
              <LuStar fill={(g.rating ?? 0) >= n ? 'currentColor' : 'none'} />
            </button>
          ))}
        </div>
        <textarea
          className="min-h-20 w-full rounded-lg border border-line bg-surface p-3 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none"
          placeholder="이 게임에 대한 메모"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== g.notes && void updateGame(g.key, { notes })}
        />
      </Section>

      <Section
        title={`도전과제${detail?.achievements.length ? ` · ${achieved.length}/${detail.achievements.length}` : ''}`}
        action={
          detail && detail.achievements.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy === 'pct'}
              onClick={() => run('pct', async () => setDetail(await window.api.loadGlobalAchievementPct(g.key)))}
            >
              {busy === 'pct' ? <Spinner /> : null}
              전체 유저 달성률
            </Button>
          )
        }
      >
        {!detail ? (
          <Spinner />
        ) : detail.achievements.length === 0 ? (
          <p className="text-[13px] text-muted">도전과제가 없거나 아직 동기화하지 않았습니다.</p>
        ) : (
          <ul className="space-y-1.5">
            {[...achieved, ...locked].slice(0, 200).map((a) => (
              <li key={a.apiname} className={cn('flex items-center gap-3 rounded-lg px-1 py-1', !a.achieved && 'opacity-55')}>
                {a.icon ? (
                  <img src={a.achieved ? a.icon : a.iconGray || a.icon} alt="" className="h-9 w-9 shrink-0 rounded-md" loading="lazy" />
                ) : (
                  <div className="h-9 w-9 shrink-0 rounded-md bg-surface-2" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-ink">{a.name}</div>
                  {a.description && <div className="truncate text-[12px] text-muted">{a.description}</div>}
                </div>
                <div className="num shrink-0 text-right text-[12px]">
                  {a.achieved && a.unlockTime && <div className="text-muted">{dateKo(a.unlockTime * 1000)}</div>}
                  {a.globalPct != null && <div className={cn(a.globalPct < 5 ? 'text-sale' : 'text-faint')}>{a.globalPct.toFixed(1)}%</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {detail && detail.sessions.length > 0 && (
        <Section title="플레이 기록">
          <ul className="space-y-1">
            {detail.sessions.slice(0, 20).map((s) => (
              <li key={s.id} className="flex justify-between text-[13px]">
                <span className="text-muted">{new Date(s.startedAt).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                <span className="num text-ink">{s.endedAt ? duration(s.endedAt - s.startedAt) : '플레이 중'}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <div className="h-8" />
    </>
  )
}

function DlcSection({ dlcs, onChanged }: { dlcs: DlcRow[]; onChanged(): Promise<void> }) {
  const { reload, toast } = useStore()
  const [showAll, setShowAll] = useState(false)
  const owned = dlcs.filter((d) => d.owned)
  const list = showAll ? dlcs : [...owned, ...dlcs.filter((d) => !d.owned)].slice(0, 12)
  const ownedValue = owned.reduce((a, d) => a + (d.priceKr?.initial ?? 0), 0)
  const toggle = async (d: DlcRow) => {
    try {
      await window.api.setDlcOwned(d.appid, !d.owned)
      await Promise.all([onChanged(), reload()])
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  return (
    <Section
      title={`DLC · 보유 ${owned.length}/${dlcs.length}`}
      action={owned.length > 0 ? <span className="num text-[12px] text-muted">보유 DLC 정가 {won(ownedValue)}</span> : undefined}
    >
      <p className="mb-2 text-[12px] text-faint">
        Steam API로는 DLC 보유 여부를 알 수 없어서, 구매 내역·라이선스를 가져오면 자동으로 표시되고 직접 체크할 수도 있습니다.
      </p>
      <ul className="divide-y divide-line">
        {list.map((d) => (
          <DlcItem key={d.appid} d={d} onToggle={() => void toggle(d)} onSaved={onChanged} />
        ))}
      </ul>
      {dlcs.length > list.length && (
        <button type="button" className="mt-2 text-[13px] text-brand underline" onClick={() => setShowAll(true)}>
          DLC {dlcs.length - list.length}개 더 보기
        </button>
      )}
    </Section>
  )
}

function DlcItem({ d, onToggle, onSaved }: { d: DlcRow; onToggle(): void; onSaved(): Promise<void> }) {
  const { reload } = useStore()
  const [price, setPrice] = useState(d.purchasePrice != null ? String(d.purchasePrice) : '')
  return (
    <li className="flex items-center gap-3 py-2">
      <input type="checkbox" className="h-4 w-4 accent-[var(--brand)]" checked={d.owned} onChange={onToggle} aria-label="보유" />
      <Cover src={d.headerImage} alt="" className="h-10 w-[86px] shrink-0 rounded-md" />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className="block max-w-full truncate text-left text-[13px] font-medium text-ink hover:underline"
          onClick={() => void window.api.openExternal(`https://store.steampowered.com/app/${d.appid}/`)}
        >
          {d.name}
        </button>
        <div className="flex flex-wrap items-center gap-x-2 text-[12px]">
          {d.isFree ? <span className="text-faint">무료</span> : <PriceLine p={d.priceKr} className="text-[12px]" />}
          {!d.isFree && d.lowKr && d.lowKr.cut > 0 && (
            <span className="text-faint">
              역대 최저 <LowLine low={d.lowKr} fmt={won} className="text-[12px]" />
            </span>
          )}
          <ReviewBadge review={d.review} compact />
        </div>
      </div>
      {d.owned && !d.isFree && (
        <Input
          className="num h-8 w-28 text-right text-[13px]"
          inputMode="numeric"
          placeholder="구매가"
          value={price ? Number(price).toLocaleString('ko-KR') : ''}
          onChange={(e) => setPrice(String(parseWon(e.target.value) ?? ''))}
          onBlur={async () => {
            const v = price === '' ? null : Number(price)
            if (v === d.purchasePrice) return
            await window.api.updateUserData(d.key, { purchasePrice: v })
            await Promise.all([onSaved(), reload()])
          }}
        />
      )}
    </li>
  )
}
