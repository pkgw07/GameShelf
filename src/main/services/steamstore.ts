// Steam 스토어 로그인 세션.
// 비밀번호는 프로그램이 다루지 않는다: Steam 공식 로그인 페이지를 별도 창에 띄우고,
// 로그인 후 생긴 쿠키(이 PC의 프로그램 데이터에만 저장)로 본인 계정 페이지를 읽는다.
//  - 보유 앱(게임 + DLC): store.steampowered.com/dynamicstore/userdata
//  - 구매 내역: /account/history (+ AjaxLoadMoreHistory 로 끝까지)
//  - 라이선스: /account/licenses
import { BrowserWindow, session, shell, type Session } from 'electron'
import type { StoreStatus } from '@shared/types'
import {
  extractHistoryRows,
  loadMoreBody,
  ownedAppsFromUserdata,
  parseHistoryCursor,
  parseSessionId,
  steamIdFromLoginCookie,
  wrapHistory
} from './storeparse'

const STORE = 'https://store.steampowered.com'
const PARTITION = 'persist:steam-store'
const MAX_PAGES = 300

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class SteamStore {
  constructor() {
    // 일부 사이트가 Electron 표시가 있는 브라우저를 막으므로 일반 Chrome 과 같은 이름으로 접속
    const ses = this.ses
    ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|gameshelf|GameShelf)\/\S+/g, ''))
  }

  private get ses(): Session {
    return session.fromPartition(PARTITION)
  }

  private async loginCookie(): Promise<string | null> {
    const c = await this.ses.cookies.get({ url: STORE, name: 'steamLoginSecure' })
    return c[0]?.value ?? null
  }

  async status(expectedSteamId: string): Promise<StoreStatus> {
    const steamId = steamIdFromLoginCookie(await this.loginCookie())
    return { loggedIn: Boolean(steamId), steamId, matches: steamId != null && (!expectedSteamId || steamId === expectedSteamId) }
  }

  /** Steam 로그인 창을 띄우고, 로그인이 끝나면 닫는다. 사용자가 창을 닫으면 false */
  login(parent: BrowserWindow | null): Promise<boolean> {
    return new Promise((resolve) => {
      const win = new BrowserWindow({
        width: 520,
        height: 760,
        parent: parent ?? undefined,
        modal: Boolean(parent),
        title: 'Steam 로그인',
        autoHideMenuBar: true,
        webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false }
      })
      // 새 창(도움말 링크 등)은 기본 브라우저로
      win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https:\/\//.test(url)) void shell.openExternal(url)
        return { action: 'deny' }
      })
      let done = false
      const finish = (ok: boolean): void => {
        if (done) return
        done = true
        clearInterval(timer)
        if (!win.isDestroyed()) win.close()
        resolve(ok)
      }
      const timer = setInterval(async () => {
        if (win.isDestroyed()) return
        const url = win.webContents.getURL()
        if (steamIdFromLoginCookie(await this.loginCookie()) && url.startsWith(STORE) && !/\/login/.test(url)) finish(true)
      }, 800)
      win.on('closed', () => finish(false))
      void win.loadURL(`${STORE}/login/?redir=account%2F&l=koreana`)
    })
  }

  async logout(): Promise<void> {
    await this.ses.clearStorageData()
  }

  private async get(path: string): Promise<Response> {
    const r = await this.ses.fetch(`${STORE}${path}`, { headers: { 'Accept-Language': 'ko-KR,ko;q=0.9' } })
    if (!r.ok) throw new Error(`Steam 스토어 응답 오류 (${r.status})`)
    if (/\/login/.test(r.url)) throw new Error('Steam 로그인이 풀렸습니다. 다시 로그인해 주세요.')
    return r
  }

  /** 보유 앱 appid (게임 + DLC). 로그인이 안 되어 있으면 null */
  async ownedApps(): Promise<number[] | null> {
    if (!steamIdFromLoginCookie(await this.loginCookie())) return null
    const r = await this.get(`/dynamicstore/userdata/?t=${Date.now()}`)
    const apps = ownedAppsFromUserdata(await r.json())
    // 로그인이 만료되면 빈 목록이 온다 → 아무것도 바꾸지 않도록 null
    return apps.length ? apps : null
  }

  /** 구매 내역 전체를 한 장의 HTML 로 (렌더러의 구매 내역 파서로 읽는다) */
  async purchaseHistoryHtml(onPage?: (n: number) => void): Promise<{ html: string; pages: number }> {
    const first = await (await this.get('/account/history/?l=koreana')).text()
    const rows = [extractHistoryRows(first)]
    let cursor = parseHistoryCursor(first)
    const sid = parseSessionId(first) ?? (await this.ses.cookies.get({ url: STORE, name: 'sessionid' }))[0]?.value ?? null
    let pages = 1
    onPage?.(pages)
    while (cursor && sid && pages < MAX_PAGES) {
      await sleep(400)
      const r = await this.ses.fetch(`${STORE}/account/AjaxLoadMoreHistory/?l=koreana`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
        body: loadMoreBody(sid, cursor).toString()
      })
      if (!r.ok) throw new Error(`구매 내역을 더 불러오지 못했습니다 (${r.status})`)
      const j = (await r.json()) as { success?: number; html?: string; cursor?: typeof cursor }
      if (j.success !== 1) break
      if (j.html) rows.push(j.html)
      cursor = j.cursor && j.cursor.wallet_txnid != null ? j.cursor : null
      pages++
      onPage?.(pages)
    }
    return { html: wrapHistory(rows), pages }
  }

  async licensesHtml(): Promise<string> {
    return (await this.get('/account/licenses/?l=koreana')).text()
  }
}
