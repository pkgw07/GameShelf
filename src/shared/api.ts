import type {
  ActivityData,
  AppInfo,
  BackupResult,
  GameDetail,
  GameRow,
  HltbInfo,
  ImportResult,
  NowPlaying,
  ParsedLicenseRow,
  ParsedPurchaseRow,
  PriceInspection,
  PricePoint,
  ProfileInfo,
  PurchaseRecord,
  RecommendationResult,
  Settings,
  StoreSearchResult,
  SyncState,
  UpdateState,
  UserDataPatch,
  WishlistRow
} from './types'

/** 화면에서 window.api 로 호출하는 기능 목록 */
export interface SteamShelfApi {
  getAppInfo(): Promise<AppInfo>
  getSettings(): Promise<Settings>
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  resolveSteamId(input: string): Promise<ProfileInfo>
  getProfile(): Promise<ProfileInfo | null>

  getLibrary(): Promise<GameRow[]>
  getWishlist(): Promise<WishlistRow[]>
  updateUserData(key: string, patch: UserDataPatch): Promise<GameRow | null>
  bulkUpdate(keys: string[], patch: UserDataPatch): Promise<void>
  getGameDetail(key: string): Promise<GameDetail>
  loadGlobalAchievementPct(key: string): Promise<GameDetail>

  startSync(): Promise<void>
  cancelSync(): Promise<void>
  getSyncState(): Promise<SyncState>

  searchStore(term: string): Promise<StoreSearchResult[]>
  inspectPrice(appid: number): Promise<PriceInspection>
  fetchItadHistory(appid: number): Promise<{ kr: PricePoint[]; us: PricePoint[] }>

  lookupHltb(key: string): Promise<HltbInfo | null>
  lookupHltbBulk(): Promise<void>

  getRecommendations(refreshPool: boolean): Promise<RecommendationResult>
  getActivity(days: number): Promise<ActivityData>

  openTextFile(): Promise<{ name: string; text: string } | null>
  importPurchases(rows: ParsedPurchaseRow[]): Promise<ImportResult>
  importLicenses(rows: ParsedLicenseRow[]): Promise<ImportResult>
  assignImported(key: string, amount: number | null, date: string | null): Promise<void>
  getPurchases(): Promise<PurchaseRecord[]>

  backup(): Promise<BackupResult>
  restore(): Promise<BackupResult>
  exportCsv(): Promise<BackupResult>
  openExternal(url: string): Promise<void>
  openDataFolder(): Promise<void>

  getNowPlaying(): Promise<NowPlaying | null>

  getUpdateState(): Promise<UpdateState>
  checkForUpdates(): Promise<UpdateState>
  downloadUpdate(): Promise<void>
  installUpdate(): Promise<void>

  onSyncState(cb: (s: SyncState) => void): () => void
  onNowPlaying(cb: (n: NowPlaying | null) => void): () => void
  onDataChanged(cb: () => void): () => void
  onUpdateState(cb: (u: UpdateState) => void): () => void
}

export const IPC = {
  invoke: 'pl:invoke',
  syncState: 'pl:sync-state',
  nowPlaying: 'pl:now-playing',
  dataChanged: 'pl:data-changed',
  updateState: 'pl:update-state'
} as const

/** invoke 로 전달 가능한 메서드 이름 (이벤트 구독 제외) */
export type ApiMethod = Exclude<keyof SteamShelfApi, 'onSyncState' | 'onNowPlaying' | 'onDataChanged' | 'onUpdateState'>
