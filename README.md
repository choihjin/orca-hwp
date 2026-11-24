# 시험 문서 (testdata)

`main`과 무관한 브랜치입니다. 태그에 들어가지 않고, `npm run fixtures`가 커밋을 고정해 받아 갑니다.

- `synthetic-memos.hwp` (15,360 B, sha256 `2e10a649b9c0d3bade94c9eb39463b639acad4e96f2544129e6d115ea8dbafbe`): rhwp 0.9.1(npm, 무결성 확인)로 만든 합성 메모 HWP. 만드는 스크립트는 `main`의 `scripts/testdata/synthetic-memos.generator.mjs`이며 두 번 만들어도 같은 바이트가 나온다. 사람 이름, 컴퓨터 이름, 폴더 경로가 없음을 만들 때 확인한다. 실제 문서나 회사 문서는 쓰지 않는다.
- rhwp(MIT)의 빈 문서에서 시작하며, 그 고지는 `main`의 `THIRD_PARTY_NOTICES.txt`에 있다.
