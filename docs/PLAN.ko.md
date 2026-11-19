# 계획

2026-11-19에 골격을 만들었다. 아래에서 "확인 필요"는 아직 원문이나 실행으로 확인하지 않은 것이다.

## 왜 만드나

- Orca 공식 카탈로그와 커뮤니티 카탈로그에 한글 문서 플러그인이 없다 (2026-11-19 확인: `stablyai/orca-plugins` 플러그인 43개와 두 카탈로그 파일에 hwp·hangul·hancom 언급 0건, `stablyai/orca-community-plugins`는 플러그인 폴더 0개)
- 공식 카탈로그에는 같은 방식의 문서 뷰어가 있다: `docx`(Word Preview), `spreadsheet`. 둘 다 `customEditors` + `contentKind: "bytes"` + `editor/index.html` + `build/` + `THIRD_PARTY_NOTICES.txt` 구조다. 참고 구현으로 본다

## 지금 있는 것

- 매니페스트: `.hwpx`, `.hwp`의 custom editor 하나, `execution: sandboxed-ui`, `contentKind: bytes`, 권한(capabilities) 없음
- `editor/main.ts`: 바이트를 받아 파일 종류와 크기만 표시
- `editor/format.ts`: 매직 바이트로 종류 판별 (ZIP이면 hwpx, OLE 복합 파일이면 hwp)
- `orca plugin validate .` 통과, `orca plugin test .` 4개 통과 (2026-11-19). `tsc` 타입 검사는 돌리지 않았다

## 범위

- 1차: `.hwpx` 읽기 전용 뷰어. 문단 텍스트 → 표 → 그림 → 글자·문단 모양
- 뒤로 미룸: `.hwp` 5.x 바이너리, 편집, 인쇄·PDF 내보내기, 검색

## 확인 필요

- `.hwpx` 구조: ZIP 안에 본문이 `Contents/section0.xml` 같은 XML로 들어 있다는 것까지는 다른 작업에서 봤다. 표준 문서(OWPML, KS X 6101) 원문으로 요소 이름과 단위를 확인한다
- `.hwp` 5.x: OLE 복합 파일 안의 스트림이 압축된 레코드 구조라고 알고 있다. 한글과컴퓨터가 공개한 형식 문서의 이용 조건(저작권 고지 문구 등)을 확인한다
- 쓸 수 있는 라이브러리: 브라우저에서 도는 ZIP 해제와 HWP·HWPX 파서 후보를 찾고, 각각 라이선스·유지 상태·번들 크기를 확인한다. 후보 이름은 확인 전이라 적지 않는다
- 샌드박스 프레임 제약: 문서 크기 한도, 동적 `import` 가능 여부, 그림(바이너리 데이터) 표시 방법, 글꼴 대체
- 공식 `docx` 플러그인이 빌드 산출물을 넣는 방식(`build/`)과 서드파티 고지 파일 형식
- 시험용 문서: 공개해도 되는 `.hwpx`·`.hwp` 표본 (회사 문서는 저장소에 넣지 않는다)

## 다음 작업

1. 위 "확인 필요"를 조사하고 결정 기록으로 남긴다
2. `.hwpx`에서 문단 텍스트를 뽑아 보여 주는 최소 뷰어
3. 공개 표본으로 테스트 추가
4. 아이콘·표지·스크린샷, 영문·한글 README 다듬기 → GitHub 공개 여부 결정
