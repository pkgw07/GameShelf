import { useMemo, useRef, useState, type ClipboardEvent } from 'react'
import { LuClipboardPaste, LuImage } from 'react-icons/lu'
import { bestMatch, parsePasted, type MatchTarget, type PastedLine } from '@/lib/pasteParser'
import { cn } from '@/lib/cn'
import { parseWon, usd, won } from '@/lib/format'
import { useStore } from '@/lib/store'
import { Badge, Button, Input, Spinner } from './ui'

interface Row extends PastedLine {
  include: boolean
  targetKey: string | null
  targetText: string
  score: number | null
}

const EXAMPLE = `예시)
엘든 링	38,880	2024-06-27
Hollow Knight  ₩8,250  2023.11.24
2023년 5월 3일 Portal 2 ₩ 2,300`

/** 표·텍스트 붙여넣기 또는 캡처 이미지로 구매가 넣기 */
export function PasteImport({ mode }: { mode: 'text' | 'image' }) {
  const { games, dlcs, reload, toast } = useStore()
  const [text, setText] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const targets: MatchTarget[] = useMemo(
    () => [
      ...games.map((g) => ({ key: g.key, label: g.nameKo || g.name, names: [g.name, g.nameKo].filter(Boolean) as string[] })),
      ...dlcs.map((d) => ({ key: d.key, label: `${d.name} (DLC)`, names: [d.name] }))
    ],
    [games, dlcs]
  )
  const byLabel = useMemo(() => new Map(targets.map((t) => [t.label.toLowerCase(), t])), [targets])

  const analyze = (src: string) => {
    const lines = parsePasted(src)
    setRows(
      lines.map((l) => {
        const m = bestMatch(l.name, targets)
        return {
          ...l,
          include: Boolean(m) && !l.refund && l.amount != null && l.currency !== 'USD',
          targetKey: m?.target.key ?? null,
          targetText: m?.target.label ?? '',
          score: m?.score ?? null
        }
      })
    )
  }

  const readImage = async (file: Blob) => {
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(String(r.result))
      r.onerror = () => rej(new Error('이미지를 읽지 못했습니다.'))
      r.readAsDataURL(file)
    })
    setPreview(dataUrl)
    setBusy('ocr')
    try {
      const t = await window.api.ocrImage(dataUrl)
      setText(t)
      analyze(t)
      if (!t.trim()) toast('글자를 찾지 못했습니다. 더 크게 캡처하거나 텍스트로 붙여넣어 보세요.', 'error')
    } catch (e) {
      toast(`글자 인식에 실패했습니다: ${(e as Error).message}`, 'error')
    } finally {
      setBusy(null)
    }
  }

  const onPaste = (e: ClipboardEvent) => {
    if (mode !== 'image') return
    const item = [...e.clipboardData.items].find((i) => i.type.startsWith('image/'))
    const f = item?.getAsFile()
    if (f) {
      e.preventDefault()
      void readImage(f)
    }
  }

  const update = (id: number, patch: Partial<Row>) => setRows((rs) => rs?.map((r) => (r.id === id ? { ...r, ...patch } : r)) ?? null)

  const apply = async () => {
    const items = (rows ?? []).filter((r) => r.include && r.targetKey).map((r) => ({ key: r.targetKey as string, amount: r.amount, date: r.date }))
    if (!items.length) return
    setBusy('apply')
    try {
      const n = await window.api.applyPurchases(items)
      await reload()
      toast(`${n}개 항목에 구매가를 넣었습니다.`)
      setRows(null)
      setText('')
      setPreview(null)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const selected = rows?.filter((r) => r.include && r.targetKey).length ?? 0

  return (
    <div onPaste={onPaste}>
      <datalist id="paste-targets">
        {targets.map((t) => (
          <option key={t.key} value={t.label} />
        ))}
      </datalist>
      {mode === 'text' ? (
        <>
          <p className="mb-2 text-[13px] text-muted">
            엑셀·메모장에 정리해 둔 표나, Steam 구매 내역 페이지를 드래그해서 복사한 내용을 그대로 붙여넣으세요. 줄마다 게임 이름, 금액, (있으면) 날짜를 찾아냅니다.
          </p>
          <textarea
            className="h-40 w-full rounded-lg border border-line bg-surface p-3 font-mono text-[13px] text-ink placeholder:text-faint focus:border-brand focus:outline-none"
            placeholder={EXAMPLE}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-2 flex gap-2">
            <Button variant="primary" icon={<LuClipboardPaste />} disabled={!text.trim()} onClick={() => analyze(text)}>
              인식하기
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="mb-2 text-[13px] text-muted">
            구매 내역이나 직접 만든 표를 캡처(Win+Shift+S)한 뒤 아래 칸을 누르고 Ctrl+V 하세요. 이미지 파일을 골라도 됩니다. 처음 한 번은 한국어 인식 데이터를 내려받느라 1분 정도 걸릴 수 있어요.
          </p>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex h-40 w-full items-center justify-center gap-4 rounded-xl border-2 border-dashed border-line-strong bg-surface-2 text-[13px] text-muted hover:border-brand"
          >
            {preview ? <img src={preview} alt="" className="max-h-36 max-w-[50%] rounded object-contain" /> : <LuImage className="h-8 w-8 text-faint" />}
            <span>{busy === 'ocr' ? '글자 읽는 중…' : '여기를 누르고 Ctrl+V 로 캡처 붙여넣기, 또는 클릭해서 이미지 고르기'}</span>
            {busy === 'ocr' && <Spinner />}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void readImage(f)
              e.target.value = ''
            }}
          />
          {text && !busy && (
            <details className="mt-2 text-[12px]">
              <summary className="cursor-pointer text-muted">인식된 글자 보기·고치기</summary>
              <textarea
                className="mt-2 h-32 w-full rounded-lg border border-line bg-surface p-2 font-mono text-[12px] text-ink"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <Button size="sm" className="mt-1" onClick={() => analyze(text)}>
                다시 인식하기
              </Button>
            </details>
          )}
        </>
      )}

      {rows && (
        <div className="mt-4">
          {rows.length === 0 ? (
            <p className="text-[13px] text-muted">게임 이름과 금액을 찾지 못했습니다. 한 줄에 "이름 금액" 형태로 넣어 보세요.</p>
          ) : (
            <>
              <div className="overflow-hidden rounded-xl border border-line">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-line bg-surface-2 text-left text-[12px] text-muted">
                      <th className="w-10 px-3 py-2" />
                      <th className="px-2 py-2 font-medium">인식된 이름</th>
                      <th className="px-2 py-2 font-medium">연결할 게임·DLC</th>
                      <th className="px-2 py-2 text-right font-medium">금액 (원)</th>
                      <th className="px-3 py-2 font-medium">날짜</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className={cn('border-b border-line last:border-b-0', !r.include && 'opacity-60')}>
                        <td className="px-3 py-1.5">
                          <input type="checkbox" className="accent-[var(--brand)]" checked={r.include} onChange={(e) => update(r.id, { include: e.target.checked })} />
                        </td>
                        <td className="max-w-[220px] px-2 py-1.5">
                          <div className="truncate text-ink" title={r.raw}>
                            {r.name}
                          </div>
                          <div className="flex gap-1">
                            {r.refund && <Badge tone="bad">환불</Badge>}
                            {r.split && <Badge tone="sale">합산 결제를 나눔</Badge>}
                            {r.currency === 'USD' && <Badge tone="muted">달러 {usd(r.amount)}</Badge>}
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            list="paste-targets"
                            className={cn('h-8 w-full', !r.targetKey && 'border-bad/50')}
                            placeholder="보유 게임에서 고르기"
                            value={r.targetText}
                            onChange={(e) => {
                              const t = byLabel.get(e.target.value.toLowerCase())
                              update(r.id, { targetText: e.target.value, targetKey: t?.key ?? null, include: t ? r.include || true : false })
                            }}
                          />
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <Input
                            className="num h-8 w-28 text-right"
                            inputMode="numeric"
                            value={r.amount != null && r.currency !== 'USD' ? r.amount.toLocaleString('ko-KR') : ''}
                            placeholder={r.currency === 'USD' ? '원화로 입력' : ''}
                            onChange={(e) => update(r.id, { amount: parseWon(e.target.value), currency: 'KRW' })}
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <Input type="date" className="h-8" value={r.date ?? ''} onChange={(e) => update(r.id, { date: e.target.value || null })} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <Button variant="primary" disabled={!selected || busy === 'apply'} onClick={() => void apply()}>
                  {busy === 'apply' ? <Spinner className="border-t-brand-ink" /> : null}
                  선택한 {selected}개 적용
                </Button>
                <span className="text-[12px] text-faint">
                  적용한 금액은 직접 입력한 값으로 저장됩니다 (총 {won((rows ?? []).filter((r) => r.include && r.targetKey).reduce((a, r) => a + (r.amount ?? 0), 0))}).
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
