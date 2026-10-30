import { useEffect } from 'react'
import { DEFAULT_SETTINGS, UI_SCALES } from '@shared/types'
import { GameDrawer } from './components/GameDrawer'
import { StoreDrawer } from './components/Inspection'
import { Sidebar, Toasts, UpdateBanner } from './components/Shell'
import { Spinner } from './components/ui'
import { StoreProvider, useStore } from './lib/store'
import { Achievements } from './pages/Achievements'
import { Activity } from './pages/Activity'
import { Backlog } from './pages/Backlog'
import { Yearly } from './pages/Yearly'
import { Dashboard } from './pages/Dashboard'
import { Deals } from './pages/Deals'
import { Library } from './pages/Library'
import { Money } from './pages/Money'
import { Purchases } from './pages/Purchases'
import { Recommend } from './pages/Recommend'
import { Search } from './pages/Search'
import { Settings } from './pages/Settings'

/** Ctrl + 휠 / Ctrl + = - 0 으로 글자 크기 바꾸기 (설정의 글자 크기와 같은 값) */
function useZoomKeys() {
  const { settings, saveSettings } = useStore()
  const scale = settings?.uiScale ?? DEFAULT_SETTINGS.uiScale
  useEffect(() => {
    const step = (dir: 1 | -1 | 0) => {
      let next = DEFAULT_SETTINGS.uiScale
      if (dir !== 0) {
        const i = UI_SCALES.findIndex((v) => v >= scale - 1e-6)
        const cur = i < 0 ? UI_SCALES.length - 1 : i
        next = UI_SCALES[Math.min(UI_SCALES.length - 1, Math.max(0, cur + dir))]
      }
      if (next !== scale) void saveSettings({ uiScale: next })
    }
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey) return
      if (e.key === '=' || e.key === '+') step(1)
      else if (e.key === '-') step(-1)
      else if (e.key === '0') step(0)
      else return
      e.preventDefault()
    }
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      step(e.deltaY < 0 ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
    }
  }, [scale, saveSettings])
}

function Main() {
  const { ready, page } = useStore()
  useZoomKeys()
  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-muted">
        <Spinner /> 불러오는 중
      </div>
    )
  }
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="relative min-w-0 flex-1 overflow-y-auto">
        <UpdateBanner />
        {page === 'dashboard' && <Dashboard />}
        {page === 'library' && <Library />}
        {page === 'backlog' && <Backlog />}
        {page === 'money' && <Money />}
        {page === 'purchases' && <Purchases />}
        {page === 'deals' && <Deals />}
        {page === 'search' && <Search />}
        {page === 'recommend' && <Recommend />}
        {page === 'achievements' && <Achievements />}
        {page === 'activity' && <Activity />}
        {page === 'yearly' && <Yearly />}
        {page === 'settings' && <Settings />}
      </main>
      <GameDrawer />
      <StoreDrawer />
      <Toasts />
    </div>
  )
}

export function App() {
  return (
    <StoreProvider>
      <Main />
    </StoreProvider>
  )
}
