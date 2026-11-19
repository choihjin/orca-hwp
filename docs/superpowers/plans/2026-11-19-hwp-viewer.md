# HWP/HWPX 뷰어 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> 이 저장소에서는 Orca 오케스트레이션 워커(I1~I4)가 아래 "분담"대로 나눠 맡는다. 자기 Task만 읽어도 되게 Interfaces를 적었다.

**Goal:** Orca custom editor로 `.hwp`·`.hwpx`를 rhwp 0.8.7로 쪽 단위 렌더하고, 에이전트가 같은 엔진으로 아무 쪽·영역을 PNG·텍스트로 받을 수 있게 한다.

**Architecture:** rhwp WASM을 감싼 어댑터 하나(`editor/engine/rhwp-adapter.js`)를 프레임 뷰어와 node 스크립트(`agent/agent-view.mjs`)가 함께 쓴다. 쪽 SVG는 DOM 없는 정화 모듈을 거쳐 인라인으로 넣고, 플러그인에 넣은 OFL 글꼴로 그린다. 에이전트 PNG는 순수 WASM 변환기(resvg)로 만든다.

**Tech Stack:** Orca plugin API 1(`sandboxed-ui`, isolated frame), TypeScript(프레임 전용 코드), ESM JavaScript+JSDoc(프레임·node 공용 코드), `@rhwp/core` 0.8.7, `@resvg/resvg-wasm` 2.6.2, node 22, `orca/testing`.

**Spec:** `docs/superpowers/specs/2026-11-19-hwp-viewer-design.md`

## Global Constraints

- 권한 없음: `orca-plugin.json`의 `capabilities: []`. 네트워크 없이 동작.
- 파일 상한: WASM·JS·HTML·CSS·SVG 파일당 16,777,216 B, 글꼴 파일당 32 MiB, Orca가 변환하는 `.ts` 파일당 1 MiB, 플러그인 폴더 2,000파일·52,428,800 B.
- rhwp 고정: `@rhwp/core@0.8.7`, `rhwp.js` sha256 `70cde06a369fa7fd4fc8bc8f3d6acaee158596ba1a116a2c72159002b0b5654e`, `rhwp_bg.wasm` sha256 `54cf95014312e605c51b98eb9021247ea79ef2bbd0a7080e11c011d0246e3989`, 상류 태그 커밋 `1a76570e833917d15817415a53c09ad61ab3203f`.
- 글꼴 출처: rhwp 태그 `v0.9.1`(커밋 `981ce66b4183b13c1a3b5907e04a8969c8c42034`)의 `assets/fonts/`.
- rhwp를 import하는 모듈은 `editor/engine/rhwp-adapter.js` 하나뿐.
- 프레임과 node가 함께 쓰는 모듈(`rhwp-adapter.js`, `sanitize.js`, `text-lines.js`)은 변환 없이 도는 ESM JavaScript, 타입은 JSDoc.
- 한컴 고지 문구(그대로): `본 제품은 한컴의 HWP 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.`
- 상표 고지(그대로): `"한글", "한컴", "HWP", "HWPX"는 주식회사 한글과컴퓨터의 등록 상표입니다. 이 플러그인은 한글과컴퓨터와 관계없는 독립 프로젝트입니다.`
- 상시 안내(그대로): `rhwp 엔진이 그린 화면이며 한글 프로그램과 다를 수 있습니다.`
- 새 worktree에서는 먼저 `orca plugin types .`로 `.orca/types`를 만든다(git 제외 폴더).
- 커밋 메시지: `[TYPE] 한글 제목`(예: `[FEAT] SVG 정화 모듈 추가`), AI 기여자 문구 금지, 푸시 금지.
- `spike/`, `fixtures/`는 git 제외. 표본은 `scripts/fetch-fixtures.mjs`로만 받는다.

## Review Focus

- 아주 큰 문서(수십 MB, 수백 쪽): 첫 쪽이 빠르게 보이고 멈추지 않아야 한다 → Task 6 합격 검사에 큰 표본 포함, Task 7 캡처 확인.
- 열어 둔 파일이 밖에서 바뀜: 이전 문서를 버리고(`dispose`) 새 문서를 다시 그려야 한다 → Task 7 `controller.test.ts`.
- 한글 문서가 아닌 ZIP·OLE(예: 이름만 바꾼 `.docx`), 잘린 파일, 암호 문서: 오류 화면, 멈춤 없음 → Task 1 어댑터 테스트, Task 6 잘린 표본.
- 쪽 크기가 섞인 문서(가로 쪽 구역): 지연 렌더 범위와 스크롤 위치가 쪽별 크기를 따라야 한다 → Task 5 `page-window.test.ts`.
- 쪽이 0개이거나 본문이 빈 문서: 빈 화면 대신 안내가 보여야 한다 → Task 7 `controller.test.ts`.

## 분담과 순서

| 순서 | Task | 맡는 곳 | 브랜치 |
|---|---|---|---|
| 0 | Task 1 엔진 경계 | 코디네이터 | `develop` |
| 1(병렬) | Task 2, 3 | I1 Codex `gpt-6.2-sol` | `feature/build-vendor` |
| 1(병렬) | Task 4, 5, 6 | I4 Claude `claude-opus-5-5` | `feature/core-modules` |
| 1(병렬) | Task 8 | I3 Codex `gpt-6.2-sol` | `feature/agent-view` |
| 1(병렬) | Task 7 | I2 Claude `claude-opus-5-5` | `feature/viewer` |
| 2 | 합치기·통합 확인(Task 9) | 코디네이터 | `develop` |
| 3 | 최종 리뷰 | Codex `gpt-6.2-astra` | 읽기 전용 |

병렬 Task는 서로의 산출물이 없어도 시작할 수 있게 Interfaces를 고정했다. Task 7·8은 Task 4(`sanitize.js`)·Task 2(글꼴·변환기)가 합쳐지기 전에는 임시 대역(그대로 통과시키는 함수, 시스템 글꼴)으로 개발하고, 합친 뒤 Task 9에서 실제 모듈로 확인한다.

---

### Task 1: 엔진 경계 (rhwp 고정 + 어댑터)

**Files:**
- Create: `build/vendor-rhwp.mjs`
- Create: `editor/vendor/rhwp/rhwp.js`, `editor/vendor/rhwp/rhwp_bg.wasm`, `editor/vendor/rhwp/LICENSE`, `editor/vendor/rhwp/engine-info.js` (스크립트 산출물)
- Create: `editor/engine/rhwp-adapter.js`
- Test: `editor/engine/rhwp-adapter.test.mjs`
- Modify: `package.json` (scripts 추가: `vendor:rhwp`, `vendor:fonts`, `vendor:resvg`, `notices`, `check:size`, `fixtures`, `acceptance`)

**Interfaces:**
- Produces (`editor/engine/rhwp-adapter.js`):
  - `initEngine(wasm: URL | Uint8Array): Promise<void>` — 여러 번 불러도 한 번만 초기화.
  - `openDocument(bytes: Uint8Array): EngineDocument` — 실패 시 `EngineError`를 던진다.
  - `EngineDocument = { pageCount: number; pageSize(i: number): { width: number; height: number }; renderPageSvg(i: number): string; pageTextRuns(i: number): TextRun[]; dispose(): void }` — 쪽 번호는 0부터, 크기 단위는 SVG와 같은 px.
  - `TextRun = { text: string; x: number; y: number; w: number; h: number; fontFamily: string; fontSize: number; bold: boolean }` — `getPageTextLayout(i)`의 `runs`에서 이 필드만 옮긴다.
  - `class EngineError extends Error { code: 'not-hangul' | 'encrypted' | 'corrupt' | 'unsupported' | 'engine'; engineCode?: string }`
  - `ENGINE_INFO` 재수출: `{ name: 'rhwp', version: '0.8.7', source: string, sha256: { js: string; wasm: string } }` (`editor/vendor/rhwp/engine-info.js`가 정의). 설계 5.2의 `ENGINE.json`을 프레임과 node가 fetch 없이 import할 수 있게 JS 모듈로 바꾼 것이다.

- [ ] **Step 1: `build/vendor-rhwp.mjs` 작성 후 실행** — npm 레지스트리 tarball `https://registry.npmjs.org/@rhwp/core/-/core-0.8.7.tgz`를 받아 `rhwp.js`·`rhwp_bg.wasm`·`LICENSE`를 꺼내 Global Constraints의 sha256과 대조, 다르면 종료 코드 1. 맞으면 `editor/vendor/rhwp/`에 쓰고 `engine-info.js`를 생성. `npm run vendor:rhwp` → 세 파일과 `engine-info.js` 생성, 해시 출력.
- [ ] **Step 2: 실패하는 테스트 작성** (`editor/engine/rhwp-adapter.test.mjs`)

```js
test('한글 문서가 아니면 not-hangul', async () => {
  await initEngine(wasmBytes)
  assert.throws(() => openDocument(new Uint8Array([1, 2, 3])), (e) => e.code === 'not-hangul')
})
test('HWPX가 아닌 ZIP은 unsupported 또는 corrupt', async () => {
  // 최소 ZIP(빈 mimetype 하나)을 테스트 안에서 만든다
  assert.throws(() => openDocument(minimalZip), (e) => ['unsupported', 'corrupt'].includes(e.code))
})
test('잘린 OLE는 corrupt 또는 unsupported, 멈추지 않음', ...)
test('표본이 있으면 쪽 수·크기·SVG·텍스트를 낸다', async () => {
  // fixtures/21868765_별표2_보건소_분장사무.hwp 가 없으면 건너뛴다
  const doc = openDocument(bytes)
  assert.equal(doc.pageCount, 4)
  assert.equal(Math.round(doc.pageSize(0).width), 794)
  assert.ok(doc.renderPageSvg(0).startsWith('<svg'))
  assert.ok(doc.pageTextRuns(0).some((r) => r.text.includes('보건정책과')))
  doc.dispose()
})
test('initEngine 두 번 불러도 한 번만 초기화', ...)
```

- [ ] **Step 3: 실패 확인** — `orca plugin test .` → 위 테스트 FAIL(모듈 없음).
- [ ] **Step 4: 어댑터 구현** — `openDocument`는 먼저 `editor/format.ts`와 같은 매직 바이트 규칙으로 판별해 아니면 `not-hangul`. rhwp 오류 문자열의 `오류코드: (\w+)`를 `engineCode`로 담고, `UNSUPPORTED_FILE_FORMAT` → `unsupported`, 코드나 메시지에 `PASSWORD|ENCRYPT|암호` → `encrypted`, `CORRUPT|INVALID|PARSE|손상` → `corrupt`, 그 밖 → `engine`. `pageSize`는 `JSON.parse(getPageInfo(i))`의 `width`·`height`. 매직 바이트 상수는 `format.ts`와 중복되므로 어댑터가 쓰는 JS 판(`editor/format.js`)으로 옮기고 `format.ts`는 그것을 재수출한다.
- [ ] **Step 5: 통과 확인** — `orca plugin test .` → 새 테스트 PASS, 기존 4개 PASS.
- [ ] **Step 6: 커밋** — `[FEAT] rhwp 0.8.7 고정과 엔진 어댑터 추가`

### Task 2: 글꼴·PNG 변환기 고정과 크기 검사 (I1)

**Files:**
- Create: `build/pins.json` (모든 외부 파일의 URL·sha256·크기)
- Create: `build/vendor-fonts.mjs`, `build/vendor-resvg.mjs`, `build/check-size.mjs`
- Create: `editor/fonts/*` (글꼴 13개 또는 변환본), `editor/fonts/fonts.css`, `editor/fonts/licenses/*`
- Create: `agent/vendor/resvg/index.mjs`, `agent/vendor/resvg/index_bg.wasm`, `agent/vendor/resvg/LICENSE`

**Interfaces:**
- Produces: `editor/fonts/fonts.css`(프레임이 `<link>`로 싣는다), `editor/fonts/manifest.json` = `[{ file: string; families: string[]; weight: 400 | 700 | 200; sha256: string }]` (Task 8이 PNG 변환에 넘길 글꼴 목록), `agent/vendor/resvg/index.mjs`(resvg-wasm 2.6.2 원본 그대로), `npm run check:size` 종료 코드 0/1.

- [ ] **Step 1: 글꼴 13개 고정** — 파일: `NotoSerifKR-Regular`, `NotoSerifKR-Bold`, `NotoSansKR-Regular`, `NotoSansKR-Bold`, `NotoSansKR-ExtraLight`, `Pretendard-Regular`, `Pretendard-Bold`, `NanumMyeongjo-Regular`, `NanumMyeongjo-Bold`, `D2Coding-Regular`, `D2Coding-Bold`, `RHWPPublicBatang-Regular`, `RHWPOldHangul-Regular` (모두 `.woff2`, 합계 12,558,440 B). sha256은 같은 태그의 `assets/fonts/licenses/font-notices.json`에서 가져와 `pins.json`에 적고, 받은 파일과 대조. 글꼴별 라이선스 원문도 같은 태그 `assets/fonts/licenses/`에서 복사.
- [ ] **Step 2: resvg가 WOFF2를 읽는지 판정** — `@resvg/resvg-wasm@2.6.2`(npm tarball, sha256을 `pins.json`에 기록)를 받아 node에서 `NotoSansKR-Regular.woff2`를 `font.fontBuffers`로 넘겨 한글 `<text>`가 그려지는지(PNG의 어두운 픽셀 수 > 0) 확인. 결과를 `build/README.md`에 기록.
  - 읽으면: WOFF2 그대로 쓴다.
  - 못 읽으면: 빌드 때 fontTools로 WOFF2 → TTF/OTF 변환본을 만들어 **변환본만** 싣고(프레임 CSS도 변환본을 가리킴), 원본 sha256과 변환 명령을 `pins.json`·라이선스 폴더에 기록(OFL은 변환 허용, 이름 유지 조건 확인). 변환 후 `check:size`가 통과해야 한다. 통과 못 하면 멈추고 코디네이터에게 `ask`.
- [ ] **Step 3: `fonts.css` 생성** — 파일마다 `@font-face`(src는 같은 폴더 상대 URL, weight 명시). family 이름은 rhwp 0.8.7 대체 목록(`src/renderer/mod.rs` 태그 `1a76570e` 2575행 근처)과 표본 SVG의 `font-family` 값에 나오는 이름을 모두 별칭으로 등록(예: `Noto Serif KR`, `Noto Sans KR`, `Noto Sans KR ExtraLight`, `Pretendard`, `NanumMyeongjo`/`Nanum Myeongjo`, `D2Coding`, `RHWP Public Batang`, `RHWP Old Hangul`, `Source Han Serif K Old Hangul`). `manifest.json`도 생성.
- [ ] **Step 4: `check-size.mjs` 작성** — 플러그인 폴더(`.git`, `node_modules`, `spike`, `fixtures`, `.orca` 제외)의 파일 수·합계, `.wasm`·`.js`·`.html`·`.css` 파일당 16,777,216 B, `.ts` 파일당 1,048,576 B, 글꼴 파일당 33,554,432 B를 검사. 위반 시 경로와 크기를 출력하고 종료 코드 1.
- [ ] **Step 5: 확인** — `npm run vendor:fonts && npm run vendor:resvg && npm run check:size` → 종료 코드 0, 합계 출력.
- [ ] **Step 6: 커밋** — `[CHORE] 글꼴과 PNG 변환기 고정, 크기 검사 추가`

### Task 3: 서드파티 고지 (I1)

**Files:**
- Create: `build/notices.mjs`, `build/licenses/*.txt`(검토본), `THIRD_PARTY_NOTICES.txt`

**Interfaces:**
- Consumes: Task 2의 `pins.json`, `editor/fonts/licenses/*`, `agent/vendor/resvg/LICENSE`
- Produces: 루트 `THIRD_PARTY_NOTICES.txt`, `npm run notices` (검토본과 다르면 종료 코드 1)

- [ ] **Step 1: Rust 의존성 목록 확정** — rhwp 태그 `1a76570e`를 임시 폴더에 받아 `~/.cargo/bin/cargo tree -p rhwp --locked --target wasm32-unknown-unknown -e normal,no-proc-macro --prefix none -f '{p}|{l}'`로 고유 크레이트 목록(약 131개)을 만들고, `cargo fetch` 후 `~/.cargo/registry/src`에서 각 크레이트의 LICENSE*/COPYING*/NOTICE*를 모은다.
- [ ] **Step 2: 고지 파일 생성** — 순서: 한컴 고지·상표 고지(Global Constraints 문구 그대로) → rhwp MIT 전문(Copyright (c) 2025-2026 Edward Kim) → rhwp 태그의 `THIRD_PARTY_LICENSES.md` 전문 → 크레이트별 `name@version (license)`와 원문 → 글꼴별 저작권과 OFL 전문 → resvg-wasm MPL-2.0 전문과 원본 위치. 공식 docx 플러그인 방식대로 원문을 `build/licenses/`의 검토본과 줄바꿈 정규화 후 비교해 다르면 실패.
- [ ] **Step 3: 확인** — `npm run notices` 두 번 실행해 같은 결과(결정적), 종료 코드 0. 크레이트 수와 파일 크기 출력.
- [ ] **Step 4: 커밋** — `[DOCS] 서드파티 고지 생성 추가`

### Task 4: SVG 정화 (I4)

**Files:**
- Create: `editor/render/sanitize.js`
- Test: `editor/render/sanitize.test.mjs`

**Interfaces:**
- Produces: `sanitizeSvg(svg: string, prefix: string): { svg: string; fontFaces: string[]; warnings: string[] }`, `class SanitizeError extends Error {}` — DOM 없이 동작. 형식이 깨진 XML이면 `SanitizeError`(호출자는 그 쪽을 렌더 오류로 표시, 원문을 통과시키지 않는다). `prefix`는 `p3-` 같은 쪽 접두사.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
test('script·foreignObject·iframe·object·embed 제거', () => { /* 결과에 해당 태그 없음 */ })
test('on* 속성 제거', () => { /* <rect onload="x()"> → onload 없음 */ })
test('data:image만 남기고 외부·javascript: href 제거', () => {
  // <image href="data:image/png;base64,AAAA"> 유지, href="https://e.com/a.png"·"javascript:x" 제거
})
test('<a>는 벗기고 내용은 남김', ...)
test('<style>의 data: @font-face만 fontFaces로 옮기고 나머지 규칙은 warnings', ...)
test('id와 url(#…)·href="#…" 참조에 접두사', () => {
  const r = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="body-clip-3"><rect/></clipPath></defs><g clip-path="url(#body-clip-3)"/></svg>', 'p0-')
  assert.ok(r.svg.includes('id="p0-body-clip-3"'))
  assert.ok(r.svg.includes('url(#p0-body-clip-3)'))
})
test('깨진 XML은 SanitizeError', () => { assert.throws(() => sanitizeSvg('<svg><g></svg>', 'p0-'), SanitizeError) })
test('rhwp 표본 SVG는 텍스트 요소 수가 그대로', ...) // fixtures 없으면 건너뜀
```

- [ ] **Step 2: 실패 확인** — `orca plugin test .` → FAIL.
- [ ] **Step 3: 구현** — 허용 목록 토크나이저: 태그·속성·텍스트·CDATA·주석을 순서대로 읽어 허용 요소(`svg g defs clipPath mask pattern linearGradient radialGradient stop rect circle ellipse line polyline polygon path text tspan image use symbol title desc`)와 허용 속성 외는 버린다. 엔티티는 그대로 둔다. 쪽 하나에 수십만 문자이므로 문자열 이어붙이기 대신 배열 join.
- [ ] **Step 4: 통과 확인** — `orca plugin test .` → PASS.
- [ ] **Step 5: 커밋** — `[FEAT] SVG 정화 모듈 추가`

### Task 5: 보기 상태와 지연 렌더 범위 (I4)

**Files:**
- Create: `editor/state/view-memory.ts`, `editor/view/page-window.ts`
- Test: `editor/state/view-memory.test.ts`, `editor/view/page-window.test.ts`

**Interfaces:**
- Produces:
  - `documentKey(bytes: Uint8Array): Promise<string>` — 길이 + 앞 64 KiB + 뒤 64 KiB의 SHA-256 hex(`crypto.subtle`).
  - `loadView(storage: Storage | null, key: string): { page: number; zoom: number } | null`, `saveView(storage: Storage | null, key: string, view: { page: number; zoom: number }): void` — 키 접두사 `hwp-viewer:view:`, 최대 200개 유지(오래된 것부터 삭제), storage가 없거나 던지면 조용히 무시.
  - `pageLayout(sizes: { width: number; height: number }[], zoom: number, gap: number): { tops: number[]; heights: number[]; total: number }`
  - `pagesToRender(layout, viewportTop: number, viewportHeight: number, overscan: number): { first: number; last: number }` — 쪽이 0개면 `{ first: 0, last: -1 }`.

- [ ] **Step 1: 실패하는 테스트 작성** — `documentKey`가 같은 바이트에 같은 키, 한 바이트 다르면 다른 키; `saveView` 201번째에 가장 오래된 것 삭제; storage가 던져도 예외 없음; `pageLayout`이 세로 794×1123과 가로 1123×794가 섞인 쪽에서 `tops` 누적이 맞음; `pagesToRender`가 뷰포트 경계·overscan·0쪽에서 맞음.
- [ ] **Step 2: 실패 확인** — `orca plugin test .` → FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인** — `orca plugin test .` → PASS.
- [ ] **Step 5: 커밋** — `[FEAT] 보기 기억과 지연 렌더 범위 계산 추가`

### Task 6: 표본과 합격 검사 (I4)

**Files:**
- Create: `scripts/fixtures.json`, `scripts/fetch-fixtures.mjs`, `scripts/acceptance.mjs`

**Interfaces:**
- Consumes: Task 1 어댑터, Task 4 `sanitizeSvg`, Task 8 `textLines`(합친 뒤; 그 전에는 `pageTextRuns`의 `text`를 이어 붙여 비교)
- Produces: `fixtures/`의 표본 파일, `npm run acceptance` (종료 코드 0/1, 표본별 결과 표 출력)

- [ ] **Step 1: `fixtures.json` 작성** — rhwp 태그 `1a76570e`의 `samples/`에서: `21868765_별표2_보건소_분장사무.hwp`(+`.pdf`), `2022년 국립국어원 업무계획.hwp`(+`.pdf`), `2025년 기부·답례품 실적 지자체 보고서_양식.hwpx`(+`.pdf`), 가장 큰 공개 표본 1개(예: `2025 행정업무운영 편람`), 쪽을 넘는 표가 있는 표본 1개. 파일마다 경로·sha256·크기. 기준 PDF가 있는 표본은 기대값을 미리 계산해 적는다: `pageCount`(pdfinfo), 확인 쪽(첫 쪽·표가 있는 쪽·마지막 쪽)별 줄마다 첫 글자·끝 글자(pdftotext -layout). 계산 명령을 파일 머리 주석 대신 `scripts/README.md`에 기록.
- [ ] **Step 2: `fetch-fixtures.mjs`** — `fixtures.json`대로 받아 sha256 대조, 다르면 종료 코드 1. 잘린 표본(보건소 HWP의 앞 50%)도 `fixtures/truncated.hwp`로 만든다.
- [ ] **Step 3: `acceptance.mjs`** — 표본마다: 열기, 쪽 수 비교, 확인 쪽의 줄 첫·끝 글자 비교(엔진 텍스트를 줄로 묶어 비교), 모든 쪽 `renderPageSvg`+`sanitizeSvg`가 예외 없이 끝나는지, 첫 쪽까지 걸린 시간 기록(합격 기준 아님, 출력만). 잘린 표본은 `EngineError`로 끝나야 합격.
- [ ] **Step 4: 확인** — `npm run fixtures && npm run acceptance` → 기준 PDF 있는 표본 3개 합격, 큰 표본 열림, 잘린 표본 오류로 합격. 불합격 항목이 있으면 숫자를 그대로 보고(기대값을 고치지 않는다).
- [ ] **Step 5: 커밋** — `[TEST] 공개 표본 내려받기와 합격 검사 추가`

### Task 7: 뷰어 화면 (I2)

**Files:**
- Create: `editor/index.html`, `editor/view/controller.ts`, `editor/view/viewer.ts`, `editor/view/status-bar.ts`, `editor/view/about.ts`, `editor/view/errors.ts`, `editor/view/viewer.css`
- Modify: `editor/main.ts`(전면 교체), `orca-plugin.json`(entry `editor/index.html`, 설명), `README.md`·`README.ko.md`는 건드리지 않는다(Task 8 몫)
- Test: `editor/view/controller.test.ts`

**Interfaces:**
- Consumes: Task 1 `initEngine`·`openDocument`·`EngineError`·`ENGINE_INFO`; Task 4 `sanitizeSvg`(합치기 전엔 대역); Task 5 `documentKey`·`loadView`·`saveView`·`pageLayout`·`pagesToRender`; Task 2 `editor/fonts/fonts.css`(합치기 전엔 없음)
- Produces: `createController(deps: { engine: { open(bytes: Uint8Array): EngineDocument }; view: ViewPort; storage: Storage | null }): { load(bytes: Uint8Array): Promise<void>; dispose(): void }`, `ViewPort = { showDocument(doc: EngineDocument, startPage: number): void; showError(code: EngineError['code'] | 'empty', detail?: string): void; clear(): void }`

- [ ] **Step 1: 실패하는 테스트 작성** (`controller.test.ts`, 가짜 엔진·가짜 ViewPort로 node에서)

```ts
test('기억한 쪽에서 연다', ...)          // loadView가 {page: 3} → showDocument(doc, 3)
test('문서가 바뀌면 이전 문서를 dispose하고 다시 연다', ...) // load 두 번 → 첫 doc.dispose 호출 1회
test('쪽이 0개면 empty 오류', ...)       // pageCount 0 → showError('empty')
test('EngineError는 code 그대로 오류 화면', ...) // encrypted → showError('encrypted')
test('기억한 쪽이 범위 밖이면 0쪽', ...)
```

- [ ] **Step 2: 실패 확인** — `orca plugin test .` → FAIL.
- [ ] **Step 3: controller 구현** — DOM 없이 순수 로직만.
- [ ] **Step 4: 통과 확인** — `orca plugin test .` → PASS.
- [ ] **Step 5: 화면 구현** — 설계 5.3 여는 순서를 그대로 따른다: 모듈 시작에서 `initEngine(new URL('./vendor/rhwp/rhwp_bg.wasm', import.meta.url))`와 `document.fonts.load()`(Noto Serif KR 400/700, Noto Sans KR 400/700)를 `Promise.all`로 끝낸 **뒤에** `orca.document.onDidChange` 구독. 콜백에서 동기로 시작 쪽과 다음 쪽을 `sanitizeSvg(svg, 'p<i>-')` 결과로 인라인 렌더, `fontFaces`는 머리 스타일시트로(내용 해시로 중복 제거). 나머지 쪽은 `pageLayout` 크기의 자리표시, IntersectionObserver와 `pagesToRender`로 렌더·해제. 쪽 렌더 실패(`SanitizeError` 등)는 그 쪽에 오류 표시하고 상태 줄의 오류 쪽 수 증가. 다 그리면 `document.documentElement.dataset.renderState = 'done'`. 화면 가운데 쪽이 바뀌거나 확대가 바뀌면 500 ms 디바운스로 `saveView`. 상태 줄: `HWP · 3/35쪽 · 100% · rhwp 0.8.7` 형식(+오류 쪽 수). 키: `PageUp`/`PageDown`, `Home`/`End`, `+`/`-`/`0`, 숫자+`Enter`. 정보 화면(상태 줄 `ⓘ` 버튼): 한컴 고지, 상표 고지, 상시 안내(Global Constraints 문구 그대로), `THIRD_PARTY_NOTICES.txt` 안내. 오류 화면 문구는 `not-hangul`·`encrypted`·`corrupt`·`unsupported`·`engine`·`empty`별 한국어 한 줄 + `console.error`. 바깥 영역은 `--orca-*` 변수, 쪽은 흰 바탕. `editor/main.ts` 머리 주석에 한컴 고지 문구.
- [ ] **Step 6: 정적 확인** — `orca plugin validate . && orca plugin check . && npm run typecheck` → 모두 ok.
- [ ] **Step 7: Orca에서 확인** — 코디네이터가 시험판을 내린 뒤(`orca plugin dev unload spike/rhwp-087`), `orca plugin dev load <worktree 경로>`(승인 지문이 나오면 코디네이터에게 `ask`). 표본 3개를 `orca plugin shot <키> --editor <표본> --width 1000 --height 1400 --json --out .orca/shots/<이름>.png`로 찍어 직접 읽는다: 빈 쪽·로딩 화면 없음, 제목·표·쪽 번호 판독, 상태 줄 판독. 같은 표본을 다시 열었을 때 기억한 쪽으로 가는지(사용자가 쪽을 옮긴 상태는 `localStorage`를 직접 쓸 수 없으므로, 열기→`saveView` 경로는 controller 테스트로 갈음하고 캡처는 첫 열기만).
- [ ] **Step 8: 커밋** — `[FEAT] HWP 뷰어 화면 구현`

### Task 8: 에이전트 경로 (I3)

**Files:**
- Create: `agent/agent-view.mjs`, `agent/text-lines.js`, `docs/AGENTS.md`
- Modify: `README.md`, `README.ko.md` (현재 단계 갱신, AGENTS 문서 연결, 한컴 고지·상표 고지)
- Test: `agent/text-lines.test.mjs`, `agent/agent-view.test.mjs`

**Interfaces:**
- Consumes: Task 1 어댑터(node에서 `initEngine(readFileSync(<vendor>/rhwp_bg.wasm))`), Task 4 `sanitizeSvg`(합치기 전엔 대역), Task 2 `editor/fonts/manifest.json`·`agent/vendor/resvg/index.mjs`(합치기 전엔 시스템에 있는 같은 판 resvg-wasm을 임시로)
- Produces:
  - `textLines(runs: TextRun[], tolerance?: number): string[]` — `y`가 `tolerance`(기본: 해당 run `h`의 0.5배) 안이면 같은 줄, 줄 안은 `x` 순, 줄은 `y` 순. 표 칸 글자 포함.
  - CLI: `node agent/agent-view.mjs <파일> [--page N(1부터, 기본 1)] [--region x,y,w,h(쪽 px)] [--scale S(기본 1.5)] [--out 경로(기본: 임시 폴더)] [--text] [--json]`. `--json` 출력: `{ file, pageCount, page, pageSize: {width, height}, png, text?: string[], engine: ENGINE_INFO, warnings: string[] }`. 오류 시 `{ error: { code, message } }`와 종료 코드 1.
  - 스크립트는 자기 위치(`import.meta.url`)로 `../editor/vendor/rhwp/`, `../editor/fonts/`, `./vendor/resvg/`를 찾는다. 설계 5.7대로 사용자 컴퓨터에 원래 글꼴(함초롬바탕 등, macOS `~/Library/Fonts`·`/Library/Fonts`)이 있으면 기본으로 함께 넘겨 뷰어 화면과 맞춘다. `--bundled-fonts-only`면 넣은 글꼴만 써서 기계마다 같은 결과를 낸다(테스트는 이 옵션으로).

- [ ] **Step 1: 실패하는 테스트 작성** — `text-lines.test.mjs`: 같은 y의 두 run이 x 순으로 한 줄, y 차이가 tolerance 밖이면 두 줄, 표 칸 run(같은 행의 칸 셋)이 한 줄로 합쳐짐. `agent-view.test.mjs`(표본 없으면 건너뜀): 보건소 HWP `--page 1 --json --text` → `pageCount` 4, `png` 파일 존재·PNG 시그니처, `text`에 `보건정책과` 포함; `--page 9` → 종료 코드 1, `error.code`가 `page-out-of-range`; 한글 문서가 아닌 파일 → `error.code` `not-hangul`.
- [ ] **Step 2: 실패 확인** — `orca plugin test .` → FAIL.
- [ ] **Step 3: 구현** — `--region`은 SVG `viewBox`를 바꿔 자른다. PNG 크기 = 영역 × scale. `node_modules`를 import하지 않는다.
- [ ] **Step 4: 통과 확인** — `orca plugin test .` → PASS. 네트워크를 끈 상태에서 한 번 더(`node --no-network`가 없으면 결과에 "미확인"으로 기록).
- [ ] **Step 5: `docs/AGENTS.md` 작성** — 순서: (1) 사용자가 보는 쪽 보기 `orca plugin shot <키> --editor <파일> --width 1000 --height 1400 --json`, (2) 플러그인 폴더 찾기: `orca plugin list --json`에서 `pluginKey`가 `*.hwp-viewer`인 항목의 `isDev`/`source.contentHash`로 `~/Library/Application Support/orca/plugins/<pluginKey>/<contentHash>/`(macOS에서 확인한 위치, Orca가 약속한 계약 아님), (3) 아무 쪽·영역 보기 `node <폴더>/agent/agent-view.mjs ...`, (4) 주의: 높이 1800 이하, `--act`는 창이 숨겨져야 함, 빈 화면이면 다시 찍기, 래스터 그림은 확대해도 원본 해상도 이상 안 됨, 상시 안내 문구, node 최소 버전.
- [ ] **Step 6: README 갱신** — 두 README에 현재 단계, AGENTS 문서 연결, 한컴 고지·상표 고지(Global Constraints 문구 그대로).
- [ ] **Step 7: 커밋** — `[FEAT] 에이전트용 쪽 렌더 스크립트와 안내 추가`

### Task 9: 합치기와 통합 확인 (코디네이터)

- [ ] **Step 1: 합치기** — `develop`에 `feature/build-vendor` → `feature/core-modules` → `feature/agent-view` → `feature/viewer` 순으로 합친다. 대역을 실제 모듈로 바꾸는 수정은 해당 워커에게 `send`로 돌린다.
- [ ] **Step 2: 전체 확인** — `npm run check:size && npm run notices && orca plugin validate . && orca plugin check . && orca plugin test . && npm run typecheck && npm run fixtures && npm run acceptance` → 모두 종료 코드 0.
- [ ] **Step 3: Orca 확인** — `develop` 작업 폴더를 dev load, 표본 3개 캡처를 열어 판독(빈 쪽 없음). `agent-view.mjs`로 보건소 1쪽 전체와 표 영역 확대 PNG를 만들어 판독.
- [ ] **Step 4: 설치본 확인(사용자 승인 후)** — 설치된 사본에서 `docs/AGENTS.md` 절차대로 `agent-view.mjs` 실행.
- [ ] **Step 5: 최종 리뷰** — Codex `gpt-6.2-astra`(xhigh)가 설계 대비 전체 diff를 읽기 전용으로 리뷰, 지적은 해당 워커에게.
