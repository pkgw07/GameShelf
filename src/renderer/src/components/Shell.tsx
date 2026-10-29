import { useEffect, useState, type ReactNode } from 'react'
import {
  LuChartColumn,
  LuDownload,
  LuGift,
  LuHourglass,
  LuTrophy,
  LuCompass,
  LuLayoutDashboard,
  LuLibrary,
  LuMoon,
  LuRefreshCw,
  LuSearch,
  LuSettings,
  LuSun,
  LuTag,
  LuWallet,
  LuX
} from 'react-icons/lu'
import { APP_VERSION } from '@shared/types'
import logo from '@/assets/logo.png'
import { cn } from '@/lib/cn'
import { duration, relative } from '@/lib/format'
import { useStore, type Page } from '@/lib/store'

const NAV: { page: Page; label: string; icon: ReactNode }[] = [
  { page: 'dashboard', label: '대시보드', icon: <LuLayoutDashboard /> },
  { page: 'library', label: '라이브러리', icon: <LuLibrary /> },
  { page: 'backlog', label: '백로그', icon: <LuHourglass /> },
  { page: 'money', label: '가격·지출', icon: <LuWallet /> },
  { page: 'deals', label: '할인·위시리스트', icon: <LuTag /> },
  { page: 'search', label: '게임 가격 검색', icon: <LuSearch /> },
  { page: 'recommend', label: '추천', icon: <LuCompass /> },
  { page: 'achievements', label: '도전과제', icon: <LuTrophy /> },
  { page: 'activity', label: '활동 기록', icon: <LuChartColumn /> },
  { page: 'yearly', label: '연말 결산', icon: <LuGift /> }
]

export function Sidebar() {
  const { page, go, profile, games, wishlist } = useStore()
  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-6">
        <img src={logo} alt="" className="h-9 w-9" />
        <div>
          <div className="text-[15px] leading-tight font-bold text-ink">GameShelf</div>
          <div className="text-[11px] leading-tight text-faint">게임 장부 · v{APP_VERSION}</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 px-3">
        {NAV.map((n) => (
          <button
            key={n.page}
            type="button"
            onClick={() => go(n.page)}
            className={cn(
              'flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors [&>svg]:h-[17px] [&>svg]:w-[17px]',
              page === n.page ? 'bg-brand-soft font-semibold text-brand' : 'text-muted hover:bg-surface-2 hover:text-ink'
            )}
          >
            {n.icon}
            <span className="flex-1 text-left">{n.label}</span>
            {n.page === 'library' && games.length > 0 && <span className="num text-[12px] text-faint">{games.length}</span>}
            {n.page === 'deals' && wishlist.length > 0 && <span className="num text-[12px] text-faint">{wishlist.length}</span>}
          </button>
        ))}
      </nav>
      <div className="space-y-0.5 border-t border-line px-3 py-3">
        <button
          type="button"
          onClick={() => go('settings')}
          className={cn(
            'flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm [&>svg]:h-[17px] [&>svg]:w-[17px]',
            page === 'settings' ? 'bg-brand-soft font-semibold text-brand' : 'text-muted hover:bg-surface-2 hover:text-ink'
          )}
        >
          <LuSettings />
          설정
        </button>
        {profile && (
          <div className="flex items-center gap-2.5 px-2.5 pt-2">
            {profile.avatar ? <img src={profile.avatar} alt="" className="h-7 w-7 rounded-full" /> : <div className="h-7 w-7 rounded-full bg-surface-2" />}
            <div className="min-w-0 text-[13px]">
              <div className="truncate font-medium text-ink">{profile.personaName}</div>
              <div className="text-[11px] text-faint">Steam 연결됨</div>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}

function useNow(ms: number) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

export function TopBar({ title, actions }: { title: string; actions?: ReactNode }) {
  const { sync, nowPlaying, settings, saveSettings, dark, openGame } = useStore()
  const now = useNow(30_000)
  const running = sync?.running
  return (
    <div className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-paper/90 px-8 backdrop-blur">
      <h1 className="text-xl font-bold text-ink">{title}</h1>
      <div className="flex-1" />
      {nowPlaying && (
        <button
          type="button"
          onClick={() => openGame(nowPlaying.key)}
          className="flex h-9 items-center gap-2 rounded-full border border-line bg-surface pr-3.5 pl-3 text-[13px] hover:bg-surface-2"
          title="지금 플레이 중인 게임"
        >
          <span className="pulse-dot h-2 w-2 rounded-full bg-good" />
          <span className="max-w-[220px] truncate font-medium text-ink">{nowPlaying.name}</span>
          <span className="num text-faint">{duration(now - nowPlaying.since)}</span>
        </button>
      )}
      {actions}
      <SyncButton />
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
        title={dark ? '라이트 모드로' : '다크 모드로'}
        onClick={() => settings && void saveSettings({ theme: dark ? 'light' : 'dark' })}
      >
        {dark ? <LuSun className="h-[18px] w-[18px]" /> : <LuMoon className="h-[18px] w-[18px]" />}
      </button>
      {running && sync && (
        <div className="absolute right-0 bottom-0 left-0 h-0.5 bg-transparent">
          <div
            className="h-full bg-brand transition-all"
            style={{ width: sync.total ? `${(sync.current / sync.total) * 100}%` : '30%' }}
          />
        </div>
      )}
    </div>
  )
}

function SyncButton() {
  const { sync } = useStore()
  if (sync?.running) {
    return (
      <div className="flex h-9 items-center gap-2 rounded-lg border border-line bg-surface pr-1 pl-3 text-[13px]">
        <LuRefreshCw className="h-4 w-4 animate-spin text-brand" />
        <span className="max-w-[260px] truncate text-ink">{sync.label}</span>
        {sync.total > 0 && (
          <span className="num text-faint">
            {sync.current}/{sync.total}
          </span>
        )}
        <button
          type="button"
          title="취소"
          className="ml-1 flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-2"
          onClick={() => void window.api.cancelSync()}
        >
          <LuX />
        </button>
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={() => void window.api.startSync()}
      className="flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[13px] text-ink hover:bg-surface-2"
      title={sync?.lastFinishedAt ? `마지막 동기화: ${new Date(sync.lastFinishedAt).toLocaleString('ko-KR')}` : undefined}
    >
      <LuRefreshCw className="h-4 w-4" />
      동기화
      {sync?.lastFinishedAt && <span className="text-faint">{relative(sync.lastFinishedAt)}</span>}
    </button>
  )
}

export function Toasts() {
  const { toasts } = useStore()
  return (
    <div className="pointer-events-none fixed right-6 bottom-6 z-50 flex flex-col items-end gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            'max-w-[420px] rounded-xl border px-4 py-2.5 text-[13px] shadow-lg',
            t.tone === 'error' ? 'border-bad/40 bg-bad-soft text-bad' : 'border-line bg-surface text-ink'
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}

export function PageBody({ children, className, narrow }: { children: ReactNode; className?: string; narrow?: boolean }) {
  return <div className={cn('mx-auto px-8 py-6', narrow ? 'max-w-[880px]' : 'max-w-[1280px]', className)}>{children}</div>
}


export function UpdateBanner() {
  const { update } = useStore()
  if (!update || !['available', 'downloading', 'downloaded'].includes(update.status)) return null
  return (
    <div className="flex items-center gap-3 border-b border-brand/30 bg-brand-soft px-8 py-2.5 text-[13px] text-ink">
      <LuDownload className="h-4 w-4 text-brand" />
      {update.status === 'available' && (
        <>
          <span>
            새 버전 <b>{update.version}</b>이 나왔습니다. (지금 {update.currentVersion})
          </span>
          <button type="button" className="ml-auto rounded-md bg-brand px-3 py-1 font-medium text-brand-ink hover:opacity-90" onClick={() => void window.api.downloadUpdate()}>
            업데이트 받기
          </button>
        </>
      )}
      {update.status === 'downloading' && (
        <>
          <span>새 버전 {update.version} 받는 중</span>
          <div className="ml-auto h-1.5 w-48 overflow-hidden rounded-full bg-surface">
            <div className="h-full bg-brand" style={{ width: `${update.percent ?? 0}%` }} />
          </div>
          <span className="num w-10 text-right text-muted">{update.percent ?? 0}%</span>
        </>
      )}
      {update.status === 'downloaded' && (
        <>
          <span>
            새 버전 <b>{update.version}</b> 준비 완료. 다시 시작하면 설치됩니다. 지금 안 하면 프로그램을 끌 때 설치됩니다.
          </span>
          <button type="button" className="ml-auto rounded-md bg-brand px-3 py-1 font-medium text-brand-ink hover:opacity-90" onClick={() => void window.api.installUpdate()}>
            다시 시작해서 설치
          </button>
        </>
      )}
    </div>
  )
}
