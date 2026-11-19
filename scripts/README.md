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

### 엔진 줄 묶기

엔진 쪽 줄은 에이전트 경로와 같은 `agent/text-lines.js`의 `textLines(pageTextRuns(i))`다(런 상자 위 `y`가 첫 런과
런 높이의 절반 안이면 같은 줄, 줄 안은 `x` 순). 임시 기준선 묶기(y + 0.85h, 3 px)에서 바꾼 뒤 달라진 값:
국립국어원 34쪽 31/36(엔진 42줄) → 34/36(엔진 35줄), 76076 1쪽 엔진 24줄 → 21줄(일치 13/18 그대로),
76076 33쪽 31/39(엔진 41줄) → 30/39(엔진 40줄). 나머지 쪽은 같다.

### 줄 비교의 한계

`pdftotext -layout`의 행 나누기와 엔진 줄 묶기는 표에서 서로 다르게 줄을 만든다. 같은 기준선의 단어를 `-layout`이
따로 한 행으로 빼기도 하고(보건소 4쪽 '만안구'), 세로 가운데 정렬된 칸('구분', '산식', '근거설명')을 옆 행에
붙이기도 한다. `-bbox-layout` 단어 상자로 묶는 규칙 두 가지(상자 아래 끝, 세로 겹침)도 시험했지만 각각 다른 곳에서
어긋나 기대값은 계획대로 `-layout`으로 둔다.

## 알려진 차이 (`knownDifferences`)

기대값은 고치지 않는다. 대신 사람이 **확인한** 줄 차이만 `fixtures.json`의 표본별 `knownDifferences`에 적는다.

```json
{ "page": 33, "kind": "engine", "reason": "한 줄 이유", "evidence": "확인한 근거(단어 상자 좌표, 줄 끝 글자 등)" }
```

- `kind: "engine"`: rhwp가 기준 PDF와 실제로 다르게 그린 것(줄바꿈, 쪽 나눔).
- `kind: "comparison"`: 렌더는 PDF와 같은데 `pdftotext -layout`의 행 나누기 때문에 다르게 보이는 것. 근거는
  `pdftotext -bbox-layout`의 단어 상자와 엔진 런(`pageTextRuns`) 좌표를 맞대어 확인한다.
- 판정: 목록에 있는 쪽의 차이는 '알려진 차이'로 출력하고 불합격으로 세지 않는다. 목록에 없는 쪽의 차이는 불합격.
  목록에 있는데 이제 일치하면 '해결됨' 경고를 내고(불합격 아님) 항목을 지울지 사람이 판단한다. `page`가 확인 쪽이
  아니거나 `kind`·`reason`·`evidence`가 빠진 항목은 그 표본을 불합격으로 만든다.
- 목록은 쪽 단위다. 알려진 쪽에 새 차이가 더 생겨도 같은 쪽이면 가려진다. 표의 `일치/기대` 숫자가 바뀌었는지를
  함께 본다.
- 출력 맨 아래에 '알려진 엔진 차이'를 따로 모아 찍는다. 합격으로 세지만 렌더가 기준 PDF와 다른 곳이다.
