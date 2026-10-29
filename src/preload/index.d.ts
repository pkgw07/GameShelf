import type { GameShelfApi } from '../shared/api'

declare global {
  interface Window {
    api: GameShelfApi
  }
}

export {}
