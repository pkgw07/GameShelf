// 메인 프로세스와 화면(렌더러)이 함께 쓰는 타입 정의

export const APP_VERSION = '1.6.0'

/** 지원 플랫폼. 1.0은 steam만 동작하고 나머지는 확장 대비용 */
export type Platform = 'steam' | 'psn' | 'xbox' | 'switch' | 'manual'

export type GameStatus = 'none' | 'playing' | 'cleared' | 'completed' | 'dropped' | 'later'

export const STATUS_ORDER: GameStatus[] = ['none', 'playing', 'cleared', 'completed', 'dropped', 'later']

export const STATUS_LABELS: Record<GameStatus, string> = {
  none: '미분류',
  playing: '플레이 중',
  cleared: '클리어',
  completed: '100%',
  dropped: '포기',
  later: '나중에'
}

/** 지역별 가격. 금액은 해당 통화의 최소 단위 (KRW: 원, USD: 센트) */
export interface PriceInfo {
  currency: string
  initial: number
  final: number
  discount: number
  fetchedAt: number
}

/**
 * Steam 역대 최저가 = 역대 최대 할인율로 팔렸던 가격.
 * 지금 할인 중인지와 상관없이 항상 같은 값을 보여 준다.
 */
export interface LowInfo {
  amount: number
  regular: number | null
  /** 역대 최대 할인율 (%) */
  cut: number
  /** ISO 날짜 문자열 */
  date: string | null
  /**
   * itad: IsThereAnyDeal의 해당 지역 기록
   * self: 프로그램이 직접 기록한 가격
   * estimate: 다른 지역의 최대 할인율을 이 지역 정가에 적용한 값
   */
  source: 'itad' | 'self' | 'estimate'
}

/** Steam 사용자 평가 */
export interface ReviewInfo {
  /** 긍정 비율 (0~100) */
  percent: number | null
  count: number
  /** 예: 매우 긍정적 */
  label: string | null
}

export interface HltbInfo {
  /** 시간 단위 */
  main: number | null
  extra: number | null
  complete: number | null
  source: 'hltb' | 'manual'
  hltbId?: number | null
  matchedName?: string | null
}

export interface GenreRef {
  id: string
  name: string
}

export interface GameRow {
  /** 플랫폼 + 게임 ID로 만든 고유 키. 예: steam:620 */
  key: string
  platform: Platform
  gameId: string
  /** Steam 게임이면 appid, 아니면 null */
  appid: number | null
  name: string
  nameKo: string | null
  playtimeMin: number
  playtime2wMin: number
  /** 마지막 플레이 (unix 초) */
  lastPlayed: number | null
  headerImage: string
  genres: GenreRef[]
  isFree: boolean
  detailsStatus: 'ok' | 'unavailable' | 'pending'
  priceKr: PriceInfo | null
  priceUs: PriceInfo | null
  lowKr: LowInfo | null
  lowUs: LowInfo | null
  achTotal: number | null
  achDone: number | null
  status: GameStatus
  statusAuto: boolean
  excludedManual: boolean
  /** 실제 구매가 (원) */
  purchasePrice: number | null
  purchaseDate: string | null
  purchaseSource: 'manual' | 'history' | null
  /** 라이선스 획득일 (구매 내역이 없을 때 대체로 쓰임) */
  acquiredDate: string | null
  notes: string
  rating: number | null
  hltb: HltbInfo | null
  inWishlist: boolean
  firstSeen: number
  review: ReviewInfo | null
  /** 상점에 있는 DLC 수 / 보유로 표시된 DLC 수 */
  dlcCount: number
  dlcOwned: number
  /** 기기 (PS5, PS4, Xbox Series, Switch 등). Steam 은 null */
  device: string | null
  /** 플레이타임을 알 수 있는지 (Xbox 는 알 수 없음) */
  playtimeKnown: boolean
  /** 직접 추가한 게임 (Switch 등) */
  manual: boolean
  /** PlayStation 트로피 (획득 개수) */
  trophies: TrophyCounts | null
  /** Xbox 게이머스코어 */
  gamerscore: { done: number; total: number } | null
}

export interface TrophyCounts {
  platinum: number
  gold: number
  silver: number
  bronze: number
}

export const PLATFORM_LABELS: Record<Platform, string> = {
  steam: 'Steam',
  psn: 'PlayStation',
  xbox: 'Xbox',
  switch: 'Switch',
  manual: '기타'
}

/** 직접 추가·수정할 때 쓰는 값 */
export interface ManualGameInput {
  platform: Exclude<Platform, 'steam'>
  name: string
  playtimeMin: number
  image: string | null
  device: string | null
}

/** 다른 플랫폼 연결 상태 */
export interface PlatformStatus {
  psn: { connected: boolean; account: string | null }
  xbox: { connected: boolean; account: string | null }
  nintendo: { connected: boolean; account: string | null }
}

/** DLC 보유 표시의 출처: 직접 / 라이선스 가져오기 / 구매 내역 / Steam 로그인 보유 목록 / 설치 폴더 */
export type DlcOwnSource = 'manual' | 'license' | 'purchase' | 'store' | 'installed'

/** 보유 게임의 DLC */
export interface DlcRow {
  appid: number
  key: string
  parentKey: string
  parentName: string
  name: string
  headerImage: string
  priceKr: PriceInfo | null
  priceUs: PriceInfo | null
  lowKr: LowInfo | null
  lowUs: LowInfo | null
  review: ReviewInfo | null
  isFree: boolean
  owned: boolean
  ownedSource: DlcOwnSource | null
  purchasePrice: number | null
  purchaseDate: string | null
}

export interface WishlistRow {
  appid: number
  key: string
  name: string
  addedAt: number | null
  priority: number
  headerImage: string
  genres: GenreRef[]
  priceKr: PriceInfo | null
  priceUs: PriceInfo | null
  lowKr: LowInfo | null
  lowUs: LowInfo | null
  detailsStatus: 'ok' | 'unavailable' | 'pending'
  review: ReviewInfo | null
  /** 목표가 (원). 이 가격 이하가 되면 알림 */
  targetPrice: number | null
}

export interface UserDataPatch {
  status?: GameStatus
  excluded?: boolean
  purchasePrice?: number | null
  purchaseDate?: string | null
  notes?: string
  rating?: number | null
  hltbMainManual?: number | null
}

export interface Settings {
  steamApiKey: string
  steamId: string
  itadApiKey: string
  /** 이 시간(분) 미만으로 플레이한 게임을 "안 한 게임"으로 판정 */
  unplayedMinutes: number
  excludeFree: boolean
  /** 무료 배포로 받은 게임(역대 최저가 0원, 구매가 없음)을 통계에서 제외 */
  excludeGiveaway: boolean
  excludeUnplayed: boolean
  excludedGenres: string[]
  /** 화면 확대 비율 (글자 크기). 1 = 1.3 이전 크기 */
  uiScale: number
  theme: 'system' | 'light' | 'dark'
  minimizeToTray: boolean
  launchAtLogin: boolean
  nowPlaying: boolean
  autoStatus: boolean
  /** 한국/미국 가격 비교용 환율 (1달러 = ?원) */
  usdKrwRate: number
  /** 가격 총합에 보유 DLC 포함 */
  includeDlcInTotals: boolean
  /** 위시리스트 목표가 도달 알림 */
  notifyTargetPrice: boolean
  /** 위시리스트 역대 최저가 도달 알림 */
  notifyHistoricalLow: boolean
  /** PlayStation 로그인 (갱신 토큰, 암호화 저장) */
  psnRefreshToken: string
  psnAccount: string
  /** Xbox: OpenXBL(xbl.io) API 키 (암호화 저장) */
  xblApiKey: string
  xblAccount: string
  /** Nintendo: 로그인 세션 토큰 (약 2년, 암호화 저장) */
  nintendoSessionToken: string
  nintendoAccount: string
  /** 자동 백업 (주 1회, 최근 8개 보관) */
  autoBackup: boolean
}

/** 설정에서 고를 수 있는 글자 크기 (화면 확대 비율) */
export const UI_SCALES = [1, 1.1, 1.15, 1.25, 1.35]

export const DEFAULT_SETTINGS: Settings = {
  steamApiKey: '',
  steamId: '',
  itadApiKey: '',
  unplayedMinutes: 30,
  excludeFree: true,
  excludeGiveaway: true,
  excludeUnplayed: false,
  excludedGenres: [],
  uiScale: 1.15,
  theme: 'system',
  minimizeToTray: true,
  launchAtLogin: false,
  nowPlaying: true,
  autoStatus: true,
  usdKrwRate: 1400,
  includeDlcInTotals: true,
  notifyTargetPrice: true,
  notifyHistoricalLow: true,
  psnRefreshToken: '',
  psnAccount: '',
  xblApiKey: '',
  xblAccount: '',
  nintendoSessionToken: '',
  nintendoAccount: '',
  autoBackup: true
}

export interface ProfileInfo {
  steamId: string
  personaName: string
  avatar: string
  profileUrl: string
}

export interface SyncState {
  running: boolean
  phase: string
  label: string
  current: number
  total: number
  error: string | null
  warnings: string[]
  lastFinishedAt: number | null
  lastDailyAt: number | null
}

export interface NowPlaying {
  key: string
  /** Steam 게임이면 appid, 콘솔이면 null */
  appid: number | null
  name: string
  since: number
  platform: Platform
  /** PS5, Xbox Series 등 */
  device: string | null
}

export interface PricePoint {
  /** ms timestamp */
  t: number
  initial: number
  final: number
  discount: number
  source: 'itad' | 'self'
}

export interface AchievementRow {
  apiname: string
  name: string
  description: string
  icon: string
  iconGray: string
  achieved: boolean
  unlockTime: number | null
  globalPct: number | null
}

export interface PlaySession {
  id: number
  key: string
  name: string
  startedAt: number
  endedAt: number | null
}

export interface GameDetail {
  key: string
  achievements: AchievementRow[]
  historyKr: PricePoint[]
  historyUs: PricePoint[]
  sessions: PlaySession[]
  playtimeSeries: { date: string; minutes: number }[]
  dlcs: DlcRow[]
}

export interface StoreSearchResult {
  appid: number
  name: string
  image: string
  priceKr: PriceInfo | null
}

export interface PriceInspection {
  appid: number
  name: string
  headerImage: string
  genres: GenreRef[]
  priceKr: PriceInfo | null
  priceUs: PriceInfo | null
  lowKr: LowInfo | null
  lowUs: LowInfo | null
  historyKr: PricePoint[]
  historyUs: PricePoint[]
  owned: boolean
  inWishlist: boolean
  itadAvailable: boolean
  notes: string[]
  review: ReviewInfo | null
  /** 상점 소개 (한국어가 있으면 한국어) */
  description: string | null
  releaseDate: string | null
  developers: string[]
  /** 스크린샷 썸네일 / 원본 */
  screenshots: { thumb: string; full: string }[]
}

export interface GenreWeight {
  id: string
  name: string
  weight: number
  hours: number
  count: number
  /** 이 장르 점수에 크게 기여한 내 게임 (기여도 순, 최대 8개) */
  top: { key: string; name: string; hours: number; platform: Platform }[]
}

/** 추천 점수가 어떻게 나왔는지 */
export interface RecoReason {
  /** 이 게임의 장르와 내 취향 점수 (0~1). 취향에 없는 장르는 0 */
  genres: { id: string; name: string; weight: number }[]
  /** 취향 일치 점수 (장르 가중치 합 / √장르 수) */
  match: number
  /** 평가 점수 (긍정 비율 × 리뷰 수 신뢰도). 보유 게임은 null */
  quality: number | null
  /** 같은 장르를 많이 플레이한 내 게임 */
  because: { key: string; name: string; hours: number; platform: Platform; shared: string[] }[]
}

export interface Recommendation {
  appid: number
  /** 보유 게임이면 라이브러리 키 */
  key?: string
  name: string
  score: number
  matched: string[]
  positivePct: number | null
  reviews: number | null
  headerImage: string
  priceKr: PriceInfo | null
  playtimeMin?: number
  inWishlist?: boolean
  reason?: RecoReason
}

export interface RecommendationResult {
  profile: GenreWeight[]
  candidates: Recommendation[]
  backlog: Recommendation[]
  poolFetchedAt: number | null
  error: string | null
}

export interface ActivityData {
  daily: { date: string; minutes: number }[]
  topGames: { key: string; name: string; minutes: number }[]
  sessions: PlaySession[]
  achievements: {
    key: string
    gameName: string
    apiname: string
    name: string
    icon: string
    unlockTime: number
  }[]
  achByMonth: { month: string; count: number }[]
  snapshotDays: number
}

/** 구매 내역 페이지에서 화면이 파싱한 한 줄 */
export interface ParsedPurchaseRow {
  date: string | null
  items: string[]
  type: string
  total: number | null
  currency: string | null
  isRefund: boolean
  isGamePurchase: boolean
}

export interface ParsedLicenseRow {
  date: string | null
  name: string
  acquisition: string
}

export interface ImportItemResult {
  itemName: string
  date: string | null
  amount: number | null
  matchedKey: string | null
  matchedName: string | null
}

export interface ImportResult {
  kind: 'purchases' | 'licenses'
  totalRows: number
  matched: number
  skippedManual: number
  unmatched: ImportItemResult[]
}

export interface PurchaseRecord {
  id: number
  date: string | null
  type: string
  items: string[]
  total: number | null
  currency: string | null
  refunded: boolean
}

export interface AppInfo {
  version: string
  dataPath: string
  dbDriver: string
  platform: string
}

export interface RareAchievement {
  key: string
  gameName: string
  apiname: string
  name: string
  description: string
  icon: string
  globalPct: number
  unlockTime: number | null
}

export interface YearReview {
  year: number
  /** 플레이타임 기록이 있는 날 수 (설치 이후만 기록됨) */
  recordedDays: number
  playMinutes: number
  activeDays: number
  topGames: { key: string; name: string; minutes: number }[]
  monthlyMinutes: { month: string; minutes: number }[]
  achievements: number
  monthlyAchievements: { month: string; count: number }[]
  rarest: RareAchievement[]
  completedGames: { key: string; name: string }[]
  spent: number
  boughtCount: number
  bought: { key: string; name: string; price: number | null; date: string }[]
  sessions: number
  longestSession: { name: string; minutes: number } | null
  genreMinutes: { id: string; name: string; minutes: number }[]
}

/** 붙여넣기/캡처에서 인식한 구매 정보 한 줄 (화면에서 확인 후 적용) */
export interface PurchaseApplyItem {
  key: string
  amount: number | null
  date: string | null
}

export interface UpdateState {
  /** disabled: 개발 모드 등 업데이트를 쓸 수 없는 상태 */
  status: 'disabled' | 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  currentVersion: string
  version: string | null
  percent: number | null
  error: string | null
  checkedAt: number | null
}

/** 프로그램 안 Steam 스토어 로그인 상태 */
export interface StoreStatus {
  loggedIn: boolean
  /** 로그인한 계정의 SteamID64 */
  steamId: string | null
  /** 설정의 Steam 계정과 같은지 (설정에 계정이 없으면 true) */
  matches: boolean
}

export interface OwnedDlcResult {
  /** 어디서 확인했는지 */
  source: 'store' | 'installed' | 'none'
  owned: number
  added: number
  removed: number
}

export interface BackupResult {
  ok: boolean
  path: string | null
  message: string
}
