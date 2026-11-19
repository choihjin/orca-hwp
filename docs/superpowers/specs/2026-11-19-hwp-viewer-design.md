# HWP/HWPX 뷰어 설계

2026-11-19. 상태: 사용자 승인(2026-11-19). 근거 자료는 1단계 조사 보고서다: `docs/decisions/phase1/`(W1 시험판, W1b 블라인드 판독, W3 글꼴·고지)와 `docs/decisions/rhwp-091-viewer-build/`(W2 빌드 보고와 재현 자료). 보고서 안의 `spike/…` 경로는 커밋하지 않은 1단계 작업 폴더를 가리킨다.

## 1. 의도

Orca 안에서 한글 문서(`.hwp`, `.hwpx`)를 열어 **원본에 가깝게** 보여 주는 읽기 전용 뷰어. 사용자만이 아니라 **Orca 에이전트도 이 화면을 보고** 문서가 "어떻게 보이고 어떻게 고쳐야 하는지" 판단할 수 있어야 한다(사용자 요구, 원문: "뷰어에서 어떻게 보이고 어떻게 고쳐야 하는지를 실제로 열어봐야 알 수 있으니까"). 수정 기능은 나중에 가능하면 좋다.

## 2. 목표, 비목표, 실패 조건

목표
- `.hwp`(5.x)와 `.hwpx`를 한 엔진으로 쪽 단위로 그린다. 쪽 수와 줄바꿈이 한컴 기준 PDF와 같은 수준(1단계 표본 3개에서 확인한 수준)을 유지한다.
- 에이전트가 (가) 사용자가 지금 보는 쪽을, (나) 원하는 아무 쪽·영역을 PNG로 받아 읽을 수 있다.
- 네트워크 없이 동작한다. 권한(capabilities) 없음.

비목표 (이번 범위 밖)
- 편집·저장, 인쇄·PDF 내보내기, 문서 안 검색, 브라우저 클라이언트(`orca serve`) 지원, HWP3, 암호 문서 열기(안내만 한다).

실패 조건 (동작해도 실패로 본다)
- 에이전트 캡처에 빈 쪽이나 로딩 화면이 찍힌다.
- 엔진이 그린 화면을 원본(한글 프로그램)과 같다고 오해하게 만든다. 기준 PDF 없이 달라진 쪽을 찾아내는 것은 이번 범위 밖이므로, 대신 "rhwp가 그린 화면이며 한글 프로그램과 다를 수 있음"을 정보 화면과 `docs/AGENTS.md`에 상시 밝히고, 알 수 있는 신호(렌더 오류가 난 쪽)는 상태 줄에 표시한다(작성자 판단).
- 문서 안의 스크립트나 외부 참조가 프레임에서 실행·요청된다.
- 한컴 고지 문구가 화면에 없다.

## 3. 제약 (확인된 사실)

- Orca 데스크톱 isolated frame: 네트워크 차단. CSP `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; img-src 'self' data: blob:; font-src 'self' data:`.
- WASM·JS·HTML·CSS·SVG는 파일당 16 MiB까지 통째로 읽어 서빙(Range 불가). 글꼴·이미지는 파일당 32 MiB 스트리밍. 플러그인 폴더 2,000파일·50 MiB. Orca가 변환하는 `.ts` 파일당 1 MiB. 문서 64 MiB.
- `orca plugin shot --editor`는 편집기가 문서를 구독하고 첫 칠을 한 직후에 찍는다. 앱의 렌더 완료를 기다리지 않는다(W1에서 `<img>` 방식의 빈 쪽 캡처 실측).
- `shot --act`(키·클릭 입력)는 Orca 창이 보이면 `invalid_argument`로 거절된다(실측). `--theme`도 창이 보이면 적용되지 않는다(실측). `--height`는 이 화면 기준 약 1800 CSS px를 넘으면 그림이 세로로 늘어난다(추정 상한).
- 매니페스트 `contributes.skills`·`mcpServers`는 예약 항목이라 비워야 한다. 플러그인이 에이전트에 도구를 붙일 공식 경로는 없다.
- 함초롬바탕·돋움은 한컴 사용권상 재배포·수정 금지라 플러그인에 넣을 수 없다(W3).
- 한컴 공개 규격 이용 고지가 의무다: 제품 UI·매뉴얼·도움말·소스에 "본 제품은 한컴의 HWP 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다." (W3, 한컴 공식 안내).

## 4. 접근안과 선택

### 4.1 렌더링 엔진

| 안 | 내용 | 대가 |
|---|---|---|
| **V1 (선택)** | `@rhwp/core` 0.8.7 npm을 해시 고정해 그대로 싣는다. WASM 11,821,756 B | 0.9.0·0.9.1의 조판 수정(쪽을 넘는 중첩 표, 행 이어받기, 표 뒤 본문 이월, 머리말/꼬리말·바탕쪽 등)을 놓친다. 고지는 Rust 크레이트 라이선스를 직접 모아야 한다 |
| V2 | 0.9.1을 PDF 기능 없이 빌드하고 뷰어 API만 남겨 후처리. WASM 13,881,337 B | Rust·wasm-pack·Binaryen·후처리 스크립트를 고정한 빌드를 유지해야 한다. 편집 API를 남기면 19,210,456 B로 16 MiB 초과 |
| C | 파서 직접 작성 | 기각: HWP 바이너리와 쪽 단위 시각 재현을 모두 새로 만들어야 한다 |

사용자 결정: **V1로 시작하고, 나중에 V2로 바꿀 수 있게 만든다.** 0.8.7은 편집 API(`exportHwp`, `exportHwpx`)를 포함하고도 상한 안이라 나중의 수정 기능에도 유리하다. 1단계 표본 40쪽에서 0.8.7과 0.9.1의 쪽 수·텍스트는 같았고 그림 차이는 작았다(표 많은 문서의 차이는 미확인).

### 4.2 쪽을 그리는 방식

- (a) SVG를 Blob `<img>`로: 기각. 비동기 디코드라 캡처에 빈 쪽이 찍혔고(W1), 이미지 SVG는 페이지의 웹폰트를 쓰지 못한다(W3 Chromium 실측).
- **(b) 정화한 SVG를 인라인으로 (선택)**: 문서 콜백 안에서 동기로 넣을 수 있어 캡처에 내용이 찍히고, 플러그인 글꼴을 쓴다. DOM 비용이 커서 지연 렌더가 필요하다.

### 4.3 에이전트가 쪽을 보는 방법

- **P1+P2 (선택)**
  - P1 뷰어 안: 문서별로 마지막에 보던 쪽·확대를 기억한다. `orca plugin shot`이 사용자가 보던 쪽을 그대로 찍는다.
  - P2 뷰어 밖: node 스크립트가 플러그인과 같은 WASM·같은 정화 규칙·같은 글꼴로 원하는 쪽·영역을 PNG로, 쪽 텍스트를 텍스트로 낸다. 창 상태와 무관하다.
- P3 대안: 뷰어를 일반 웹 페이지로도 띄워 Orca 내장 브라우저로 찍는다. 로컬 서버가 필요하고 복잡해서 보류.

P2를 둘 곳 (사용자 결정): **플러그인 안에 함께 싣는다.** 플러그인을 설치한 사람의 에이전트가 어느 프로젝트에서든 오프라인으로 쓸 수 있어야 한다. 사용자 말: "이거 아니면 사람들이 쓸 이유가 줄어들잖아." 저장소에만 두는 안은 기각.

## 5. 설계

### 5.1 플러그인 모양

- `orca-plugin.json`: id `hwp-viewer`, `execution: sandboxed-ui`, `capabilities: []`, customEditors 하나(`.hwp`, `.hwpx`, `contentKind: bytes`, `frame: isolated`, `priority: default`), `engines.orca >=1.4.248`. 설명에 한컴과 무관한 독립 뷰어임을 적는다.
- entry는 `editor/index.html`. 정적 상태 줄·글꼴 CSS를 담고 `main.ts`를 모듈로 불러온다. 우리 코드는 TypeScript(파일당 1 MiB 미만 유지), vendor는 `.js` 그대로.

### 5.2 파일 구성과 경계

| 경로 | 책임 |
|---|---|
| `editor/vendor/rhwp/` | `rhwp.js`, `rhwp_bg.wasm`, `LICENSE`, `ENGINE.json`(버전, 출처, sha256). 손으로 고치지 않는다 |
| `editor/engine/rhwp-adapter.ts` | vendor를 import하는 **유일한** 모듈. `initEngine()`, `openDocument(bytes) → { pageCount, pageSize(i), renderPageSvg(i), dispose() }`, 오류를 `not-hangul`·`encrypted`·`corrupt`·`unsupported`·`engine`으로 분류 |
| `editor/render/sanitize.js` | SVG 정화와 쪽별 ID 접두사(5.4). 프레임과 P2(node)가 함께 쓰므로 변환 없이 도는 ESM JavaScript로 쓰고 타입은 JSDoc으로 단다. DOM에 의존하지 않는다 |
| `editor/view/` | 쪽 배치, 지연 렌더, 확대, 쪽 이동, 상태 줄, 오류 화면, 정보(고지) 화면 |
| `editor/state/view-memory.ts` | 문서별 마지막 쪽·확대 기억(P1) |
| `editor/fonts/` | WOFF2 글꼴, `fonts.css`, 글꼴별 라이선스 원문 |
| `editor/format.ts` | 매직 바이트 판별(기존) |
| `agent/agent-view.mjs` | P2 에이전트용 렌더 스크립트. **플러그인과 함께 배포된다** |
| `agent/vendor/` | P2의 PNG 변환기(순수 WASM, 5.7). 손으로 고치지 않는다 |
| `scripts/fetch-fixtures.mjs` | 공개 표본 내려받기(5.9) |
| `build/` | vendor·글꼴 고정과 검증, 고지 생성, 크기 검사(5.8) |
| `docs/AGENTS.md` | 에이전트가 문서를 확인하는 방법 |
| `docs/decisions/` | 결정 기록과 W2·W3 보고서, 0.9.1 빌드 재현 자료 |

엔진 교체(V2)는 `editor/vendor/rhwp/`의 파일과 `ENGINE.json`, 고지만 바꾸는 일이어야 한다. 뷰어 다른 곳에서 rhwp 타입·API를 직접 쓰지 않는다.

### 5.3 여는 순서 (캡처 타이밍 계약)

1. 모듈 로드 시 **문서를 구독하기 전에** WASM 초기화와 핵심 글꼴(Noto Serif KR 400/700, Noto Sans KR 400/700) `document.fonts.load()`를 함께 끝낸다.
2. 그다음 `orca.document.onDidChange`(또는 `session`)를 구독한다.
3. 문서를 받는 콜백 안에서 동기로: 형식 판별 → `openDocument` → 기억한 쪽(없으면 1쪽)과 그 다음 쪽까지 정화·인라인 렌더 → 그 쪽으로 스크롤 → 상태 줄 갱신.
4. 나머지 쪽은 `pageSize`로 크기를 잡은 자리표시만 두고, 화면에 가까워지면(IntersectionObserver) 렌더한다. 멀어진 쪽은 DOM에서 내려 메모리를 줄인다.
5. 다 그린 뒤 `document.documentElement.dataset.renderState = 'done'`.
6. 문서가 바뀌면(외부 수정) 이전 문서의 렌더 작업을 취소하고 `dispose()`한 뒤 3부터 다시.

`pageSize`는 `getPageInfo(i)` JSON에서 얻는 것을 우선 시도한다(0.8.7 타입에 있음, 필드는 미확인).

### 5.4 SVG 정화 규칙

허용 목록 방식. 1단계 표본의 0.8.7 출력에는 `script`·`foreignObject`·`on*`·외부 href가 없었지만 방어용으로 둔다.
- 지움: `script`, `foreignObject`, `iframe`·`object`·`embed`, 모든 `on*` 속성, `data:`가 아닌 `href`/`xlink:href`(이미지는 `data:image/*`만), `javascript:` URL, `<a>`(내용은 남김).
- `<style>`: `@font-face`(src가 `data:`인 것)만 남겨 문서 머리의 스타일시트 하나로 옮기고 내용 해시로 중복 제거. 다른 규칙은 지우고 경고를 남긴다(0.8.7 표본에는 `<style>` 없음).
- 쪽마다 `id`와 `url(#…)`·`href="#…"` 참조에 쪽 접두사를 붙여 쪽 간 ID 충돌을 막는다.

### 5.5 글꼴

- W3의 구성 B(OFL, 13파일, 12,558,440 B): Noto Serif KR R/B, Noto Sans KR R/B·ExtraLight, Pretendard R/B, 나눔명조 R/B, D2Coding R/B, RHWP Public Batang R, RHWP Old Hangul R. 파일과 SHA-256은 rhwp v0.9.1 `assets/fonts/`와 `font-notices.json` 기준.
- `fonts.css`의 family 이름은 rhwp SVG의 `font-family` 목록에 나오는 이름과 맞춘다(예: `Noto Serif KR`, weight 400/700 명시). SVG 목록 순서대로 사용자 컴퓨터에 설치된 원래 글꼴(함초롬바탕 등)이 먼저 쓰이고, 없으면 넣은 글꼴로 내려온다.
- 0.8.7의 옛한글 대체 이름(`Source Han Serif K Old Hangul`)은 `RHWP Old Hangul` 파일로 연결한다.
- 글꼴이 바뀌어도 줄·쪽은 엔진이 정하므로 바뀌지 않는다. 바뀌는 것은 글자 모양·폭과 겹침이다(W3).

### 5.6 화면

- 상단 상태 줄 한 줄: 형식, 현재 쪽/전체 쪽, 확대, 엔진 버전, 문제 표시(렌더 오류가 난 쪽 수). 에이전트가 PNG만 보고 어느 쪽·어떤 상태인지 알 수 있어야 한다. 대체 글꼴 사용 여부는 브라우저에서 설치 글꼴을 믿을 만하게 알아낼 방법이 확인되지 않아 첫 버전에서는 표시하지 않는다(작성자 판단).
- 기본 보기: 연속 스크롤, 쪽 너비 맞춤. 확대/축소 단계와 키(예: `+`/`-`/`0`), 쪽 이동 키(`PageUp`/`PageDown`, `Home`/`End`, 쪽 번호 입력)는 사용자용이다. 에이전트는 키 입력에 기대지 않는다.
- 정보 화면(상태 줄의 버튼): 한컴 고지 문구, 상표 고지("한글", "한컴", "HWP", "HWPX"는 한글과컴퓨터의 등록 상표이며 이 플러그인은 독립 프로젝트), rhwp·글꼴 라이선스 요약과 `THIRD_PARTY_NOTICES.txt` 안내.
- 오류 화면: 한글 문서가 아님, 암호 문서(지원 안 함 안내), 손상, 엔진 오류. `console.error`로도 남긴다.
- Orca 테마(`--orca-*` 변수)를 바깥 영역에 쓰고 쪽 자체는 흰 바탕.

### 5.7 에이전트 경로

- P1: `view-memory`는 문서 바이트의 SHA-256(앞뒤 일부와 길이로 줄여도 됨)을 키로 마지막 쪽·확대를 frame `localStorage`에 저장한다. 열 때 그 쪽으로 간다.
- P2: `node <플러그인 폴더>/agent/agent-view.mjs <파일> [--page N] [--region x,y,w,h] [--scale S] [--out a.png] [--text] [--json]`
  - 플러그인 폴더 안의 파일만으로 오프라인 동작한다. `node_modules`나 네이티브 바이너리에 기대지 않는다. Orca가 플러그인 폴더의 `node_modules`를 싣는다는 보장이 없고, 설치 환경마다 플랫폼이 다르기 때문이다.
  - 같은 `editor/vendor/rhwp/`와 같은 `editor/render/sanitize.js`를 쓴다.
  - PNG 변환은 순수 WASM 변환기(예: resvg의 WASM 판)를 `agent/vendor/`에 해시 고정해 싣는다. 크기는 수 MB로 추정(미측정)하며 예산에 넣는다.
  - 글꼴은 `editor/fonts/`의 글꼴을 쓰고, 사용자 컴퓨터에 원래 글꼴 파일(함초롬바탕 등)이 있으면 함께 넘긴다. 줄·쪽 위치는 엔진이 정하므로 뷰어와 같고, 글자 모양만 설치 글꼴에 따라 다를 수 있다.
  - `--text`는 `getPageTextLayout` 또는 SVG의 `<text>`에서 읽기 순서대로 뽑는다. `getPageText`는 표 안 글자를 빠뜨리므로(W1) 쓰지 않는다.
  - `--json`은 쪽 수, 쪽 크기, 만든 파일 경로, 오류를 낸다(에이전트가 다음 동작을 정하기 쉽게).
  - node 최소 버전은 구현자가 정해 `docs/AGENTS.md`에 적는다. node가 없으면 P1만 쓰라고 안내한다.
- 플러그인 폴더 찾기: 이 Mac에서 설치된 플러그인은 `~/Library/Application Support/orca/plugins/<pluginKey>/<contentHash>/`에 있었다(확인함). 해당 `contentHash`는 `orca plugin list --json`의 `source.contentHash`로 알 수 있다. 개발 로드면 개발 폴더다. 이 위치는 Orca가 문서로 약속한 계약이 아니므로(위험) `docs/AGENTS.md`에 찾는 명령을 적고, 스크립트는 자기 위치를 기준으로 vendor·글꼴을 찾는다. 다른 OS의 위치는 미확인.
- `docs/AGENTS.md`(플러그인과 함께 배포, README에서 연결): 사용자가 보는 쪽 확인(`orca plugin shot <키> --editor <파일> --width 1000 --height 1400 --json`), 플러그인 폴더 찾기, 아무 쪽·영역 확인(P2), 주의(높이 1800 이하, `--act`는 창이 숨겨져야 함, 빈 화면이면 다시 찍기, 래스터 그림은 확대해도 원본 해상도 이상 안 됨, rhwp가 그린 화면이라 한글 프로그램과 다를 수 있음). 에이전트에게 도구를 자동으로 붙일 방법이 없으므로 사용자가 에이전트에게 이 문서를 알려 주는 방식이다.

### 5.8 빌드·고정·고지

- `build/` 스크립트 하나가: npm `@rhwp/core@0.8.7`을 받아 sha256(`rhwp.js` `70cde06a…654e`, `rhwp_bg.wasm` `54cf9501…3989`)을 검증해 vendor에 복사하고, 글꼴 13개를 rhwp `v0.9.1` 태그에서 받아 SHA-256을 검증해 복사하고, P2의 PNG 변환기를 버전·해시 고정해 `agent/vendor/`에 복사하고, `THIRD_PARTY_NOTICES.txt`를 만들고, 크기를 검사한다(WASM 파일 16 MiB 이하, 폴더 50 MiB 이하, `.ts` 파일 1 MiB 이하). 산출물(vendor, 글꼴)은 커밋한다. Orca가 플러그인 폴더를 그대로 싣기 때문이다. 예상 합계: rhwp 약 12.3 MB + 글꼴 12.6 MB + 변환기 수 MB(미측정) + 코드, 50 MiB 안.
- `THIRD_PARTY_NOTICES.txt`: rhwp MIT 전문, rhwp `v0.8.7` 태그의 `THIRD_PARTY_LICENSES.md`, 같은 태그 `Cargo.lock`의 wasm32 대상 의존 크레이트(약 131개) 각각의 라이선스·NOTICE, 글꼴별 OFL 전문과 저작권. 공식 docx 플러그인처럼 검토본(`build/licenses/`)과 대조해 바뀌면 실패한다.
- 한컴 고지 문구는 정보 화면, `README.md`·`README.ko.md`, 소스(`editor/main.ts` 머리 주석)에 넣는다.

### 5.9 테스트와 표본

- 단위 테스트(`orca plugin test`): `format`, `sanitize`(위험 요소 제거, ID 접두사, `@font-face` 이동), 지연 렌더 범위 계산, `view-memory` 키, 어댑터 오류 분류(가짜 엔진).
- 표본: 저장소에 넣지 않는다. `scripts/fetch-fixtures.mjs`가 rhwp `v0.8.7` 태그(`1a76570e`)의 공개 표본을 파일별 sha256으로 검증해 `fixtures/`(git 제외)에 받는다. 1단계 표본 3개(보건소 HWP 4쪽, 국립국어원 HWP 35쪽, 기부 HWPX 30쪽)와 기준 PDF를 포함한다.
- 통합 확인: `orca plugin validate`, `check`, `test`, `tsc`.
- P2 확인: 저장소 폴더에서, 그리고 설치된 사본에서 각각 `agent-view.mjs`로 표본 PNG·텍스트를 만든다. 설치된 사본 시험은 Orca에 설치하는 일이므로 그때 사용자 승인을 받는다. 네트워크를 끊은 상태와 `node_modules`가 없는 상태에서도 동작해야 한다.
- 첫 버전 합격선(작성자 판단). 렌더러와 에이전트 판독을 나눠서 본다.
  - 렌더러(기계 판정): 기준 PDF가 있는 표본마다 쪽 수가 같다. 지정한 쪽(표본별 첫 쪽·표가 있는 쪽·마지막 쪽)에서 엔진이 그린 글자(SVG `<text>`에서 추출)가 PDF 추출 텍스트와 같고, 각 줄의 첫·끝 글자가 같다. 캡처에 빈 쪽·로딩 화면이 없다.
  - 에이전트 판독(사람이 보는 확인): 쪽 전체 PNG(1000×1400)에서 본문·표·쪽 번호를 읽을 수 있다. 작은 표·차트 글자는 영역 확대(P2)로 읽을 수 있으면 된다. 에이전트의 판독 오타(W1b의 577자 중 2자)는 렌더러 결함으로 세지 않는다. 래스터 그림 속 작은 글자는 원본 해상도 한계로 합격선에서 뺀다.

### 5.10 1단계 정리

- 본 플러그인을 올리기 전에 `orca plugin dev unload spike/rhwp-087`.
- `spike/`는 커밋하지 않는다. W1·W1b 보고서는 `docs/decisions/`로 옮긴다.
- W2의 0.9.1 빌드 재현 자료(`REPRODUCE.md`, `make-viewer-only.py`, `run-builds.sh`, `compare.mjs` 등)와 W3 보고서를 `docs/decisions/`로 옮긴다(임시 폴더라 지워질 수 있음).

## 6. 나중의 길

- V2 전환: `docs/decisions/rhwp-091-viewer-build/`의 절차로 빌드 → vendor·`ENGINE.json`·고지 교체 → 표본 비교. 편집 API가 필요하면 16 MiB 문제를 먼저 풀어야 한다.
- 수정 기능: 0.8.7의 `exportHwp`/`exportHwpx`와 `orca.document.session().change`로 이어 간다. 별도 설계.

## 7. 구현자에게 맡기는 것

- 지연 렌더의 정확한 거리·개수, 확대 단계, 화면 스타일, 상태 줄 문구.
- `getPageInfo`·`getPageTextLayout`의 필드 해석.
- 고지 생성 도구 선택(`cargo about` 또는 직접 작성).
- P2의 PNG 변환 라이브러리 선택(위 조건을 지키는 한).

## 8. 작업 분담 (계획 단계에서 구체화)

| 워커 | 모델 | 맡을 곳 |
|---|---|---|
| I1 벤더링·빌드·고지 | Codex `gpt-6.2-sol` | `build/`, `editor/vendor/`, `editor/fonts/`, `agent/vendor/`, `THIRD_PARTY_NOTICES.txt` |
| I2 뷰어 본체 | Claude `claude-opus-5-5` | `editor/`(vendor·fonts 제외), `orca-plugin.json` |
| I3 에이전트 경로 | Codex `gpt-6.2-sol` | `agent/agent-view.mjs`, `docs/AGENTS.md` |
| I4 테스트·표본 | Claude `claude-opus-5-5` | 테스트 파일, `scripts/fetch-fixtures.mjs` |
| 최종 리뷰 | Codex `gpt-6.2-astra` | 읽기 전용 |

먼저 `rhwp-adapter`와 `sanitize`의 인터페이스를 고정한 뒤 병렬로 들어간다. 워커별 worktree를 쓰려면 골격 첫 커밋이 필요하다(사용자 승인 필요).
