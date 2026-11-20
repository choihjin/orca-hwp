# 커밋하는 시험 문서

공개해도 되는 합성 문서만 둔다. 실제 문서나 회사 문서는 넣지 않는다. 공개 표본은 `npm run fixtures`가 `fixtures/`(git 제외)에 받는다.

| 파일 | 내용 | npm 0.8.7 | 0.8.7-p1 |
|---|---|---:|---:|
| `synthetic-tac-sibling-reset.hwp` | 글자 없는 문단 하나에 1×1 "글자처럼 취급" 표 27개가 줄마다 하나씩, 22번째 줄(0부터)에서 저장 vpos가 0으로 되돌아감 | 27쪽 | 2쪽 |
| `synthetic-tac-sibling-reset-shapes.hwp` | 같은 형태로 `[표] [글상자] [표] [글상자 글상자]` 줄을 반복, 표 줄에서 vpos가 0으로 되돌아감 | 19쪽 | 2쪽 |

- 용도: rhwp 쪽 나눔 패치(`build/rhwp-patches/v0.8.7-tac-sibling-reset.diff`)의 회귀 검사. 기대값은 문서에 저장된 줄 정보대로 2쪽이다. 테스트는 `editor/engine/rhwp-adapter.test.mjs`.
- 만든 방법: rhwp 저장소의 `saved/blank2010.hwp`(devel `0a437a7eefb19bfe81fc12866887e4548ea9554d`)에 합성 문단을 넣고 rhwp의 `export_hwp_native`로 저장했다. 생성 코드는 `synthetic-tac-sibling-reset.generator.rs`(rhwp 저장소의 `tests/` 아래에서 도는 테스트 형식)다. 빈 문서에서 넘어온 작성자·생성일 요약 정보, 임시 경로, 미리보기는 지웠다.
- 한컴 오피스에서 열리는지는 미확인이다.
- 출처 파일 `saved/blank2010.hwp`는 rhwp 저장소에 있으며 저장소 라이선스는 MIT(Copyright (c) 2025-2026 Edward Kim)다. 이 파일만 따로 다룬 고지는 찾지 못했으므로 저장소 MIT를 따른다고 본다(추정). MIT 전문은 [THIRD_PARTY_NOTICES.txt](../../THIRD_PARTY_NOTICES.txt)의 rhwp 항목에 있다.
- sha256: `synthetic-tac-sibling-reset.hwp` `022e6667488521d73c3ff6f4dbdb6ff82f71e91d5692f2a9a2785453f0a67eeb`, `synthetic-tac-sibling-reset-shapes.hwp` `c3d2b619ff57fa58bee9deb572d12eb973c212433566f6089aebcbc5811c6b64`
