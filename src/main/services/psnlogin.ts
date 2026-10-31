// 콘솔 계정 로그인 창 (PlayStation, Nintendo).
// PlayStation 로그인 창. 비밀번호는 Sony 페이지에만 입력되고, 프로그램은 로그인 뒤 생긴 NPSSO 로
// 갱신 토큰을 받아 암호화해 저장한다. NPSSO·로그인 쿠키는 창을 닫을 때 지운다.
import { BrowserWindow, session, shell } from 'electron'
import { nintendoAccess, nintendoAuthUrl, nintendoNickname, nintendoSessionToken, NINTENDO_REDIRECT, parseNintendoRedirect } from '../providers/nintendo'
import { codeFromNpsso, getOnlineId, SSO_COOKIE_URL, tokensFromCode, type PsnTokens } from '../providers/psn'

const PARTITION = 'psn-login'

export function psnLogin(parent: BrowserWindow | null): Promise<{ tokens: PsnTokens; onlineId: string | null } | null> {
  const ses = session.fromPartition(PARTITION)
  ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|gameshelf|GameShelf)\/\S+/g, ''))
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 560,
      height: 800,
      parent: parent ?? undefined,
      modal: Boolean(parent),
      title: 'PlayStation 로그인 — 오른쪽 위 "로그인"을 눌러 로그인하세요',
      autoHideMenuBar: true,
      webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    win.removeMenu()
    win.on('page-title-updated', (e) => e.preventDefault())
    win.webContents.setWindowOpenHandler(({ url }) => {
      // Sony 로그인 팝업은 같은 창에서 연다
      if (/sony\.com|playstation\.com/.test(url)) void win.loadURL(url)
      else if (/^https:\/\//.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    let done = false
    let busy = false
    const finish = (v: { tokens: PsnTokens; onlineId: string | null } | null, err?: Error) => {
      if (done) return
      done = true
      clearInterval(timer)
      if (!win.isDestroyed()) win.close()
      void ses.clearStorageData()
      if (err) reject(err)
      else resolve(v)
    }
    const timer = setInterval(async () => {
      if (busy || done) return
      busy = true
      try {
        const r = await ses.fetch(SSO_COOKIE_URL)
        const j = (await r.json().catch(() => null)) as { npsso?: string } | null
        if (j?.npsso) {
          const tokens = await tokensFromCode(await codeFromNpsso(j.npsso))
          finish({ tokens, onlineId: await getOnlineId(tokens.accessToken) })
        }
      } catch (e) {
        if ((e as Error).message.includes('PlayStation')) finish(null, e as Error)
      } finally {
        busy = false
      }
    }, 2000)
    win.on('closed', () => finish(null))
    void win.loadURL('https://www.playstation.com/ko-kr/')
  })
}

/**
 * 닌텐도 계정 로그인 창. 로그인 후 "이 사람을 선택"을 누르면 닌텐도가 npf…://auth 로 보내는 주소를
 * 가로채 세션 토큰을 받는다(링크를 복사할 필요 없음). 비밀번호는 닌텐도 페이지에만 입력된다.
 */
export function nintendoLogin(parent: BrowserWindow | null): Promise<{ sessionToken: string; nickname: string | null } | null> {
  const ses = session.fromPartition('nintendo-login')
  ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|gameshelf|GameShelf)\/\S+/g, ''))
  const req = nintendoAuthUrl()
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 520,
      height: 780,
      parent: parent ?? undefined,
      modal: Boolean(parent),
      title: '닌텐도 계정 로그인 — 로그인 후 "이 사람을 선택"을 누르세요',
      autoHideMenuBar: true,
      webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    win.removeMenu()
    win.on('page-title-updated', (e) => e.preventDefault())
    let done = false
    const finish = (v: { sessionToken: string; nickname: string | null } | null, err?: Error) => {
      if (done) return
      done = true
      if (!win.isDestroyed()) win.close()
      void ses.clearStorageData()
      if (err) reject(err)
      else resolve(v)
    }
    let handled = false
    const onUrl = (e: { preventDefault(): void }, url: string) => {
      if (!url.startsWith(NINTENDO_REDIRECT)) return
      e.preventDefault()
      // 같은 주소로 이벤트가 여러 번 올 수 있다 (코드는 한 번만 쓸 수 있음)
      if (handled) return
      handled = true
      void (async () => {
        try {
          const code = parseNintendoRedirect(url, req.state)
          if (!code) throw new Error('닌텐도 로그인 코드를 받지 못했습니다.')
          const token = await nintendoSessionToken(code, req.verifier)
          finish({ sessionToken: token, nickname: await nintendoNickname(await nintendoAccess(token)) })
        } catch (err) {
          finish(null, err as Error)
        }
      })()
    }
    win.webContents.on('will-navigate', onUrl)
    win.webContents.on('will-redirect', onUrl)
    win.webContents.on('will-frame-navigate', (e) => onUrl(e, e.url))
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith(NINTENDO_REDIRECT)) onUrl({ preventDefault() {} }, url)
      else if (/nintendo\.(com|net)/.test(url)) void win.loadURL(url)
      return { action: 'deny' }
    })
    win.on('closed', () => finish(null))
    void win.loadURL(req.url)
  })
}
