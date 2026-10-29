// 등록된 플랫폼 어댑터 목록. 1.0은 Steam만 등록되어 있다.
// 확장 예시: import { psnProvider } from './psn' 후 배열에 추가
import type { PlatformProvider } from './types'
import { steamProvider } from './steam'

export const providers: PlatformProvider[] = [steamProvider]
