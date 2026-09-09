from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CANONICAL_API = "https://api.alignmembers.com.mx/api"
RUNTIME_FILES = [
    "stripe-checkout-bridge.js",
    "login-github.html",
    "portal.html",
    "member.html",
    "portal-aliados.html",
    "profile-photo.html",
    "payment-success.html",
]
FORBIDDEN = (
    "aligncommunity.netlify.app",
    "alignmembership.netlify.app",
    "/.netlify/functions/",
)


def read(path: str) -> str:
    target = ROOT / path
    if not target.exists():
        raise SystemExit(f"Backend contract: missing required file {path}")
    return target.read_text(encoding="utf-8", errors="ignore")


def main() -> None:
    wrangler = read("cloudflare/payments-worker/wrangler.toml")
    if 'main = "src/main.js"' not in wrangler:
        raise SystemExit("Backend contract: wrangler must point to src/main.js")

    main_worker = read("cloudflare/payments-worker/src/main.js")
    if "entry-member-login.js" not in main_worker:
        raise SystemExit("Backend contract: canonical worker must delegate to the complete API chain")

    payment_page = read("pago.html")
    if "stripe-checkout-bridge.js" not in payment_page:
        raise SystemExit("Backend contract: pago.html must load stripe-checkout-bridge.js directly")

    checked = ["pago.html", *RUNTIME_FILES]
    for path in checked:
        data = read(path)
        for legacy in FORBIDDEN:
            if legacy in data:
                raise SystemExit(f"Backend contract: legacy backend reference {legacy!r} found in {path}")

    for path in RUNTIME_FILES:
        data = read(path)
        if path != "stripe-checkout-bridge.js" and "api.alignmembers.com.mx" not in data:
            raise SystemExit(f"Backend contract: {path} is not connected to the canonical API")

    bridge = read("stripe-checkout-bridge.js")
    if CANONICAL_API not in bridge:
        raise SystemExit("Backend contract: checkout bridge is not connected to the canonical API")

    if (ROOT / "netlify.toml").exists():
        raise SystemExit("Backend contract: netlify.toml must not return to the production branch")

    print("Backend contract OK: Cloudflare Worker + KV is the only production runtime.")


if __name__ == "__main__":
    main()
