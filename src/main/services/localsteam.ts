// 이 PC에 설치된 Steam 게임의 DLC 찾기 (로그인 없이 쓸 수 있는 방법)
// steamapps/appmanifest_*.acf 의 InstalledDepots 에 "dlcappid" 가 적혀 있으면 그 DLC 를 보유하고 설치한 것이다.
// 설치하지 않은 게임, 내려받을 파일이 없는 DLC 는 알 수 없다.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { installedDlcFromManifest, libraryPaths } from './storeparse'

function steamPathFromRegistry(): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      const m = !err && String(stdout).match(/SteamPath\s+REG_SZ\s+(.+)/i)
      resolve(m ? m[1].trim().replace(/\//g, '\\') : null)
    })
  })
}

async function steamRoot(): Promise<string | null> {
  const candidates = [
    await steamPathFromRegistry(),
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    join(homedir(), '.steam', 'steam'),
    join(homedir(), '.local', 'share', 'Steam')
  ]
  return candidates.find((p): p is string => Boolean(p) && existsSync(join(p as string, 'steamapps'))) ?? null
}

/** 설치된 DLC appid 목록. Steam 폴더를 못 찾으면 null */
export async function scanInstalledDlc(): Promise<number[] | null> {
  const root = await steamRoot()
  if (!root) return null
  const libs = new Set([root])
  try {
    for (const p of libraryPaths(await readFile(join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8'))) libs.add(p)
  } catch {
    /* 기본 라이브러리만 */
  }
  const out = new Set<number>()
  for (const lib of libs) {
    const dir = join(lib, 'steamapps')
    let files: string[]
    try {
      files = (await readdir(dir)).filter((f) => /^appmanifest_\d+\.acf$/.test(f))
    } catch {
      continue
    }
    for (const f of files) {
      try {
        for (const id of installedDlcFromManifest(await readFile(join(dir, f), 'utf8'))) out.add(id)
      } catch {
        /* 읽을 수 없는 파일은 건너뜀 */
      }
    }
  }
  return [...out]
}
