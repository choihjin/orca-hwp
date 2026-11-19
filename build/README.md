# HWP 뷰어 빌드

`npm run vendor:fonts`는 rhwp v0.9.1의 WOFF2와 고지를 내려받고
`fonts.css`와 `manifest.json`을 다시 만든다. `npm run vendor:resvg`는
resvg-wasm과 woff2-encoder의 해제 전용 파일을 갱신한다. 두 스크립트는
`pins.json`의 크기와 SHA-256을 검증한다. `npm run check:size`는
배포 폴더의 파일 수와 바이트 상한을 검사한다.

## resvg-wasm의 WOFF2 지원 판정

**resvg-wasm 2.6.2는 WOFF2를 읽지 못한다.** Node.js 22.22.3에서
시스템 글꼴을 끄고, 흰 배경에 `font-family="Noto Sans KR"`로 `한글`을
그리는 256×96 SVG를 시험했다. `font.fontBuffers`를 비운 대조군에서
명도 128 미만 픽셀은 0개였다. 원본 `NotoSansKR-Regular.woff2`를
넘기면 `new Resvg(...)`에서 `RuntimeError: unreachable`이 발생했다.
같은 글꼴을 TTF로 해제해 넘기면 어두운 픽셀 1,527개가 그려졌다.

13개 TTF·OTF를 플러그인에 넣은 시험에서 글꼴은 51,934,336 B,
플러그인 폴더는 67,132,409 B였다. 폴더 상한은 52,428,800 B다.
프레임은 상류 WOFF2 13개(12,558,440 B)를 그대로 사용한다. P2는
`agent/vendor/woff2/decode.mjs`의 `decodeWoff2(bytes)`로 메모리에서
TTF·OTF를 복원해 resvg에 넘긴다. 디코더는 WASM이 내장된 npm
`woff2-encoder@2.0.0`의 해제 전용 모듈이다.

`manifest.json`의 `families`는 SVG/CSS에서 요청하는 이름이다. resvg가
글꼴 바이트에서 읽는 이름 중 `Noto Serif KR ExtraLight`는 Noto Serif KR
400·700, `Noto Sans KR Thin`은 Noto Sans KR 700,
`NanumMyeongjo`는 나눔명조 400·700에 해당한다.
`Source Han Serif K Old Hangul`이 요청되면 `RHWP Old Hangul`을 사용한다.

## 해제 및 렌더링 확인

Apple M2 Pro, Node.js 22.22.3에서 각 글꼴을 한 번씩 해제했다. 아래
시간은 `decodeWoff2` 호출에 걸린 시간이며, 글꼴 파일 읽기와 resvg 렌더링
시간은 제외했다. 각 글꼴을 단독으로 사용해 시스템 글꼴 없이 `한글`을
그렸고, 옛한글 글꼴은 `ᄒᆞᆫ글`을 그렸다. 빈 글꼴 대조군에서 어두운
픽셀은 모두 0개였다. 복원된 TTF·OTF와 fontTools 4.62.1에서 같은 원본을
해제한 TTF·OTF를 각각 resvg에 넘긴 결과, 13개 PNG 모두 바이트가 같았다.

| WOFF2 | 해제 시간(ms) | 명도 128 미만 픽셀 |
| --- | ---: | ---: |
| NotoSerifKR-Regular | 84.65 | 1,190 |
| NotoSerifKR-Bold | 51.69 | 1,810 |
| NotoSansKR-Regular | 20.25 | 1,527 |
| NotoSansKR-Bold | 18.51 | 2,429 |
| NotoSansKR-ExtraLight | 22.22 | 855 |
| Pretendard-Regular | 23.47 | 1,414 |
| Pretendard-Bold | 23.76 | 2,150 |
| NanumMyeongjo-Regular | 17.45 | 1,071 |
| NanumMyeongjo-Bold | 18.75 | 1,445 |
| D2Coding-Regular | 38.18 | 1,701 |
| D2Coding-Bold | 38.79 | 2,297 |
| RHWPPublicBatang-Regular | 65.01 | 909 |
| RHWPOldHangul-Regular | 4.54 | 979 |
| 합계 | 427.27 | |

`node build/check-font-render.mjs`로 13개 글꼴의 해제와 단독 렌더링을
확인한다. PNG 바이트도 비교하려면 fontTools 4.62.1과 Brotli가 설치된
Python으로 대조군을 만들고 `node build/check-font-render.mjs fixtures/font-reference`를
실행한다.

```python
from pathlib import Path
from fontTools.ttLib import TTFont

out = Path("fixtures/font-reference")
out.mkdir(parents=True, exist_ok=True)
for source in Path("editor/fonts").glob("*.woff2"):
    with TTFont(source, recalcTimestamp=False) as font:
        font.flavor = None
        suffix = ".otf" if font.sfntVersion == "OTTO" else ".ttf"
        font.save(out / source.with_suffix(suffix).name, reorderTables=False)
```
