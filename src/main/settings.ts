// 설정 저장/불러오기. API 키는 OS 보안 저장소(Electron safeStorage)로 암호화해서 저장한다.
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import type { Repo } from './db/repo'

export interface SecretCodec {
  available(): boolean
  encrypt(plain: string): string
  decrypt(stored: string): string
}

/** 암호화를 쓸 수 없는 환경(테스트 등)용 */
export const plainCodec: SecretCodec = {
  available: () => false,
  encrypt: (s) => s,
  decrypt: (s) => s
}

const SECRET_KEYS: (keyof Settings)[] = ['steamApiKey', 'itadApiKey']

export class SettingsStore {
  private cache: Settings | null = null
  constructor(
    private repo: Repo,
    private codec: SecretCodec
  ) {}

  get(): Settings {
    if (this.cache) return this.cache
    const raw = this.repo.getSettingsMap()
    const s: Settings = { ...DEFAULT_SETTINGS }
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      const v = raw[k]
      if (v === undefined) continue
      try {
        let parsed = JSON.parse(v) as unknown
        if (SECRET_KEYS.includes(k) && typeof parsed === 'string' && parsed.startsWith('enc:')) {
          parsed = this.codec.decrypt(parsed.slice(4))
        }
        ;(s as unknown as Record<string, unknown>)[k] = parsed
      } catch {
        // 손상된 값은 기본값 유지
      }
    }
    this.cache = s
    return s
  }

  save(patch: Partial<Settings>): Settings {
    const cur = this.get()
    const next: Settings = { ...cur, ...patch }
    next.unplayedMinutes = Math.max(0, Math.min(100_000, Math.round(Number(next.unplayedMinutes) || 0)))
    next.usdKrwRate = Math.max(1, Number(next.usdKrwRate) || DEFAULT_SETTINGS.usdKrwRate)
    next.steamApiKey = next.steamApiKey.trim()
    next.itadApiKey = next.itadApiKey.trim()
    next.steamId = next.steamId.trim()
    for (const k of Object.keys(patch) as (keyof Settings)[]) {
      let v: unknown = next[k]
      if (SECRET_KEYS.includes(k) && typeof v === 'string' && v && this.codec.available()) {
        v = 'enc:' + this.codec.encrypt(v)
      }
      this.repo.setSetting(k, JSON.stringify(v))
    }
    this.cache = next
    return next
  }
}
