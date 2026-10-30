// 플랫폼 어댑터 공통 인터페이스.
// 새 플랫폼(PSN, Xbox, Switch)은 이 인터페이스를 구현해서 providers/index.ts 에 등록하면 된다.
import type { Platform, Settings } from '@shared/types'
import type { OwnedGameInput } from '../db/repo'

export interface ProviderContext {
  settings: Settings
  signal: AbortSignal
  /** 갱신된 토큰 등을 저장할 때 */
  saveSettings?(patch: Partial<Settings>): void
}

export interface PlatformProvider {
  readonly platform: Platform
  readonly displayName: string
  /** 필요한 키/계정이 설정되었는지 */
  isConfigured(settings: Settings): boolean
  /** 보유 게임과 플레이타임 */
  fetchOwnedGames(ctx: ProviderContext): Promise<OwnedGameInput[]>
}
