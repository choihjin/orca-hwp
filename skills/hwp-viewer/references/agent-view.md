# agent-view.mjs 옵션과 출력

플러그인 폴더의 `agent/agent-view.mjs`(이 스킬의 `scripts/hwp-view.sh`가 대신 찾아 실행).

## 옵션

| 옵션 | 뜻 |
|---|---|
| `<file>` | `.hwp`(HWP 5.x) 또는 `.hwpx` |
| `--page N` | 1부터. 기본 1 |
| `--region x,y,w,h` | 쪽 왼쪽 위 기준 쪽 px. 생략하면 쪽 전체. 쪽과 안 겹치면 오류 |
| `--scale S` | 기본 1.5. 출력 PNG는 최대 16,777,216 픽셀 |
| `--out PATH` | 생략하면 임시 폴더. 입력 파일과 같으면 거부 |
| `--text` | 쪽 텍스트를 줄 단위로(표 칸 포함). `--region`과 무관하게 쪽 전체 |
| `--memos` | 문서 전체 메모를 `memos`에, 그 쪽 PNG에 강조와 번호. 메모를 못 읽으면 `memos`가 빠지고 `warnings`에 이유가 들어감 |
| `--json` | 기계가 읽는 출력 |
| `--bundled-fonts-only` | 플러그인 글꼴만 사용(기계마다 같은 결과). 기본은 사용자·시스템 글꼴(macOS `Library/Fonts`)도 사용 |

## `--json` 출력

```json
{ "file": "...", "pageCount": 35, "page": 3, "pageSize": { "width": 793.7, "height": 1122.5 },
  "png": "/tmp/.../page-3.png", "text": ["…"], "engine": { "name": "rhwp", "version": "0.8.7-p2", ... },
  "warnings": [] }
```

오류면 종료 코드 1과 `{ "error": { "code": "...", "message": "..." } }`.

| code | 상황 |
|---|---|
| `not-hangul` | `.hwp`(OLE)·`.hwpx`(ZIP)가 아님 |
| `corrupt` | 잘렸거나 손상 |
| `unsupported` | 지원하지 않는 형식 |
| `encrypted` | 암호 문서(열지 않음) |
| `page-out-of-range` | 쪽 번호가 범위 밖 |
| `region-out-of-page` | 영역이 쪽과 겹치지 않음 |
| `invalid-argument` | 옵션 오류, `--out`이 원본과 같음, 픽셀 상한 초과 |
| `render-failed` | 렌더 실패(원래 오류 메시지 포함) |

## Orca 캡처(`--shot`)

`orca plugin shot <pluginKey> --editor <file> --width 1000 --height 1400 --json` — json의 `path`가 PNG. 사용자가 마지막에 본 쪽·확대로 열린다. `settled: true`, `errors: []`인지 확인.
