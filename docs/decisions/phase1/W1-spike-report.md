# W1 보고: rhwp 0.8.7 시험판을 Orca에서 띄우고 PNG 판독성 확인

작성 2026-11-19. Orca 1.4.263, macOS(5K 화면 5120×2880). 시험 플러그인 `local.hwp-viewer-spike`는 **dev load된 상태로 둠**.
`priority: default`이므로 지금 Orca에서 `.hwp`/`.hwpx`를 열면 이 시험 편집기가 기본으로 잡힌다(코디네이터가 시험 기간 동안 허용함).

## 1. Orca에서 떴는가

떴다(확인).
- `orca plugin validate spike/rhwp-087`: ok. `orca plugin check spike/rhwp-087`: `editor/index.html: ok, 3 file(s) load`.
- `orca plugin dev load`: 처음에 `approval_required`(exit 3), 코디네이터 승인 뒤 `--approve ap1-5dc16f2eba3af1187e33ac2f109d4d5f`로 로드(`ok: true`, status idle, capabilities 없음).
- 모든 shot 결과가 `settled: true`, `errors: []`. 초기화 오류는 없었고 `globalThis.measureTextWidth` 등록은 하지 않았다.
- 구성: `orca-plugin.json`(entry `editor/index.html`) → `<script type="module" src="./main.js">` → `./vendor/rhwp.js`, `init({ module_or_path: new URL('./vendor/rhwp_bg.wasm', import.meta.url) })`. vendor 해시는 지정값과 같다.

## 2. 표본별 쪽 수, 시간, PNG

시간은 frame 안 `performance.now()`로 잰 값이고 `orca plugin logs local.hwp-viewer-spike`에서 모았다(마지막 측정 회차).
- init = WASM 받기+컴파일+초기화
- 첫 쪽 = `new HwpDocument` 파싱 + 첫 쪽 `renderPageSvg`
- 전체 = 파싱 + 모든 쪽의 SVG 문자열 생성(DOM 반영은 빠짐)
- DOM = DOM에 넣는 데 걸린 시간. (a)는 `<img>` 디코드가 비동기라 디코드 시간이 들어가지 않는다.

| 표본 | 형식 | 쪽 | 방식 | init | 파싱 | 첫 쪽 | 전체 | DOM | SVG 합계(문자) |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|
| 21868765_별표2_보건소_분장사무.hwp | HWP 5.1.1.0 | 4 | (a) | 51ms | 100ms | 144ms | 212ms | 11ms | 1,133,900 |
| 〃 | | | (b) | 46ms | 98ms | 139ms | 213ms | 76ms | 〃 |
| 2022년 국립국어원 업무계획.hwp | HWP 5.1.0.1 | 35 | (a) | 49ms | 179ms | 224ms | 458ms | 40ms | 12,765,116 |
| 〃 | | | (b) | 102ms | 277ms | 317ms | 567ms | 627ms | 〃 |
| 2025년 기부·답례품 실적 지자체 보고서_양식.hwpx | HWPX 5.1.0.0 | 30 | (a) | 72ms | 111ms | 144ms | 295ms | 21ms | 3,966,404 |
| 〃 | | | (b) | 53ms | 116ms | 153ms | 300ms | 103ms | 〃 |

회차마다 값이 흔들린다. 예: 국립국어원 init은 41~152ms, 첫 쪽은 206~317ms 사이였다. 메모리 사용량은 미측정이다.

쪽 수는 기준 PDF와 같다(PDF도 4 / 35 / 30쪽).

PNG (`spike/shots/`):
- 1쪽, 1000×1400: `bogeonso-{img,inline}-p1.png`, `nikl-{img,inline}-p1.png`, `gibu-{img,inline}-p1.png`
- 한 쪽 보기 3쪽: `nikl-{img,inline}-single-p3.png`, `gibu-{img,inline}-single-p3.png`
- 큰 높이 4000: `*-inline-tall.png`. 세로로 늘어나 왜곡됨, 아래 5절 참고.
- `--theme dark`: `bogeonso-img-dark.png`. 적용 안 됨, 아래 5절 참고.
- **`gibu-img-p1.png`는 빈 쪽이 찍힌 실패 표본**이다(아래 4절).

## 3. PNG 판독 결과 (Claude가 PNG를 직접 읽음, 기준 PDF·`getPageText`와 대조)

| 문서/쪽 | 항목 | 결과 | 근거 |
|---|---|---|---|
| 보건소 p1 | 제목 "보건소의 부서별 분장사무(제13조 관련)", "[별표 2] 〈개정 2025. 12. 31.〉" | 읽힘·맞음 | PDF p1과 글자 같음 |
| 보건소 p1 | 표 머리 "부 서 명 / 분 장 사 무", 셀 "보건정책과" | 읽힘·맞음 | PDF와 같음 |
| 보건소 p1 | 표 셀 본문 1~34번(예: "4. 보건소 계약(추정가격 2천만원 이하) 및 지출에 관한 사항", "14. …협의회 운영에 관한 사항–동안구") | 34줄 모두 읽힘·맞음, 줄바꿈 같음 | PDF p1과 한 줄씩 대조 |
| 보건소 p1 | 쪽 번호, 머리말/꼬리말 | 원본에 없음(PDF에도 없음) | |
| 보건소 p1 | `getPageText(0)` | **빈 문자열** | 표 안 글자는 돌려주지 않음 |
| 국립국어원 p1 | 표지 제목 "2022년 국립국어원 업무계획", "2022. 1.", 로고+"국립국어원" | 읽힘·맞음 | 로고(내장 이미지)도 보임 |
| 국립국어원 p3(본문 "- 1 -") | 제목 "Ⅰ. 2021년 평가", "1 성 과" 띠 | 읽힘·맞음 | PDF p3과 같음 |
| 국립국어원 p3 | 본문 작은 글씨(예: "** 개체명, 감성, 함의 분석, 회의록 요약, …비윤리적 표현 등", "(8월~11월, 30개 팀 참여)") | 읽힘·맞음 | PDF와 같고 `getPageText(2)`와도 글자 일치 |
| 국립국어원 p3 | 표1 셀(연도/'18년…누적, "0.31억 어절", "18억 어절", "1.03억 어절", "20.3억 어절", "11종", "7종", "8종", "26종", "13종 18억어절") | 모두 읽힘·맞음 | PDF와 같음 |
| 국립국어원 p3 | 셀 "23종 20억어절(누적)" | 읽히지만 글자가 겹침 | 한컴 PDF에서도 같은 곳이 겹친다(원본 자간 문제). 160dpi로 잘라 대조함 |
| 국립국어원 p3 | 표2 셀("전문가 감수, 사전 반영", 2,208건 / 8,232건 / 10,286건 / 10,847건 / 12,230건) | 읽힘·맞음 | PDF와 같음 |
| 국립국어원 p3 | 쪽 번호 "- 1 -" | 읽힘·맞음 | |
| 국립국어원 p3 | 문단 줄바꿈("…확대(3종 대상 / 6회→4종 대상 13회)…") | PDF와 같은 자리에서 꺾임 | 세 문단 대조 |
| 국립국어원 p3 | `getPageText(2)` | 본문은 있으나 **표 셀 글자는 없음** | 로그 `[spike] text p3` |
| 기부 p1 | "대외주의"(빨간 글자 상자), "지자체명 / 2025년 보고서", "2026. 1.", 상자 안 "본 보고서는 … 알려 주시기 바랍니다." | 읽힘·맞음 | PDF p1과 같음 |
| 기부 p1 | 꼬리말 쪽 번호 "- 1 -" | 읽힘·맞음 | |
| 기부 p1 | `getPageText(0)` | "지자체명 / 2025년 보고서 / 2026. 1."만 있음, 상자 안 글자는 없음 | |
| 기부 p3 | 내장 차트 이미지 4개(제목 "2025년 기부·답례품·포인트 실적 종합 현황", 막대 값 "1,514.6억", "878.0억", "65.1억", "30,911", 꺾은선 "337.5억", "잔여 총계 1,076억P") | 읽힘·맞음 | 래스터 이미지라 작은 축 글자는 흐리지만 값 라벨은 읽힘 |
| 기부 p3 | 빈 표(파란 점선, 첫 행 음영), "- 3 -" | 맞음 | PDF p3도 빈 표 |
| 상태 줄 | "HWP · 35쪽 · 현재 3/35 · 방식 (b) inline svg · 한 쪽 · init …ms" | 읽힘 | 에이전트가 PNG만 보고 어느 쪽, 어떤 방식인지 알 수 있음 |

틀린 글자, 깨진 글자, □ 같은 빈 글리프는 본 범위에서 찾지 못했다. 위 표에 적은 쪽만 확인했고, 나머지 쪽은 미확인이다.
글꼴은 PDF와 다르다. PDF는 한컴 글꼴(휴먼명조, HY신명조 등)이고, 렌더는 시스템 대체 글꼴이다. 명조는 AppleMyungjo, 고딕은 Apple SD Gothic Neo로 추정한다. 근거는 SVG의 `font-family` 목록에서 macOS에 있는 첫 항목이 그것이라는 점뿐이다. 그래도 글자 폭이 쪽 배치를 깨뜨리지 않아 줄바꿈은 PDF와 같았다. rhwp가 줄 위치를 미리 계산하기 때문으로 추정한다.

## 4. 렌더 방식 (a) blob `<img>` vs (b) 정화 후 인라인 `<svg>`

- **글꼴 모양**: 같다. 국립국어원 p3의 같은 영역을 잘라 나란히 보면 글꼴, 줄바꿈, 겹침이 똑같다. 픽셀 차이는 안티앨리어싱 수준이다(값이 32를 넘는 픽셀: 국립국어원 28,044개, 기부 2,200개). 두 방식 모두 SVG의 `font-family` 목록대로 시스템 글꼴을 쓴다.
- **정화 대상**: rhwp 0.8.7 출력에는 `script` 0, `foreignObject` 0, `on*` 0, 외부 href 0이었다. `<image>`는 국립국어원 3개, 기부 25개가 있고 모두 `data:`다. `<style>`과 `@font-face`는 0이다.
- **결정적 차이는 캡처 시점**이다. `plugin shot`은 편집기가 문서를 받고 처음 그린 직후에 찍으며, 앱 쪽 완료 신호(`data-render-state`)를 기다리지 않는다. (a)는 `<img>` 디코드가 비동기라 **빈 흰 쪽이 찍힐 수 있다**. `gibu-img-p1.png`에서 실제로 일어났고, 앞선 회차의 `nikl-img-single-p3`와 `gibu-img-tall`도 같았다. (b)는 문서를 받는 콜백 안에서 동기로 DOM에 넣으므로 6회 모두 내용이 찍혔다.
- **비용**: (b)는 DOM 비용이 크다. 국립국어원 35쪽 전체 인라인에 627ms가 들었고, (a)는 40ms에 디코드가 따로 든다. 쪽마다 노드가 수만 개라 연속 보기에서 모든 쪽을 인라인으로 두면 무겁다(메모리는 미측정).
- **권고**: 에이전트가 PNG로 판단해야 하므로 **화면에 보이는 쪽은 (b) 인라인**으로 둔다. 정화는 지금 규칙을 유지한다(0.8.7은 걸리는 것이 없지만 방어용). 멀리 있는 쪽은 자리표시만 두거나 지연 렌더해 DOM 비용을 줄인다. (a)를 쓰려면 `img.decode()`가 끝난 뒤에 문서를 구독하거나 첫 칠을 늦출 방법이 필요한데, shot이 그것을 기다린다는 보장이 없다.

## 5. `plugin shot`에서 막힌 것 (실제 출력)

- `--act`: 거절됨, exit 1.
  `{"code":"invalid_argument","message":"shot --act needs Orca's window hidden or minimized, so it never clicks under the user"}`
  창은 숨기지 않았다. 따라서 키 `m`, `s`, `j`, `k`, `Home`, `End`, 숫자+`Enter`는 **Orca 안에서 동작을 확인하지 못했다**.
  대신 `editor/spike-config.json`(`mode`, `view`, `page`)을 바꿔 상태를 정했다. dev 폴더라 승인을 다시 받지 않고 반영됐다.
- `--theme dark`: `themeApplied: false`, `themeReason: "the Orca window is visible; capturing in the current theme so the app is not repainted"`. 현재 Orca가 dark라 상태 줄과 바깥은 이미 어둡고, 쪽 자체는 흰 바탕 SVG다. 밝은 테마 캡처는 못 했다.
- **큰 `--height`는 왜곡된다**: 4000을 주면 PNG는 1000×4000이지만 화면은 세로로 약 2.2배 늘어난 그림이다. 상태 줄 높이가 22px에서 49px로 바뀌었고 글자가 세로로 길쭉해졌다. 1400과 1800에서는 상태 줄이 22px, 2200에서 27px, 2800에서 34px였다. 그래서 이 화면에서 실제 편집기 높이 상한은 약 1800 CSS px로 추정한다(화면 논리 높이 1440과의 관계는 미확인). 4000 PNG는 판독에 쓰면 안 된다.
- **Claude 쪽에서 큰 그림이 줄어든다**: 1000×4000 PNG는 500×2000으로 줄어 보여서 상태 줄과 작은 글씨가 흐려졌다. 1000×1400 한 쪽 PNG가 판독에 가장 좋았다.
- **로딩 화면 캡처**: 첫 판(비동기 init 뒤에 렌더) 국립국어원 shot은 `settled: true`, `errors: []`인데 "0쪽 · init 0ms"인 로딩 화면이 찍혔다. 탭이 바로 닫혀 그 회차의 로그도 남지 않았다. WASM init을 먼저 끝내고 그 뒤에 `onDidChange`를 구독해 첫 쪽을 동기로 그리게 바꾼 뒤에는 재발하지 않았다.
  shot은 "편집기가 문서를 요청하고 그릴 때"까지만 기다린다. `settled`는 렌더 완료를 뜻하지 않는다.
- shot 한 번은 약 2초가 걸렸다(첫 회 `time` 1.9s).

## 6. 다음 설계에 넘길 발견과 위험

1. **shot 타이밍 계약**: 렌더 완료를 shot이 기다리게 할 수단이 문서에 없다. 본 설계에서는 (1) WASM을 미리 초기화하고, (2) 문서 콜백 안에서 보이는 쪽을 동기로 인라인 렌더하고, (3) 나머지는 뒤로 미뤄야 한다. 이것이 에이전트 판독의 전제다.
2. **판독용 크기**: 한 쪽 보기, 폭 1000, 높이 1400 정도가 좋다. 높이는 약 1800 이하로 해야 한다(이 화면 기준 추정). 여러 쪽을 한 장에 넣는 방식은 왜곡과 축소 때문에 쓸모가 없다. 에이전트용 "쪽 N 보기"는 설정이나 상태로 고를 수 있어야 한다. `--act`는 창이 보이면 거절되므로 키 입력에 기대면 안 된다.
3. **`getPageText`는 표 안 글자를 빼고 준다**: 보건소 p1은 통째로 빈 문자열이었다. 에이전트용 텍스트 대조나 검색에 쓰려면 `getPageTextLayout`이나 다른 API를 조사해야 한다(미조사). 반환값에는 `\r\n`이 많다.
4. **글꼴**: SVG는 시스템 글꼴 이름 목록에만 기대고 `@font-face`가 없다. 줄 배치는 rhwp가 정하므로 글꼴이 바뀌어도 줄바꿈은 같았다(이 Mac에서 확인). 다른 OS나 글꼴이 없는 환경에서 글자 폭이 달라 겹치거나 넘칠 위험은 미확인이다(W3 글꼴 조사와 연결). `getDocumentInfo`가 `fallbackFont: /usr/share/fonts/truetype/nanum/NanumGothic.ttf`를 보고하지만 브라우저에서는 의미가 없는 경로다.
5. **크기와 성능**: 35쪽 문서의 SVG가 1,280만 자다(첫 쪽 8.8만 자, 보건소 1쪽은 37.6만 자). 모든 쪽을 미리 생성하면 0.5초쯤 걸리고, 인라인 DOM은 0.6초 이상이다. 더 큰 표본(`2025 행정업무운영 편람` 10~13MB)은 미측정이다. 지연 렌더가 필요하다.
6. **편집기 기본 지정**: 시험판이 `priority: default`로 `.hwp`/`.hwpx`를 잡고 있다. 본 플러그인을 올리기 전에 `orca plugin dev unload spike/rhwp-087`이 필요하다.
7. 확인하지 못한 것: 키보드 조작 전체, 밝은 테마 캡처, HWP3와 암호 문서, 메모리, 다른 OS.

## 만든 파일 (모두 `spike/` 안)

- `spike/rhwp-087/orca-plugin.json`, `editor/index.html`, `editor/main.js`, `editor/spike-config.json`, `editor/vendor/{rhwp.js,rhwp_bg.wasm,LICENSE}`
- `spike/samples/` 표본 7개와 `SOURCES.md` (rhwp `v0.8.7` = `1a76570e833917d15817415a53c09ad61ab3203f`)
- `spike/shots/*.png`
- 이 보고서 `spike/W1-REPORT.md`

`spike-config.json`의 현재 값은 `mode: inline`, `view: scroll`이다.
