import type {
  ActivityData,
  AppInfo,
  BackupResult,
  DlcRow,
  GameDetail,
  GameRow,
  HltbInfo,
  ImportResult,
  OwnedDlcResult,
  StoreStatus,
  NowPlaying,
  ParsedLicenseRow,
  ParsedPurchaseRow,
  PriceInspection,
  PricePoint,
  ProfileInfo,
  PurchaseApplyItem,
  PurchaseRecord,
  RareAchievement,
  RecommendationResult,
  Settings,
  StoreSearchResult,
  SyncState,
  UpdateState,
  UserDataPatch,
  WishlistRow,
  YearReview
} from './types'

/** 화면에서 window.api 로 호출하는 기능 목록 */
export interface GameShelfApi {
  getAppInfo(): Promise<AppInfo>
  getSettings(): Promise<Settings>
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  resolveSteamId(input: string): Promise<ProfileInfo>
  getProfile(): Promise<ProfileInfo | null>

  getLibrary(): Promise<GameRow[]>
  getWishlist(): Promise<WishlistRow[]>
  getDlcs(): Promise<DlcRow[]>
  setDlcOwned(appid: number, owned: boolean): Promise<void>
  setTargetPrice(appid: number, price: number | null): Promise<void>
  getRareAchievements(limit: number): Promise<RareAchievement[]>
  getYearReview(year: number): Promise<YearReview>
  ocrImage(dataUrl: string): Promise<string>
  applyPurchases(items: PurchaseApplyItem[]): Promise<number>
  testNotification(): Promise<void>
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
  resetPurchases(scope: 'imported' | 'all'): Promise<BackupResult>
  /** 프로그램 안 Steam 스토어 로그인 */
  storeStatus(): Promise<StoreStatus>
  storeLogin(): Promise<StoreStatus>
  storeLogout(): Promise<StoreStatus>
  /** 로그인 세션으로 구매 내역 전체 HTML (렌더러 파서로 읽음) */
  storePurchaseHistory(): Promise<{ html: string; pages: number }>
  storeLicenses(): Promise<string>
  /** 보유 DLC 확인: 로그인돼 있으면 Steam 보유 목록, 아니면 설치 폴더 */
  syncOwnedDlc(): Promise<OwnedDlcResult>

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
export type ApiMethod = Exclude<keyof GameShelfApi, 'onSyncState' | 'onNowPlaying' | 'onDataChanged' | 'onUpdateState'>
