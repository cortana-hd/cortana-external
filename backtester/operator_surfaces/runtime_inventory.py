"""Runtime inventory artifact for the Mac-mini operator lane."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from evaluation.artifact_contracts import (
    ARTIFACT_FAMILY_RUNTIME_INVENTORY,
    annotate_artifact,
)

BACKTESTER_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKTESTER_ROOT.parent
WATCHDOG_ROOT = REPO_ROOT / "watchdog"


def build_runtime_inventory_artifact(*, generated_at: str) -> dict[str, Any]:
    components = [
        _component(
            "external_service",
            "service",
            must_be_running=True,
            ownership="TypeScript market-data lane",
            inspection_path=str(REPO_ROOT / "apps" / "external-service"),
            health_probe={"type": "http", "path": "http://127.0.0.1:3033/market-data/ready"},
            restart_policy={"owner": "launchd", "label": "com.cortana.fitness-service"},
        ),
        _component(
            "daytime_flow",
            "script",
            must_be_running=False,
            ownership="Python operator wrapper",
            inspection_path=str(BACKTESTER_ROOT / "scripts" / "daytime_flow.sh"),
            health_probe={"type": "artifact", "path": str(BACKTESTER_ROOT / "var" / "local-workflows")},
            restart_policy={"owner": "operator", "label": "cday"},
        ),
        _component(
            "nighttime_flow",
            "script",
            must_be_running=False,
            ownership="Python nightly wrapper",
            inspection_path=str(BACKTESTER_ROOT / "scripts" / "nighttime_flow.sh"),
            health_probe={"type": "artifact", "path": str(BACKTESTER_ROOT / "var" / "local-workflows")},
            restart_policy={"owner": "operator", "label": "cnight"},
        ),
        _component(
            "pre_open_canary",
            "artifact_family",
            must_be_running=False,
            ownership="Python readiness gate",
            inspection_path=str(BACKTESTER_ROOT / "var" / "readiness" / "pre-open-canary-latest.json"),
            health_probe={"type": "artifact", "path": str(BACKTESTER_ROOT / "var" / "readiness" / "pre-open-canary-latest.json")},
            restart_policy={"owner": "cron", "label": "pre-open canary"},
        ),
        _component(
            "watchdog",
            "launchd_job",
            must_be_running=True,
            ownership="shell watchdog",
            inspection_path=str(WATCHDOG_ROOT / "watchdog.sh"),
            health_probe={"type": "launchd", "label": "com.cortana.watchdog"},
            restart_policy={"owner": "launchd", "label": "com.cortana.watchdog"},
        ),
        _component(
            "postgres",
            "database",
            must_be_running=True,
            ownership="local structured store",
            inspection_path="postgresql://local/cortana",
            health_probe={"type": "command", "command": "psql cortana -c 'select 1'"},
            restart_policy={"owner": "operator", "label": "postgres"},
        ),
        _component(
            "operator_payloads",
            "artifact_family",
            must_be_running=False,
            ownership="shared operator contract",
            inspection_path=str(BACKTESTER_ROOT / "tests" / "fixtures" / "consumer_contracts"),
            health_probe={"type": "fixture_corpus", "path": str(BACKTESTER_ROOT / "tests" / "fixtures" / "consumer_contracts")},
            restart_policy={"owner": "git", "label": "fixture regression"},
        ),
    ]
    return annotate_artifact(
        {
            "components": components,
            "warnings": [],
        },
        artifact_family=ARTIFACT_FAMILY_RUNTIME_INVENTORY,
        producer="backtester.operator_surfaces.runtime_inventory",
        generated_at=generated_at,
        known_at=generated_at,
        status="ok",
        degraded_status="healthy",
        outcome_class="run_completed",
    )


def _component(
    component_key: str,
    component_type: str,
    *,
    must_be_running: bool,
    ownership: str,
    inspection_path: str,
    health_probe: dict[str, Any],
    restart_policy: dict[str, Any],
) -> dict[str, Any]:
    return {
        "component_key": component_key,
        "component_type": component_type,
        "ownership": ownership,
        "must_be_running": must_be_running,
        "inspection_path": inspection_path,
        "health_probe": health_probe,
        "restart_policy": restart_policy,
    }
