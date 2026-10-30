import { useCallback, useEffect, useState } from 'react'
import { LuCloudDownload, LuLogIn, LuLogOut, LuPuzzle } from 'react-icons/lu'
import type { ImportResult, OwnedDlcResult, StoreStatus } from '@shared/types'
import { parseLicenses, parsePurchaseHistory } from '@/lib/parsers'
import { useStore } from '@/lib/store'
import { Badge, Button, Spinner } from './ui'

export interface SteamImportResult {
  purchases: ImportResult
  licenses: ImportResult
  dlc: OwnedDlcResult
}

export function useStoreStatus() {
  const [status, setStatus] = useState<StoreStatus | null>(null)
  const refresh = useCallback(async () => setStatus(await window.api.storeStatus()), [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { status, setStatus, refresh }
}

export function dlcResultText(r: OwnedDlcResult): string {
  if (r.source === 'none') return '보유 DLC를 확인할 방법이 없습니다. Steam에 로그인하면 전체 보유 DLC를 알 수 있습니다.'
  const where = r.source === 'store' ? 'Steam 보유 목록' : '설치된 게임 폴더'
  const parts = [`${where}에서 보유 DLC ${r.owned}개 확인`]
  if (r.added) parts.push(`새로 체크 ${r.added}개`)
  if (r.removed) parts.push(`보유 해제 ${r.removed}개`)
  return parts.join(' · ')
}

/** 로그인 → 구매 내역 → 라이선스 → 보유 DLC 를 한 번에 */
export function useSteamImport(onDone?: (r: SteamImportResult) => void) {
  const { reload, toast } = useStore()
  const { status, setStatus, refresh } = useStoreStatus()
  const [step, setStep] = useState<string | null>(null)

  const login = async (): Promise<StoreStatus | null> => {
    setStep('Steam 로그인 창에서 로그인해 주세요')
    try {
      const s = await window.api.storeLogin()
      setStatus(s)
      return s
    } finally {
      setStep(null)
    }
  }

  const logout = async () => setStatus(await window.api.storeLogout())

  const run = async () => {
    try {
      let s = status ?? (await window.api.storeStatus())
      if (!s.loggedIn) {
        const after = await login()
        if (!after?.loggedIn) return
        s = after
      }
      if (!s.matches) {
        toast('프로그램에서 로그인한 Steam 계정이 설정의 계정과 다릅니다. 로그아웃 후 같은 계정으로 로그인해 주세요.', 'error')
        return
      }
      setStep('구매 내역 불러오는 중 (내역이 많으면 1분 정도 걸립니다)')
      const h = await window.api.storePurchaseHistory()
      const purchases = await window.api.importPurchases(parsePurchaseHistory(h.html))
      setStep('라이선스 불러오는 중')
      const licenses = await window.api.importLicenses(parseLicenses(await window.api.storeLicenses()))
      setStep('보유 DLC 확인 중')
      const dlc = await window.api.syncOwnedDlc()
      await reload()
      toast(`구매 내역 ${purchases.totalRows}건에서 ${purchases.matched}개, 라이선스에서 ${licenses.matched}개 반영 · ${dlcResultText(dlc)}`)
      onDone?.({ purchases, licenses, dlc })
    } catch (e) {
      toast((e as Error).message, 'error')
      void refresh()
    } finally {
      setStep(null)
    }
  }

  return { status, step, busy: step != null, login, logout, run }
}

/** 상태 배지 + 로그인/로그아웃 */
export function StoreLoginRow({ imp }: { imp: ReturnType<typeof useSteamImport> }) {
  const { status, busy } = imp
  if (!status) return null
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-2 px-4 py-3 text-[13px]">
      {status.loggedIn ? (
        <>
          <Badge tone={status.matches ? 'brand' : 'bad'}>{status.matches ? '로그인됨' : '다른 계정'}</Badge>
          <span className="text-muted">{status.steamId}</span>
          <Button size="sm" variant="ghost" className="ml-auto" icon={<LuLogOut />} disabled={busy} onClick={() => void imp.logout()}>
            로그아웃
          </Button>
        </>
      ) : (
        <>
          <Badge tone="muted">로그인 안 됨</Badge>
          <Button size="sm" className="ml-auto" icon={<LuLogIn />} disabled={busy} onClick={() => void imp.login()}>
            Steam 로그인
          </Button>
        </>
      )}
    </div>
  )
}

export const STORE_LOGIN_NOTE =
  'Steam 공식 로그인 페이지가 별도 창으로 열립니다. 아이디·비밀번호는 Steam에만 전달되고 이 프로그램은 보지 않습니다. 로그인 상태는 이 PC의 프로그램 데이터에만 남고, 로그아웃하면 지워집니다.'

/** 가격·지출 → 구매가 가져오기의 "Steam에서 바로" 탭 */
export function SteamImportTab({ onResult }: { onResult(r: ImportResult): void }) {
  const imp = useSteamImport((r) => onResult(r.purchases))
  return (
    <div className="space-y-3">
      <p className="max-w-[72ch] text-[13px] text-muted">
        프로그램 안에서 Steam에 한 번 로그인하면 <b className="text-ink">구매 내역(구매가·구매일), 라이선스(획득일), 보유 DLC</b>를 한 번에 불러옵니다. 페이지를
        저장할 필요가 없고, 다음부터는 버튼만 누르면 새 구매가 반영됩니다.
      </p>
      <StoreLoginRow imp={imp} />
      <div className="flex items-center gap-3">
        <Button variant="primary" icon={imp.busy ? <Spinner className="border-t-brand-ink" /> : <LuCloudDownload />} disabled={imp.busy} onClick={() => void imp.run()}>
          {imp.status?.loggedIn ? 'Steam에서 불러오기' : '로그인하고 불러오기'}
        </Button>
        {imp.step && <span className="text-[13px] text-muted">{imp.step}</span>}
      </div>
      <p className="text-[12px] text-faint">{STORE_LOGIN_NOTE} 직접 입력한 구매가는 덮어쓰지 않습니다.</p>
    </div>
  )
}

/** 라이브러리 DLC 보기의 "보유 DLC 확인" */
export function OwnedDlcButton() {
  const { reload, toast } = useStore()
  const [busy, setBusy] = useState(false)
  return (
    <Button
      size="sm"
      icon={busy ? <Spinner /> : <LuPuzzle />}
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          const r = await window.api.syncOwnedDlc()
          await reload()
          toast(dlcResultText(r), r.source === 'none' ? 'error' : 'info')
        } catch (e) {
          toast((e as Error).message, 'error')
        } finally {
          setBusy(false)
        }
      }}
    >
      보유 DLC 확인
    </Button>
  )
}
