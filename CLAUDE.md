# GameShelf — Claude Code 작업 안내

Steam·PlayStation·Xbox·Nintendo 게임 라이브러리를 분석하는 Windows 데스크톱 앱(Electron). 사용자는 한국어 사용자이고 화면 문구도 모두 한국어다. 대화와 보고도 한국어로 한다.

## 명령

- `npm install` → `npm run dev` : 개발 실행 (Node.js 22 이상, node:sqlite 사용)
- `npm run typecheck` : main/preload(tsconfig.node.json) + renderer(tsconfig.web.json) 타입 검사
- `npm test` : `tests/core.test.ts` 통합 테스트. 가짜 fetch(setFetch)로 Steam·ITAD·PSN·Xbox·Nintendo 응답을 흉내 내 동기화부터 계산까지 확인한다. 네트워크 없이 돈다
- `npm run build` : electron-vite 빌드. `npx electron . --selftest` 는 CI 가 패키징 전에 돌리는 실행 확인

바꾼 뒤에는 typecheck와 test를 둘 다 통과시킨다. main/shared 로직을 바꾸면 `tests/core.test.ts`에 검증을 추가한다.

## 배포 (자동 업데이트)

1. `package.json`의 `version`과 `src/shared/types.ts`의 `APP_VERSION`을 같이 올린다 (1.0부터 시작, 기능 추가는 마이너, 수정은 패치)
2. `CHANGELOG.md` 맨 위에 사용자에게 보이는 말로 변경 내용을 적는다. 기능이 바뀌면 `README.md` 기능 표도 고친다
3. 커밋 메시지에 `[release]`를 넣어 `main`에 푸시 → GitHub Actions(`.github/workflows/build.yml`, windows-latest)가 설치 파일·blockmap·latest.yml 을 `v버전` Release 에 올린다. 설치된 앱은 electron-updater 로 이것을 받아 업데이트한다
4. Actions 실행 결과(성공, Release 파일 3개)를 확인한다. 실패하면 check-run annotations 에 원인이 남는다

## 구조

- `src/main` : Electron 메인 프로세스
  - `core.ts` : Electron 없이 만들 수 있는 핵심 객체(DB, Repo, SyncService, Insights, NowPlaying). 테스트도 이걸 쓴다
  - `index.ts` : 창·트레이·알림·자동 동기화(KST 새벽 4시 기준 하루 1회)·자동 백업·업데이트
  - `ipc.ts` : 렌더러 API 구현. 메서드 목록은 `src/shared/api.ts`, 노출은 `src/preload/index.ts`의 `methodMap`(빠뜨리면 타입 오류)
  - `db/` : SQLite. `driver.ts` 는 node:sqlite → better-sqlite3 순으로 연다. 쿼리 인자는 `?` 위치 인자만. `schema.ts` 의 SCHEMA_VERSION 과 `migrate()` 에서 열 추가는 `hasColumn` 으로 확인 후 ALTER
  - `providers/` : 플랫폼 어댑터 (`types.ts` 의 PlatformProvider). steam, psn, xbox, nintendo
  - `services/` : sync(동기화 단계), insights(추천·가격 검색·활동), imports(구매 내역 가져오기), steamstore(앱 안 Steam 로그인), psnlogin(PS·닌텐도 로그인 창), nowplaying, hltb, itad, backup, exporter
- `src/shared` : main·renderer 공용 타입(`types.ts`)과 순수 계산(`analytics.ts`: 역대 최저가, 지출, 추천 점수, titleKey 등)
- `src/renderer/src` : React 19 + Tailwind v4. `lib/store.tsx` 가 전역 상태, `pages/` 가 화면, `components/ui.tsx` 가 기본 컴포넌트

## 데이터 원칙

- 게임은 `games(platform, game_id)`, 사용자가 입력한 값은 `user_data` 에 따로 둔다. 동기화는 user_data 를 덮어쓰지 않는다. 직접 입력한 구매가(`purchase_source='manual'`)는 가져오기도 덮어쓰지 않는다
- Steam 외 플랫폼의 이미지·기기·트로피·게이머스코어·장르는 `ext_game`. 직접 추가한 게임은 `ext_game.manual=1` 이고 동기화가 지우지 않는다. 같은 이름이 플랫폼 동기화로 들어오면 `mergeManualDuplicates` 가 입력값을 옮기고 직접 추가한 쪽을 지운다
- 플랫폼 사이 같은 게임 판정은 `titleKey()` (™®·기종 표기·문장부호 제거)
- 가격: Steam 상점 API 는 모든 통화를 ×100 으로 준다. 원화는 100으로 나눠 원 단위로 저장, 달러는 센트. 기본 통화는 원화(한국 상점), 달러는 각 게임의 미국 정가(환율 환산 아님)
- 역대 최저가 = 역대 최대 할인율로 팔린 가격. 지금 할인 여부와 상관없이 같은 값 (`effectiveLow`)
- 비밀값(Steam/ITAD 키, PSN 갱신 토큰, Xbox 키, 닌텐도 세션 토큰)은 `settings.ts` 의 SECRET_KEYS 로 암호화 저장. PSN·Xbox·닌텐도 토큰은 `publicSettings()` 로 렌더러에 가려서 보낸다
- 요청 간격은 `util/http.ts` 의 `limiters`. 화면에서 바로 보는 요청은 `steamStoreUi` 를 써서 동기화 줄 뒤에서 기다리지 않게 한다

## 비공식 API (바뀌면 여기부터 확인)

- PlayStation: PlayStation 앱 클라이언트(`providers/psn.ts`). NPSSO → 인증 코드 → 토큰, gamelist/v2(플레이타임), trophy/v1(트로피), basicPresences(지금 플레이 중)
- Xbox: OpenXBL(xbl.io) 사용자 API 키. `/achievements`, `/presence`, `/account`. 무료 키는 시간당 요청 수 제한이 있다
- Nintendo: Nintendo Store 앱 클라이언트 `5c38e31cd085304b`, PKCE 로그인 → `npf…://auth` 리다이렉트를 로그인 창에서 가로챈다 → session_token(약 2년) → 15분 접근 토큰 → `app-api.znej.nintendo.com/api/v2.0/users/me/play_histories`
- Steam 스토어 로그인 세션: dynamicstore/userdata(보유 DLC), account/history + AjaxLoadMoreHistory(구매 내역), account/licenses
- HowLongToBeat: 검색 주소를 Next.js 청크에서 찾는다(`services/hltb.ts`)

실제 계정 없이 테스트하므로, 이 부분을 고칠 때는 응답 형식을 출처(공개 라이브러리 등)로 확인하고 `tests/core.test.ts` 의 가짜 응답도 같이 맞춘다.

## 화면 문구·디자인

- 쉬운 한국어 문장. 기술 용어(토큰, API 등)는 꼭 필요할 때만
- 글자 크기는 Electron 확대 비율(`uiScale`, 기본 115%)로 조절한다. 고정 px 클래스(`text-[13px]`)를 써도 확대로 함께 커진다. 좁은 창(최소 1024×확대 비율)에서 글자가 칸을 넘치지 않는지 확인한다
- 라이트·다크 모두 `index.css` 의 색 토큰(`text-ink`, `text-muted`, `bg-surface` 등)으로 쓴다
