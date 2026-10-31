// 메인 프로세스 로직 통합 테스트: 가짜 Steam/ITAD 응답으로 동기화 → 계산 확인
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { Core } from '../src/main/core'
import { plainCodec } from '../src/main/settings'
import { setFetch } from '../src/main/util/http'
import { importPurchases, importLicenses, splitAmount, applyPurchases } from '../src/main/services/imports'
import { yearReview } from '../src/main/services/yearreview'
import { effectiveLow, isGiveaway, excludeReason } from '../src/shared/analytics'
import { findSearchEndpoint, pickBest, similarity } from '../src/main/services/hltb'
import { parseRunningAppId } from '../src/main/services/nowplaying'
import * as sp from '../src/main/services/storeparse'
import { codeFromNpsso, tokensFromCode, isoDurationMinutes } from '../src/main/providers/psn'
import { xblAccount, xboxPresence } from '../src/main/providers/xbox'
import { psnPresence } from '../src/main/providers/psn'
import { nintendoAuthUrl, parseNintendoRedirect, nintendoSessionToken, nintendoAccess, nintendoNickname, nintendoDevice } from '../src/main/providers/nintendo'
import { autoBackupIfDue } from '../src/main/services/backup'
import { suggestStatus } from '../src/main/services/autostatus'
import { genreProfile, becauseOf } from '../src/shared/analytics'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { titleKey, isUnplayed } from '../src/shared/analytics'
import { libraryCsv } from '../src/main/services/exporter'
import { toMinor } from '../src/main/providers/steam'
import { amountToMinor } from '../src/main/services/itad'
import {
  moneyTotals,
  purchaseTiming,
  spendBy,
  excludeReason,
  hltbRemaining,
  dealVerdict,
  genreProfile,
  costPerHour,
  isUnplayed
} from '../src/shared/analytics'

const now = Math.floor(Date.now() / 1000)
let dlcMode: 'none' | 'owned' = 'none'
let krPortal = { currency: 'KRW', initial: 1150000, final: 1150000, discount_percent: 0 }

const apps: Record<number, any> = {
  620: { type: 'game', name: '포탈 2', is_free: false, dlc: [9001, 9002], header_image: 'https://x/620.jpg', genres: [{ id: '1', description: '액션' }, { id: '25', description: '어드벤처' }] },
  1145360: { type: 'game', name: 'Hades', is_free: false, header_image: 'https://x/hades.jpg', genres: [{ id: '1', description: '액션' }, { id: '23', description: '인디' }, { id: '3', description: 'RPG' }] },
  413150: { type: 'game', name: 'Stardew Valley', is_free: false, header_image: 'https://x/sdv.jpg', genres: [{ id: '23', description: '인디' }, { id: '3', description: 'RPG' }, { id: '28', description: '시뮬레이션' }] },
  570: { type: 'game', name: 'Dota 2', is_free: true, header_image: 'https://x/570.jpg', genres: [{ id: '1', description: '액션' }, { id: '37', description: '무료' }] },
  1086940: { type: 'game', name: "Baldur's Gate 3", is_free: false, header_image: 'https://x/bg3.jpg', genres: [{ id: '3', description: 'RPG' }] }
}
const pricesKr = () => ({
  620: krPortal,
  1145360: { currency: 'KRW', initial: 2400000, final: 1200000, discount_percent: 50 },
  413150: { currency: 'KRW', initial: 1600000, final: 1600000, discount_percent: 0 },
  1086940: { currency: 'KRW', initial: 6600000, final: 6600000, discount_percent: 0 },
  9001: { currency: 'KRW', initial: 550000, final: 550000, discount_percent: 0 }
})
const pricesUs: Record<number, any> = {
  620: { currency: 'USD', initial: 999, final: 999, discount_percent: 0 },
  1145360: { currency: 'USD', initial: 2499, final: 1249, discount_percent: 50 },
  413150: { currency: 'USD', initial: 1499, final: 1499, discount_percent: 0 },
  1086940: { currency: 'USD', initial: 5999, final: 5999, discount_percent: 0 }
}
const calls: string[] = []
const psnTokenCalls: string[] = []

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

setFetch((async (input: any, init?: any) => {
  const url = String(input)
  calls.push(url)
  const u = new URL(url)
  // ── PlayStation ──
  if (url.startsWith('https://ca.account.sony.com/api/authz/v3/oauth/authorize')) {
    assert.equal(init?.redirect, 'manual')
    assert.match(String(init?.headers?.Cookie), /npsso=NPSSO1/)
    return new Response(null, { status: 302, headers: { location: 'com.scee.psxandroid.scecompcall://redirect/?code=v3.CODE&cid=x' } })
  }
  if (url === 'https://ca.account.sony.com/api/authz/v3/oauth/token') {
    const form = new URLSearchParams(String(init?.body))
    psnTokenCalls.push(form.get('grant_type') ?? '')
    if (form.get('grant_type') === 'refresh_token' && form.get('refresh_token') === 'EXPIRED') return json({ error: 'invalid_grant' }, 400)
    return json({ access_token: 'AT', refresh_token: form.get('grant_type') === 'refresh_token' ? 'RT2' : 'RT1', expires_in: 3600 })
  }
  if (url.startsWith('https://m.np.playstation.com/api/gamelist/v2/users/me/titles')) {
    assert.equal(init?.headers?.Authorization, 'Bearer AT')
    const offset = Number(u.searchParams.get('offset'))
    if (offset === 0)
      return json({
        titles: [
          { titleId: 'PPSA01', name: 'ELDEN RING', localizedName: '엘든 링', category: 'ps5_native_game', concept: { genres: ['ROLE_PLAYING_GAMES', 'ACTION'] }, imageUrl: 'https://img/er.png', playDuration: 'PT61H30M12S', lastPlayedDateTime: '2026-10-01T10:00:00Z' },
          { titleId: 'CUSA02', name: 'Bloodborne™', category: 'ps4_game', imageUrl: 'https://img/bb.png', playDuration: 'P1DT2H', lastPlayedDateTime: '2024-01-01T00:00:00Z' }
        ],
        nextOffset: 2,
        totalItemCount: 3
      })
    return json({ titles: [{ titleId: 'PPSA03', name: 'Astro Bot', category: 'ps5_native_game', playDuration: 'PT45M' }], totalItemCount: 3 })
  }
  if (url.startsWith('https://m.np.playstation.com/api/trophy/v1/users/me/trophyTitles')) {
    return json({
      trophyTitles: [
        { npCommunicationId: 'NPWR1', trophyTitleName: 'Bloodborne', trophyTitlePlatform: 'PS4', definedTrophies: { bronze: 26, silver: 9, gold: 4, platinum: 1 }, earnedTrophies: { bronze: 26, silver: 9, gold: 4, platinum: 1 } },
        { npCommunicationId: 'NPWR2', trophyTitleName: 'Demon\'s Souls', trophyTitlePlatform: 'PS3', trophyTitleIconUrl: 'https://img/ds.png', definedTrophies: { bronze: 20, silver: 10, gold: 5, platinum: 1 }, earnedTrophies: { bronze: 3 }, lastUpdatedDateTime: '2012-05-05T00:00:00Z' }
      ],
      totalItemCount: 2
    })
  }
  if (url.includes('us-prof.np.community.playstation.net')) return json({ profile: { onlineId: 'psn_user' } })
  if (url.includes('basicPresences')) return json({ basicPresence: { primaryPlatformInfo: { onlineStatus: 'online', platform: 'PS5' }, gameTitleInfoList: [{ npTitleId: 'PPSA01', titleName: 'ELDEN RING', launchPlatform: 'PS5' }] } })
  // ── Nintendo ──
  if (url === 'https://accounts.nintendo.com/connect/1.0.0/api/session_token') {
    const f = new URLSearchParams(String(init?.body))
    assert.equal(f.get('session_token_code'), 'STC')
    assert.ok(f.get('session_token_code_verifier'))
    return json({ session_token: 'NSESSION', code: 'x' })
  }
  if (url === 'https://accounts.nintendo.com/connect/1.0.0/api/token') {
    const b = JSON.parse(String(init?.body))
    if (b.session_token === 'NEXPIRED') return json({ error: 'invalid_grant' }, 400)
    assert.equal(b.grant_type, 'urn:ietf:params:oauth:grant-type:jwt-bearer-session-token')
    return json({ access_token: 'NAT', expires_in: 900 })
  }
  if (url === 'https://api.accounts.nintendo.com/2.0.0/users/me') return json({ nickname: '닌텐도유저' })
  if (url === 'https://app-api.znej.nintendo.com/api/v2.0/users/me/play_histories') {
    assert.equal(init?.headers?.Authorization, 'Bearer NAT')
    return json({
      playHistories: [
        { titleId: '0100F2C0115B6000', titleName: '젤다의 전설 티어스 오브 더 킹덤', platform: 'Nintendo Switch', imageUrl: 'https://img/totk.jpg', firstPlayedAt: '2023-05-12T10:00:00+09:00', lastPlayedAt: '2026-10-28T22:00:00+09:00', totalPlayedMinutes: 9120 },
        { titleId: '0100A3D008C5C000', titleName: 'Mario Kart World', platform: 'Nintendo Switch 2', totalPlayedMinutes: 600, lastPlayedAt: '2026-10-30T20:00:00+09:00' }
      ],
      recentPlayHistories: [
        { playedDate: '2026-10-28', dailyPlayHistories: [{ titleId: '0100F2C0115B6000', totalPlayedMinutes: 90 }] },
        { playedDate: '2026-10-30', dailyPlayHistories: [{ titleId: '0100A3D008C5C000', totalPlayedMinutes: 45 }, { titleId: '0100F2C0115B6000', totalPlayedMinutes: 30 }] }
      ]
    })
  }
  // ── Xbox (OpenXBL) ──
  if (url.startsWith('https://xbl.io/api/v2/')) {
    if (init?.headers?.['X-Authorization'] !== 'XKEY') return json({ error: 'unauthorized' }, 401)
    if (url.endsWith('/presence')) return json([{ xuid: '2535', state: 'Online', devices: [{ type: 'Scarlett', titles: [{ id: '750323071', name: 'Home', placement: 'Background', state: 'Active' }, { id: '1', name: 'Halo Infinite', placement: 'Full', state: 'Active' }] }] }])
    if (url.endsWith('/account')) return json({ profileUsers: [{ id: '2535', settings: [{ id: 'Gamertag', value: 'MyTag' }] }] })
    return json({
      xuid: '2535',
      titles: [
        { titleId: '1', name: 'Halo Infinite', type: 'Game', devices: ['XboxSeries', 'PC'], displayImage: 'https://img/halo.png', achievement: { currentAchievements: 30, totalAchievements: 119, currentGamerscore: 300, totalGamerscore: 1500 }, titleHistory: { lastTimePlayed: '2026-10-20T00:00:00Z' } },
        { titleId: '2', name: 'ELDEN RING', type: 'Game', devices: ['XboxOne'], achievement: { currentAchievements: 0, totalAchievements: 42, currentGamerscore: 0, totalGamerscore: 1000 }, titleHistory: { lastTimePlayed: '2025-01-01T00:00:00Z' } },
        { titleId: '3', name: 'Netflix', type: 'App', devices: ['XboxSeries'] }
      ]
    })
  }
  if (url.includes('GetOwnedGames')) {
    return json({
      response: {
        game_count: 4,
        games: [
          { appid: 620, name: 'Portal 2', playtime_forever: 1200, playtime_2weeks: 60, rtime_last_played: now - 3600, has_community_visible_stats: true },
          { appid: 1145360, name: 'Hades', playtime_forever: 10, rtime_last_played: 0, has_community_visible_stats: true },
          { appid: 413150, name: 'Stardew Valley', playtime_forever: 3000, rtime_last_played: now - 86400 * 200, has_community_visible_stats: true },
          { appid: 570, name: 'Dota 2', playtime_forever: 5000, rtime_last_played: now - 86400 * 400, has_community_visible_stats: false }
        ]
      }
    })
  }
  if (url.includes('GetWishlist')) return json({ response: { items: [{ appid: 1086940, priority: 1, date_added: now - 1000 }] } })
  if (url.includes('store.steampowered.com/api/appdetails')) {
    const ids = (u.searchParams.get('appids') ?? '').split(',').map(Number)
    const cc = u.searchParams.get('cc')
    if (u.searchParams.get('filters') === 'price_overview') {
      const src = cc === 'kr' ? pricesKr() : pricesUs
      const out: any = {}
      for (const id of ids) out[id] = (src as any)[id] ? { success: true, data: { price_overview: (src as any)[id] } } : { success: true, data: [] }
      return json(out)
    }
    const id = ids[0]
    return json({ [id]: apps[id] ? { success: true, data: { ...apps[id], price_overview: (pricesKr() as any)[id] } } : { success: false } })
  }
  if (url.includes('IStoreBrowseService/GetDLCForApps/')) {
    return json({ response: { dlc_data: dlcMode === 'owned' ? [{ appid: 9001, parentappid: 620 }, { appid: 9003, parentappid: 620 }] : [] } })
  }
  if (url.includes('IStoreBrowseService/GetItems')) {
    const input = JSON.parse(u.searchParams.get('input_json')!)
    const items = input.ids.map((x: any) => {
      const id = x.appid
      const names: Record<number, string> = { 9001: '포탈 2 사운드트랙', 9002: 'Peer Review' }
      return {
        item_type: 0, id, appid: id, success: 1, name: names[id] ?? 'G' + id, is_free: id === 9002,
        related_items: names[id] ? { parent_appid: 620 } : undefined,
        assets: id === 9001 ? { asset_url_format: 'steam/apps/9001/abc123/${FILENAME}?t=1', header: 'header.jpg' } : undefined,
        reviews: id === 9002 ? undefined : { summary_filtered: { review_count: 1000 + id % 7, percent_positive: 95, review_score: 9, review_score_label: '압도적으로 긍정적' } }
      }
    })
    return json({ response: { store_items: items } })
  }
  if (url.includes('GetGlobalAchievementPercentagesForApp')) {
    return json({ achievementpercentages: { achievements: [{ name: 'A1', percent: '2.5' }, { name: 'A2', percent: 40 }, { name: 'B1', percent: 0.7 }] } })
  }
  if (url.includes('lookup/id/shop/61')) {
    const body = JSON.parse(init.body) as string[]
    return json(Object.fromEntries(body.map((b) => [b, b === 'app/570' ? null : 'itad-' + b.slice(4)])))
  }
  if (url.includes('games/storelow/v2')) {
    const body = JSON.parse(init.body) as string[]
    const kr = u.searchParams.get('country') === 'KR'
    return json(
      body.map((id) => {
        const appid = Number(id.replace('itad-', ''))
        const lowKr: Record<number, number> = { 620: 2300, 1145360: 9600, 413150: 8000, 1086940: 52800 }
        const lowUs: Record<number, number> = { 620: 1.99, 1145360: 9.99, 413150: 7.49, 1086940: 47.99 }
        return {
          id,
          lows: [
            {
              shop: { id: 61, name: 'Steam' },
              price: kr ? { amount: lowKr[appid], currency: 'KRW' } : { amount: lowUs[appid], currency: 'USD' },
              regular: kr ? { amount: 11500, currency: 'KRW' } : { amount: 9.99, currency: 'USD' },
              cut: 80,
              timestamp: '2024-06-27T19:00:00+02:00'
            }
          ]
        }
      })
    )
  }
  if (url.includes('GetPlayerAchievements')) {
    const appid = Number(u.searchParams.get('appid'))
    if (appid === 620)
      return json({
        playerstats: {
          success: true,
          achievements: [
            { apiname: 'A1', achieved: 1, unlocktime: now - 5000, name: '첫걸음', description: '시작' },
            { apiname: 'A2', achieved: 0, unlocktime: 0, name: '두번째', description: '' }
          ]
        }
      })
    if (appid === 413150)
      return json({ playerstats: { success: true, achievements: [{ apiname: 'B1', achieved: 1, unlocktime: now - 9000, name: '농부' }] } })
    return json({ playerstats: { error: 'Requested app has no stats', success: false } }, 400)
  }
  if (url.includes('GetSchemaForGame')) {
    return json({ game: { availableGameStats: { achievements: [{ name: 'A1', displayName: '첫걸음', icon: 'https://i/a1.jpg', icongray: 'https://i/a1g.jpg' }] } } })
  }
  return json({ error: 'unmocked ' + url }, 404)
}) as typeof fetch)

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'pl-'))
  const states: string[] = []
  const notes: string[] = []
  const core = new Core(join(dir, 'test.db'), plainCodec, {
    syncState: (s) => states.push(`${s.phase}:${s.label}:${s.current}/${s.total}${s.error ? ' ERR ' + s.error : ''}`),
    nowPlaying: () => {},
    dataChanged: () => {},
    notify: (t, b) => notes.push(`${t}|${b}`)
  })
  console.log('driver', core.db.driver)
  core.settings.save({ steamApiKey: 'K', steamId: '76561198000000000', itadApiKey: 'I' })

  const t0 = Date.now()
  await core.sync.run('full')
  console.log('full sync took', ((Date.now() - t0) / 1000).toFixed(1), 's; warnings', core.sync.getState().warnings, 'error', core.sync.getState().error)
  assert.equal(core.sync.getState().error, null)

  let games = core.repo.listGames()
  assert.equal(games.length, 4)
  const portal = games.find((g) => g.appid === 620)!
  assert.equal(portal.nameKo, '포탈 2')
  assert.deepEqual(portal.priceKr && [portal.priceKr.initial, portal.priceKr.final], [11500, 11500])
  assert.deepEqual(portal.priceUs && [portal.priceUs.initial, portal.priceUs.final], [999, 999])
  assert.equal(portal.lowKr?.amount, 2300)
  assert.equal(portal.lowKr?.source, 'itad')
  assert.equal(portal.lowUs?.amount, 199)
  assert.equal(portal.achTotal, 2)
  assert.equal(portal.achDone, 1)
  assert.equal(portal.status, 'playing')
  assert.equal(portal.statusAuto, true)
  const sdv = games.find((g) => g.appid === 413150)!
  assert.equal(sdv.status, 'completed', '도전과제 100% → 자동 100%')
  const dota = games.find((g) => g.appid === 570)!
  assert.equal(dota.isFree, true)
  assert.equal(dota.priceKr, null)
  assert.equal(dota.lowKr, null)
  const hades = games.find((g) => g.appid === 1145360)!
  assert.equal(hades.priceKr?.discount, 50)
  assert.equal(hades.achTotal, 0, '도전과제 없는 게임은 0으로 기록')

  // DLC·평가·희귀도
  const dlcs = core.repo.listDlcs()
  assert.equal(dlcs.length, 2)
  assert.equal(dlcs[0].name, '포탈 2 사운드트랙')
  assert.equal(dlcs[0].priceKr?.initial, 5500)
  assert.equal(dlcs[0].headerImage, 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/9001/abc123/header.jpg?t=1')
  assert.equal(dlcs[1].isFree, true)
  assert.equal(portal.dlcCount, 2)
  assert.equal(portal.review?.label, '압도적으로 긍정적')
  const rare = core.repo.rareAchievements(10)
  assert.equal(rare[0].name, '농부', '가장 희귀한 달성 도전과제가 먼저')
  assert.equal(rare[0].globalPct, 0.7)

  const wl = core.repo.listWishlist()
  assert.equal(wl.length, 1)
  assert.equal(wl[0].name, "Baldur's Gate 3")
  assert.equal(wl[0].priceKr?.final, 66000)
  assert.equal(wl[0].lowKr?.amount, 52800)

  // 1.0에서 업데이트한 경우: DLC 목록이 비어 있고 확인 시각도 없음 → 다음 동기화에서 한 번에 채움
  core.db.exec(`UPDATE steam_app SET dlc = '[]', dlc_checked_at = NULL WHERE appid = 620`)
  assert.equal(core.repo.listDlcs().length, 0)
  assert.deepEqual(core.repo.ownedGamesUncheckedDlc(), [620])
  dlcMode = 'owned'
  await core.sync.run('daily')
  assert.equal(core.sync.getState().error, null)
  const after = core.repo.listDlcs().map((d) => d.appid).sort()
  assert.deepEqual(after, [9001, 9003])
  assert.deepEqual(core.repo.ownedGamesUncheckedDlc(), [])
  console.log('dlc backfill ok', after)

  // 보유 DLC 자동 반영
  {
    const owned = () => core.repo.listDlcs().filter((d) => d.owned).map((d) => `${d.appid}:${d.ownedSource}`).sort()
    // 로그인 없음 → 설치 폴더
    core.sync.ownedAppsSource = async () => null
    core.sync.installedDlcSource = async () => [9003, 777]
    let r = await core.sync.checkOwnedDlc()
    assert.deepEqual([r.source, r.owned, r.added, r.removed], ['installed', 1, 1, 0])
    assert.deepEqual(owned(), ['9003:installed'])
    // Steam 로그인 보유 목록: 9001 보유, 9003 은 목록에 없음(환불) → 해제
    core.sync.ownedAppsSource = async () => [620, 9001]
    r = await core.sync.checkOwnedDlc()
    assert.deepEqual([r.source, r.owned, r.added, r.removed], ['store', 1, 1, 1])
    assert.deepEqual(owned(), ['9001:store'])
    // 직접 해제한 DLC 는 보유 목록이 다시 체크하지 않음
    core.repo.setDlcOwned(9001, false, 'manual')
    r = await core.sync.checkOwnedDlc()
    assert.deepEqual(owned(), [])
    // 직접 체크한 DLC 는 목록에 없어도 유지
    core.repo.setDlcOwned(9003, true, 'manual')
    r = await core.sync.checkOwnedDlc()
    assert.deepEqual(owned(), ['9003:manual'])
    // 보유 목록 오류 → 설치 폴더로 대체
    core.sync.ownedAppsSource = async () => { throw new Error('x') }
    core.sync.installedDlcSource = async () => null
    assert.equal((await core.sync.checkOwnedDlc()).source, 'none')
    core.db.exec('DELETE FROM dlc_owned')
    core.sync.ownedAppsSource = null
    console.log('owned dlc ok')
  }

  // ── 다른 플랫폼 ──
  {
    assert.equal(isoDurationMinutes('PT61H30M12S'), 3690)
    assert.equal(isoDurationMinutes('P1DT2H'), 1560)
    assert.equal(isoDurationMinutes(undefined), 0)
    assert.equal(titleKey('Bloodborne™'), titleKey('BLOODBORNE'))
    assert.equal(titleKey('ELDEN RING (PS4 & PS5)'), titleKey('Elden Ring'))
    assert.equal(titleKey('Ghost of Tsushima Director\'s Cut PS4 & PS5'), titleKey("Ghost of Tsushima Director's Cut"))
    // 로그인 흐름: NPSSO → 코드 → 토큰
    const code = await codeFromNpsso('NPSSO1')
    assert.equal(code, 'v3.CODE')
    const tk = await tokensFromCode(code)
    assert.deepEqual(tk, { accessToken: 'AT', refreshToken: 'RT1' })
    core.settings.save({ psnRefreshToken: 'RT1', psnAccount: 'psn_user' })
    assert.equal(await xblAccount('XKEY'), 'MyTag')
    await assert.rejects(xblAccount('BAD'), /OpenXBL API 키/)
    core.settings.save({ xblApiKey: 'XKEY', xblAccount: 'MyTag' })

    // 닌텐도 로그인: PKCE 주소 → 리다이렉트 → 세션 토큰
    const req = nintendoAuthUrl()
    const au = new URL(req.url)
    assert.equal(au.searchParams.get('client_id'), '5c38e31cd085304b')
    assert.equal(au.searchParams.get('redirect_uri'), 'npf5c38e31cd085304b://auth')
    assert.equal(au.searchParams.get('session_token_code_challenge'), createHash('sha256').update(req.verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''))
    assert.equal(parseNintendoRedirect('https://example.com', req.state), null)
    assert.throws(() => parseNintendoRedirect(`npf5c38e31cd085304b://auth#session_token_code=STC&state=WRONG`, req.state), /확인값/)
    const stc = parseNintendoRedirect(`npf5c38e31cd085304b://auth#session_token_code=STC&state=${req.state}&session_state=x`, req.state)!
    const nst = await nintendoSessionToken(stc, req.verifier)
    assert.equal(nst, 'NSESSION')
    assert.equal(await nintendoNickname(await nintendoAccess(nst)), '닌텐도유저')
    assert.equal(nintendoDevice({ platform: 'Nintendo Switch 2' }), 'Switch 2')
    assert.equal(nintendoDevice({ platform: 'Nintendo Switch' }), 'Switch')
    core.settings.save({ nintendoSessionToken: 'NSESSION', nintendoAccount: '닌텐도유저' })

    // 지금 플레이 중 (콘솔)
    const pp = await psnPresence('AT')
    assert.deepEqual(pp, { platform: 'psn', gameId: 'PPSA01', name: 'ELDEN RING', device: 'PS5' })
    const xp = await xboxPresence('XKEY')
    assert.deepEqual(xp, { platform: 'xbox', gameId: '1', name: 'Halo Infinite', device: 'Xbox Series' })

    // 직접 추가한 게임 (동기화가 지우지 않아야 함)
    const sw = core.repo.addManualGame({ platform: 'switch', name: '포켓몬 레전즈 Z-A', playtimeMin: 6000, image: 'https://img/totk.png', device: 'Switch' })
    const psManual = core.repo.addManualGame({ platform: 'psn', name: 'Disc Game', playtimeMin: 0, image: null, device: 'PS4' })
    // 닌텐도 연결 전에 직접 넣어 둔 같은 게임 → 동기화하면 합쳐짐
    const swDup = core.repo.addManualGame({ platform: 'switch', name: 'Mario Kart World', playtimeMin: 100, image: null, device: 'Switch 2' })
    core.repo.patchUserData(swDup, { purchasePrice: 79800, purchaseDate: '2025-06-05', status: 'playing', notes: '패키지' })

    await core.sync.run('daily')
    const st = core.sync.getState()
    assert.equal(st.error, null)
    assert.deepEqual(st.warnings, [])
    assert.equal(core.settings.get().psnRefreshToken, 'RT2', '갱신된 토큰 저장')
    const all = core.repo.listGames()
    const ps = all.filter((g) => g.platform === 'psn')
    const er = ps.find((g) => g.gameId === 'PPSA01')!
    assert.equal(er.name, '엘든 링')
    assert.equal(er.playtimeMin, 3690)
    assert.equal(er.device, 'PS5')
    assert.equal(er.headerImage, 'https://img/er.png')
    const bb = ps.find((g) => g.gameId === 'CUSA02')!
    assert.deepEqual([bb.achDone, bb.achTotal, bb.trophies?.platinum], [40, 40, 1], '이름으로 트로피 연결')
    assert.equal(bb.status, 'completed', '트로피 100% → 100% 태그')
    const ds = ps.find((g) => g.gameId === 'NPWR2')!
    assert.deepEqual([ds.playtimeKnown, ds.device, ds.achDone, ds.achTotal], [false, 'PS3', 3, 36])
    assert.ok(ps.some((g) => g.key === psManual), 'PSN 동기화가 직접 추가한 PSN 게임을 지우지 않음')
    const xb = all.filter((g) => g.platform === 'xbox')
    assert.equal(xb.length, 2, '앱은 제외')
    const halo = xb.find((g) => g.gameId === '1')!
    assert.deepEqual([halo.playtimeKnown, halo.device, halo.gamerscore?.done, halo.gamerscore?.total, halo.achDone], [false, 'Xbox Series', 300, 1500, 30])
    assert.equal(isUnplayed(halo, 30), false, '플레이타임을 몰라도 실행 기록이 있으면 안 한 게임 아님')
    const ns = all.filter((g) => g.platform === 'switch' && !g.manual)
    assert.equal(ns.length, 2)
    const totk = ns.find((g) => g.gameId === '0100F2C0115B6000')!
    assert.deepEqual([totk.playtimeMin, totk.playtime2wMin, totk.device, totk.headerImage, totk.playtimeKnown], [9120, 120, 'Switch', 'https://img/totk.jpg', true])
    const mk = ns.find((g) => g.gameId === '0100A3D008C5C000')!
    assert.equal(mk.device, 'Switch 2')
    assert.ok(!all.some((g) => g.key === swDup), '직접 추가한 같은 게임은 지워짐')
    assert.deepEqual([mk.purchasePrice, mk.purchaseDate, mk.status, mk.notes], [79800, '2025-06-05', 'playing', '패키지'], '입력값은 옮겨짐')
    // 플래티넘 = 100%
    assert.equal(suggestStatus({ ...bb, achDone: 40, achTotal: 45, status: 'none', statusAuto: false }), 'completed')
    // PS 장르가 취향에 반영
    const prof = genreProfile(all, 30)
    const rpg = prof.find((p) => p.id === '3')
    assert.ok(rpg && rpg.top.some((t) => t.platform === 'psn'), 'PS 게임이 RPG 취향에 반영')
    assert.ok(becauseOf(['3', '1'], prof).length > 0)
    // 콘솔 플레이 중 → 라이브러리 게임과 연결
    const np = core.nowPlaying.resolveConsole({ platform: 'psn', gameId: 'PPSA01', name: 'ELDEN RING', device: 'PS5' })
    assert.equal(np.key, er.key)
    const np2 = core.nowPlaying.resolveConsole({ platform: 'xbox', gameId: null, name: 'Halo Infinite' })
    assert.equal(np2.key, halo.key)
    // 추천: 다른 플랫폼에 이미 있는 게임은 빼고, 추천 이유를 함께 준다
    core.repo.replaceRecoPool([
      { appid: 976730, name: 'Halo Infinite', genres: ['Action'], positive: 90000, negative: 1000 },
      { appid: 990001, name: 'Great RPG', genres: ['RPG', 'Action'], positive: 50000, negative: 1000 }
    ])
    const reco = await core.insights.recommendations(false)
    assert.ok(!reco.candidates.some((c) => c.name === 'Halo Infinite'), 'Xbox에 있는 게임은 추천 안 함')
    const great = reco.candidates.find((c) => c.name === 'Great RPG')!
    assert.ok(great.reason && great.reason.genres.length === 2 && great.reason.quality != null)
    assert.ok(great.reason.because.some((b) => b.platform === 'psn'), '추천 이유에 PS 게임')
    assert.ok(Math.abs(great.score - (great.reason.match * 0.65 + great.reason.quality! * 0.35)) < 1e-9)
    const bl = reco.backlog[0]
    assert.ok(!bl || (bl.key && bl.reason && bl.reason.quality === null))
    // CSV 에 플랫폼 열
    const csv = libraryCsv(core.repo.listGames(), core.settings.get())
    assert.match(csv.split('\r\n')[0], /^\uFEFF?플랫폼,기기,/)
    assert.ok(csv.includes('PlayStation,PS5,PPSA01,엘든 링'))
    const zelda = all.find((g) => g.key === sw)!
    assert.deepEqual([zelda.manual, zelda.playtimeMin, zelda.headerImage, zelda.device], [true, 6000, 'https://img/totk.png', 'Switch'])

    // 직접 추가한 게임 고치기·지우기
    core.repo.updateManualGame(sw, { playtimeMin: 6600, name: '젤다 티오킹' })
    const z2 = core.repo.listGames().find((g) => g.key === sw)!
    assert.deepEqual([z2.name, z2.playtimeMin], ['젤다 티오킹', 6600])
    assert.throws(() => core.repo.updateManualGame(er.key, { name: 'x' }), /직접 추가한 게임만/)
    core.repo.deleteManualGame(psManual)
    assert.ok(!core.repo.listGames().some((g) => g.key === psManual))

    // 갱신 토큰 만료 → 경고만 남기고 Steam 동기화는 계속
    core.settings.save({ psnRefreshToken: 'EXPIRED' })
    await core.sync.run('daily')
    assert.equal(core.sync.getState().error, null)
    assert.ok(core.sync.getState().warnings.some((w) => /PlayStation 로그인이 만료/.test(w)))
    // 닌텐도 로그인 만료 → 경고만
    core.settings.save({ nintendoSessionToken: 'NEXPIRED' })
    await core.sync.run('daily')
    assert.ok(core.sync.getState().warnings.some((w) => /닌텐도 로그인이 만료/.test(w)))
    core.settings.save({ psnRefreshToken: '', xblApiKey: '', nintendoSessionToken: '' })
    assert.equal(core.repo.removePlatformGames('switch'), 2)
    core.repo.patchUserData(er.key, { purchasePrice: 30000 })
    assert.equal(core.repo.removePlatformGames('psn'), 4)
    assert.equal(core.repo.removePlatformGames('xbox'), 2)
    core.repo.deleteManualGame(sw)
    assert.ok(core.repo.listGames().every((g) => g.platform === 'steam'))
    console.log('platforms ok', { psn: ps.length, xbox: xb.length })
  }

  // 자동 백업: 7일마다, 8개만 보관
  {
    const dir = join(mkdtempSync(join(tmpdir(), 'gs-bk-')), 'backups')
    const day = 86_400_000
    let t = Date.parse('2026-01-01T00:00:00Z')
    assert.ok(autoBackupIfDue(core.db, core.repo, dir, t))
    assert.equal(autoBackupIfDue(core.db, core.repo, dir, t + 3 * day), null, '7일 안에는 안 함')
    for (let i = 1; i <= 10; i++) {
      t += 7 * day
      assert.ok(autoBackupIfDue(core.db, core.repo, dir, t))
    }
    const files = readdirSync(dir).sort()
    assert.equal(files.length, 8)
    assert.equal(files[files.length - 1], `auto-${new Date(t).toISOString().slice(0, 10)}.db`)
    assert.ok(existsSync(join(dir, files[0])))
    console.log('auto backup ok')
  }

  // 상세 창: 한 번에 받고, 15분 안에 다시 열면 요청하지 않음
  {
    const t0 = Date.now()
    const c0 = calls.length
    const info = await core.insights.inspectPrice(620)
    const took = Date.now() - t0
    assert.equal(info.appid, 620)
    assert.ok(info.priceKr, '한국 가격')
    const used = calls.length - c0
    const again = await core.insights.inspectPrice(620)
    assert.equal(calls.length - c0, used, '캐시')
    assert.equal(again, info)
    console.log('inspect ok', { took, requests: used })
  }

  // 스토어 응답 파싱
  assert.equal(sp.steamIdFromLoginCookie('76561198012345678%7C%7CeyJhbGciOi'), '76561198012345678')
  assert.equal(sp.steamIdFromLoginCookie('garbage'), null)
  const page = `<script>g_sessionID = "abc123";</script><table class="wallet_history_table"><tbody>
<tr class="wallet_table_row wallet_table_row_amt_change"><td class="wht_date">2024년 6월 27일</td></tr>
<tr class="wallet_table_row"><td class="wht_date">2023년 1월 2일</td></tr></tbody></table>
<script>var g_historyCursor = {"wallet_txnid":"123","timestamp_newest":1700000000,"balance":"0","currency":16};</script>`
  assert.equal(sp.parseSessionId(page), 'abc123')
  const cur = sp.parseHistoryCursor(page)!
  assert.equal(cur.wallet_txnid, '123')
  assert.equal(sp.parseHistoryCursor('g_historyCursor = null;'), null)
  assert.equal(sp.loadMoreBody('abc123', cur).toString(), 'sessionid=abc123&cursor%5Bwallet_txnid%5D=123&cursor%5Btimestamp_newest%5D=1700000000&cursor%5Bbalance%5D=0&cursor%5Bcurrency%5D=16')
  const rows = sp.extractHistoryRows(page)
  assert.equal((rows.match(/<tr/g) ?? []).length, 2)
  assert.ok(!rows.includes('</table>'))
  assert.ok(sp.wrapHistory([rows, '<tr class="wallet_table_row"></tr>']).includes('</tbody></table>'))
  assert.deepEqual(sp.ownedAppsFromUserdata({ rgOwnedApps: [620, '9001', 'x'] }), [620, 9001])
  assert.deepEqual(sp.ownedAppsFromUserdata({}), [])
  assert.deepEqual(sp.installedDlcFromManifest('"InstalledDepots"\n{\n"621"\n{\n"manifest" "1"\n"dlcappid"\t\t"9001"\n}\n"622"\n{\n"dlcappid" "9003"\n}\n}'), [9001, 9003])
  assert.deepEqual(sp.libraryPaths('"0"\n{\n"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n}\n"1"\n{\n"path" "D:\\\\SteamLibrary"\n}'), ['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary'])
  console.log('store parse ok')

  // 목표가 알림: 66000 → 목표 70000 설정 후 확인
  core.repo.setTargetPrice(1086940, 70000)
  core.sync.checkWishlistAlerts(core.settings.get())
  assert.equal(notes.filter((n) => n.startsWith('목표가')).length, 1)
  core.sync.checkWishlistAlerts(core.settings.get())
  assert.equal(notes.filter((n) => n.startsWith('목표가')).length, 1, '같은 가격으로는 한 번만 알림')

  // 수동 상태는 자동 제안이 덮어쓰지 않음
  core.repo.patchUserData(portal.key, { status: 'later' })
  // 지출 기록 초기화: 가져온 것만 / 전부
  {
    const keys = core.repo.listGames().map((g) => g.key)
    core.repo.patchUserData(keys[0], { purchasePrice: 11111, purchaseDate: '2024-01-01' })
    core.repo.setImportedPurchase(keys[1], 2222, '2024-02-02')
    const get = (k: string) => core.repo.listGames().find((g) => g.key === k)!
    assert.equal(get(keys[1]).purchaseSource, 'history')
    assert.equal(core.repo.resetPurchases('imported'), 1)
    assert.equal(get(keys[1]).purchasePrice, null)
    assert.equal(get(keys[0]).purchasePrice, 11111, '직접 입력은 남음')
    core.repo.setImportedPurchase(keys[1], 2222, '2024-02-02')
    assert.ok(core.repo.resetPurchases('all') >= 2)
    assert.ok(core.repo.listGames().every((g) => g.purchasePrice == null && g.purchaseDate == null && g.acquiredDate == null))
    core.repo.patchUserData(keys[0], { purchasePrice: 5000 })
    assert.equal(get(keys[0]).purchasePrice, 5000, '초기화 후 다시 입력')
    core.repo.patchUserData(keys[0], { purchasePrice: null })
  }
  // 가격 변동 → 이력 기록, 프로그램 기록이 ITAD보다 낮으면 그 값이 최저가
  krPortal = { currency: 'KRW', initial: 1150000, final: 200000, discount_percent: 83 }
  const callsBefore = calls.length
  await core.sync.run('daily')
  const detailCalls = calls.slice(callsBefore).filter((c) => c.includes('appdetails') && !c.includes('filters=')).length
  assert.equal(detailCalls, 0, 'daily 동기화는 상세 정보를 다시 받지 않음')
  const achCalls = calls.slice(callsBefore).filter((c) => c.includes('GetPlayerAchievements')).length
  assert.equal(achCalls, 0, '플레이타임 변화 없으면 도전과제 재조회 안 함')
  games = core.repo.listGames()
  const portal2 = games.find((g) => g.appid === 620)!
  assert.equal(portal2.status, 'later')
  assert.equal(portal2.lowKr?.amount, 2000)
  assert.equal(portal2.lowKr?.source, 'self')
  const hist = core.repo.priceHistory(620, 'kr')
  assert.equal(hist.length, 2)
  console.log('price history', hist.map((h) => `${h.final}(${h.discount}%)`).join(' → '))

  // 구매 내역 가져오기: 한 결제에 두 게임 → 정가 비율로 분배
  const imp = importPurchases(core.repo, [
    { date: '2023-05-03', items: ['Portal 2', 'Hades™'], type: '구매', total: 30000, currency: 'KRW', isRefund: false, isGamePurchase: true },
    { date: '2024-01-10', items: ['Stardew Valley'], type: '구매', total: 8000, currency: 'KRW', isRefund: false, isGamePurchase: true },
    { date: '2024-02-01', items: ['Unknown Game'], type: '구매', total: 5000, currency: 'KRW', isRefund: false, isGamePurchase: true },
    { date: '2024-03-01', items: ['Dota 2 Battle Pass'], type: '게임 내 구매', total: 9000, currency: 'KRW', isRefund: false, isGamePurchase: false }
  ])
  console.log('import', imp)
  assert.equal(imp.matched, 3)
  assert.equal(imp.unmatched.length, 1)
  games = core.repo.listGames()
  const p3 = games.find((g) => g.appid === 620)!
  const h3 = games.find((g) => g.appid === 1145360)!
  assert.equal(p3.purchasePrice! + h3.purchasePrice!, 30000)
  assert.equal(p3.purchasePrice, Math.round((30000 * 11500) / (11500 + 24000)))
  // 직접 입력값은 가져오기가 덮어쓰지 않음
  core.repo.patchUserData(h3.key, { purchasePrice: 12345 })
  const imp2 = importPurchases(core.repo, [
    { date: '2023-05-03', items: ['Hades'], type: '구매', total: 99999, currency: 'KRW', isRefund: false, isGamePurchase: true }
  ])
  assert.equal(imp2.skippedManual, 1)
  assert.equal(core.repo.getGame(h3.key)?.purchasePrice, 12345)

  const lic = importLicenses(core.repo, [
    { date: '2015-02-02', name: 'Dota 2 - Commercial License', acquisition: 'Complimentary' },
    { date: '2019-01-01', name: 'Not owned', acquisition: 'Steam 상점' }
  ])
  assert.equal(lic.matched, 1)
  const lic2 = importLicenses(core.repo, [{ date: '2020-05-05', name: '포탈 2 사운드트랙', acquisition: 'Steam 상점' }])
  assert.equal(lic2.matched, 1)
  assert.equal(core.repo.listDlcs().find((d) => d.appid === 9001)?.owned, true, '라이선스 가져오기로 DLC 보유 표시')
  const applied = applyPurchases(core.repo, [{ key: 'steam:9001', amount: 3300, date: '2021-01-01' }])
  assert.equal(applied, 1)
  assert.equal(core.repo.listDlcs().find((d) => d.appid === 9001)?.purchasePrice, 3300)
  const yr = yearReview(core.repo, 2021)
  assert.equal(yr.spent >= 3300, true)
  console.log('year 2021 bought', yr.bought.map((b) => b.name + ':' + b.price))
  assert.equal(core.repo.getGame(dota.key)?.acquiredDate, '2015-02-02')

  // 분석
  games = core.repo.listGames()
  const s = core.settings.get()
  const included = games.filter((g) => !excludeReason(g, s))
  assert.equal(included.length, 3, '무료 게임 기본 제외')
  const t = moneyTotals(included)
  console.log('totals', t)
  assert.equal(t.regularKr, 11500 + 24000 + 16000)
  assert.equal(t.currentKr, 2000 + 12000 + 16000)
  assert.equal(t.lowKr, 2000 + 9600 + 8000)
  assert.equal(t.regularUs, 999 + 2499 + 1499)
  const sdv2 = games.find((g) => g.appid === 413150)!
  assert.equal(purchaseTiming(sdv2).grade, 'best')
  const cph = costPerHour(sdv2)
  assert.equal(Math.round(cph!), 160)
  const byYear = spendBy(included, 'year')
  console.log('spend by year', byYear)
  assert.equal(isUnplayed(hades, 30), true)
  assert.equal(dealVerdict(portal2.priceKr, portal2.lowKr), 'lowest')
  assert.equal(dealVerdict(hades.priceKr, { amount: 9600, regular: 24000, cut: 60, date: null, source: 'itad' }), 'wait')
  const prof = genreProfile(included, 30)
  console.log('genre profile', prof.map((p) => `${p.name}:${p.weight.toFixed(2)}`).join(', '))
  assert.equal(prof[0].weight, 1)

  // 스냅샷 → 활동 기록
  const ins = core.insights
  core.repo.saveSnapshot('2000-01-01', [{ platform: 'steam', gameId: '620', minutes: 100 }])
  const act = ins.activity(7)
  assert.equal(act.daily.length, 7)
  assert.ok(act.achievements.length >= 1, '최근 달성 도전과제')
  console.log('activity days', act.daily.length, 'top', act.topGames, 'ach', act.achievements.length)

  // HLTB 엔딩 시간 수동 입력
  core.repo.patchUserData(portal.key, { hltbMainManual: 8.5 })
  const rem = hltbRemaining(core.repo.getGame(portal.key)!)
  assert.equal(rem?.remaining, 0, '20시간 플레이 > 8.5시간')

  // 상세
  const det = ins.gameDetail(portal.key)
  assert.equal(det.achievements.length, 2)
  assert.equal(det.achievements[0].icon, 'https://i/a1.jpg')

  // 세션
  const sid = core.repo.startSession(portal.key, 'Portal 2', Date.now() - 60000)
  core.repo.endSession(sid, Date.now())
  assert.equal(core.repo.sessions({ key: portal.key }).length, 1)

  // CSV
  const csv = libraryCsv(games, s)
  assert.ok(csv.startsWith('﻿'))
  assert.equal(csv.split('\r\n').length, 5)

  // 백업 (VACUUM INTO)
  core.db.exec(`VACUUM INTO '${join(dir, 'backup.db').replace(/'/g, "''")}'`)

  core.close()
  console.log('states sample', states.filter((x) => !x.startsWith('idle')).slice(0, 6), '...', states.length)
}

// 단위 테스트
{
  const now0 = Date.now()
  // 최대 50% 할인한 적 있는 게임이 지금 40% 할인 중 → 역대 최저가는 50%
  const cur40 = { currency: 'KRW', initial: 10000, final: 6000, discount: 40, fetchedAt: now0 }
  const l1 = effectiveLow(null, cur40, null, 50)!
  assert.deepEqual([l1.amount, l1.cut, l1.source], [5000, 50, 'estimate'])
  // 할인하고 있지 않을 때도 50%
  const cur0 = { currency: 'KRW', initial: 10000, final: 10000, discount: 0, fetchedAt: now0 }
  const l2 = effectiveLow(null, cur0, null, 50)!
  assert.deepEqual([l2.amount, l2.cut], [5000, 50])
  // 한국 기록이 있으면 그 값을 쓴다
  const l3 = effectiveLow({ amount: 5000, regular: 10000, cut: 50, date: '2024-01-01', source: 'itad' }, cur40, null, 75)!
  assert.deepEqual([l3.amount, l3.cut, l3.source], [5000, 50, 'itad'])
  // 지금이 역대 최대 할인이면 현재가
  const cur60 = { currency: 'KRW', initial: 10000, final: 4000, discount: 60, fetchedAt: now0 }
  const l4 = effectiveLow({ amount: 5000, regular: 10000, cut: 50, date: '2024-01-01', source: 'itad' }, cur60, null)!
  assert.deepEqual([l4.amount, l4.cut], [4000, 60])
  // 달러는 센트 내림
  const l5 = effectiveLow(null, { currency: 'USD', initial: 5999, final: 5999, discount: 0, fetchedAt: now0 }, null, 50)!
  assert.equal(l5.amount, 2999)
}
assert.equal(toMinor('KRW', 3200000), 32000)
assert.equal(toMinor('USD', 5999), 5999)
assert.equal(amountToMinor('KRW', 32000), 32000)
assert.equal(amountToMinor('USD', 59.99), 5999)
assert.deepEqual(splitAmount(30000, [11500, 24000]), [9718, 20282])
assert.deepEqual(splitAmount(100, [0, 0, 0]), [33, 33, 34])
assert.equal(parseRunningAppId('\r\nHKEY_CURRENT_USER\\Software\\Valve\\Steam\r\n    RunningAppID    REG_DWORD    0x26c\r\n'), 620)
assert.equal(parseRunningAppId('    RunningAppID    REG_DWORD    0x0'), 0)
assert.equal(parseRunningAppId('ERROR'), null)
assert.equal(
  findSearchEndpoint('a=1;fetch("/api/user/log",{method:"POST"});x=fetch("/api/seek/".concat(t),{method:"POST",headers:h,body:b})'),
  '/api/seek'
)
assert.ok(similarity('Hades', 'HADES') === 1)
assert.equal(
  pickBest(
    [
      { hltbId: 1, name: 'Portal', main: 3, extra: 4, complete: 5, steamAppid: 400 },
      { hltbId: 2, name: 'Portal 2', main: 8.5, extra: 13, complete: 22, steamAppid: 620 }
    ],
    'Portal 2',
    620
  )?.hltbId,
  2
)
assert.equal(pickBest([{ hltbId: 3, name: 'Totally Different', main: 1, extra: 1, complete: 1, steamAppid: null }], 'Portal 2', null), null)

// 무료 배포 게임
{
  const low0 = { amount: 0, regular: 30000, cut: 100, date: null, source: 'itad' as const }
  assert.equal(isGiveaway({ isFree: false, lowKr: low0, lowUs: null, purchasePrice: null }), true)
  assert.equal(isGiveaway({ isFree: false, lowKr: low0, lowUs: null, purchasePrice: 0 }), true)
  assert.equal(isGiveaway({ isFree: false, lowKr: low0, lowUs: null, purchasePrice: 15000 }), false, '돈 내고 산 기록이 있으면 아님')
  assert.equal(isGiveaway({ isFree: true, lowKr: null, lowUs: null, purchasePrice: null }), false, '무료 게임은 따로')
  assert.equal(isGiveaway({ isFree: false, lowKr: { ...low0, amount: 9000, cut: 70 }, lowUs: low0, purchasePrice: null }), false, '한국 기록이 있으면 한국 기준')
  assert.equal(isGiveaway({ isFree: false, lowKr: null, lowUs: low0, purchasePrice: null }), true)
  const g = { excludedManual: false, isFree: false, lowKr: low0, lowUs: null, purchasePrice: null, genres: [], playtimeMin: 600 } as any
  const base = { excludeFree: true, excludeUnplayed: false, excludedGenres: [], unplayedMinutes: 30 }
  assert.equal(excludeReason(g, { ...base, excludeGiveaway: true }), 'giveaway')
  assert.equal(excludeReason(g, { ...base, excludeGiveaway: false }), null)
  console.log('giveaway ok')
}

main()
  .then(() => console.log('ALL OK'))
  .catch((e) => {
    console.error('FAILED', e)
    process.exit(1)
  })
