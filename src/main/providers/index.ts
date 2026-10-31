// 등록된 플랫폼 어댑터 목록. Steam 이 기본이고, 나머지는 설정에서 연결했을 때만 동기화한다.
import { nintendoProvider } from './nintendo'
import { psnProvider } from './psn'
import { steamProvider } from './steam'
import type { PlatformProvider } from './types'
import { xboxProvider } from './xbox'

export const providers: PlatformProvider[] = [steamProvider, psnProvider, xboxProvider, nintendoProvider]
