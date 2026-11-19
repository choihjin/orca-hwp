# HWP Viewer for Orca

[Orca](https://github.com/stablyai/orca) 안에서 한글 문서(`.hwpx`, `.hwp`)를 바로 열어 보는 플러그인입니다.

[English](README.md)

## 현재 단계

사용자 지정 편집기 골격을 바탕으로 rhwp 엔진을 사용하는 `.hwp`·`.hwpx` 쪽 뷰어를 구현 중입니다. 자세한 내용은 [구현 계획](docs/superpowers/plans/2026-11-19-hwp-viewer.md)에 있습니다.

## 에이전트로 문서 읽기

에이전트에게 [한글 문서 확인 안내](docs/AGENTS.md)를 알려 주면 Orca에서 현재 쪽을 캡처하거나, 원하는 쪽과 영역을 PNG로 그려 쪽 텍스트를 오프라인에서 읽을 수 있습니다.

## 개발

```sh
orca plugin validate .
orca plugin test .
orca plugin dev watch .    # 이 폴더를 Orca에 올리고 로그와 다시 올리기를 보여 줍니다. Ctrl-C로 내립니다
```

편집기는 샌드박스 프레임에서 빌드 단계 없이 동작합니다. 파싱·렌더링 라이브러리는 ESM 빌드를 플러그인 안에 복사해 상대 경로로 가져와야 합니다.

## 한컴 및 상표 고지

본 제품은 한컴의 HWP 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.

"한글", "한컴", "HWP", "HWPX"는 주식회사 한글과컴퓨터의 등록 상표입니다. 이 플러그인은 한글과컴퓨터와 관계없는 독립 프로젝트입니다.

## 라이선스

MIT
