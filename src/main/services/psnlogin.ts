// PlayStation 로그인 창. 비밀번호는 Sony 페이지에만 입력되고, 프로그램은 로그인 뒤 생긴 NPSSO 로
// 갱신 토큰을 받아 암호화해 저장한다. NPSSO·로그인 쿠키는 창을 닫을 때 지운다.
import { BrowserWindow, session, shell } from 'electron'
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
