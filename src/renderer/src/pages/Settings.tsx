import { useEffect, useState } from 'react'
import { LuCheck, LuLogIn, LuPlus, LuKeyRound, LuTrash2, LuDatabase, LuDownload, LuEye, LuEyeOff, LuFolderOpen, LuUpload } from 'react-icons/lu'
import { isGiveaway } from '@shared/analytics'
import { GENRES } from '@shared/genres'
import { DEFAULT_SETTINGS, UI_SCALES, type AppInfo, type PlatformStatus, type Settings as S } from '@shared/types'
import { PageBody, TopBar } from '@/components/Shell'
import { Badge, Button, Field, Input, Panel, Segmented, Spinner, Switch } from '@/components/ui'
import { ManualGameDialog } from '@/components/ManualGameDialog'
import { STORE_LOGIN_NOTE, StoreLoginRow, useSteamImport } from '@/components/SteamConnect'
import { cn } from '@/lib/cn'
import { relative } from '@/lib/format'
import { useStore } from '@/lib/store'

function SecretInput({ value, onSave, placeholder }: { value: string; onSave(v: string): void; placeholder: string }) {
  const [v, setV] = useState(value)
  const [show, setShow] = useState(false)
  useEffect(() => setV(value), [value])
  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <Input
          type={show ? 'text' : 'password'}
          className="w-full pr-10 font-mono"
          placeholder={placeholder}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onBlur={() => v !== value && onSave(v)}
        />
        <button
          type="button"
          className="absolute top-1/2 right-2 -translate-y-1/2 text-faint hover:text-ink"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? '숨기기' : '보기'}
        >
          {show ? <LuEyeOff /> : <LuEye />}
        </button>
      </div>
      {v !== value && (
        <Button variant="primary" onClick={() => onSave(v)}>
          저장
        </Button>
      )}
    </div>
  )
}

const ext = (url: string) => () => void window.api.openExternal(url)

export function Settings() {
  const { settings, saveSettings, profile, setProfile, toast, sync, games, update } = useStore()
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [account, setAccount] = useState(settings?.steamId ?? '')
  const [checking, setChecking] = useState(false)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [rate, setRate] = useState(String(settings?.usdKrwRate ?? 1400))
  const [minutes, setMinutes] = useState(String(settings?.unplayedMinutes ?? 30))
  const giveaways = games.filter(isGiveaway).length

  useEffect(() => {
    void window.api.getAppInfo().then(setInfo)
  }, [])
  useEffect(() => {
    if (settings) {
      setRate(String(settings.usdKrwRate))
      setMinutes(String(settings.unplayedMinutes))
    }
  }, [settings])

  if (!settings) return null
  const save = async (p: Partial<S>, msg?: string) => {
    try {
      await saveSettings(p)
      if (msg) toast(msg)
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const connect = async () => {
    if (!settings.steamApiKey) {
      toast('Steam API 키를 먼저 입력해 주세요.', 'error')
      return
    }
    setChecking(true)
    try {
      const p = await window.api.resolveSteamId(account)
      await saveSettings({ steamId: p.steamId })
      setAccount(p.steamId)
      setProfile(p)
      toast(`${p.personaName} 계정을 연결했습니다.`)
      if (!games.length) void window.api.startSync()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setChecking(false)
    }
  }

  const fileAction = async (fn: () => Promise<{ ok: boolean; message: string }>) => {
    const r = await fn()
    if (r.message !== '취소했습니다.') toast(r.message, r.ok ? 'info' : 'error')
  }

  const ready = Boolean(settings.steamApiKey && settings.steamId)

  return (
    <>
      <TopBar title="설정" />
      <PageBody narrow className="space-y-5">
        {!ready && (
          <div className="rounded-2xl border border-brand/30 bg-brand-soft px-5 py-4 text-[13px] text-ink">
            <b>처음 사용하시나요?</b> 아래 Steam 계정 항목에서 API 키를 넣고 계정을 연결하면 바로 동기화를 시작합니다.
          </div>
        )}

        <Panel title="Steam 계정">
          <div className="space-y-4">
            <Field
              label="Steam Web API 키"
              hint={
                <>
                  <button type="button" className="text-brand underline" onClick={ext('https://steamcommunity.com/dev/apikey')}>
                    steamcommunity.com/dev/apikey
                  </button>
                  에서 발급받을 수 있습니다. 도메인 칸에는 아무 이름(예: localhost)이나 넣으면 됩니다. 키는 이 컴퓨터에 암호화해서 저장합니다.
                </>
              }
            >
              <SecretInput value={settings.steamApiKey} placeholder="32자리 키" onSave={(v) => void save({ steamApiKey: v }, 'Steam API 키를 저장했습니다.')} />
            </Field>
            <Field label="계정" hint="SteamID64(17자리 숫자), 프로필 주소, 또는 커스텀 URL 이름을 넣으세요.">
              <div className="flex gap-2">
                <Input
                  className="flex-1"
                  placeholder="예: https://steamcommunity.com/id/내아이디"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void connect()}
                />
                <Button variant="primary" disabled={checking || !account.trim()} onClick={() => void connect()}>
                  {checking ? <Spinner className="border-t-brand-ink" /> : <LuCheck />}
                  연결
                </Button>
              </div>
            </Field>
            {profile && (
              <div className="flex items-center gap-3 rounded-xl bg-surface-2 p-3">
                {profile.avatar ? <img src={profile.avatar} alt="" className="h-10 w-10 rounded-full" /> : <div className="h-10 w-10 rounded-full bg-surface" />}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-ink">{profile.personaName}</div>
                  <div className="text-[12px] text-faint">{profile.steamId}</div>
                </div>
                <Badge tone="brand">연결됨</Badge>
              </div>
            )}
            <p className="text-[12px] text-faint">
              Steam 프로필 → 프로필 편집 → 개인정보 설정에서 "게임 세부 정보"를 공개로 해야 게임 목록과 플레이타임을 불러올 수 있습니다. 위시리스트도 공개여야 불러옵니다.
            </p>
          </div>
        </Panel>

        <StoreLoginPanel />

        <PlatformsPanel />

        <Panel title="가격 데이터">
          <div className="space-y-4">
            <Field
              label="IsThereAnyDeal API 키 (선택)"
              hint={
                <>
                  Steam 역대 최저가와 과거 할인 이력에 사용합니다.{' '}
                  <button type="button" className="text-brand underline" onClick={ext('https://isthereanydeal.com/apps/my/')}>
                    isthereanydeal.com/apps/my
                  </button>
                  에서 앱을 등록하면 무료로 받을 수 있습니다. 없으면 설치 이후 프로그램이 기록한 가격만으로 최저가를 계산합니다.
                </>
              }
            >
              <SecretInput value={settings.itadApiKey} placeholder="API 키" onSave={(v) => void save({ itadApiKey: v }, 'IsThereAnyDeal 키를 저장했습니다. 다음 동기화부터 반영됩니다.')} />
            </Field>
            <Field label="한국/미국 가격 비교용 환율" hint="가격 총합에는 쓰지 않고, 게임별 한국 정가와 미국 정가를 비교할 때만 씁니다.">
              <div className="flex items-center gap-2 text-[13px] text-muted">
                1달러 =
                <Input
                  className="num w-28 text-right"
                  inputMode="numeric"
                  value={rate}
                  onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))}
                  onBlur={() => Number(rate) !== settings.usdKrwRate && void save({ usdKrwRate: Number(rate) })}
                />
                원
              </div>
            </Field>
          </div>
        </Panel>

        <Panel title="라이브러리 분석">
          <Field label="안 한 게임 기준" hint="이 시간보다 적게 플레이한 게임을 '샀는데 안 한 게임'으로 봅니다. 0으로 하면 한 번도 실행하지 않은 게임만 해당합니다.">
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <Input
                className="num w-24 text-right"
                inputMode="numeric"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))}
                onBlur={() => Number(minutes || 0) !== settings.unplayedMinutes && void save({ unplayedMinutes: Number(minutes || 0) })}
              />
              분 미만
            </div>
          </Field>
          <div className="mt-4 divide-y divide-line">
            <Switch
              checked={settings.excludeFree}
              onChange={(v) => void save({ excludeFree: v })}
              label="무료 게임을 통계에서 제외"
              hint="가격 총합, 안 한 게임 수, 추천 분석에서 빠집니다."
            />
            <Switch
              checked={settings.excludeGiveaway}
              onChange={(v) => void save({ excludeGiveaway: v })}
              label={`무료 배포로 받은 게임을 통계에서 제외${giveaways ? ` (${giveaways}개)` : ''}`}
              hint="Steam 역대 최저가가 0원인 유료 게임입니다. 구매 기록 입력 목록에서도 빠집니다. 돈을 내고 산 게임이라면 구매가를 넣으면 다시 포함됩니다."
            />
            <Switch
              checked={settings.excludeUnplayed}
              onChange={(v) => void save({ excludeUnplayed: v })}
              label="안 한 게임을 통계에서 제외"
              hint="실제로 즐긴 게임만으로 가격과 플레이 통계를 보고 싶을 때 켜세요."
            />
            <Switch
              checked={settings.includeDlcInTotals}
              onChange={(v) => void save({ includeDlcInTotals: v })}
              label="가격 총합에 보유 DLC 포함"
              hint="보유로 표시한 DLC의 정가·현재가·역대 최저가·구매가를 총합에 더합니다."
            />
            <Switch
              checked={settings.autoStatus}
              onChange={(v) => void save({ autoStatus: v })}
              label="상태 태그 자동 제안"
              hint="도전과제 100%면 '100%', 최근 2주 안에 플레이했으면 '플레이 중'을 붙입니다. 직접 고른 태그는 바꾸지 않습니다."
            />
          </div>
          <div className="mt-4">
            <div className="mb-2 text-[13px] font-medium text-muted">통계에서 제외할 장르</div>
            <div className="flex flex-wrap gap-1.5">
              {GENRES.map((g) => {
                const on = settings.excludedGenres.includes(g.id)
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() =>
                      void save({ excludedGenres: on ? settings.excludedGenres.filter((x) => x !== g.id) : [...settings.excludedGenres, g.id] })
                    }
                    className={cn(
                      'h-8 rounded-full px-3 text-[13px] ring-1',
                      on ? 'bg-bad-soft text-bad ring-bad/30' : 'text-muted ring-line hover:text-ink'
                    )}
                  >
                    {g.ko}
                  </button>
                )
              })}
            </div>
            <p className="mt-2 text-[12px] text-faint">게임마다 개별로 제외하려면 라이브러리에서 게임을 열어 "통계에서 제외"를 켜세요.</p>
          </div>
        </Panel>

        <Panel title="알림" action={<Button size="sm" variant="ghost" onClick={() => void window.api.testNotification()}>알림 테스트</Button>}>
          <div className="divide-y divide-line">
            <Switch
              checked={settings.notifyTargetPrice}
              onChange={(v) => void save({ notifyTargetPrice: v })}
              label="위시리스트 목표가 도달 알림"
              hint="할인·위시리스트 화면에서 게임마다 목표가를 정하면, 그 가격 이하가 됐을 때 Windows 알림을 띄웁니다."
            />
            <Switch
              checked={settings.notifyHistoricalLow}
              onChange={(v) => void save({ notifyHistoricalLow: v })}
              label="위시리스트 역대 최저가 알림"
              hint="위시리스트 게임이 역대 최대 할인율 이상으로 할인하면 알립니다. 같은 가격으로는 한 번만 알립니다."
            />
          </div>
          <p className="mt-2 text-[12px] text-faint">가격 확인은 하루 한 번 자동 기록 때와 동기화할 때 이뤄집니다. 트레이에 두면 창을 닫아도 알림을 받을 수 있습니다.</p>
        </Panel>

        <Panel title="화면">
          <div className="flex items-center justify-between">
            <span className="text-sm text-ink">테마</span>
            <Segmented<S['theme']>
              value={settings.theme}
              onChange={(v) => void save({ theme: v })}
              options={[
                { value: 'system', label: '시스템 설정' },
                { value: 'light', label: '라이트' },
                { value: 'dark', label: '다크' }
              ]}
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-ink">
              글자 크기
              <span className="ml-2 text-[12px] text-faint">Ctrl + 마우스 휠, Ctrl + / - / 0 으로도 바꿀 수 있습니다</span>
            </span>
            <Segmented<string>
              value={String(settings.uiScale)}
              onChange={(v) => void save({ uiScale: Number(v) })}
              options={UI_SCALES.map((v) => ({ value: String(v), label: v === DEFAULT_SETTINGS.uiScale ? `${Math.round(v * 100)}% (기본)` : `${Math.round(v * 100)}%` }))}
            />
          </div>
        </Panel>

        <Panel title="백그라운드 실행">
          <div className="divide-y divide-line">
            <Switch
              checked={settings.minimizeToTray}
              onChange={(v) => void save({ minimizeToTray: v })}
              label="창을 닫으면 트레이로 숨기기"
              hint="트레이에 있는 동안 하루 한 번 가격과 플레이타임을 자동으로 기록합니다. 완전히 끄려면 트레이 아이콘에서 '종료'를 누르세요."
            />
            <Switch
              checked={settings.launchAtLogin}
              onChange={(v) => void save({ launchAtLogin: v })}
              label="컴퓨터를 켤 때 자동 실행"
              hint="창 없이 트레이로 시작합니다. 자동 기록을 빠뜨리지 않으려면 켜 두세요."
            />
            <Switch
              checked={settings.nowPlaying}
              onChange={(v) => void save({ nowPlaying: v })}
              label="플레이 중인 게임 감지"
              hint="Steam이 기록하는 실행 중인 게임 정보를 30초마다 확인합니다(Windows). 네트워크를 쓰지 않고 CPU 사용도 거의 없습니다. 게임을 끄면 플레이타임과 도전과제를 자동으로 갱신합니다."
            />
          </div>
        </Panel>

        <Panel title="데이터">
          <div className="flex flex-wrap gap-2">
            <Button icon={<LuDatabase />} onClick={() => void fileAction(window.api.backup)}>
              백업 파일 만들기
            </Button>
            <Button icon={<LuUpload />} onClick={() => void fileAction(window.api.restore)}>
              백업에서 복원
            </Button>
            <Button icon={<LuDownload />} onClick={() => void fileAction(window.api.exportCsv)}>
              CSV로 내보내기
            </Button>
            <Button variant="ghost" icon={<LuFolderOpen />} onClick={() => void window.api.openDataFolder()}>
              데이터 폴더 열기
            </Button>
          </div>
          <p className="mt-3 text-[12px] text-faint">
            백업에는 직접 입력한 구매가, 메모, 상태 태그, 가격·플레이 기록이 모두 들어 있습니다. 복원하면 현재 데이터는 데이터 폴더에 따로 한 번 더 남겨 둡니다.
          </p>
          <dl className="mt-4 grid grid-cols-[140px_1fr] gap-y-1 text-[13px]">
            <dt className="text-muted">마지막 동기화</dt>
            <dd className="text-ink">{sync?.lastFinishedAt ? `${new Date(sync.lastFinishedAt).toLocaleString('ko-KR')} (${relative(sync.lastFinishedAt)})` : '아직 없음'}</dd>
            <dt className="text-muted">버전</dt>
            <dd className="text-ink">GameShelf {info?.version}</dd>
            <dt className="text-muted">저장 위치</dt>
            <dd className="truncate text-ink">{info?.dataPath}</dd>
            <dt className="text-muted">DB 드라이버</dt>
            <dd className="text-ink">{info?.dbDriver}</dd>
          </dl>
          {sync && sync.warnings.length > 0 && (
            <details className="mt-3 text-[12px]">
              <summary className="cursor-pointer text-sale">지난 동기화 경고 {sync.warnings.length}건</summary>
              <ul className="mt-2 space-y-0.5 text-muted">
                {sync.warnings.slice(0, 30).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}
        </Panel>

        <Panel title="업데이트">
          <div className="flex items-center gap-3">
            <div className="flex-1 text-[13px]">
              <div className="text-ink">
                지금 버전 <b>{update?.currentVersion ?? info?.version}</b>
              </div>
              <div className="text-muted">
                {update?.status === 'disabled' && '개발 모드에서는 업데이트를 확인하지 않습니다. 설치한 프로그램에서 동작합니다.'}
                {update?.status === 'idle' && '프로그램을 켤 때와 6시간마다 새 버전을 확인합니다.'}
                {update?.status === 'checking' && '확인 중…'}
                {update?.status === 'not-available' && `최신 버전입니다.${update.checkedAt ? ` (${relative(update.checkedAt)} 확인)` : ''}`}
                {update?.status === 'available' && `새 버전 ${update.version}이 있습니다. 화면 위 알림에서 받을 수 있습니다.`}
                {update?.status === 'downloading' && `새 버전 받는 중 ${update.percent ?? 0}%`}
                {update?.status === 'downloaded' && `새 버전 ${update.version}이 준비됐습니다. 다시 시작하면 설치됩니다.`}
                {update?.status === 'error' && `확인하지 못했습니다: ${update.error}`}
              </div>
            </div>
            <Button
              disabled={checkingUpdate || update?.status === 'disabled' || update?.status === 'downloading'}
              onClick={async () => {
                setCheckingUpdate(true)
                try {
                  await window.api.checkForUpdates()
                } finally {
                  setCheckingUpdate(false)
                }
              }}
            >
              {checkingUpdate ? <Spinner /> : null}
              업데이트 확인
            </Button>
          </div>
        </Panel>

        <ResetPanel />

        <Panel title="데이터 출처">
          <ul className="space-y-1 text-[13px] text-muted">
            <li>게임 목록·플레이타임·도전과제·가격: Steam Web API, Steam 상점</li>
            <li>
              Steam 역대 최저가·할인 이력:{' '}
              <button type="button" className="text-brand underline" onClick={ext('https://isthereanydeal.com/')}>
                IsThereAnyDeal
              </button>
            </li>
            <li>평균 엔딩 시간: HowLongToBeat (비공식 조회, 실패하면 직접 입력)</li>
            <li>추천 후보: SteamSpy</li>
          </ul>
          <p className="mt-2 text-[12px] text-faint">GameShelf는 Valve, IsThereAnyDeal, HowLongToBeat와 관계없는 개인용 프로그램입니다.</p>
        </Panel>
      </PageBody>
    </>
  )
}

function StoreLoginPanel() {
  const imp = useSteamImport()
  return (
    <Panel title="Steam 로그인 (선택)">
      <div className="space-y-3">
        <p className="text-[13px] text-muted">
          로그인해 두면 <b className="text-ink">보유 DLC</b>를 동기화할 때마다 자동으로 확인하고, 구매 기록·가격·지출 화면에서 <b className="text-ink">구매 내역·라이선스</b>를 버튼 하나로
          불러올 수 있습니다. Steam API 키만으로는 이 정보를 받을 수 없습니다.
        </p>
        <StoreLoginRow imp={imp} />
        {imp.step && <p className="text-[13px] text-muted">{imp.step}</p>}
        <p className="text-[12px] text-faint">{STORE_LOGIN_NOTE}</p>
      </div>
    </Panel>
  )
}

function ResetPanel() {
  const { toast } = useStore()
  const [confirm, setConfirm] = useState<'accounts' | 'all' | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async (scope: 'accounts' | 'all') => {
    setBusy(true)
    try {
      const r = await window.api.factoryReset(scope)
      toast(r.message)
      // 설정·프로필을 처음부터 다시 읽는다 (전체 초기화는 프로그램이 다시 시작됨)
      if (scope === 'accounts') setTimeout(() => window.location.reload(), 800)
    } catch (e) {
      toast((e as Error).message, 'error')
      setBusy(false)
    }
  }
  return (
    <Panel title="초기화">
      <div className="space-y-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="danger" icon={<LuKeyRound />} disabled={busy} onClick={() => setConfirm('accounts')}>
            계정 정보만 지우기
          </Button>
          <span className="text-muted">Steam API 키, Steam 계정 연결, IsThereAnyDeal 키, Steam 로그인을 지웁니다. 게임·가격·구매 기록은 남습니다.</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="danger" icon={<LuTrash2 />} disabled={busy} onClick={() => setConfirm('all')}>
            전체 초기화
          </Button>
          <span className="text-muted">위 계정 정보와 모든 데이터(게임, 가격 이력, 구매 기록, 태그, 메모, 설정)를 지우고 처음 상태로 다시 시작합니다.</span>
        </div>
        {confirm && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-bad/30 bg-bad-soft px-4 py-3">
            <span className="text-ink">
              {confirm === 'all'
                ? '모든 데이터를 지우고 프로그램을 다시 시작합니다. 지우기 직전 데이터는 데이터 폴더의 backups에 백업해 둡니다.'
                : 'API 키와 계정 연결, Steam 로그인을 지웁니다.'}{' '}
              계속할까요?
            </span>
            <Button variant="danger" disabled={busy} onClick={() => void run(confirm)}>
              {busy ? <Spinner /> : null}
              지우기
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirm(null)}>
              취소
            </Button>
          </div>
        )}
      </div>
    </Panel>
  )
}

function PlatformsPanel() {
  const { toast } = useStore()
  const [st, setSt] = useState<PlatformStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const [adding, setAdding] = useState(false)
  useEffect(() => {
    void window.api.getPlatformStatus().then(setSt)
  }, [])
  const act = async (label: string, fn: () => Promise<PlatformStatus>, ok?: (s: PlatformStatus) => string | null) => {
    setBusy(label)
    try {
      const r = await fn()
      setSt(r)
      const msg = ok?.(r)
      if (msg) {
        toast(msg)
        void window.api.startSync()
      }
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }
  const ext = (url: string) => () => void window.api.openExternal(url)
  if (!st) return null
  return (
    <Panel title="다른 플랫폼">
      <div className="divide-y divide-line text-[13px]">
        <div className="pb-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="w-24 font-semibold text-ink">PlayStation</span>
            {st.psn.connected ? (
              <>
                <Badge tone="brand">연결됨</Badge>
                <span className="text-muted">{st.psn.account}</span>
                <Button size="sm" variant="ghost" className="ml-auto" disabled={busy != null} onClick={() => void act('psn', window.api.psnLogout)}>
                  연결 끊기
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                className="ml-auto"
                icon={busy === 'psn' ? <Spinner /> : <LuLogIn />}
                disabled={busy != null}
                onClick={() => void act('psn', window.api.psnLogin, (r) => (r.psn.connected ? 'PlayStation을 연결했습니다. 동기화를 시작합니다.' : null))}
              >
                PlayStation 로그인
              </Button>
            )}
          </div>
          <p className="mt-1.5 text-[12px] text-faint">
            PS4·PS5 플레이타임과 트로피(PS3·Vita 포함)를 가져옵니다. 열린 창에서 Sony 계정으로 로그인하면 자동으로 닫힙니다. 비밀번호는 Sony 페이지에만 입력되고, 프로그램은 로그인 유지용 토큰만 암호화해 저장합니다(약 2달마다 다시 로그인). PlayStation 앱과 같은 비공식 방식이라 Sony가 바꾸면 잠시 안 될 수 있습니다.
          </p>
        </div>
        <div className="py-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="w-24 font-semibold text-ink">Xbox</span>
            {st.xbox.connected ? (
              <>
                <Badge tone="brand">연결됨</Badge>
                <span className="text-muted">{st.xbox.account}</span>
                <Button size="sm" variant="ghost" className="ml-auto" disabled={busy != null} onClick={() => void act('xbox', window.api.xblDisconnect)}>
                  연결 끊기
                </Button>
              </>
            ) : (
              <>
                <Input className="min-w-0 flex-1" placeholder="OpenXBL API 키" value={key} onChange={(e) => setKey(e.target.value)} />
                <Button
                  size="sm"
                  icon={busy === 'xbox' ? <Spinner /> : <LuCheck />}
                  disabled={busy != null || !key.trim()}
                  onClick={() =>
                    void act('xbox', () => window.api.xblConnect(key), (r) => {
                      setKey('')
                      return `Xbox(${r.xbox.account})를 연결했습니다. 동기화를 시작합니다.`
                    })
                  }
                >
                  연결
                </Button>
              </>
            )}
          </div>
          <p className="mt-1.5 text-[12px] text-faint">
            <button type="button" className="text-brand underline" onClick={ext('https://xbl.io/')}>
              xbl.io
            </button>
            에서 Xbox 계정으로 로그인한 뒤 API 키를 만들어 넣으세요(무료). 플레이한 게임, 도전과제, 게이머스코어, 마지막 플레이 날짜를 가져옵니다. Xbox는 플레이타임을 공개하지 않아 시간은 비어 있습니다.
          </p>
        </div>
        <div className="pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="w-24 font-semibold text-ink">Switch · 기타</span>
            <Button size="sm" className="ml-auto" icon={<LuPlus />} onClick={() => setAdding(true)}>
              게임 직접 추가
            </Button>
          </div>
          <p className="mt-1.5 text-[12px] text-faint">
            Nintendo는 게임 목록을 가져올 수 있는 공개 방법이 없어 직접 추가합니다. 디스크 게임이나 다른 런처(Epic 등) 게임도 같은 방법으로 넣을 수 있고, 라이브러리의 "게임 추가" 버튼으로도 됩니다.
          </p>
          {adding && <ManualGameDialog onClose={() => setAdding(false)} />}
        </div>
      </div>
      <p className="mt-4 text-[12px] text-faint">
        연결한 플랫폼은 동기화할 때 함께 불러옵니다. 연결을 끊으면 그 플랫폼에서 받아 온 게임은 목록에서 빠지고, 입력한 구매가·메모·상태는 남아 있다가 다시 연결하면 돌아옵니다.
      </p>
    </Panel>
  )
}
