#!/usr/bin/env python3
"""Read-only check of the deployed ALIGN Cloudflare Worker health endpoint.

This script never sends payment credentials and never modifies Cloudflare or Stripe.
It verifies what is DEPLOYED, not just what wrangler.toml says.
"""
import json
import sys
import urllib.error
import urllib.request

HEALTH_URL = "https://api.alignmembers.com.mx/api/health"
EXPECTED = {
    "ok": True,
    "architecture": "cloudflare-worker-kv",
    "storage": "kv-ready",
    "stripeMode": "live",
    "stripeApi": "configured",
    "stripeWebhook": "configured",
    "stripePrices": "configured",
}


def main():
    request = urllib.request.Request(
        HEALTH_URL,
        headers={"Accept": "application/json", "User-Agent": "ALIGN-readonly-health-audit/1.0"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=18) as response:
            http_status = response.status
            data = json.loads(response.read(64_000).decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as error:
        print(f"UNVERIFIED: Cannot retrieve deployed health endpoint ({type(error).__name__}).")
        return 1

    # Only print pre-approved, non-sensitive keys; never dump response or headers.
    print(f"Cloudflare Worker health: HTTP {http_status}")
    problems = []
    for key, expected in EXPECTED.items():
        value = data.get(key) if isinstance(data, dict) else None
        print(f"  {key}: {value!r}")
        if value != expected:
            problems.append(f"{key}: expected {expected!r}, got {value!r}")

    if problems:
        print("UNVERIFIED: deployed configuration fails one or more checks.")
        return 1

    print("PASS: publicly deployed API reports Live ready.")
    print("NOTE: Health does not confirm webhook deliveries, KV member sync, or a successful end-to-end purchase.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
