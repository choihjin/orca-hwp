# 합성 시험 문서

문서 파일은 저장소에 커밋하지 않는다. Orca 커뮤니티 카탈로그가 태그에 든 바이너리 파일(`.hwp`, ZIP인 `.hwpx` 포함)을 거절하기 때문이다(v0.1.1이 이 이유로 거절됨, 2026-11-24 확인). 문서는 `npm run fixtures`가 아래 커밋에서 받아 크기와 sha256을 대조한다. 쪽 나눔 두 문서는 이 저장소의 커밋 `01c7b454cf9480b7602e11f1495058d93e838909`에서 `fixtures/`(git 제외)로 받고, `scripts/fixtures.json`의 크기·sha256과 대조한다. 받지 않았으면 해당 테스트는 건너뛴다.

공개해도 되는 합성 문서만 쓴다. 실제 문서나 회사 문서는 쓰지 않는다.

| 파일 | 내용 | npm 0.8.7 | 0.8.7-p1 |
|---|---|---:|---:|
| `synthetic-tac-sibling-reset.hwp` | 글자 없는 문단 하나에 1×1 "글자처럼 취급" 표 27개가 줄마다 하나씩, 22번째 줄(0부터)에서 저장 vpos가 0으로 되돌아감 | 27쪽 | 2쪽 |
| `synthetic-tac-sibling-reset-shapes.hwp` | 같은 형태로 `[표] [글상자] [표] [글상자 글상자]` 줄을 반복, 표 줄에서 vpos가 0으로 되돌아감 | 19쪽 | 2쪽 |

- 용도: rhwp 쪽 나눔 패치(`build/rhwp-patches/v0.8.7-tac-sibling-reset.diff`)의 회귀 검사. 기대값은 문서에 저장된 줄 정보대로 2쪽이다. 테스트는 `editor/engine/rhwp-adapter.test.mjs`.
- 만든 방법: rhwp 저장소의 `saved/blank2010.hwp`(devel `0a437a7eefb19bfe81fc12866887e4548ea9554d`)에 합성 문단을 넣고 rhwp의 `export_hwp_native`로 저장했다. 생성 코드는 `synthetic-tac-sibling-reset.generator.rs`(rhwp 저장소의 `tests/` 아래에서 도는 테스트 형식)다. 빈 문서에서 넘어온 작성자·생성일 요약 정보, 임시 경로, 미리보기는 지웠다.
- 한컴 오피스에서 열리는지는 미확인이다.
- 출처 파일 `saved/blank2010.hwp`는 rhwp 저장소에 있으며 저장소 라이선스는 MIT(Copyright (c) 2025-2026 Edward Kim)다. 이 파일만 따로 다룬 고지는 찾지 못했으므로 저장소 MIT를 따른다고 본다(추정). MIT 전문은 [THIRD_PARTY_NOTICES.txt](../../THIRD_PARTY_NOTICES.txt)의 rhwp 항목에 있다.
- sha256: `synthetic-tac-sibling-reset.hwp` `022e6667488521d73c3ff6f4dbdb6ff82f71e91d5692f2a9a2785453f0a67eeb`, `synthetic-tac-sibling-reset-shapes.hwp` `c3d2b619ff57fa58bee9deb572d12eb973c212433566f6089aebcbc5811c6b64`

## 메모 시험 문서

- `synthetic-memos.hwp`는 `testdata` 브랜치(커밋 `54e463f798039d0252d4d120dbce7a49a5f9f6d3`)에서 받는다. `scripts/testdata/synthetic-memos.generator.mjs`가 rhwp 0.9.1(npm, 무결성 확인)로 만들며 같은 입력이면 같은 바이트다. 문서 정보(요약 정보, 경로, 미리보기)에 사람·컴퓨터·폴더 이름이 없음을 만들 때 확인한다.
- 넣은 것: 본문 문단 전체·낱말·여러 줄 메모, 같은 글의 메모 묶음, 표 칸, 글상자, 묶인 글상자, 쪽 나눔 뒤. 한컴에서 만든 문서는 아니다. 시험은 `editor/engine/memo-documents.test.mjs`(없으면 건너뛴다).
- HWPX 시험 문서는 커밋하지 않고 `scripts/testdata/hwpx-text.mjs`로 테스트 안에서 글자에서 만든다.
