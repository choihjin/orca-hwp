# HWP 뷰어 빌드

## resvg-wasm의 WOFF2 지원 판정

판정은 **WOFF2를 읽지 못함**이다. Node.js 22.22.3에서
`@resvg/resvg-wasm@2.6.2`의 원본 JS·WASM을 로드한 뒤, 흰 배경에
`font-family="Noto Sans KR"`로 `한글`을 그리는 256×96 SVG를 시험했다.
시스템 글꼴을 끄고 `font.fontBuffers`를 비운 대조군은 명도 128 미만
픽셀이 0개였다. rhwp v0.9.1의 `NotoSansKR-Regular.woff2` 하나를
넘기자 `new Resvg(...)`에서 `RuntimeError: unreachable`이 발생해
PNG를 생성하지 못했다. 따라서 브라우저와 PNG 경로에는 이 WOFF2를
해제한 OpenType 글꼴을 사용할 계획이다.
