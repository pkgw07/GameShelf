import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { excludeReason, type ExcludeReason } from '@shared/analytics'
import type { DlcRow, GameRow, NowPlaying, ProfileInfo, Settings, SyncState, UpdateState, UserDataPatch, WishlistRow } from '@shared/types'
import type { PricedItem } from '@shared/analytics'

export type Page =
  | 'dashboard'
  | 'library'
  | 'backlog'
  | 'money'
  | 'purchases'
  | 'deals'
  | 'search'
  | 'recommend'
  | 'achievements'
  | 'activity'
  | 'yearly'
  | 'settings'

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'error'
}

interface Store {
  ready: boolean
  page: Page
  go(p: Page): void
  settings: Settings | null
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  profile: ProfileInfo | null
  setProfile(p: ProfileInfo | null): void
  games: GameRow[]
  /** 통계에 포함되는 게임 (제외 규칙 적용) */
  included: GameRow[]
  excludeOf(g: GameRow): ExcludeReason | null
  wishlist: WishlistRow[]
  dlcs: DlcRow[]
  /** 가격 총합에 쓰는 항목: 통계 포함 게임 + (설정 시) 보유 DLC */
  priced: PricedItem[]
  ownedDlcs: DlcRow[]
  sync: SyncState | null
  nowPlaying: NowPlaying | null
  update: UpdateState | null
  reload(): Promise<void>
  updateGame(key: string, patch: UserDataPatch): Promise<void>
  openGame(key: string | null): void
  openKey: string | null
  dark: boolean
  toast(text: string, tone?: Toast['tone']): void
  toasts: Toast[]
}

const Ctx = createContext<Store | null>(null)

export function useStore(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('StoreProvider 밖에서 사용할 수 없습니다.')
  return s
}

function useSystemDark(): boolean {
  const mq = useMemo(() => window.matchMedia('(prefers-color-scheme: dark)'), [])
  const [dark, setDark] = useState(mq.matches)
  useEffect(() => {
    const fn = () => setDark(mq.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [mq])
  return dark
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const api = window.api
  const [ready, setReady] = useState(false)
  const [page, setPage] = useState<Page>('dashboard')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [profile, setProfile] = useState<ProfileInfo | null>(null)
  const [games, setGames] = useState<GameRow[]>([])
  const [wishlist, setWishlist] = useState<WishlistRow[]>([])
  const [dlcs, setDlcs] = useState<DlcRow[]>([])
  const [sync, setSync] = useState<SyncState | null>(null)
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)
  const systemDark = useSystemDark()

  const toast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = ++toastId.current
    setToasts((t) => [...t, { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3200)
  }, [])

  const reload = useCallback(async () => {
    const [g, w, d] = await Promise.all([api.getLibrary(), api.getWishlist(), api.getDlcs()])
    setGames(g)
    setWishlist(w)
    setDlcs(d)
  }, [api])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [s, st, np, up] = await Promise.all([api.getSettings(), api.getSyncState(), api.getNowPlaying(), api.getUpdateState()])
      if (!alive) return
      setUpdate(up)
      setSettings(s)
      setSync(st)
      setNowPlaying(np)
      await reload()
      setReady(true)
      if (!s.steamApiKey || !s.steamId) setPage('settings')
      api.getProfile().then((p) => alive && setProfile(p))
    })()
    const offs = [
      api.onSyncState((s) => setSync(s)),
      api.onNowPlaying((n) => setNowPlaying(n)),
      api.onDataChanged(() => void reload()),
      api.onUpdateState((u) => setUpdate(u))
    ]
    return () => {
      alive = false
      offs.forEach((f) => f())
    }
  }, [api, reload])

  // 동기화 오류는 알림으로도 띄운다
  const lastErr = useRef<string | null>(null)
  useEffect(() => {
    if (sync?.error && sync.error !== lastErr.current) toast(sync.error, 'error')
    lastErr.current = sync?.error ?? null
  }, [sync?.error, toast])

  const dark = settings?.theme === 'dark' || (settings?.theme !== 'light' && systemDark)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  const saveSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const next = await api.saveSettings(patch)
      setSettings(next)
      return next
    },
    [api]
  )

  const updateGame = useCallback(
    async (key: string, patch: UserDataPatch) => {
      const row = await api.updateUserData(key, patch)
      if (row) setGames((gs) => gs.map((g) => (g.key === key ? row : g)))
    },
    [api]
  )

  const excludeOf = useCallback((g: GameRow) => (settings ? excludeReason(g, settings) : null), [settings])
  const included = useMemo(() => games.filter((g) => !excludeOf(g)), [games, excludeOf])
  const ownedDlcs = useMemo(() => dlcs.filter((d) => d.owned), [dlcs])
  const priced = useMemo<PricedItem[]>(
    () => (settings?.includeDlcInTotals ? [...included, ...ownedDlcs] : included),
    [included, ownedDlcs, settings?.includeDlcInTotals]
  )

  const value: Store = {
    ready,
    page,
    go: setPage,
    settings,
    saveSettings,
    profile,
    setProfile,
    games,
    included,
    excludeOf,
    wishlist,
    dlcs,
    priced,
    ownedDlcs,
    sync,
    nowPlaying,
    update,
    reload,
    updateGame,
    openGame: setOpenKey,
    openKey,
    dark,
    toast,
    toasts
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
