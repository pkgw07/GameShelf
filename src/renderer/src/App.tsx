import { GameDrawer } from './components/GameDrawer'
import { Sidebar, Toasts, UpdateBanner } from './components/Shell'
import { Spinner } from './components/ui'
import { StoreProvider, useStore } from './lib/store'
import { Activity } from './pages/Activity'
import { Dashboard } from './pages/Dashboard'
import { Deals } from './pages/Deals'
import { Library } from './pages/Library'
import { Money } from './pages/Money'
import { Recommend } from './pages/Recommend'
import { Search } from './pages/Search'
import { Settings } from './pages/Settings'

function Main() {
  const { ready, page } = useStore()
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
        {page === 'money' && <Money />}
        {page === 'deals' && <Deals />}
        {page === 'search' && <Search />}
        {page === 'recommend' && <Recommend />}
        {page === 'activity' && <Activity />}
        {page === 'settings' && <Settings />}
      </main>
      <GameDrawer />
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
