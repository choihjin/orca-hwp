# HWP 뷰어 빌드

`npm run vendor:fonts`는 rhwp v0.9.1의 WOFF2와 고지를 내려받고
`fonts.css`와 `manifest.json`을 다시 만든다. `npm run vendor:resvg`는
resvg-wasm을 갱신한다. 두 스크립트는
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
`agent/woff2.js`의 `decodeWoff2(bytes)`로 메모리에서 TTF·OTF를 복원해
resvg에 넘긴다. 이 모듈은 W3C WOFF2 규격을 따라 직접 쓴 것으로, Brotli는
Node.js의 `node:zlib`을 쓴다. v0.1.3까지는 npm `woff2-encoder@2.0.0`의
WASM을 썼다. 13개 글꼴의 해제 결과가 그 WASM과 바이트까지 같으며,
`agent/woff2.test.mjs`가 SHA-256으로 확인한다. 바이트를 맞추기 위해
복원한 `loca`는 `glyf` 바로 뒤에 두고, 결과가 머리말의 `totalSfntSize`보다
짧으면 그 크기까지 0으로 채운다(결과의 두 배를 넘는 값은 무시한다).

`manifest.json`의 `families`는 SVG/CSS에서 요청하는 이름이다. resvg가
글꼴 바이트에서 읽는 이름 중 `Noto Serif KR ExtraLight`는 Noto Serif KR
400·700, `Noto Sans KR Thin`은 Noto Sans KR 700,
`NanumMyeongjo`는 나눔명조 400·700에 해당한다.
`Source Han Serif K Old Hangul`이 요청되면 `RHWP Old Hangul`을 사용한다.

## 해제 및 렌더링 확인

Apple M2 Pro, Node.js 22.22.3에서 `check-font-render.mjs`를 11번 실행했다.
다른 작업이 함께 돌던 때(부하 평균 약 10)의 값이다. 아래 시간은 합계가
중앙값인 실행에서 `decodeWoff2` 호출에 걸린 시간이며, 글꼴 파일 읽기와 resvg 렌더링
시간은 제외했다. 각 글꼴을 단독으로 사용해 시스템 글꼴 없이 `한글`을
그렸고, 옛한글 글꼴은 `ᄒᆞᆫ글`을 그렸다. 빈 글꼴 대조군에서 어두운
픽셀은 모두 0개였다. 복원된 TTF·OTF와 fontTools 4.62.1에서 같은 원본을
해제한 TTF·OTF를 각각 resvg에 넘긴 결과, 13개 PNG 모두 바이트가 같았다.

| WOFF2 | 해제 시간(ms) | 명도 128 미만 픽셀 |
| --- | ---: | ---: |
| NotoSerifKR-Regular | 100.45 | 1,190 |
| NotoSerifKR-Bold | 104.63 | 1,810 |
| NotoSansKR-Regular | 43.27 | 1,527 |
| NotoSansKR-Bold | 27.46 | 2,429 |
| NotoSansKR-ExtraLight | 31.31 | 855 |
| Pretendard-Regular | 32.66 | 1,414 |
| Pretendard-Bold | 32.37 | 2,150 |
| NanumMyeongjo-Regular | 30.98 | 1,071 |
| NanumMyeongjo-Bold | 27.88 | 1,445 |
| D2Coding-Regular | 52.84 | 1,701 |
| D2Coding-Bold | 49.96 | 2,297 |
| RHWPPublicBatang-Regular | 84.14 | 909 |
| RHWPOldHangul-Regular | 3.29 | 979 |
| 합계 | 621.24 | |

같은 조건에서 번갈아 실행한 v0.1.3의 WASM은 합계 중앙값이 479.04 ms였다.

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

## 서드파티 고지

`npm run notices`는 고정한 상류 파일과 배포 폴더에 있는 라이선스 원문을
`build/licenses/`의 검토본과 대조한다. 줄바꿈을 LF로 맞춘 뒤 내용이
다르면 고지 파일을 쓰기 전에 실패한다. Rust 크레이트 원본은
`CARGO_HOME`(기본 `~/.cargo`)의 캐시를 먼저 읽고, 없으면 crates.io에서
받는다. 원본 아카이브는 `Cargo.lock`의 SHA-256으로 검증한다.

`build/licenses/crates.json`은 rhwp v0.8.7의 WASM 타깃 normal 그래프를
고정한다. 확인한 항목은 총 131개로, rhwp 자체와 같은 작업공간의 크레이트
3개, crates.io 크레이트 127개다. 같은 작업공간의 크레이트에는 상류
저장소의 MIT 전문을 적용했다. 목록을 갱신할 때는 고정한 상류 커밋에서
다음 명령을 실행하고 출력의 중복 노드를 제거한다.

```sh
cargo tree -p rhwp --locked --target wasm32-unknown-unknown -e normal,no-proc-macro --prefix none -f '{p}|{l}'
cargo fetch --locked --target wasm32-unknown-unknown
```
