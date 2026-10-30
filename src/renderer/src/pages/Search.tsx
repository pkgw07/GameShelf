import { useState } from 'react'
import { LuSearch } from 'react-icons/lu'
import type { PriceInspection, StoreSearchResult } from '@shared/types'
import { Cover, PriceLine } from '@/components/game'
import { Inspection } from '@/components/Inspection'
import { PageBody, TopBar } from '@/components/Shell'
import { Button, Empty, Input, Panel, Spinner } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useStore } from '@/lib/store'

export function Search() {
  const { toast } = useStore()
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<StoreSearchResult[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [picked, setPicked] = useState<number | null>(null)
  const [info, setInfo] = useState<PriceInspection | null>(null)
  const [inspecting, setInspecting] = useState(false)

  const search = async () => {
    if (!term.trim()) return
    setLoading(true)
    try {
      setResults(await window.api.searchStore(term.trim()))
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const inspect = async (appid: number) => {
    setPicked(appid)
    setInspecting(true)
    setInfo(null)
    try {
      setInfo(await window.api.inspectPrice(appid))
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setInspecting(false)
    }
  }

  return (
    <>
      <TopBar title="게임 가격 검색" />
      <PageBody>
        <p className="mb-4 max-w-[70ch] text-[13px] text-muted">
          갖고 있지 않은 게임도 검색할 수 있습니다. 지금 할인이 Steam 역대 최저가 수준인지, 과거 할인 이력과 비교해 보여 줍니다.
        </p>
        <form
          className="mb-5 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void search()
          }}
        >
          <div className="relative">
            <LuSearch className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint" />
            <Input className="w-[420px] pl-9" placeholder="게임 이름 (한국어 또는 영어)" value={term} onChange={(e) => setTerm(e.target.value)} />
          </div>
          <Button variant="primary" type="submit" disabled={loading}>
            {loading ? <Spinner className="border-t-brand-ink" /> : null}
            검색
          </Button>
        </form>
        <div className="grid grid-cols-[340px_1fr] items-start gap-5">
          <div className="rounded-2xl border border-line bg-surface">
            {results == null ? (
              <p className="p-5 text-[13px] text-muted">검색 결과가 여기에 표시됩니다.</p>
            ) : results.length === 0 ? (
              <p className="p-5 text-[13px] text-muted">검색 결과가 없습니다. 영어 이름으로도 찾아보세요.</p>
            ) : (
              <ul>
                {results.map((r) => (
                  <li key={r.appid}>
                    <button
                      type="button"
                      onClick={() => void inspect(r.appid)}
                      className={cn(
                        'flex w-full items-center gap-3 border-b border-line px-3 py-2.5 text-left last:border-b-0 hover:bg-surface-2',
                        picked === r.appid && 'bg-brand-soft'
                      )}
                    >
                      <Cover src={r.image} alt="" className="h-[34px] w-[90px] shrink-0 rounded" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-ink">{r.name}</div>
                        <PriceLine p={r.priceKr} className="text-[12px]" />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            {inspecting && (
              <div className="flex items-center gap-2 p-6 text-[13px] text-muted">
                <Spinner /> 가격과 할인 이력을 불러오는 중
              </div>
            )}
            {!inspecting && info && (
              <Panel>
                <Inspection info={info} />
              </Panel>
            )}
            {!inspecting && !info && <Empty title="왼쪽 목록에서 게임을 고르세요">현재 가격, 역대 최저가, 할인 이력 그래프를 보여 줍니다.</Empty>}
          </div>
        </div>
      </PageBody>
    </>
  )
}
