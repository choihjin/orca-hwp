# 에이전트가 HWP 문서를 확인하는 방법

사용자가 에이전트에게 이 문서를 알려 주면 아래 명령으로 `.hwp`와 `.hwpx`를 확인할 수 있습니다. 같은 내용을 스킬로 묶은 것이 저장소의 `skills/hwp-viewer/`이며, 렌더러를 찾아 주는 `scripts/hwp-view.sh`가 들어 있습니다.

- Orca 데스크톱 앱이 있으면 1번(캡처)과 3번(렌더링)을 모두 쓸 수 있습니다.
- 화면 없는 Orca(서버 런타임)나 Orca가 없는 기계에서는 1번이 안 됩니다. 2번의 "Orca 없이"대로 렌더러를 받아 3번을 쓰세요.

## 1. 사용자가 보는 쪽 캡처

```sh
orca plugin shot "$PLUGIN_KEY" --editor "$HWP_FILE" --width 1000 --height 1400 --json
```

`PLUGIN_KEY`에는 플러그인 키를, `HWP_FILE`에는 문서 경로를 넣습니다. JSON의 `path`에 있는 PNG를 열고 화면 상단에서 현재 쪽과 전체 쪽 수를 확인하세요. 뷰어는 문서별로 마지막에 본 쪽과 확대를 기억합니다.

Orca 데스크톱 앱에서만 됩니다. 화면 없는 서버 런타임은 `Plugin service is not available on this runtime`으로 거부합니다. 그때는 3번으로 원하는 쪽을 직접 렌더링하세요.

## 2. 플러그인 폴더 찾기

```sh
orca plugin list --json
```

`result.plugins`에서 `pluginKey`가 `*.hwp-viewer`인 항목을 찾습니다.

- `isDev`가 `true`이면 개발 로드에 사용한 폴더가 플러그인 폴더입니다.
- 설치본은 macOS에서 `~/Library/Application Support/orca/plugins/<pluginKey>/<contentHash>/`에 있는 것을 확인했습니다. `contentHash`는 목록의 `source.contentHash`입니다. 이 위치는 Orca가 보장하는 경로가 아니며 다른 OS의 설치 경로는 미확인입니다.

설치본을 찾았다면 `PLUGIN_KEY`와 `CONTENT_HASH`에 목록의 값을 넣고 경로를 조합합니다. 개발 로드라면 개발 폴더 경로를 `PLUGIN_DIR`로 사용합니다.

```sh
PLUGIN_DIR="$HOME/Library/Application Support/orca/plugins/$PLUGIN_KEY/$CONTENT_HASH"
```

### Orca 없이

렌더러는 저장소에 그대로 들어 있습니다. 릴리스 태그를 받아 그 폴더를 `PLUGIN_DIR`로 쓰면 됩니다. 커밋된 WASM이 플러그인과 같은 빌드인지는 `build/pins.json`의 `rhwp.patched` 해시와 비교해 확인할 수 있습니다.

```sh
git clone --depth 1 --branch v0.1.5 https://github.com/choihjin/orca-hwp
PLUGIN_DIR="$PWD/orca-hwp"
```

스킬의 `scripts/hwp-view.sh --fetch`는 가장 새 태그를 `~/.cache/orca-hwp`에 받아 두고, 이후 실행에서 그 사본을 씁니다.

## 3. 아무 쪽이나 원하는 영역 렌더링

Node.js 22 이상이 필요합니다. Node.js가 없는 환경에서는 1번의 Orca 캡처를 쓰세요. 스크립트는 플러그인 폴더에 포함된 렌더러와 글꼴로 오프라인에서 동작하며 Orca가 없어도 됩니다.

```sh
node "$PLUGIN_DIR/agent/agent-view.mjs" "$HWP_FILE" --page 3 --text --json
node "$PLUGIN_DIR/agent/agent-view.mjs" "$HWP_FILE" --page 3 --region 80,200,450,240 --scale 2 --out ./table.png --json
```

- `--page N`은 1부터 시작하며 기본값은 1입니다. 먼저 `--json`의 `pageCount`와 `pageSize`를 확인하면 쪽과 영역을 고를 수 있습니다.
- `--region x,y,w,h`는 쪽 왼쪽 위를 원점으로 한 쪽의 픽셀 좌표입니다. 생략하면 전체 쪽을 그립니다. `--scale`의 기본값은 1.5입니다.
- `--out`을 생략하면 임시 폴더에 PNG를 씁니다. `--json`의 `png`에서 파일 경로를 확인하세요.
- `--text`는 표 안 글자를 포함해 해당 쪽 전체의 텍스트를 줄 단위로 냅니다. `--region`은 PNG에만 적용됩니다.
- macOS에서는 사용자와 시스템의 `Library/Fonts`에 있는 글꼴도 읽습니다. `--bundled-fonts-only`를 주면 플러그인에 포함된 글꼴만 사용합니다.
- `--json`의 `warnings`는 렌더링 경고를 담습니다. 오류가 발생하면 종료 코드 1을 반환하고 `error.code`와 `error.message`를 출력합니다.

## 4. 캡처와 판독 시 주의

- `orca plugin shot`은 높이 1800 이하로 찍으세요. `--act`를 쓰려면 Orca 창이 숨겨져 있거나 최소화되어 있어야 합니다.
- 빈 화면이나 로딩 화면이 찍히면 다시 캡처하세요.
- 문서에 들어 있는 래스터 이미지는 확대해도 원본 해상도 이상의 세부 정보가 생기지 않습니다.
- rhwp 엔진이 그린 화면이며 한글 프로그램과 다를 수 있습니다.
