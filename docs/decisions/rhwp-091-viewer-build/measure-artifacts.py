import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path

work = Path(__file__).resolve().parent
limit = 16 * 1024 * 1024
builds = {
    "baseline": work / "build-baseline",
    "light": Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else work / "build-light",
}
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def executable_commands(log):
    result = {}
    for raw in log.read_text().splitlines():
        line = re.sub(r"\x1b\[[0-9;]*m", "", raw)
        if "wasm_pack::child" not in line or "Running " not in line:
            continue
        argv = shlex.split(line.split("Running ", 1)[1])
        executable = Path(argv[0]).name
        if executable in {"wasm-bindgen", "wasm-opt"} and argv[1:] != ["--version"]:
            result[executable] = argv
    return result

def package_stats(package):
    optimized = package / "rhwp_bg.wasm"
    return {
        "package": str(package),
        "packaged_wasm_bytes": optimized.stat().st_size,
        "packaged_gzip_9_bytes": len(subprocess.check_output(["gzip", "-n", "-9", "-c", str(optimized)])),
        "passes_16_mib": optimized.stat().st_size <= limit,
        "bytes_headroom": limit - optimized.stat().st_size,
        "sha256": {p.name: sha(p) for p in sorted(package.glob("rhwp*")) if p.is_file()},
    }

results = {}
for name, directory in builds.items():
    commands = executable_commands(directory / "build.log")
    assert {"wasm-bindgen", "wasm-opt"} <= commands.keys(), f"tools not observed in {name}"
    pre_opt = directory / "pre-opt"
    pre_opt.mkdir(exist_ok=True)
    linker_raw = directory / "linker.wasm"
    replay_input = pre_opt / "rhwp.wasm"
    if not replay_input.exists():
        os.link(linker_raw, replay_input)
    replay = commands["wasm-bindgen"].copy()
    replay[1] = str(replay_input)
    replay[replay.index("--out-dir") + 1] = str(pre_opt)
    subprocess.run(replay, cwd=work / "rhwp-sparse", check=True, env={
        **os.environ,
        "TMPDIR": str(work / "process-tmp"),
    })
    results[name] = {
        "cargo_linker_bytes": linker_raw.stat().st_size,
        "cargo_linker_sha256": sha(linker_raw),
        "pre_opt_bytes": (pre_opt / "rhwp_bg.wasm").stat().st_size,
        "pre_opt_sha256": sha(pre_opt / "rhwp_bg.wasm"),
        "bindgen_replay": replay,
        "tools": commands,
        "tool_versions": {tool: subprocess.check_output([argv[0], "--version"], text=True).strip()
                          for tool, argv in commands.items()},
        "tool_sha256": {tool: sha(Path(argv[0])) for tool, argv in commands.items()},
        **package_stats(directory / "package"),
    }
results["npm_0.9.1"] = package_stats(work / "npm-091" / "package")
results["npm_0.8.7"] = package_stats(work / "npm-087" / "package")
(work / "measurements.json").write_text(json.dumps(results, indent=2, ensure_ascii=False) + "\n")
for name, stats in results.items():
    print(name, *(stats.get(key, "미측정") for key in (
        "cargo_linker_bytes", "pre_opt_bytes", "packaged_wasm_bytes", "packaged_gzip_9_bytes",
        "passes_16_mib", "bytes_headroom",
    )))
