# rhwp v0.9.1 WASM 재현

소스는 `edwardkim/rhwp`의 `v0.9.1` 태그, 커밋 `981ce66b4183b13c1a3b5907e04a8969c8c42034`다. 맥 arm64에서 저장소가 지정한 Rust `1.93.1`과 `Cargo.lock`을 사용했다. Rustup으로 설치한 기본 stable은 `1.100.0`이다. 아래 재현 명령은 새 임시 경로에서 실행한다.

## 1. 도구 설치

```bash
w="$(mktemp -d)"
cd "$w"
curl -fsSL https://sh.rustup.rs -o rustup-init.sh
env TMPDIR="$w" RUSTUP_HOME="$HOME/.rustup" CARGO_HOME="$HOME/.cargo" \
  sh rustup-init.sh -y --no-modify-path --profile minimal \
  --default-toolchain 1.93.1 --target wasm32-unknown-unknown

curl -fsSL https://github.com/wasm-bindgen/wasm-pack/releases/download/v0.15.0/wasm-pack-v0.15.0-aarch64-apple-darwin.tar.gz -o wasm-pack.tgz
tar -xzf wasm-pack.tgz
install -m 755 wasm-pack-v0.15.0-aarch64-apple-darwin/wasm-pack "$HOME/.cargo/bin/wasm-pack"

curl -fsSL https://github.com/wasm-bindgen/wasm-bindgen/releases/download/0.2.127/wasm-bindgen-0.2.127-aarch64-apple-darwin.tar.gz -o wasm-bindgen.tgz
tar -xzf wasm-bindgen.tgz
install -m 755 wasm-bindgen-0.2.127-aarch64-apple-darwin/wasm-bindgen "$HOME/.cargo/bin/wasm-bindgen"

curl -fsSL https://github.com/WebAssembly/binaryen/releases/download/version_117/binaryen-version_117-arm64-macos.tar.gz -o binaryen.tgz
tar -xzf binaryen.tgz
```

`wasm-opt`은 Binaryen 117 배포 파일을 임시 폴더에서 실행한다. `WASM_PACK_CACHE`는 `~/.cargo/wasm-pack-cache`로 지정한다. 시스템 설치와 셸 설정 수정은 필요 없다.

## 2. 소스와 표본 준비

이 문서와 함께 저장한 `clone-paths.txt`, `run-builds.sh`, `measure-artifacts.py`, `compare.mjs`, `render-thumbnails.py`를 새 임시 폴더에 복사한다. `clone-paths.txt`는 빌드와 표본에 필요한 태그 파일만 가져오기 위한 sparse-checkout 패턴이다.

```bash
git clone --depth 1 --filter=blob:none --no-checkout --branch v0.9.1 https://github.com/edwardkim/rhwp.git rhwp-sparse
git -C rhwp-sparse sparse-checkout set --no-cone --stdin < clone-paths.txt
git -C rhwp-sparse checkout --detach v0.9.1
test "$(git -C rhwp-sparse rev-parse HEAD)" = 981ce66b4183b13c1a3b5907e04a8969c8c42034
for version in 0.8.7 0.9.1; do
  case "$version" in
    0.8.7) dest=npm-087 ;;
    0.9.1) dest=npm-091 ;;
  esac
  mkdir -p "$dest"
  curl -fsSL "https://registry.npmjs.org/@rhwp/core/-/core-$version.tgz" -o "$dest/core.tgz"
  tar -xzf "$dest/core.tgz" -C "$dest"
done
```

## 3. 빌드와 출력 비교

```bash
bash run-builds.sh both
python3 measure-artifacts.py
node compare.mjs comparison npm-087/package build-light/package
node compare.mjs compare-same-version build-baseline/package build-light/package
env TMPDIR="$w/process-tmp" python3 render-thumbnails.py comparison thumbnails
```

기준 빌드의 공식 npm 릴리스 명령은 `python3 scripts/measure_render_diff_wasm.py --profile release --build-mode standard`다. 이 스크립트가 `sh scripts/wasm-pack-locked.sh --target web --release`를 실행한다. `bash scripts/prepare-npm.sh`로 npm 포장 메타데이터와 고지 파일을 준비한다. 경량판은 같은 wrapper에 `--out-dir <경량 경로> --no-default-features --features wasm-api`를 추가했다. wrapper는 Cargo 잠금 파일을 강제한다.

비교 스크립트는 JS glue 모듈마다 Node의 `readFileSync`로 WASM 바이트를 읽어 `default({ module_or_path: bytes })`로 초기화한다. 각 쪽의 원본 SVG와 `getPageText` 문자열을 UTF-8로 저장하며, `results.json`에는 해시와 쪽 수, `pages.tsv`에는 쪽별 크기와 일치 여부를 쓴다. `measure-artifacts.py`는 링커 원본과 같은 bindgen 호출을 재실행해 사전 최적화 크기를 재고, 최적화된 패키지에 `gzip -n -9`를 적용해 참고 크기를 잰다.

- [v0.9.1 npm 배포 워크플로](https://github.com/edwardkim/rhwp/blob/v0.9.1/.github/workflows/npm-publish.yml)
- [v0.9.1 Cargo feature 선언](https://github.com/edwardkim/rhwp/blob/v0.9.1/Cargo.toml#L360-L373)
- [v0.9.1 공식 Node 렌더 비교 예제](https://github.com/edwardkim/rhwp/blob/v0.9.1/scripts/svg_native_wasm_diff.mjs)

실측에서는 기본 빌드와 경량 빌드를 병렬로 진행했다. 경량 로그와 결과는 `build-light-parallel/`에 있다. 위의 순차 재현은 같은 명령과 feature로 경량 결과를 `build-light/`에 저장한다.

## 4. 추가 크기 옵션과 뷰어 전용 산출물

기본 `-O` 대신 `-Oz`를 재현하려면 옵션을 적용하기 전의 바인딩 생성 결과를 사용한다.

```bash
mkdir -p build-light-oz/package
./binaryen-version_117/bin/wasm-opt build-light/pre-opt/rhwp_bg.wasm \
  -o build-light-oz/package/rhwp_bg.wasm -Oz
cp build-light/package/rhwp.js build-light/package/*.d.ts build-light-oz/package/
node compare.mjs compare-oz build-light/package build-light-oz/package
```

뷰어 전용 실험판을 재현하려면 `make-viewer-only.py`를 함께 복사한다. 후처리 대상은 `-O`까지 완료한 PDF 미포함 패키지다.

```bash
python3 make-viewer-only.py build-light/package build-viewer-only
./binaryen-version_117/bin/wasm-opt build-viewer-only/retained-exports.wasm \
  -o build-viewer-only/package/rhwp_bg.wasm -O
cp rhwp-sparse/LICENSE build-viewer-only/package/LICENSE
cp -R build-baseline/package/notices build-viewer-only/package/
node compare.mjs compare-viewer-only build-light/package build-viewer-only/package
shasum -a 256 build-light/package/rhwp* build-viewer-only/package/rhwp*
```
