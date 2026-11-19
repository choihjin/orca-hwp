# HWP Viewer for Orca

[Orca](https://github.com/stablyai/orca) 안에서 한글 문서(`.hwpx`, `.hwp`)를 바로 열어 보는 플러그인입니다.

[English](README.md)

## 현재 단계

골격만 있습니다. `.hwpx`와 `.hwp`의 편집기로 등록되고, 파일을 바이트로 읽어 종류와 크기를 보여 줍니다. **문서 내용은 아직 그리지 않습니다.** 계획은 [docs/PLAN.ko.md](docs/PLAN.ko.md)에 있습니다.

## 다음 작업

1. `.hwpx` 읽기: ZIP을 풀고 본문 XML에서 문단 텍스트를 뽑아 보여 주기
2. 표, 그림, 글자 모양 순으로 넓히기
3. `.hwp`(5.x 바이너리)는 `.hwpx` 다음에 결정

## 개발

```sh
orca plugin validate .
orca plugin test .
orca plugin dev watch .    # 이 폴더를 Orca에 올리고 로그와 다시 올리기를 보여 줍니다. Ctrl-C로 내립니다
```

편집기는 샌드박스 프레임에서 빌드 단계 없이 돕니다. 파싱·렌더링 라이브러리는 ESM 빌드를 플러그인 안에 복사해 상대 경로로 가져와야 합니다.

## 라이선스

MIT
