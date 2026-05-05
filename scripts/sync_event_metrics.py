#!/usr/bin/env python3
"""
Cron-friendly helper to trigger server-side event metrics sync.

Usage:
  ADMIN_SYNC_TOKEN=... python3 scripts/sync_event_metrics.py
  ADMIN_SYNC_TOKEN=... python3 scripts/sync_event_metrics.py --event-id <EVENT_ID>
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request


def main() -> int:
    parser = argparse.ArgumentParser(description="Trigger Evorra event metrics sync endpoint")
    parser.add_argument(
        "--base-url",
        default=os.getenv("APP_BASE_URL", "http://127.0.0.1:5001"),
        help="Base URL for running Flask app (default: APP_BASE_URL or http://127.0.0.1:5001)",
    )
    parser.add_argument(
        "--event-id",
        default="",
        help="Optional event ID to sync only one event",
    )
    args = parser.parse_args()

    token = (os.getenv("ADMIN_SYNC_TOKEN") or "").strip()
    if not token:
        print("ERROR: ADMIN_SYNC_TOKEN is required in environment.", file=sys.stderr)
        return 2

    base = args.base_url.rstrip("/")
    payload = {"event_id": args.event_id} if args.event_id else {}
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{base}/api/admin/sync-event-metrics",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            text = resp.read().decode("utf-8")
            print(text)
        return 0
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        print(f"HTTP {e.code}: {detail}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
