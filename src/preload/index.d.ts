import type { SteamShelfApi } from '../shared/api'

declare global {
  interface Window {
    api: SteamShelfApi
  }
}

export {}
