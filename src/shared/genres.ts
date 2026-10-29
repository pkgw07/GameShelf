// Steam 장르 ID ↔ 영어 이름(SteamSpy 조회용) ↔ 한국어 이름
// Steam 장르 ID는 언어와 상관없이 고정이라 분석 기준으로 사용한다.

export interface GenreMeta {
  id: string
  en: string
  ko: string
  /** 추천 후보 수집(SteamSpy)에 쓸 수 있는 장르인지 */
  spy: boolean
}

export const GENRES: GenreMeta[] = [
  { id: '1', en: 'Action', ko: '액션', spy: true },
  { id: '2', en: 'Strategy', ko: '전략', spy: true },
  { id: '3', en: 'RPG', ko: 'RPG', spy: true },
  { id: '4', en: 'Casual', ko: '캐주얼', spy: true },
  { id: '9', en: 'Racing', ko: '레이싱', spy: true },
  { id: '18', en: 'Sports', ko: '스포츠', spy: true },
  { id: '23', en: 'Indie', ko: '인디', spy: true },
  { id: '25', en: 'Adventure', ko: '어드벤처', spy: true },
  { id: '28', en: 'Simulation', ko: '시뮬레이션', spy: true },
  { id: '29', en: 'Massively Multiplayer', ko: '대규모 멀티플레이어', spy: true },
  { id: '37', en: 'Free to Play', ko: '무료', spy: false },
  { id: '70', en: 'Early Access', ko: '앞서 해보기', spy: true }
]

const byId = new Map(GENRES.map((g) => [g.id, g]))
const byEn = new Map(GENRES.map((g) => [g.en.toLowerCase(), g]))

export function genreName(id: string, fallback?: string): string {
  return byId.get(id)?.ko ?? fallback ?? id
}

export function genreByEn(en: string): GenreMeta | undefined {
  return byEn.get(en.toLowerCase())
}

export function genreById(id: string): GenreMeta | undefined {
  return byId.get(id)
}

/** 장르 분석에서 의미가 약한 장르 (취향보다는 유통 방식) */
export const WEAK_GENRES = new Set(['23', '37', '70'])
