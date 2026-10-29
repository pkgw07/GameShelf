// 캡처 이미지에서 글자 읽기 (tesseract.js). 한국어·영어 데이터는 처음 한 번 내려받아 저장해 둔다.
import { createWorker, type Worker } from 'tesseract.js'

let worker: Worker | null = null
let idleTimer: NodeJS.Timeout | null = null

async function getWorker(cachePath: string): Promise<Worker> {
  if (!worker) worker = await createWorker(['kor', 'eng'], 1, { cachePath })
  return worker
}

export async function recognize(imageDataUrl: string, cachePath: string): Promise<string> {
  const m = imageDataUrl.match(/^data:image\/[a-z+]+;base64,(.+)$/i)
  if (!m) throw new Error('이미지를 읽을 수 없습니다.')
  const w = await getWorker(cachePath)
  const { data } = await w.recognize(Buffer.from(m[1], 'base64'))
  // 메모리를 오래 잡고 있지 않도록 1분 뒤 정리
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    void worker?.terminate()
    worker = null
  }, 60_000)
  return data.text
}
