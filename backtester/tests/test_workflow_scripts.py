import json
import os
import stat
import subprocess
import textwrap
from pathlib import Path


REPO_ROOT = Path("/Users/hd/Developer/cortana-external")
BACKTESTER_ROOT = REPO_ROOT / "backtester"
DAYTIME_FLOW = BACKTESTER_ROOT / "scripts" / "daytime_flow.sh"
NIGHTTIME_FLOW = BACKTESTER_ROOT / "scripts" / "nighttime_flow.sh"
TREND_SWEEP = REPO_ROOT / "tools" / "stock-discovery" / "trend_sweep.sh"


def _write_executable(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


def _shell_env(bin_dir: Path) -> dict[str, str]:
    env = os.environ.copy()
    env["PATH"] = f"{bin_dir}:{env['PATH']}"
    return env


def test_daytime_flow_fails_fast_when_market_data_preflight_is_unreachable(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _write_executable(
        bin_dir / "curl",
        "#!/usr/bin/env bash\nexit 1\n",
    )

    env = _shell_env(bin_dir)
    env["LOCAL_RUNS_ROOT"] = str(tmp_path / "runs")

    result = subprocess.run(
        ["bash", str(DAYTIME_FLOW)],
        cwd=str(BACKTESTER_ROOT),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode != 0
    assert "Market data preflight" in result.stdout
    assert "- Unable to reach http://localhost:3033/market-data/ready" in result.stdout
    assert "- Start apps/external-service and try again." in result.stdout


def test_nighttime_flow_forces_progress_and_unbuffered_python(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    uv_log = tmp_path / "uv.log"
    _write_executable(
        bin_dir / "uv",
        textwrap.dedent(
            f"""\
            #!/usr/bin/env bash
            set -euo pipefail
            printf '%s\\n' "ARGS:$*" >>"{uv_log}"
            printf '%s\\n' "NIGHTLY_PROGRESS=${{NIGHTLY_PROGRESS:-}}" >>"{uv_log}"
            if [[ "$1" == "run" && "$2" == "python" && "$3" == "-u" && "$4" == "nightly_discovery.py" ]]; then
              printf '%s\\n' "Nightly discovery progress: screening 1/1 TEST"
              exit 0
            fi
            exit 0
            """
        ),
    )

    env = _shell_env(bin_dir)
    env["REQUIRE_MARKET_DATA_SERVICE"] = "0"
    env["RUN_MARKET_DATA_OPS"] = "0"
    env["RUN_PREDICTION_ACCURACY"] = "0"
    env["RUN_CRYPTO_DAILY_REFRESH"] = "0"
    env["NIGHTLY_LIMIT"] = "1"
    env["SKIP_LIVE_PREFILTER_REFRESH"] = "1"

    result = subprocess.run(
        ["bash", str(NIGHTTIME_FLOW)],
        cwd=str(BACKTESTER_ROOT),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0
    assert "Nightly discovery progress: screening 1/1 TEST" in result.stdout

    uv_invocation = uv_log.read_text(encoding="utf-8")
    assert "ARGS:run python -u nightly_discovery.py --limit 1 --skip-live-prefilter-refresh" in uv_invocation
    assert "NIGHTLY_PROGRESS=1" in uv_invocation


def test_daytime_flow_runs_paper_trade_cycle_when_enabled(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    uv_log = tmp_path / "uv.log"
    _write_executable(
        bin_dir / "curl",
        textwrap.dedent(
            """\
            #!/usr/bin/env bash
            if [[ "$1" == "-fsS" && "$2" == "http://localhost:3033/market-data/ops" ]]; then
              printf '%s' '{"source":"service","status":"ok","data":{"serviceOperatorState":"healthy","serviceOperatorAction":"No operator action required."}}'
              exit 0
            fi
            printf '%s' '{"source":"service","status":"ok","data":{"ready":true,"operatorState":"healthy","schwabStatus":"ok"}}'
            """
        ),
    )
    _write_executable(
        bin_dir / "uv",
        textwrap.dedent(
            f"""\
            #!/usr/bin/env bash
            set -euo pipefail
            printf '%s\\n' "ARGS:$*" >>"{uv_log}"
            if [[ "$1" == "run" && "$2" == "python" && "$3" == "paper_trade_cycle.py" && "$4" == "--mode" && "$5" == "daytime" ]]; then
              printf '%s\\n' "Paper trade cycle"
            fi
            exit 0
            """
        ),
    )

    env = _shell_env(bin_dir)
    env["RUN_MARKET_INTEL"] = "0"
    env["RUN_DYNAMIC_WATCHLIST_REFRESH"] = "0"
    env["RUN_DEEP_DIVE"] = "0"
    env["RUN_CRYPTO_DAILY_REFRESH"] = "0"
    env["REQUIRE_SCHWAB_CONFIGURED"] = "0"
    env["LOCAL_RUNS_ROOT"] = str(tmp_path / "runs")

    result = subprocess.run(
        ["bash", str(DAYTIME_FLOW)],
        cwd=str(BACKTESTER_ROOT),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0
    assert "== Paper trade cycle ==" in result.stdout
    assert "Paper trade cycle" in result.stdout
    uv_invocation = uv_log.read_text(encoding="utf-8")
    assert "ARGS:run python paper_trade_cycle.py --mode daytime" in uv_invocation


def test_nighttime_flow_runs_paper_trade_cycle_review_when_enabled(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    uv_log = tmp_path / "uv.log"
    _write_executable(
        bin_dir / "uv",
        textwrap.dedent(
            f"""\
            #!/usr/bin/env bash
            set -euo pipefail
            printf '%s\\n' "ARGS:$*" >>"{uv_log}"
            if [[ "$1" == "run" && "$2" == "python" && "$3" == "-u" && "$4" == "nightly_discovery.py" ]]; then
              printf '%s\\n' "Nightly discovery progress: screening 1/1 TEST"
              exit 0
            fi
            if [[ "$1" == "run" && "$2" == "python" && "$3" == "paper_trade_cycle.py" && "$4" == "--mode" && "$5" == "nighttime" ]]; then
              printf '%s\\n' "Paper trade cycle"
              exit 0
            fi
            exit 0
            """
        ),
    )

    env = _shell_env(bin_dir)
    env["REQUIRE_MARKET_DATA_SERVICE"] = "0"
    env["RUN_MARKET_DATA_OPS"] = "0"
    env["RUN_PREDICTION_ACCURACY"] = "0"
    env["RUN_CRYPTO_DAILY_REFRESH"] = "0"
    env["NIGHTLY_LIMIT"] = "1"
    env["SKIP_LIVE_PREFILTER_REFRESH"] = "1"

    result = subprocess.run(
        ["bash", str(NIGHTTIME_FLOW)],
        cwd=str(BACKTESTER_ROOT),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0
    assert "== Paper trade review ==" in result.stdout
    assert "Paper trade cycle" in result.stdout
    uv_invocation = uv_log.read_text(encoding="utf-8")
    assert "ARGS:run python paper_trade_cycle.py --mode nighttime" in uv_invocation


def test_trend_sweep_preserves_existing_watchlist_when_x_auth_is_unavailable(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _write_executable(
        bin_dir / "bird",
        textwrap.dedent(
            """\
            #!/usr/bin/env bash
            echo "Missing required credentials"
            exit 1
            """
        ),
    )

    sync_stub = tmp_path / "sync_bird_auth.sh"
    _write_executable(
        sync_stub,
        "#!/usr/bin/env bash\nexit 0\n",
    )

    watchlist_path = tmp_path / "dynamic_watchlist.json"
    existing_payload = {
        "updated_at": "2026-03-24T10:00:00-04:00",
        "source": "x_twitter_sweep",
        "tickers": [{"symbol": "NVDA", "mentions": 7, "first_seen": "2026-03-20", "last_seen": "2026-03-24"}],
    }
    watchlist_path.write_text(json.dumps(existing_payload, indent=2) + "\n", encoding="utf-8")

    env = _shell_env(bin_dir)
    env["WATCHLIST_FILE"] = str(watchlist_path)
    env["BIRD_AUTH_ENV_PATH"] = str(tmp_path / "x-twitter-bird.env")
    env["BIRD_SYNC_AUTH_CMD"] = str(sync_stub)
    env["BIRD_COOKIE_SOURCE"] = "chrome"
    env["BIRD_CHROME_PROFILE_DIR"] = str(tmp_path / "openclaw-profile")

    result = subprocess.run(
        ["bash", str(TREND_SWEEP)],
        cwd=str(REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0
    assert "X/Twitter auth unavailable; using the previous dynamic watchlist." in result.stdout
    assert json.loads(watchlist_path.read_text(encoding="utf-8")) == existing_payload
