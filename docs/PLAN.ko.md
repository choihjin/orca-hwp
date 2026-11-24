# 계획

2026-11-19에 골격을 만들고, 같은 날부터 2026-11-20까지 0.1.0(읽기 전용 뷰어)을 구현했다. 자세한 근거는 [설계](superpowers/specs/2026-11-19-hwp-viewer-design.md), [구현 계획](superpowers/plans/2026-11-19-hwp-viewer.md), [결정 기록](decisions/)에 있다.

## 왜 만드나

- Orca 공식 카탈로그와 커뮤니티 카탈로그에 한글 문서 플러그인이 없다 (2026-11-19 확인: `stablyai/orca-plugins` 플러그인 43개와 두 카탈로그 파일에 hwp·hangul·hancom 언급 0건, `stablyai/orca-community-plugins`는 플러그인 폴더 0개).
- 사람뿐 아니라 Orca 에이전트도 문서가 실제로 어떻게 보이는지 보고 "어떻게 고쳐야 하는지" 판단할 수 있어야 한다(사용자 요구).

## 지금 있는 것 (0.1.5)

- `.hwp`(5.x)와 `.hwpx`를 rhwp 0.8.7에 쪽 나눔 패치를 더한 자체 빌드 `0.8.7-p1`(npm 배포물의 JS와 자체 빌드 WASM, 해시 고정)로 쪽마다 SVG로 그려 정화한 뒤 인라인으로 보여 준다. 보이는 쪽부터 그리고, 문서별로 마지막 쪽과 확대를 기억한다.
- 한글 본문용 OFL 글꼴 13개(12.6 MB)를 싣는다. 함초롬체는 사용권상 싣지 않는다.
- 에이전트 경로 두 가지: `orca plugin shot`으로 사용자가 보는 쪽 캡처, 플러그인에 함께 실린 `agent/agent-view.mjs`로 아무 쪽·영역의 PNG와 텍스트(오프라인, node_modules 없이).
- 권한 없음, 네트워크 없음. 플러그인 크기 약 31 MB(상한 50 MiB).
- 검증: `orca plugin test` 116개, 타입 검사, 합격 검사 7/7(기준 PDF 표본 4개의 쪽 수 일치, 큰 문서 205쪽·383쪽 포함, 알려진 엔진 차이 2건), 최종 리뷰 세 차례의 important 지적 모두 수정, 설치본에서 뷰어와 에이전트 스크립트 확인.

## 정한 것

- 엔진: rhwp 0.8.7(V1), 2026-11-20부터 쪽 나눔 패치를 더한 자체 빌드 `0.8.7-p1`([결정 기록](decisions/2026-11-20-rhwp-tac-pagination-patch.md)). 0.9.1은 PDF 기능을 빼도 WASM이 19 MB라 Orca의 파일당 16 MiB 상한을 넘고, 뷰어 API만 남긴 판(13.9 MB)은 편집 API가 빠진다. 표본 비교에서 0.9.1이 더 낫다고 할 수 없었다. 다시 빌드하는 절차는 [rhwp-091-viewer-build](decisions/rhwp-091-viewer-build/REPRODUCE.md).
- 파서 직접 작성안(이 문서의 처음 계획: `.hwpx` 문단 텍스트부터)은 기각했다. HWP 바이너리와 쪽 단위 시각 재현을 모두 새로 만들어야 하기 때문이다.

## 다음 작업

1. ~~Orca 화면에서 직접 확인~~ 완료(2026-11-20): `orca plugin shot --act`로 `Home`/`End`/`PageDown`/쪽 번호+`Enter`/`+`/`0`, ⓘ 정보 화면, 다시 열 때 기억한 쪽, 비공개 실문서 28쪽을 캡처해 판독. 이 과정에서 쪽 기억이 곧 닫히는 편집기에서 저장되지 않던 문제를 찾아 고침.
2. 공개: GitHub 저장소, 아이콘·표지·스크린샷, Orca 카탈로그 등록 여부 결정.
3. 남은 문제: 결정 기록의 미해결 nit, 큰 문서 메모리·macOS 밖 동작 측정, 여러 쪽 문서 안의 빈 쪽 표시.
4. rhwp 상류: 쪽 나눔 패치를 이슈·PR로 제안(2026-11-20). 받아들여져 새 버전이 나오면 그 버전으로 옮기고 자체 패치를 뺀다([결정 기록](decisions/2026-11-20-rhwp-tac-pagination-patch.md)).
5. 수정 기능(별도 설계): rhwp 0.8.7의 `exportHwp`/`exportHwpx`와 `orca.document.session().change`로 이어 간다.
