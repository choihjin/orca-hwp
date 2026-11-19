# 표본과 합격 검사

```sh
npm run fixtures     # scripts/fetch-fixtures.mjs: 표본을 fixtures/(git 제외)에 받고 sha256 대조
npm run acceptance   # scripts/acceptance.mjs: 표본별 합격 검사, 종료 코드 0(전부 합격)/1
node scripts/acceptance.mjs --verbose   # 맞지 않는 줄을 모두 출력
```

## 표본

모두 rhwp 태그 `v0.8.7`(커밋 `1a76570e833917d15817415a53c09ad61ab3203f`)의 `samples/`에서
`https://raw.githubusercontent.com/edwardkim/rhwp/<커밋>/<경로>`로 받는다. 파일별 경로·크기·sha256은
`fixtures.json`의 `files`에 있고, 하나라도 다르면 `fetch-fixtures.mjs`가 종료 코드 1로 끝난다. 이미 받은
파일이 핀과 같으면 다시 받지 않는다.

| 표본 | 고른 이유 |
|---|---|
| `21868765_별표2_보건소_분장사무.hwp` + PDF | 1단계 표본(HWP, 표 4쪽) |
| `2022년 국립국어원 업무계획.hwp` + PDF | 1단계 표본(HWP 35쪽) |
| `2025년 기부·답례품 실적 지자체 보고서_양식.hwpx` + PDF | 1단계 표본(HWPX 30쪽) |
| `issue1891/76076_regulatory_analysis.hwpx` + `-2024.pdf` | 쪽을 넘는 표. 기준 PDF 33쪽 끝의 표 칸('근거설명')이 34쪽으로 이어진다(PDF를 그림으로 바꿔 확인). 공개 규제영향분석서, PDF는 Hwp 2024가 만듦 |
| `issue5941/1480000-201900698-native-neartop-reset.hwp` | 태그의 `samples/`에서 바이트로 가장 큰 파일(61,810,688 B, `gh api .../git/trees/<커밋>?recursive=1`로 확인). 공개 연구보고서(PRISM), 가로·세로 쪽 섞임 |
| `2025 행정업무운영 편람(최종).hwpx` | 계획이 예로 든 큰 표본(13,639,865 B). 쪽 수가 가장 많음(엔진 383쪽), 가로·세로 쪽 섞임 |
| `truncated.hwp` | 받은 파일이 아니라 `fetch-fixtures.mjs`가 보건소 HWP의 앞 50%(30,976 B)로 만든다 |

## 기대값 계산 (`--update-expected`)

기준 PDF가 있는 표본의 기대값은 `fixtures.json`에 저장한다. 다시 계산하려면 poppler의 `pdfinfo`·`pdftotext`가
`PATH`에 있어야 한다(작성 때 쓴 판: `pdftotext version 26.09.0`, Homebrew `/opt/homebrew/bin`).

```sh
node scripts/fetch-fixtures.mjs --update-expected
```

- 쪽 수: `pdfinfo <pdf>`의 `Pages:`.
- 확인 쪽의 줄: `pdftotext -layout -f <쪽> -l <쪽> <pdf> -`의 줄마다 앞뒤 공백을 뺀 첫 글자와 끝 글자(빈 줄 제외,
  글자는 코드 포인트 단위). `fixtures.json`의 `checks[].lines`에 `[첫, 끝]`으로 저장한다.
- 확인 쪽(`checkPages`) 고르는 규칙: 첫 쪽, 표 칸(SVG `cell-clip`)이 가장 많은 쪽, 마지막 쪽. 보건소는 표 하나가
  4쪽에 걸쳐 칸 클립이 없으므로 표가 이어지는 2쪽을 골랐다. 76076은 표가 쪽을 넘는 33·34쪽을 더했다.

`acceptance.mjs`는 `pdfinfo`·`pdftotext`를 실행하지 않고 저장된 값만 읽는다.

## 합격 검사가 보는 것

표본마다 어댑터(`editor/engine/rhwp-adapter.js`)로 열고:

1. 쪽 수가 기준 PDF와 같다(PDF가 있을 때).
2. 확인 쪽에서 엔진 줄과 PDF 줄의 첫·끝 글자가 순서까지 모두 같다. 표에는 `일치/기대`(최장 공통 부분열 길이 /
   PDF 줄 수)와, 줄 수가 다르면 엔진 줄 수를 적는다.
3. 모든 쪽이 `renderPageSvg` + `sanitizeSvg`를 예외 없이 지난다.
4. 첫 쪽까지 걸린 시간(열기 + 1쪽 렌더 + 정화)을 출력한다. 합격 기준은 아니다.
5. 잘린 표본은 `EngineError`로 열리지 않아야 합격이다.

### 엔진 줄 묶기 (임시)

엔진 쪽 줄은 `pageTextRuns`를 기준선(런 상자 위 `y` + 0.85 × `h`)으로 정렬해 3 px 안이면 같은 줄로 묶고, 줄 안은
`x` 순으로 이은 것이다. Task 8의 `textLines`가 합쳐지면 그것으로 바꿔 에이전트 경로와 같은 규칙을 쓰게 할 예정이다.

### 줄 비교의 한계

`pdftotext -layout`의 행 나누기와 엔진의 기준선 묶기는 표에서 서로 다르게 줄을 만든다. 2026-11-19에 확인한 경우:

- 같은 기준선의 단어를 `-layout`이 따로 한 행으로 뺀다. 보건소 4쪽 49번 항목의 '만안구'는 PDF 단어 상자의 `yMin`이
  같은 줄의 다른 단어와 같은데(`pdftotext -bbox-layout`, 295.50) `-layout` 출력에서는 다음 행에 있다.
- 세로 가운데 정렬된 표 칸('구분', '산식', '근거설명')을 `-layout`은 옆 행에 붙이고, 엔진 묶기는 따로 한 줄로 둔다.
- 세로쓰기 글자(국립국어원 34쪽 조직도)는 양쪽이 다르게 묶는다(추정).

다른 규칙도 시험했다. `-bbox-layout` 단어를 상자 아래 끝으로 묶으면 다른 글꼴의 기호(□ ➀ ② – ∼)가 따로 떨어졌고,
양쪽을 세로 겹침으로 묶으면 다른 곳에서 줄이 붙었다. 더 나은 규칙을 정하지 못해 계획대로 `-layout`을 쓴다. 이 때문에
불합격 줄이 실제 렌더 차이인지는 `--verbose` 출력을 보고 하나씩 판단해야 한다.
