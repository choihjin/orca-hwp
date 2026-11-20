# HWP Viewer for Orca

[Orca](https://github.com/stablyai/orca) 안에서 한글 문서(`.hwpx`, `.hwp`)를 쪽 단위로 열어 보는 읽기 전용 뷰어입니다. 사람뿐 아니라 Orca의 에이전트도 같은 화면을 PNG로 받아 문서가 어떻게 보이는지 확인할 수 있습니다.

[English](README.md)

## 현재 상태 (0.1.0, 2026-11-20)

- `.hwp`(HWP 5.x)와 `.hwpx`를 [rhwp](https://github.com/edwardkim/rhwp) 0.8.7에 쪽 나눔 패치를 더한 자체 빌드(`0.8.7-p1`)로 쪽마다 그립니다. 패치는 한 문단에 글자처럼 취급한 표·글상자가 여럿일 때 표마다 새 쪽이 열리던 문제를 고칩니다([결정 기록](docs/decisions/2026-11-20-rhwp-tac-pagination-patch.md)). 표, 그림, 머리말·꼬리말, 가로·세로가 섞인 쪽을 포함합니다.
- 보이는 쪽부터 그리고 나머지는 스크롤할 때 그려서, 수백 쪽 문서도 첫 쪽이 바로 보입니다.
- 문서마다 마지막에 본 쪽과 확대를 기억합니다.
- 네트워크 없이 동작하고, 플러그인 권한(capabilities)을 요청하지 않습니다. 한글 본문용 공개 글꼴(OFL) 13개를 함께 싣습니다. 컴퓨터에 원래 글꼴(함초롬바탕 등)이 있으면 그것을 먼저 씁니다.
- 손상된 파일, 한글 문서가 아닌 파일, 암호가 걸린 문서, 내용이 없는 문서는 안내 화면을 보여 줍니다. 암호 문서는 열지 않습니다.

한계:

- rhwp가 그린 화면이라 한글 프로그램과 다를 수 있습니다. 쪽을 넘는 복잡한 표가 있는 문서에서 줄바꿈·쪽 나눔이 달라지는 경우를 확인했습니다([결정 기록](docs/decisions/2026-11-19-phase2-integration.md)).
- 편집·저장, 인쇄, 문서 안 검색은 아직 없습니다.
- Orca 데스크톱 앱 전용입니다. 브라우저 클라이언트(`orca serve`)에서는 열리지 않습니다.

## 설치

아직 Orca 카탈로그에는 올리지 않았습니다. GitHub에서 바로 설치합니다.

```sh
orca plugin install choihjin/orca-hwp
```

Orca가 승인 지문을 보여 주면 내용(권한 없음, `.hwp`·`.hwpx` 편집기)을 확인한 뒤 `--approve <지문>`을 붙여 다시 실행합니다. Orca 1.4.248 이상이 필요합니다.

## 사용

Orca에서 `.hwp`·`.hwpx` 파일을 열면 뷰어가 열립니다.

| 키 | 동작 |
|---|---|
| `PageDown` / `PageUp` | 다음 쪽 / 이전 쪽 |
| `Home` / `End` | 첫 쪽 / 마지막 쪽 |
| 숫자 입력 후 `Enter` | 그 쪽으로 이동 |
| `+` / `-` / `0` | 확대 / 축소 / 쪽 너비에 맞춤 |

맨 위 상태 줄에 형식, 현재 쪽, 확대, 엔진 버전이 나옵니다. 상태 줄 오른쪽의 ⓘ 버튼은 고지와 라이선스를 보여 줍니다.

## 에이전트로 문서 읽기

에이전트에게 [한글 문서 확인 안내](docs/AGENTS.md)를 알려 주세요. 에이전트는 두 가지를 할 수 있습니다.

- `orca plugin shot`으로 사용자가 보고 있는 쪽을 캡처합니다.
- 플러그인에 함께 실린 `agent/agent-view.mjs`로 아무 쪽이나 영역을 PNG로 그리고 쪽 텍스트를 받습니다. 어느 프로젝트에서든 오프라인으로 동작하며 Node.js 22 이상이 필요합니다.

## 개발

```sh
pnpm install
orca plugin types .
npm run typecheck
orca plugin test .
npm run fixtures      # 공개 표본 문서를 fixtures/에 받기 (git 제외)
npm run acceptance    # 표본을 한컴 기준 PDF와 비교하는 합격 검사
npm run check:size    # Orca 크기 상한 검사
orca plugin dev watch .
```

편집기는 빌드 단계 없이 동작합니다. 외부 파일(rhwp, 글꼴, PNG 변환기)은 `build/`의 스크립트가 받아 해시를 검증한 뒤 싣습니다(`npm run vendor:rhwp`, `vendor:fonts`, `vendor:resvg`). 서드파티 고지는 `npm run notices`로 만듭니다. 엔진 WASM은 v0.8.7에 `build/rhwp-patches/`의 패치를 적용해 빌드한 것이며, `build/build-rhwp-patched.sh`로 다시 빌드해 고정 해시와 비교할 수 있습니다(Rust 툴체인 필요).

| 경로 | 내용 |
|---|---|
| `editor/` | 뷰어 화면. rhwp는 `editor/engine/rhwp-adapter.js` 한 곳에서만 씁니다 |
| `editor/render/sanitize.js` | 문서에서 나온 SVG를 화면에 넣기 전에 정화합니다 |
| `editor/vendor/`, `editor/fonts/` | 고정한 rhwp와 글꼴 |
| `agent/` | 에이전트용 쪽 렌더 스크립트와 PNG 변환기 |
| `build/` | 외부 파일 고정·검증, 고지 생성, 크기 검사 |
| `scripts/` | 표본 내려받기와 합격 검사 |
| `docs/` | [설계](docs/superpowers/specs/2026-11-19-hwp-viewer-design.md), [구현 계획](docs/superpowers/plans/2026-11-19-hwp-viewer.md), [결정 기록](docs/decisions/), [계획](docs/PLAN.ko.md) |

## 한컴 및 상표 고지

본 제품은 한컴의 HWP 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.

"한글", "한컴", "HWP", "HWPX"는 주식회사 한글과컴퓨터의 등록 상표입니다. 이 플러그인은 한글과컴퓨터와 관계없는 독립 프로젝트입니다.

## 라이선스

MIT. 함께 싣는 rhwp, 글꼴, PNG 변환기 등의 라이선스는 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)에 있습니다.
