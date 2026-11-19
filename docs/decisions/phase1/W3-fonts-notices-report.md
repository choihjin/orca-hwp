# Orca HWP 뷰어의 한글 글꼴과 배포 고지

2026-11-19 조사. **권고는 원문서 내장·설치 글꼴과 엔진의 줄 배치를 우선하고, 오프라인 정제 인라인 SVG에 공개 글꼴을 공급하는 구성 B**다. 이 구성은 현대 한글 11,172자와 KS X 1001 한자 4,888자를 제공한다. 한컴과의 줄·쪽 일치율은 미측정이다. [rhwp의 오프라인 동작 설명](https://github.com/edwardkim/rhwp/blob/981ce66b4183b13c1a3b5907e04a8969c8c42034/npm/editor/README.md) · [글꼴 자산](https://github.com/edwardkim/rhwp/blob/981ce66b4183b13c1a3b5907e04a8969c8c42034/assets/fonts/FONTS.md)

## 1. 문서 글꼴, SVG의 글꼴, 줄 배치

**확인.** 두 버전의 WASM `renderPageSvg(page)`는 기본 Screen 프로필로 이미 쪽이 나뉜 레이어를 SVG로 그린다. 일반 본문 `font-family`는 요청 face, 설치별칭·후속 face, 굵기 접미사를 뗀 base, 문서가 선언한 대체 face, 계열별 후보의 순서다. 실제 SVG에는 인용부호가 XML 엔티티로 보일 수 있다. 그림·수식·일부 기호·빈 family에는 별도 처리나 경로 윤곽이 있다. 두 버전 모두 사용한 **문서 자체 내장 글꼴**에서 생성한 data URL `@font-face`를 SVG 안에 쓸 수 있다. 모든 본문 대체 글꼴을 WASM이 SVG에 실어 주는 방식으로 보아서는 안 된다. [0.8.7 렌더 진입점](https://github.com/edwardkim/rhwp/blob/1a76570e833917d15817415a53c09ad61ab3203f/src/document_core/queries/rendering.rs#L1492) · [0.9.1 렌더 진입점](https://github.com/edwardkim/rhwp/blob/981ce66b4183b13c1a3b5907e04a8969c8c42034/src/document_core/queries/rendering.rs#L1815) · [문서 내장 CSS](https://github.com/edwardkim/rhwp/blob/981ce66b4183b13c1a3b5907e04a8969c8c42034/src/renderer/svg.rs#L5372)

| 요청 글꼴 | 양 버전의 기본 메트릭 별칭 | 일반 SVG가 실제로 찾는 순서의 주요 부분 | Studio 웹폰트 공급 목록에서 확인한 선언 |
|---|---|---|---|
| 함초롬바탕 / 한컴바탕 / 바탕 | HCR Batang / Haansoft Batang / Batang | 요청과 문서 대체 뒤 serif 계열. 0.8.7의 계열 앞은 Batang, 바탕, Nanum Myeongjo, AppleMyungjo, Noto Serif KR 순. 0.9.1은 이 분기 선두에 Haansoft Batang도 둔다. | 함초롬바탕·한컴바탕은 외부 HANBatang.woff, 바탕·바탕체는 로컬 NotoSerifKR-Regular |
| 함초롬돋움 / 한컴돋움 | HCR Dotum / Haansoft Dotum | 요청과 별칭·문서 대체 뒤 sans 계열. 0.8.7은 Malgun Gothic, 맑은 고딕, Apple SD Gothic Neo, Noto Sans KR ExtraLight, Noto Sans KR, Pretendard 순. 0.9.1은 Apple 다음에 HCR Dotum·함초롬돋움도 탐색하고 Noto Sans CJK KR도 탐색한다. | 한글 이름 함초롬돋움·한컴돋움은 외부 HCRDotum.woff. 영문 Haansoft Dotum 항목은 로컬 NotoSansKR-ExtraLight |
| 돋움 / 굴림 | Dotum / Gulim | 0.8.7은 일반 sans 폴백. 0.9.1은 원래 글꼴·문서 대체 뒤 ExtraLight → Noto Sans KR → Noto Sans CJK KR을 Malgun보다 먼저 찾는 전용 분기. 두 버전 모두 bold에서 ExtraLight를 제거 | 두 한글 이름은 로컬 NotoSansKR-ExtraLight |
| 맑은 고딕 | Malgun Gothic | 요청 → Malgun Gothic 등이 먼저이며 해당 호스트에서 첫 사용 가능한 글꼴이 그린다 | 한글 이름은 로컬 Pretendard-Regular |
| 굴림체 / 바탕체 / 궁서 / 나눔고딕·명조 | GulimChe / BatangChe / Gungsuh / NanumGothic·NanumMyeongjo | 굴림체는 D2Coding을 포함한 monospace. 바탕체·궁서는 serif. 나눔은 자체 family·대체 순서 적용 | D2Coding / Noto Serif KR / Gowun Batang / 각 나눔 Regular |

이는 소스의 계열 분기와 Studio 공급 규칙이다. 예를 들어, Studio 표의 바탕 → Noto Serif KR를 읽고 일반 SVG가 나눔명조나 설치 바탕을 건너뛴다고 단정하면 틀린다. 문서의 대체 선언, 언어 슬롯, 글리프 유무와 굵기에 따라 실제 선택이 달라진다. 0.8.7의 옛한글 fallback 이름은 `Source Han Serif K Old Hangul`, 0.9.1은 `RHWP Old Hangul`이다. 0.9.1은 일부 검증된 결측 글리프에서 측정에 쓰인 공급 face로 그리며 문서·호스트 프로그램도 조건에 따라 사용한다. [0.8.7 순서와 계열](https://github.com/edwardkim/rhwp/blob/1a76570e833917d15817415a53c09ad61ab3203f/src/renderer/mod.rs#L2575) · [0.9.1 순서](https://github.com/edwardkim/rhwp/blob/981ce66b4183b13c1a3b5907e04a8969c8c42034/src/renderer/mod.rs#L3886) · [0.9.1 계열](https://github.com/edwardkim/rhwp/blob/981ce66b4183b13c1a3b5907e04a8969c8c42034/src/renderer/font_fallback.rs) · [메트릭 이름 매핑](https://github.com/edwardkim/rhwp/blob/981ce66b4183b13c1a3b5907e04a8969c8c42034/src/renderer/font_rule_projections/layout_metric.rs#L34) · [글리프별 공급](https://github.com/edwardkim/rhwp/blob/981ce66b4183b13c1a3b5907e04a8969c8c42034/src/renderer/measured_glyph_supplier.rs)

**줄·쪽과 화면의 관계.** 기본 `EmbeddedTextMeasurer`가 Native/WASM 공통으로 face·굵기·문자별 내장 전진폭과 보정, 장평·자간 등을 사용한다. 알려진 글꼴·문자 폭이 없으면 문자별 보정 또는 휴리스틱(대표적으로 CJK 1 em, Latin 0.5 em)을 적용한다. 주석의 “582”는 현재 전체 수를 뜻하지 않는다. 역사적 생성 표만 실제로 세어도 각 595행이며 추가 표가 있다. 저장된 HWP line segment의 시작·높이를 활용하고 필요할 때 엔진이 재조판한다. 글꼴·가로 폭·표 셀·문단 조건에 따른 엔진 오차는 줄·쪽 경계로 전파될 수 있다. SVG가 나온 뒤 CSS 대체 글꼴만 달라지면 이미 계산된 줄·쪽은 유지된다. 달라지는 것은 같은 좌표에 찍힌 글리프의 폭·획·기준선·겹침·표 셀에서 잘리는 정도다. 0.9.1의 별도 Canvas2D 실측 세션은 준비·선택하면 파생 배치를 다시 만들 수 있으며, 독립 SVG 기본 경로와 구분한다. [0.8.7 폭](https://github.com/edwardkim/rhwp/blob/1a76570e833917d15817415a53c09ad61ab3203f/src/renderer/layout/text_measurement.rs#L810) · [0.9.1 폭](https://github.com/edwardkim/rhwp/blob/981ce66b4183b13c1a3b5907e04a8969c8c42034/src/renderer/layout/text_measurement.rs#L379) · [저장 줄](https://github.com/edwardkim/rhwp/blob/981ce66b4183b13c1a3b5907e04a8969c8c42034/src/renderer/composer/stored_lines_runs.inc.rs) · [SVG 문자 원점](https://github.com/edwardkim/rhwp/blob/981ce66b4183b13c1a3b5907e04a8969c8c42034/src/renderer/svg.rs#L3622) · [Canvas 실측 세션](https://github.com/edwardkim/rhwp/blob/981ce66b4183b13c1a3b5907e04a8969c8c42034/src/document_core/canvas_metrics.rs#L92)

**Studio.** 양 버전 모두 generated `webfont-supply.ts`를 읽어 문서 요청·필수 글꼴의 CSS `@font-face`와 `FontFace`를 등록한다. 항목 수(고유 파일 수와 다름)는 0.8.7에서 153개(로컬 62, 외부 91), 0.9.1에서 159개(로컬 64, 외부 95)였다. `disableExternalWebFonts`를 제공한다. 0.9.1은 fetch한 바이트를 명시적으로 등록하고 CSS용 Blob URL도 생성한다. Orca의 `font-src`에는 blob이 없으므로 Studio 구현을 통째로 가져오지 말고 패키지 상대 URL로 등록한다. [0.8.7 전체 공급 목록](https://github.com/edwardkim/rhwp/blob/1a76570e833917d15817415a53c09ad61ab3203f/rhwp-studio/src/core/generated/font-rule-projections/webfont-supply.ts) · [0.9.1 전체 공급 목록](https://github.com/edwardkim/rhwp/blob/981ce66b4183b13c1a3b5907e04a8969c8c42034/rhwp-studio/src/core/generated/font-rule-projections/webfont-supply.ts) · [0.9.1 로더](https://github.com/edwardkim/rhwp/blob/981ce66b4183b13c1a3b5907e04a8969c8c42034/rhwp-studio/src/core/font-loader.ts#L60)

## 2. Chromium의 인라인 SVG와 이미지 SVG

**실측.** macOS의 설치된 Google Chrome 157.0.8103.79 헤드리스에서 직접 만든 사각형 X 글꼴로 비교했다. 각 비교 영역에서 글리프 위치, 색, 크기, SVG 본문은 같았다. 같은 origin의 로컬 HTTP, `font-src 'self' data:`와 `img-src 'self' data: blob:`를 썼다.

| 64×64 영역 | 명도 128 미만 픽셀 | 결과 |
|---|---:|---|
| HTML 안 인라인 SVG + 문서 CSS 웹폰트 | 1,521 | 생성한 사각형 |
| img SVG, 부모 CSS에만 웹폰트 | 420 | 시스템 serif 글리프 |
| img SVG 자체의 CSS에 같은 origin 폰트 URL | 420 | 폰트 HTTP 요청도 발생하지 않음 |
| img SVG 자체의 CSS에 WOFF2 data URL | 1,521 | 인라인 결과와 픽셀 바이트 일치 |
| 인라인 SVG, 미설치 글꼴 + serif 대조군 | 420 | 위 420 두 행과 픽셀 바이트 일치 |

Blink는 이미지 SVG를 별도 문서로 열고 data 이외 하위 요청을 차단한다. SVG 2 명세도 이 이미지 모드와 data URL 예외를 정의한다. **권고**는 검증·정제한 SVG를 문서에 인라인으로 배치하고, 프레임의 CSS `@font-face`에는 같은 origin의 WOFF2와 실제 굵기 400/700을 선언하는 것이다. rhwp에 있는 `Noto Sans KR ExtraLight`는 별도 family로 등록한다. 실제 원본·문서 내장 face를 대체 우선순위에서 지키고, 대체 이름 연결은 CSS/렌더러에서 처리한다. 페이지별 중복 ID·스타일의 범위와 문서별 embedded family의 충돌을 다룬다. 캡처는 실제 사용할 face를 `document.fonts.load(...)`로 요청하고 `document.fonts.ready` 이후에 한다. 기존 `img` 격리를 유지하려면 SVG 안에 필요한 공개 글꼴의 `@font-face`/data URL을 넣는다. base64 자체 길이는 `4 × ceil(B / 3)`이고 여러 페이지에 같은 글꼴을 싣는 메모리·지연은 미측정이다. [Blink 원본](https://github.com/chromium/chromium/blob/b20cfc7542b08de921d936fe52bd9a5974e6e54e/third_party/blink/renderer/core/svg/graphics/isolated_svg_document_host.cc#L61) · [SVG 2 처리 모드](https://www.w3.org/TR/SVG2/conform.html#processing-modes)

## 3. 내려받은 파일의 크기와 문자 범위

아래 WOFF2는 별도 표시한 행 외에는 **0.9.1 자산**이다. 각 파일의 `stat().st_size`와 `fontTools.ttLib.TTFont(...).getBestCmap()`을 조사했다. KS 한글은 EUC-KR의 B0A1–C8FE 유효 2,350자, 현대 한글은 U+AC00–D7A3, 표의 한자는 U+4E00–9FFF의 유니코드 코드포인트 수다. KS 한자 4,888자에는 호환 한자가 포함돼 이 값과 다르다. WOFF2 38파일의 SHA-256 모두 상류 고지 목록과 일치했다. 개별 서브셋의 글리프 커버리지와 원본 패밀리의 커버리지는 다를 수 있다. [파일별 SHA·권리자·원본](https://github.com/edwardkim/rhwp/blob/981ce66b4183b13c1a3b5907e04a8969c8c42034/assets/fonts/licenses/font-notices.json) · [자산 디렉터리](https://github.com/edwardkim/rhwp/tree/981ce66b4183b13c1a3b5907e04a8969c8c42034/assets/fonts)

| 글꼴 / 굵기 | 실측 바이트(기재한 굵기 순) | KS 한글 / 현대 한글 / 기본 한자 | 배포 조건·용도 |
|---|---:|---|---|
| 함초롬바탕 R/B | 공식 WOFF2 미측정. CDN WOFF1 R 11,613,312 / B 13,632,424 | CDN R/B 2,350 / 11,172 / 20,940 | 한컴 독자 사용권. 상업적 재배포용 오픈 글꼴 후보에서 제외 |
| 함초롬돋움 R/B | 공식 WOFF2 미측정. CDN WOFF1 R 9,751,840 / B 미측정 | CDN R 2,350 / 11,172 / 20,940. B 미측정 | 위와 같음 |
| Noto Sans KR ExtraLight/R/B | 592,496 / 562,220 / 559,192 | 2,350 / 11,172 / 0 | Adobe OFL 1.1. 이 배포본에는 RFN `Source`. 한국어 본문용 서브셋 |
| Noto Serif KR R/B | 971,428 / 1,033,556 | 2,350 / 11,172 / 0 | Adobe OFL 1.1. 동봉 `NotoCJKSerif-OFL.txt`와 해당 파일의 저작권 표기에서 개별 RFN 선언 미발견 |
| 나눔고딕 R/B/ExtraBold | 363,844 / 440,012 / 402,288 | 2,350 / 11,172 / 0 | NHN/NAVER OFL 1.1. `Nanum`, `Naver Nanum`, `NanumGothic`, `NanumMyeongjo` 등 권리자 고지의 RFN 전체 유지 |
| 나눔명조 R/B/ExtraBold | 536,732 / 608,768 / 728,364 | 2,350 / 11,172 / 0 | 위와 같음. 휴먼·HY명조 대체 후보 |
| Pretendard R/B | 765,892 / 791,156 | 2,350 / 11,172 / 0 | OFL 1.1, RFN `Pretendard`. 나머지 Thin 694,804 / ExtraLight 734,392 / Light 757,000 / Medium 778,432 / SemiBold 785,856 / ExtraBold 793,540 / Black 800,404 |
| D2Coding R/B | 1,485,480 / 1,579,776 | 2,350 / 11,172 / 4,620 | OFL 1.1, RFN `D2Coding`. 호환 한자 268개를 합쳐 KS 한자 4,888자 전체. 고정폭 대체 |
| RHWP Public Batang R | 2,832,012 | 2,350 / 11,172 / 7,476 | OFL 1.1, 동봉 원문에서 RFN 선언 미발견. KS 한자 4,888자 전체. 추가 한자 fallback 후보 |
| RHWP Old Hangul R | 239,732 | 0 / 0 / 0 | 옛 자모 cmap 357개. Source Han Serif K 파생, OFL 1.1·RFN `Source`를 보존하고 개명 |
| 고운바탕 R/B, 고운돋움 R | 495,092 / 447,856 / 406,476 | 모두 2,350 / 11,172 / 0 | OFL 1.1, 개별 RFN 선언 없음. 궁서·HY고딕 계열 후보 |
| 나눔고딕코딩 R/B, Spoqa Han Sans R | 670,036 / 698,148 / 275,144 | 나눔 2,350 / 11,172 / 0, Spoqa 2,350 / **2,350** / 0 | OFL 1.1. 나눔 RFN 및 `Spoqa Han Sans` 계열 RFN 적용 |
| Cafe24 써라운드 / 슈퍼매직 R | 391,868 / 765,684 | 모두 2,350 / 11,172 / 1 | OFL 1.1. 각 공식 PDF 및 SIL 전문 유지. 장식체 |
| Happiness Sans R/B/Title/VF | 291,556 / 336,604 / 348,700 / 613,412 | 각 2,350 / 2,780 / 0 | OFL 1.1. 권리자 공식 PDF에 RFN 명시. 장식체 |
| Latin Modern Math R / Noto Sans Math R | 391,676 / 226,456 | 0 / 0 / 0 | 각각 GUST Font License·LPPL / OFL 1.1. 수식용 |
| 공식 Noto Sans CJK KR 전체 R/B, 로컬 WOFF2 압축 | 11,427,036 / 12,140,368 | 2,350 / 11,172 / 20,976 | OFL 1.1. 두께별 KS 한자 4,888개, 확장 A 6,582개, 확장 B 2,108개 |
| 공식 Noto Serif CJK KR 전체 R/B, 로컬 WOFF2 압축 | 16,716,092 / 17,839,912 | 2,350 / 11,172 / 20,992 | OFL 1.1. 두께별 KS 한자 4,888개, 확장 A 6,592개, 확장 B 2,057개 |

**함초롬 사용권.** 한컴 FAQ는 개인·기업의 출판물·화면 이용을 허용하고 출처 표시를 권장한다. 임의 수정 및 글꼴 자체의 영리 목적 재배포는 금지한다. 독립 앱과 함께 배포하는 서브셋·WOFF2 변환에 대한 명시 허가는 확인하지 못했다. 공개 CDN의 WOFF1 크기는 Studio의 실제 참조 자원에 관한 조사값이다. 플러그인에 이 파일을 싣거나 변환하지 않고, 사용자가 보유한 로컬 원본을 먼저 찾도록 한다. 함초롬바탕과 한컴바탕은 권리자·파일부터 다르다. [한컴 FAQ](https://www.hancom.com/support/faqCenter/faq/detail/2301) · [한컴의 영문 family 및 파일 구별](https://www.hancom.com/support/faqCenter/faq/detail/2462) · [Studio가 참조한 파일](https://github.com/edwardkim/rhwp/blob/981ce66b4183b13c1a3b5907e04a8969c8c42034/rhwp-studio/src/core/generated/font-rule-projections/webfont-supply.ts#L35)

**CSS 등록 확인.** 0.9.1 Noto Serif KR R/B의 내부 name ID 1이 모두 `Noto Serif KR ExtraLight`지만 OS/2 usWeightClass는 각각 400/700이다. 파일명을 보고 자동 탐지하기보다 CSS 표기 family를 `Noto Serif KR`로, face의 weight를 각각 400/700으로 명시한다. 한편 rhwp의 별도 `Noto Sans KR ExtraLight`은 200 인스턴스에서 만든 자산이며 내부 usWeightClass 400이다. 렌더러가 요청하는 별도 family의 일반 face로 등록하고 bold 체인에서 빠지는 규칙을 존중한다.

**OFL 사용권.** 프로그램에 동봉·웹 임베딩·변환·서브셋 가능. 저작권과 OFL 전문을 동봉하고, 파생 글꼴도 OFL을 유지하며, 글꼴 단독 판매는 금지된다. RFN이 선포된 글꼴에서 서브셋처럼 기능이 달라지는 파생본은 권리자의 서면 허가가 없으면 예약 이름을 primary 이름에서 제거한다. 무손실 WOFF 압축은 원 데이터와 원 메타데이터 보존 등 OFL FAQ의 조건을 확인한다. 표의 나눔과 D2Coding은 0.9.1의 전체 원본 압축본, Pretendard는 상류가 공식 배포본과 바이트 대조한 파일이다. 전체 Noto CJK 행은 공식 한국어 OTF에 글리프 제거 없이 이 조사에서 `TTFont(recalcTimestamp=False)`와 WOFF2를 적용한 결과다. 전체 한국어 CJK 판이라도 모든 유니코드 한자가 들어가는 것은 아니다. [OFL 공식 FAQ](https://openfontlicense.org/webfonts-and-reserved-font-names/) · [rhwp 고지 원본](https://github.com/edwardkim/rhwp/blob/981ce66b4183b13c1a3b5907e04a8969c8c42034/assets/fonts/licenses/README.md) · [공식 Sans OTF](https://github.com/notofonts/noto-cjk/tree/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/OTF/Korean) · [공식 Serif OTF](https://github.com/notofonts/noto-cjk/tree/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Serif/OTF/Korean)

## 4. 50 MiB 예산과 추천 구성

**확인.** 플러그인은 2,000파일·52,428,800 B까지이며, custom editor entry 최대 10 MiB, Orca가 변환하는 TS/TSX/MTS/JSX 각각 1 MiB다. 이미지·폰트·미디어 스트리밍은 파일당 32 MiB, HTML/JS/CSS/JSON/SVG/WASM 일괄 읽기는 파일당 16 MiB이다. `contributes.fonts`는 터미널·편집기·UI 선택기용(최대 8 family, family당 8 face, 파일 2 MB·합계 8 MB). 프레임 문서의 웹폰트에는 매니페스트 등록 없이 플러그인 내부 파일을 `@font-face src:url(...)`로 참조한다. 풀 Noto Serif Bold 17,839,912 B도 WOFF2 스트리밍 상한 이내다. stock 0.9.1 WASM 27,882,066 B는 별도 WASM 16 MiB 상한을 초과한다. [플러그인 크기](https://github.com/stablyai/orca/blob/282844ff620e098d0bc8349b6643241629adf5ff/docs/reference/plugin-authoring.md) · [프레임 서빙·CSP](https://github.com/stablyai/orca/blob/282844ff620e098d0bc8349b6643241629adf5ff/docs/reference/plugin-isolated-frames.md) · [매니페스트 글꼴 기여](https://github.com/stablyai/orca/blob/282844ff620e098d0bc8349b6643241629adf5ff/docs/reference/plugin-manifest.md#fontcontribution)

폰트 세트는 엔진과 독립적으로 0.9.1의 권리 고지·SHA가 있는 파일을 선택했다. **기타**에는 실제 UI JS/HTML/CSS, 라이선스, 매니페스트와 기타 부속 파일이 들어간다. 아래 기타의 남은 한도는 용량 상한에서 실측 자산을 뺀 값이며 출하 크기는 미측정이다.

| 제안 | 폰트 B | 0.8.7 WASM B | 0.8.7 npm JS B | 0.8.7 소계 B | 0.8.7 기타에 쓸 수 있는 B | 0.9.1 경량 WASM·JS·기타가 함께 쓸 수 있는 B |
|---|---:|---:|---:|---:|---:|---:|
| A. 한글 기본, 5개 | 3,718,892 | 11,821,756 | 454,520 | 15,995,168 | 36,433,632 | 48,709,908 |
| **B. 일반 공문·서식, 13개** | **12,558,440** | **11,821,756** | **454,520** | **24,834,716** | **27,594,084** | **39,870,360** |
| C. 한자 확장, 14개 | 29,274,532 | 11,821,756 | 454,520 | 41,550,808 | 10,877,992 | 23,154,268 |

- A는 Noto Serif KR R/B, Noto Sans KR R/B와 ExtraLight. 번들에서 현대 한글 전체를 공급하며 한자는 호스트에 의존한다.
- B는 A에 Pretendard R/B, 나눔명조 R/B, D2Coding R/B, RHWP Public Batang R, RHWP Old Hangul R을 더한다. Public Batang을 **한자 대체가 필요한 경우** 명시적으로 앞선 선호 글꼴 뒤·CSS generic 앞에 넣어야 한다. 이 글꼴은 성격이 다른 문서에서 무조건 선택되는 일반 체인 항목이 아니다. B의 나눔명조는 기본 serif 체인에서 Noto Serif KR보다 앞서 매칭될 수 있다. 원래 face를 가리지 말고 목표 문서의 글꼴별로 어느 fallback을 허용했는지 기록한다. 0.8.7의 옛한글 요청을 신형 글꼴에 연결할 때는 SVG 요청의 fallback 이름을 `RHWP Old Hangul`로 명시해 개명된 파일을 그대로 사용한다.
- C는 B에 전체 Noto Serif CJK KR Regular 한 파일을 더한다. 고문서·고유명사에서 기본 한자와 확장 A/B를 넓힌다. 굵은 한자에 같은 원형을 제공해야 하는 경우 Regular 한 파일만으로는 부족하다.
- **0.9.1 경량 WASM = 미측정, 전용 JS = 미측정, 최종 합계 = 미측정(이 조사).** npm 표준 JS는 587,539 B이지만 경량 glue의 측정값으로 대입하지 않았다. 전체 notices 84개·4,728,493 B를 실으면 우측 한도에서 그만큼 차감한다. 예컨대 C에서는 WASM·JS·그 밖의 파일에 18,425,775 B가 남으며 WASM 자체는 16,777,216 B 이하여야 한다. 타 워커의 최종 빌드·서빙 결과로 결정할 부분이다.

## 5. WASM과 글꼴 고지

**공식 예제.** `plugins/docx/build/build.mjs`는 esbuild의 `metafile.inputs`에서 번들에 들어간 node_modules 패키지를 경로별 수집한다. 라이선스·COPYING 원문과 `build/licenses/*.txt`의 검토본을 줄바꿈 정규화 후 비교하고, 누락·변경 시 실패한다. 이름순으로 `name@version (license)`, 홈페이지, 전문을 나열하고 `build/UPSTREAM_NOTICE.txt`를 앞에 붙여 플러그인 루트 `THIRD_PARTY_NOTICES.txt`를 생성한다. 실제 검토본은 docx-preview, fflate, immediate, jszip, lie, pako 6개다. JS metafile만으로 이미 컴파일된 WASM 안의 Rust 코드·폰트·비크레이트 포팅 알고리즘까지 열거할 수는 없다. [공식 빌드](https://github.com/stablyai/orca-plugins/blob/1329848789e35eb24ccf1dc946cc360da0dac465/plugins/docx/build/build.mjs#L95) · [고지 결과물](https://github.com/stablyai/orca-plugins/blob/1329848789e35eb24ccf1dc946cc360da0dac465/plugins/docx/THIRD_PARTY_NOTICES.txt) · [검토본](https://github.com/stablyai/orca-plugins/tree/1329848789e35eb24ccf1dc946cc360da0dac465/plugins/docx/build/licenses)

| 출하 대상 | 고지에 포함할 항목과 적용 근거 |
|---|---|
| 두 버전 공통 | rhwp **Copyright (c) 2025-2026 Edward Kim** 및 MIT 허가·면책 전문. 각 버전 `THIRD_PARTY_LICENSES.md`의 Volexity hwp-extract 복호 알고리즘 BSD-3-Clause 원문·권리자. 상류가 명시한 Hancom OWPML/DVC 스펙 참조 고지도 해당 색인에 보존. wasm-bindgen glue와 선택한 빌드의 Rust 직·전이 의존성마다 권리자·해당 전문·NOTICE. 예를 들어 encoding_rs의 BSD 및 선택한 MIT/Apache, zopfli의 Apache-2.0, curve25519/ed25519-dalek의 BSD-3, Unicode 자료 고지를 구분한다. |
| 0.8.7 npm 원본 | LICENSE, README, JS, WASM과 타입 파일은 있으나 notices 디렉터리가 없다. 상류 **같은 태그**의 THIRD_PARTY_LICENSES, Cargo.lock과 각 잠긴 crate archive의 LICENSE/COPYING/NOTICE/추가 저작권 파일로 보충한다. 예를 들어 표가 적은 encoding_rs 0.8.35와 달리 이 태그 WASM 타깃의 잠긴 버전은 0.8.42이며 archive에 COPYRIGHT, LICENSE-APACHE, LICENSE-MIT, LICENSE-WHATWG가 있다. 뷰어가 별도로 넣는 WOFF2에는 선택한 **자산 버전**의 고지를 붙인다. |
| 0.9.1 npm 원본 | LICENSE 외에 **notices 84파일·4,728,493 B**. `scripts/prepare_release_notices.py`는 target/feature에 관계없이 저장소 notices를 수집한다. 표준 npm 그대로 재배포하면 보존하는 편이 재현 가능하다. PDF 기본 구성은 PDFOxide/OfficeOxide MIT·NOTICE, PDF 코덱·qcms와 포함되는 자원에 관한 고지까지 유지한다. 84개가 모든 구성의 법적 최소 목록이나 Rust 전체 저작권 전문은 아니다. |
| 0.9.1 경량, PDF 기능 제외 | 공통 고지에 `assets/licenses/Unicode-3.0.txt`, `data/font-metrics/nimbus-roman/URW-FONT-NOTICE.txt`, `licenses/pdfium/LICENSE`(공통 Print 이미지 산술 포팅), `licenses/intel-mediasdk/LICENSE`(JPEG IDCT), `vendor/rhwp-codec-resource/LICENSE`, `vendor/rhwp-jpeg-encoder/LICENSE-*`·`RHWP_PATCHES.md`, `vendor/rhwp-zune-jpeg/LICENSE-*`·`README.ijg`·`RHWP_PATCHES.md`, 두 vendor provenance를 포함하는 구성을 권한다. IJG를 문서에도 **“This software is based in part on the work of the Independent JPEG Group.”**라고 명시한다. PDFium의 이 조건은 PDF 입력 기능을 끄는 것과 독립이다. URW는 outline 없는 추출 **메트릭**의 원본 AGPL/폰트 예외 등 고지다. 이로부터 플러그인 전체 라이선스를 단정하지 않는다. |
| 0.9.1 내장 수식 | `assets/fonts/MANIFEST-RHWP-LMM-VariableOutline.txt`, `LatinModernMath-GUST-FONT-LICENSE.txt`, `assets/fonts/licenses/LPPL-1.3c.txt`와 원작자 고지(Copyright 2012–2014 B. Jackowski, P. Strzelczyk, P. Pianowski). 0.9.1 OTF 13,488 B와 파생 윤곽이 대상. **0.8.7 태그에는 이 파생 OTF·구현이 없었다**. 0.8.7에 별도로 Latin Modern Math WOFF2를 싣는 경우에는 해당 글꼴 고지를 포함한다. |
| 경량에서 조건부 생략 가능한 상류 자료 | 조사한 WASM 타깃의 `--no-default-features --features wasm-api` normal 의존성에 PDF-import-backend, office_oxide, rhwp-hayro-{ccitt,jbig2,jpeg2000}, rhwp-qcms, rhwp-jpeg-decoder, native 전용 svg2pdf, JS 도구 ajv는 없었다. 이 경로 전용의 notices·PDF 전용 폰트·전혀 공급하지 않는 장식체 고지는 **완성된 배포물에 다른 경로로 포함되지 않았을 때** 최소 번들 제외 후보. 상류 umbrella notices 원본을 전부 보관하는 옵션도 예산에 포함했다. |
| 실제 번들 WOFF2 | 각 `filename → SHA-256 → 권리자 → 라이선스·RFN·변형`을 연결하고 해당 전문을 동봉한다. Noto Sans KR → `NotoSansKR-OFL.txt`, Noto Serif KR → `NotoCJKSerif-OFL.txt` 및 파일별 Adobe copyright, 나눔 → 해당 `Nanum*-OFL.txt`, Pretendard → `Pretendard-OFL.txt`, D2Coding → `D2Coding-OFL.txt`, Public Batang → `RHWPPublicBatang-OFL.txt`, Old Hangul → `SourceHanSerifK-OFL.txt`. 고운·Spoqa도 해당 권리자 원문, Happiness·Cafe24를 넣을 때는 원문 PDF까지 보존. C의 추가 Noto CJK는 공식 배포의 LICENSE와 OTF 내 copyright·버전·변환 기록을 함께 보존한다. |

**명령으로 확인한 범위.** `cargo tree -p rhwp --locked --target wasm32-unknown-unknown -e normal,no-proc-macro --prefix none -f '{p}|{l}'` 고유 노드는 0.8.7 기본 131개(자기 자신 포함), 0.9.1 PDF 제외/wasm-api 158개, 같은 옵션에 console_error_panic_hook를 더하면 159개다. 경량 normal graph에 남은 `vendor/` 경로 세 곳은 **rhwp-codec-resource, rhwp-jpeg-encoder, rhwp-zune-jpeg**였다. 이것은 빌드 없이 확인한 타깃 그래프이며 링크 시 제거된 코드, 코드생성기가 출력한 내용, 비크레이트 데이터까지 판정하는 법적 목록은 아니다. 실제 릴리스는 빌드 플래그·lock·배포 파일별 SHA와 검토본을 묶어 고정하고 의존성 변경 시 차이를 검토한다. [0.8.7 감사자료](https://github.com/edwardkim/rhwp/blob/1a76570e833917d15817415a53c09ad61ab3203f/THIRD_PARTY_LICENSES.md) · [0.9.1 감사자료](https://github.com/edwardkim/rhwp/blob/981ce66b4183b13c1a3b5907e04a8969c8c42034/THIRD_PARTY_LICENSES.md) · [0.9.1 notice 수집기](https://github.com/edwardkim/rhwp/blob/981ce66b4183b13c1a3b5907e04a8969c8c42034/scripts/prepare_release_notices.py) · [0.9.1 Cargo 기능](https://github.com/edwardkim/rhwp/blob/981ce66b4183b13c1a3b5907e04a8969c8c42034/Cargo.toml#L360) · [수식 파생 manifest](https://github.com/edwardkim/rhwp/blob/981ce66b4183b13c1a3b5907e04a8969c8c42034/assets/fonts/MANIFEST-RHWP-LMM-VariableOutline.txt)

## 6. 한컴 공개 규격의 제품 고지

**요구된다.** 한컴의 현재 공식 웹페이지와 스토어 안내가 모두 제시하는 문구는 **“본 제품은 한컴의 HWP 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.”** 이다. 제품 내 UI, 매뉴얼, 도움말, 소스 모두에 기재하며 구성물이 없으면 존재하는 구성물에 기재한다. 구현 시 뷰어 정보/도움말, 배포 안내·매뉴얼(있을 때), 소스에 기록한다. 라이선스 TXT 하나만 동봉하는 방식은 UI 고지까지 충족하지 않는다. [한컴 현재 공식 안내](https://www.hancom.com/support/downloadCenter/hwpOwpml) · [한컴 스토어 이용 조건](https://store.hancom.com/etc/hwpDownload.do)

공식 5.0 revision 1.3 PDF 저작권 면의 원문은 **“본 제품은 한글과컴퓨터의 글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.”** 이다. `pdftotext`에서 첫 글자는 옛한글 로고용 PUA U+F53A이었다. 두 rhwp README는 현대 표기 **“본 제품은 한글과컴퓨터의 한글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.”**를 사용한다. README의 상표 고지는 **“"한글", "한컴", "HWP", "HWPX"는 주식회사 한글과컴퓨터의 등록 상표입니다.”**이며 뒤에 제휴·후원·승인 관계가 없는 독립 오픈소스 프로젝트라는 설명이 있다. 제품 화면에는 현재 공식 웹 문구를 그대로, rhwp 고지 섹션에는 상류 문구를 보존하는 것을 제안한다. 한컴 안내의 문구 요구는 공개 HWP 규격에 해당한다. 이 조사에서는 별도 KS X 6101 표준의 독립 고지 의무를 확인하지 않았다. [5.0 rev 1.3 원문](https://cdn.hancom.com/link/docs/%ED%95%9C%EA%B8%80%EB%AC%B8%EC%84%9C%ED%8C%8C%EC%9D%BC%ED%98%95%EC%8B%9D_5.0_revision1.3.pdf) · [0.8.7 README](https://github.com/edwardkim/rhwp/blob/1a76570e833917d15817415a53c09ad61ab3203f/README.md#L508) · [0.9.1 README](https://github.com/edwardkim/rhwp/blob/981ce66b4183b13c1a3b5907e04a8969c8c42034/README.md#L523)

## 7. 측정 범위와 재현

- 대조한 npm tarball의 gitHead는 0.8.7 `1a76570e833917d15817415a53c09ad61ab3203f`, 0.9.1 `981ce66b4183b13c1a3b5907e04a8969c8c42034`. `shasum -a 1` 결과는 각각 `3bf8afb0683223e26ac704314a0a9b471c4840cd`, `2859860aec79e5f7cd68ddfe9aa1d38d660e4814`로 registry dist.shasum과 일치. 0.8.7 전체 WOFF2는 36개 22,651,296 B, 0.9.1은 38개 26,196,084 B. 배포 후보 B는 후자의 바이트를 기준으로 한다. [0.8.7 npm](https://registry.npmjs.org/@rhwp/core/0.8.7) · [0.9.1 npm](https://registry.npmjs.org/@rhwp/core/0.9.1)
- `getBestCmap()` 값은 코드포인트를 유효 글리프로 매핑하는 수다. 옛한글 GSUB 조합 품질, 세로쓰기·표·혼합 한자·종속 PUA, 실제 한컴 버전별 글자·줄·쪽 일치율과 누락률, 사용자 장치의 실제 사용 face, 스크롤 성능은 미측정이다. 한컴 원본과 대조할 때 쪽 수, 각 행의 첫·끝 글자, 표 경계·겹침, 미지원 글리프를 따로 비교해야 한다. 필수 원본이 없는 환경에선 편집 지시자가 대체 글꼴로 그린 결과임을 볼 수 있게 표시한다.
- WASM 데이터 섹션을 실행 없이 정적 복원해 13,488 B OTF 전체의 일치를 찾았을 때 0.8.7은 미발견, 0.9.1은 선형 메모리 주소 2,744,224에서 일치했다. 같은 방법으로 0.9.1 저장소 WOFF2 38개 완전 일치는 두 WASM에서 0개였다. 이 검색 결과만으로 가능한 모든 변환·압축·윤곽 상수의 부재를 증명하지 않는다. PDF 기본판의 별도 서드파티 자원도 한글 본문 글꼴 공급과 구별한다. [내장 코드](https://github.com/edwardkim/rhwp/blob/981ce66b4183b13c1a3b5907e04a8969c8c42034/src/renderer/equation/variable_outline.rs#L9)
- 실행한 핵심 측정식은 `sum(f.stat().st_size for f in directory.glob('*.woff2'))`, `len(set(TTFont(path).getBestCmap()) & set(range(0xAC00,0xD7A4)))`, `len(cmap & set(range(0x4E00,0xA000)))`다. 풀 CJK WOFF2 생성은 fontTools 4.25.0에서 `f=TTFont(otf,recalcTimestamp=False); f.flavor='woff2'; f.save(out)`. Chromium 진단은 [자가 생성한 시험 코드](/tmp/orca-hwp-w3.XNHmGXvd/chrome-proof.py), [측정 스크린샷](/tmp/orca-hwp-w3.XNHmGXvd/svg-experiment/probe.png)에서 확인할 수 있다. [0.8.7 타깃 그래프](/tmp/orca-hwp-w3.XNHmGXvd/runtime87.txt) · [0.9.1 경량 타깃 그래프](/tmp/orca-hwp-w3.XNHmGXvd/runtime91.txt)

