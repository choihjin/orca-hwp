# rhwp 0.9.1 경량 WASM 실험

PDF 기능만 끈 경량 WASM은 **19,210,456 B**로 Orca의 16 MiB 한도를 **2,433,240 B 초과**했다. 뷰어에 필요한 API만 남긴 추가 실험판은 **13,881,337 B**로 한도를 **통과**했고, 2,895,879 B의 여유가 있다.

## 도구와 소스

| 도구 | 버전 | 경로 |
| --- | --- | --- |
| rustup | 1.29.3 | `~/.cargo/bin/rustup` |
| Rust/Cargo | 1.93.1 및 `wasm32-unknown-unknown` | `~/.rustup/toolchains/1.93.1-aarch64-apple-darwin` |
| wasm-pack | 0.15.0 | `~/.cargo/bin/wasm-pack` |
| wasm-bindgen | 0.2.127 | `~/.cargo/bin/wasm-bindgen` |
| wasm-opt | Binaryen 117 | `/private/var/folders/rb/hf9xjqpj7817kthcc89jnm940000gn/T/tmp.oONAoJnmJ9/binaryen-version_117/bin/wasm-opt` |
| Node | 22.22.3 | 기존 설치 |

rustup 설치 시 선택된 stable 1.100.0도 `~/.rustup`에 있다. 양쪽 빌드에는 1.93.1을 사용했다. npm 0.9.1의 WASM `producers` 섹션에서도 rustc 1.93.1과 wasm-bindgen 0.2.127을 확인했다. npm 메타데이터의 `gitHead`와 태그의 커밋은 `981ce66b4183b13c1a3b5907e04a8969c8c42034`로 일치했다.

## 빌드와 크기

- 기본은 공식 배포 명령 `python3 scripts/measure_render_diff_wasm.py --profile release --build-mode standard`와 포장 명령 `bash scripts/prepare-npm.sh`를 실행했다. 활성 feature는 `console_error_panic_hook`, `pdf-import`, `pdf-jbig2`, `pdf-jpeg2000`, `pdf-icc`, `wasm-api`다.
- 경량은 `sh scripts/wasm-pack-locked.sh --target web --release --out-dir /private/var/folders/rb/hf9xjqpj7817kthcc89jnm940000gn/T/tmp.oONAoJnmJ9/build-light-parallel/package --no-default-features --features wasm-api`로 빌드했다. 활성 feature는 `wasm-api`다. 이 실험은 태그 소스와 `Cargo.lock` 그대로 빌드했다.
- 두 로컬 빌드에서 wasm-pack이 `wasm-opt`를 호출한 것을 로그로 확인했다. 옵션은 `-O`다. gzip은 최적화된 `rhwp_bg.wasm`에 `gzip -n -9`를 적용한 참고치다. npm 배포 파일의 빌드 중간 크기는 미측정이다.

| 빌드 | 링커 원본 B | bindgen 후·wasm-opt 전 B | 배포 WASM B | gzip B | 16 MiB |
| --- | --- | --- | --- | --- | --- |
| v0.9.1 기본 | 34,434,956 | 32,200,966 | 27,887,522 | 10,505,563 | 초과 |
| v0.9.1 경량 | 24,139,585 | 22,154,853 | 19,210,456 | 7,228,235 | 초과 |
| v0.9.1 경량, 별도 `-Oz` | 24,139,585 | 22,154,853 | 19,099,843 | 7,223,063 | 초과 |
| npm 0.9.1 | 미측정 | 미측정 | 27,882,066 | 10,505,627 | 초과 |
| npm 0.8.7 | 미측정 | 미측정 | 11,821,756 | 4,383,889 | 통과 |

로컬 기본 빌드와 npm 0.9.1의 WASM 크기 차이는 +5,456 B(+0.0196%)이며, WASM SHA-256은 달랐다. JS 및 두 형식 선언 파일의 SHA-256은 일치했다. 업스트림의 `verify_release_wasm.py`로 로컬 패키지와 Studio 복사본을 검증했다. 로컬 기본 ↔ npm 0.9.1의 표본 SVG는 40/40쪽, 텍스트는 40/40쪽에서 일치했다.

## 기능 확인

Node에서 경량 JS의 `HwpDocument`를 생성하고 `pageCount`, `renderPageSvg`, `getPageText`를 직접 호출했다. Cargo 의존성 트리에서 PDF 가져오기 백엔드, JBIG2, JPEG2000, ICC용 qcms, 콘솔 panic hook이 경량판에서 제외된 것을 확인했다. `supportsPdfImport()`는 `false`를 반환했고, 지원 정보는 `{"enabled":false,"jbig2":false,"jpeg2000":false,"icc":false,"boundedXrefRecovery":false}`였다. `importPdf` 호환 메서드 호출은 `PDF_IMPORT_DISABLED: rebuild with --features pdf-import`를 던졌다. `wasm-api`는 편집 등 기존 비 PDF JS API도 노출한다.

## npm 0.8.7과 경량 0.9.1 출력 비교

Node에서 WASM 바이트를 두 JS 모듈에 각각 주입했다. SVG 크기와 `getPageText`는 UTF-8 기준으로 쪽별 비교했다. 쪽 번호는 파일 내 순서 기준 1부터 센다.

| 표본 | 0.8.7 쪽 수 | 경량 0.9.1 쪽 수 | SVG 바이트 일치 쪽 | 텍스트 일치 쪽 |
| --- | --- | --- | --- | --- |
| 2022년 국립국어원 업무계획.hwp | 35 | 35 | 0 | 35/35 |
| 21868765_별표2_보건소_분장사무.hwp | 4 | 4 | 0 | 4/4 |
| issue5590_per_row_column_widths.hwpx | 1 | 1 | 0 | 1/1 |

같은 태그의 기본 ↔ 경량 빌드에서는 SVG 40/40쪽, 텍스트 40/40쪽이 일치했다.

세 표본의 40쪽 모두 두 버전의 SVG `viewBox`가 같았다. 국립국어원 문서 20쪽은 716,493 B에서 1,225,891 B로 가장 많이 늘었다. 0.9.1에서 하단 표 외곽의 점선이 긴 SVG 경로로 표현되며, 비교한 SVG의 `font-family` 목록도 길어졌다. 31쪽은 `clipPath` 요소가 4개에서 32개로 늘었다.

Quick Look PNG에서 국립국어원 문서 20쪽의 파란 숫자 표식 크기와 보건소 문서 1쪽의 표 배치에 작은 차이가 보였다. 비교용 PNG 5쌍은 좌측 0.8.7, 우측 경량 0.9.1로 저장했다. PNG는 현재 macOS의 글꼴 환경에서 생성한 썸네일이다. [PNG 비교 모음](panels)

### 쪽별 측정

| 표본 | 쪽 | SVG 0.8.7 B | SVG 경량 B | SVG 증감 B | 텍스트 0.8.7 B | 텍스트 경량 B | 텍스트 비교 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2022년 국립국어원 업무계획.hwp | 1 | 89,613 | 92,581 | 2,968 | 93 | 93 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 2 | 144,993 | 221,308 | 76,315 | 2 | 2 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 3 | 400,915 | 484,802 | 83,887 | 1,409 | 1,409 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 4 | 449,263 | 541,465 | 92,202 | 1,972 | 1,972 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 5 | 312,656 | 377,318 | 64,662 | 2,007 | 2,007 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 6 | 347,021 | 417,025 | 70,004 | 1,777 | 1,777 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 7 | 288,094 | 354,842 | 66,748 | 42 | 42 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 8 | 478,002 | 576,560 | 98,558 | 2,319 | 2,319 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 9 | 413,448 | 494,364 | 80,916 | 2,357 | 2,357 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 10 | 433,638 | 520,496 | 86,858 | 2,412 | 2,412 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 11 | 397,877 | 476,225 | 78,348 | 1,933 | 1,933 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 12 | 423,434 | 505,229 | 81,795 | 2,114 | 2,114 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 13 | 464,568 | 558,610 | 94,042 | 2,515 | 2,515 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 14 | 469,058 | 563,159 | 94,101 | 2,691 | 2,691 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 15 | 450,317 | 541,617 | 91,300 | 2,353 | 2,353 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 16 | 467,281 | 560,568 | 93,287 | 2,523 | 2,523 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 17 | 340,864 | 406,671 | 65,807 | 1,985 | 1,985 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 18 | 337,514 | 402,436 | 64,922 | 2,050 | 2,050 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 19 | 429,511 | 525,451 | 95,940 | 1,506 | 1,506 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 20 | 716,493 | 1,225,891 | 509,398 | 1,448 | 1,448 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 21 | 450,101 | 540,124 | 90,023 | 2,272 | 2,272 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 22 | 349,966 | 416,092 | 66,126 | 1,168 | 1,168 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 23 | 418,576 | 501,294 | 82,718 | 1,277 | 1,277 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 24 | 420,477 | 502,994 | 82,517 | 2,392 | 2,392 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 25 | 385,274 | 435,582 | 50,308 | 1,020 | 1,020 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 26 | 426,390 | 505,300 | 78,910 | 2,492 | 2,492 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 27 | 505,272 | 624,091 | 118,819 | 857 | 857 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 28 | 343,958 | 403,843 | 59,885 | 38 | 38 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 29 | 446,727 | 540,447 | 93,720 | 1,345 | 1,345 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 30 | 254,105 | 307,587 | 53,482 | 982 | 982 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 31 | 704,502 | 893,612 | 189,110 | 2 | 2 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 32 | 673,847 | 855,279 | 181,432 | 49,297 | 49,297 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 33 | 228,813 | 271,457 | 42,644 | 1,281 | 1,281 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 34 | 267,240 | 311,987 | 44,747 | 116 | 116 | 일치 |
| 2022년 국립국어원 업무계획.hwp | 35 | 427,098 | 506,445 | 79,347 | 93 | 93 | 일치 |
| 21868765_별표2_보건소_분장사무.hwp | 1 | 417,959 | 501,507 | 83,548 | 2 | 2 | 일치 |
| 21868765_별표2_보건소_분장사무.hwp | 2 | 264,071 | 325,754 | 61,683 | 2 | 2 | 일치 |
| 21868765_별표2_보건소_분장사무.hwp | 3 | 356,464 | 432,015 | 75,551 | 2 | 2 | 일치 |
| 21868765_별표2_보건소_분장사무.hwp | 4 | 220,912 | 276,486 | 55,574 | 107 | 107 | 일치 |
| issue5590_per_row_column_widths.hwpx | 1 | 25,475 | 29,907 | 4,432 | 24 | 24 | 일치 |

## 뷰어 API만 노출한 실험판

표준 경량 빌드의 WASM에서 뷰어 호출에 필요한 export 15개를 남기고 Binaryen 117의 `wasm-opt -O`로 사용하지 않는 내부 코드를 정리했다. 생성된 JS glue 위에 `HwpDocument`, `pageCount`, `renderPageSvg`, `getPageText`, `free`를 노출하고 초기화 함수와 버전 조회를 유지했다. 편집과 별도 글꼴 등록 등은 이 실험판의 공개 API에서 제외했다.

| 단계 | 크기 B |
| --- | --- |
| 공개 export를 줄인 직후 | 19,188,772 |
| `wasm-opt -O` 후 | 13,881,337 |
| gzip | 5,287,743 |

Node 비교에서 전체 API가 있는 경량판과 표본 40쪽의 SVG와 텍스트가 모두 바이트 단위로 일치했다. 범위를 벗어난 쪽 번호와 형식이 잘못된 입력도 예상 오류를 반환했다. 실험판은 upstream Cargo feature 조합에 별도 후처리를 추가한 결과다. 후처리 입력 파일이 바뀌면 export와 JS glue 인터페이스를 함께 검증해야 한다.

- [뷰어 실험판 산출물](build-viewer-only/package)
- [뷰어 실험판 출력 검증](compare-viewer-only/results.json)
- [뷰어 실험판 생성 스크립트](make-viewer-only.py)

## 산출물

경량 WASM과 JS 및 형식 선언 파일은 `/private/var/folders/rb/hf9xjqpj7817kthcc89jnm940000gn/T/tmp.oONAoJnmJ9/build-light-parallel/package`에 있다.

| 파일 | SHA-256 |
| --- | --- |
| rhwp.d.ts | `ce871bdffd17152e7542ccebf4653c0504afae5359453515bdc06484c3f253b7` |
| rhwp.js | `05b6de46c9fac4e70079eb06389db6b55060fe297495da1180cef9526aca7c71` |
| rhwp_bg.wasm | `523289cd6a4c6c40d833f790e0cce3720c92e6b0cdc3a010ae07b0772ede122e` |
| rhwp_bg.wasm.d.ts | `f247b1e62ca934386c334590515864dddf63170268518cb12ea964a461db3854` |

- [크기·도구 호출·해시 원시 자료](</private/var/folders/rb/hf9xjqpj7817kthcc89jnm940000gn/T/tmp.oONAoJnmJ9/measurements.json>)
- [쪽별 SVG와 텍스트 비교표](</private/var/folders/rb/hf9xjqpj7817kthcc89jnm940000gn/T/tmp.oONAoJnmJ9/comparison/pages.tsv>)
- [쪽별 SHA-256 및 API 실행 결과](</private/var/folders/rb/hf9xjqpj7817kthcc89jnm940000gn/T/tmp.oONAoJnmJ9/comparison/results.json>)
- [기본 및 경량 출력 비교](</private/var/folders/rb/hf9xjqpj7817kthcc89jnm940000gn/T/tmp.oONAoJnmJ9/compare-same-version/results.json>)
- [로컬 기본 및 npm 게시판 비교](</private/var/folders/rb/hf9xjqpj7817kthcc89jnm940000gn/T/tmp.oONAoJnmJ9/compare-published/results.json>)
- [빌드 및 비교 재현 절차](</private/var/folders/rb/hf9xjqpj7817kthcc89jnm940000gn/T/tmp.oONAoJnmJ9/REPRODUCE.md>)

뷰어 실험판의 SHA-256

| 파일 | SHA-256 |
| --- | --- |
| rhwp.d.ts | `89f51cec0ae25d0721747d55b371baa5ccfb8032fd3a35f68c5db5f3b7fb74ee` |
| rhwp.js | `55e9466c72259c0fac8f83e09ae0f4ffe325457b5d9cd92d4704f8c8111f2da9` |
| rhwp_bg.wasm | `33f1010b6542bf24a256cd47be079adf591dd8d584ca71480e8ff493eece2aa8` |

[두 경량 산출물 SHA-256 검증 파일](SHA256SUMS)

## 위험과 권고

태그 커밋, `Cargo.lock`, Rust 1.93.1, wasm-pack 0.15.0, wasm-bindgen 0.2.127, Binaryen 117을 함께 고정한다. 배포 전에 배포용 WASM 바이트 수를 검사하고 동일 빌드의 JS와 형식 선언 파일을 함께 묶는다. 합격 기준은 압축 전 16,777,216 B 이하다. Orca 플러그인 프레임 내 동작은 이 작업 범위에서 미측정이다.

기본 빌드의 로컬·npm 간 WASM 해시 차이 원인은 미확인이다. 배포 환경 차이가 영향을 주었을 가능성은 추정이다. 한도를 맞춘 0.9.1 후보는 뷰어 전용 실험판이다. Orca 통합 전에 플러그인이 사용하는 메서드 목록을 실험판의 공개 API와 대조하고, 프레임에서 HWP/HWPX 및 글꼴 표시를 검증한다.
