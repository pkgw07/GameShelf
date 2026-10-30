import { useEffect, useState } from 'react'
import { LuTrash2, LuX } from 'react-icons/lu'
import { PLATFORM_LABELS, type GameRow, type ManualGameInput } from '@shared/types'
import { parseWon } from '@/lib/format'
import { useStore } from '@/lib/store'
import { Cover } from './game'
import { Button, Field, Input, Segmented, Spinner } from './ui'

type P = ManualGameInput['platform']
const PLATFORMS: P[] = ['switch', 'psn', 'xbox', 'manual']
const DEFAULT_DEVICE: Record<P, string> = { switch: 'Switch', psn: 'PS5', xbox: 'Xbox Series', manual: '' }

/** 게임 직접 추가·수정 (Switch, 디스크 게임, 다른 런처 등). edit 를 주면 수정 */
export function ManualGameDialog({ edit, onClose }: { edit?: GameRow; onClose(): void }) {
  const { reload, updateGame, toast, openGame } = useStore()
  const [platform, setPlatform] = useState<P>((edit?.platform as P) ?? 'switch')
  const [name, setName] = useState(edit?.name ?? '')
  const [hours, setHours] = useState(edit ? String(Math.round((edit.playtimeMin / 60) * 10) / 10) : '')
  const [device, setDevice] = useState(edit?.device ?? DEFAULT_DEVICE.switch)
  const [image, setImage] = useState(edit?.headerImage ?? '')
  const [price, setPrice] = useState(edit?.purchasePrice != null ? String(edit.purchasePrice) : '')
  const [date, setDate] = useState(edit?.purchaseDate ?? '')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = async () => {
    if (!name.trim()) return toast('게임 이름을 넣어 주세요.', 'error')
    setBusy(true)
    try {
      const fields = {
        name: name.trim(),
        playtimeMin: Math.round((Number(hours.replace(',', '.')) || 0) * 60),
        image: image.trim() || null,
        device: device.trim() || null
      }
      let key = edit?.key
      if (edit) await window.api.updateManualGame(edit.key, fields)
      else key = await window.api.addManualGame({ platform, ...fields })
      const p = price === '' ? null : Number(price)
      if (key && (p !== (edit?.purchasePrice ?? null) || (date || null) !== (edit?.purchaseDate ?? null))) {
        await updateGame(key, { purchasePrice: p, purchaseDate: date || null })
      }
      await reload()
      toast(edit ? '게임 정보를 고쳤습니다.' : `${fields.name}을(를) 추가했습니다.`)
      onClose()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!edit) return
    setBusy(true)
    try {
      await window.api.deleteManualGame(edit.key)
      openGame(null)
      await reload()
      toast('게임을 지웠습니다.')
      onClose()
    } catch (e) {
      toast((e as Error).message, 'error')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <button type="button" aria-label="닫기" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative max-h-full w-[560px] max-w-full overflow-y-auto rounded-2xl border border-line bg-paper p-6 shadow-[var(--shadow)]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">{edit ? '게임 정보 고치기' : '게임 직접 추가'}</h2>
          <button type="button" aria-label="닫기" className="rounded-md p-1 text-muted hover:text-ink" onClick={onClose}>
            <LuX className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4">
          {!edit && (
            <Field label="플랫폼">
              <Segmented<P>
                value={platform}
                onChange={(v) => {
                  setPlatform(v)
                  setDevice(DEFAULT_DEVICE[v])
                }}
                options={PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABELS[p] }))}
              />
            </Field>
          )}
          <Field label="게임 이름">
            <Input className="w-full" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 젤다의 전설 티어스 오브 더 킹덤" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="플레이 시간 (시간)">
              <Input className="num w-full" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="예: 42.5" />
            </Field>
            <Field label="기기 (선택)">
              <Input className="w-full" value={device} onChange={(e) => setDevice(e.target.value)} placeholder="예: Switch, PS4, Epic" />
            </Field>
            <Field label="구매가 (원, 선택)">
              <Input
                className="num w-full"
                inputMode="numeric"
                value={price ? Number(price).toLocaleString('ko-KR') : ''}
                onChange={(e) => setPrice(String(parseWon(e.target.value) ?? ''))}
              />
            </Field>
            <Field label="구매일 (선택)">
              <Input type="date" className="w-full" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <Field label="표지 이미지 주소 (선택)" hint="웹에서 이미지 주소를 복사해 붙여넣으면 카드에 표시됩니다.">
            <div className="flex items-center gap-3">
              <Input className="min-w-0 flex-1" value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://…" />
              {image.trim() && <Cover src={image.trim()} alt="" className="h-10 w-[86px] shrink-0 rounded-md" />}
            </div>
          </Field>
          <p className="text-[12px] text-faint">플레이 시간은 직접 바꿔야 갱신됩니다. 날마다 기록되는 활동 기록에도 바꾼 만큼 반영됩니다.</p>
        </div>
        <div className="mt-6 flex items-center gap-2">
          {edit &&
            (confirmDelete ? (
              <>
                <span className="text-[13px] text-bad">이 게임과 기록을 모두 지울까요?</span>
                <Button size="sm" variant="danger" disabled={busy} onClick={() => void remove()}>
                  지우기
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  취소
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" icon={<LuTrash2 />} onClick={() => setConfirmDelete(true)}>
                게임 지우기
              </Button>
            ))}
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {busy ? <Spinner className="border-t-brand-ink" /> : null}
            {edit ? '저장' : '추가'}
          </Button>
        </div>
      </div>
    </div>
  )
}
