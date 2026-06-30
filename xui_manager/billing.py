from __future__ import annotations

from typing import Iterable, Mapping


GB = 1024 * 1024 * 1024


def bytes_from_gb(value: float | int) -> int:
    return int(float(value) * GB)


def calculate_billable_usage(items: Iterable[Mapping[str, object]]) -> int:
    total = 0.0
    for item in items:
        upload = int(item.get("upload", 0) or 0)
        download = int(item.get("download", 0) or 0)
        rate = float(item.get("rate", 1) or 1)
        total += (upload + download) * rate
    return int(total)
