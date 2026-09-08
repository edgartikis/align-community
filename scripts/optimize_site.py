from __future__ import annotations

from pathlib import Path
from urllib.parse import quote
import hashlib
import os
import re

from PIL import Image, ImageOps

ROOT = Path('.').resolve()
OUT_DIR = ROOT / 'assets' / 'webopt'
OUT_DIR.mkdir(parents=True, exist_ok=True)

IMAGE_EXTS = {'.png', '.jpg', '.jpeg'}
TEXT_EXTS = {'.html', '.css', '.js', '.json'}
MIN_BYTES = 130 * 1024
MAX_DIMENSION = 1920

# Public content / ally pages that receive the shared ALIGN personality system.
# Deliberately excluded: homepage, initial/auth/payment flows, member pages,
# operational dashboards/portals and the Restaurants page (already custom-designed).
PERSONALITY_PAGES = {
    'ancla-del-canelo.html',
    'boris-marisqueria.html',
    'buns-and-bros.html',
    'capri-3.html',
    'capri-5.html',
    'cera-mia.html',
    'charreadas.html',
    'cuidado-personal.html',
    'dia-de-pesca.html',
    'gingers.html',
    'global-gym.html',
    'green-cabana.html',
    'horse-riding.html',
    'marea-baja.html',
    'marmara-11.html',
    'marmara-8.html',
    'nuva.html',
    'padel-11-11.html',
    'penthouse-capri.html',
    'rancho-mx.html',
    'sante.html',
    'uspin.html',
    'velamar.html',
}

PERSONALITY_STYLESHEET = '<link rel="stylesheet" href="assets/align-section-personality.css?v=20260908-1">'
PERSONALITY_BAND = (
    '<div class="align-personality-band" aria-hidden="true">'
    '<div class="align-personality-band-track">'
    '<span>BELONG TO SOMETHING <i>◆</i> LIVE WITH PURPOSE <i>◆</i> ALIGN PARTNER <i>◆</i> TAMPICO · MADERO · ALTAMIRA <i>◆</i></span>'
    '<span>BELONG TO SOMETHING <i>◆</i> LIVE WITH PURPOSE <i>◆</i> ALIGN PARTNER <i>◆</i> TAMPICO · MADERO · ALTAMIRA <i>◆</i></span>'
    '</div></div>'
)

# These files are identity / UI assets where pixel-perfect preservation matters more
# than the small bandwidth win. Existing dedicated optimizers for carousel/Boris are
# also excluded to avoid double recompression.
PROTECTED_HINTS = (
    'align-primary',
    'align-wordmark',
    'logo',
    'favicon',
    'qr',
    'wallet',
    'image-gen-1(20260816-192750)',
)
SKIP_PARTS = {
    '.git',
    '.github',
    'node_modules',
}


def is_under(path: Path, relative_dir: str) -> bool:
    try:
        path.relative_to(ROOT / relative_dir)
        return True
    except ValueError:
        return False


def should_skip_image(path: Path) -> bool:
    rel = path.relative_to(ROOT)
    if any(part in SKIP_PARTS for part in rel.parts):
        return True
    if is_under(path, 'assets/carousel') or is_under(path, 'assets/boris') or is_under(path, 'assets/webopt'):
        return True
    lowered = rel.as_posix().lower()
    if any(hint in lowered for hint in PROTECTED_HINTS):
        return True
    return False


def ref_variants(source: Path, text_file: Path) -> list[str]:
    root_ref = source.relative_to(ROOT).as_posix()
    relative_ref = os.path.relpath(source, text_file.parent).replace(os.sep, '/')
    variants = {root_ref, relative_ref}
    if not root_ref.startswith('./'):
        variants.add('./' + root_ref)
    if not relative_ref.startswith('../') and not relative_ref.startswith('./'):
        variants.add('./' + relative_ref)

    expanded: set[str] = set()
    for item in variants:
        expanded.add(item)
        expanded.add(quote(item, safe='/._-()'))
    return sorted(expanded, key=len, reverse=True)


def output_name(source: Path) -> str:
    rel = source.relative_to(ROOT).as_posix()
    digest = hashlib.sha1(rel.encode('utf-8')).hexdigest()[:10]
    stem = ''.join(ch if ch.isalnum() or ch in '-_' else '-' for ch in source.stem)[:48].strip('-') or 'image'
    return f'{stem}-{digest}.webp'


def optimize_image(source: Path) -> Path | None:
    target = OUT_DIR / output_name(source)
    try:
        with Image.open(source) as im:
            im = ImageOps.exif_transpose(im)
            im.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.Resampling.LANCZOS)

            has_alpha = 'A' in im.getbands() or 'transparency' in im.info
            if has_alpha:
                im = im.convert('RGBA')
                im.save(target, 'WEBP', quality=88, method=6)
            else:
                im = im.convert('RGB')
                im.save(target, 'WEBP', quality=82, method=6)
    except Exception as exc:
        print(f'SKIP {source.relative_to(ROOT)}: {exc}')
        return None

    # Only switch the page to the WebP when it is meaningfully smaller.
    if target.stat().st_size >= source.stat().st_size * 0.92:
        target.unlink(missing_ok=True)
        return None
    return target


def add_body_class(html: str, class_name: str) -> str:
    match = re.search(r'<body\b[^>]*>', html, flags=re.IGNORECASE)
    if not match:
        return html
    tag = match.group(0)
    if class_name in tag:
        return html

    class_match = re.search(r'class\s*=\s*(["\'])(.*?)\1', tag, flags=re.IGNORECASE)
    if class_match:
        old = class_match.group(0)
        quote_char = class_match.group(1)
        classes = class_match.group(2).strip()
        new = f'class={quote_char}{classes} {class_name}{quote_char}'
        new_tag = tag.replace(old, new, 1)
    else:
        new_tag = tag[:-1] + f' class="{class_name}">'

    return html[:match.start()] + new_tag + html[match.end():]


def apply_personality(html: str) -> str:
    html = add_body_class(html, 'align-personality-enabled')

    if PERSONALITY_STYLESHEET not in html:
        if '</head>' not in html:
            raise RuntimeError('Public section page is missing </head>; cannot inject ALIGN personality stylesheet')
        html = html.replace('</head>', PERSONALITY_STYLESHEET + '\n</head>', 1)

    if 'class="align-personality-band"' not in html:
        footer_match = re.search(r'<footer\b', html, flags=re.IGNORECASE)
        if footer_match:
            html = html[:footer_match.start()] + PERSONALITY_BAND + '\n' + html[footer_match.start():]
        elif '</body>' in html:
            html = html.replace('</body>', PERSONALITY_BAND + '\n</body>', 1)
        else:
            raise RuntimeError('Public section page is missing </body>; cannot inject ALIGN personality band')

    return html


def main() -> None:
    text_files = [
        p for p in ROOT.rglob('*')
        if p.is_file()
        and p.suffix.lower() in TEXT_EXTS
        and '.git' not in p.parts
        and '.github' not in p.parts
    ]
    text_cache = {p: p.read_text(encoding='utf-8', errors='ignore') for p in text_files}

    candidates = [
        p for p in ROOT.rglob('*')
        if p.is_file()
        and p.suffix.lower() in IMAGE_EXTS
        and p.stat().st_size >= MIN_BYTES
        and not should_skip_image(p)
    ]

    original_total = 0
    optimized_total = 0
    optimized_count = 0
    rewritten_files: set[Path] = set()

    for source in candidates:
        hits: dict[Path, list[str]] = {}
        for text_file in text_files:
            data = text_cache[text_file]
            found = [variant for variant in ref_variants(source, text_file) if variant in data]
            if found:
                hits[text_file] = found

        # Do not add an optimized copy for an image the website never references.
        if not hits:
            continue

        target = optimize_image(source)
        if target is None:
            continue

        original_total += source.stat().st_size
        optimized_total += target.stat().st_size
        optimized_count += 1

        for text_file, old_refs in hits.items():
            data = text_cache[text_file]
            target_ref = os.path.relpath(target, text_file.parent).replace(os.sep, '/')
            target_encoded = quote(target_ref, safe='/._-()')

            for old in old_refs:
                replacement = target_encoded if '%' in old else target_ref
                data = data.replace(old, replacement)

            text_cache[text_file] = data
            rewritten_files.add(text_file)

    # Async decoding is safe and reduces main-thread image decode stalls without
    # changing layout, navigation, forms, carousels or any visual dimensions.
    for html_file in [p for p in text_files if p.suffix.lower() == '.html']:
        data = text_cache[html_file]
        pos = 0
        pieces: list[str] = []
        changed = False
        while True:
            start = data.find('<img', pos)
            if start < 0:
                pieces.append(data[pos:])
                break
            end = data.find('>', start)
            if end < 0:
                pieces.append(data[pos:])
                break
            pieces.append(data[pos:start])
            tag = data[start:end + 1]
            if 'decoding=' not in tag:
                tag = tag.replace('<img', '<img decoding="async"', 1)
                changed = True
            pieces.append(tag)
            pos = end + 1
        if changed:
            text_cache[html_file] = ''.join(pieces)
            rewritten_files.add(html_file)

    # Apply a consistent, brand-manual-inspired layer to public content pages only.
    # This intentionally leaves the principal/index, initial/auth flows and member
    # experience untouched, exactly as requested.
    for page_name in PERSONALITY_PAGES:
        page_path = ROOT / page_name
        if page_path not in text_cache:
            raise FileNotFoundError(page_path)
        personalized = apply_personality(text_cache[page_path])
        if personalized != text_cache[page_path]:
            text_cache[page_path] = personalized
            rewritten_files.add(page_path)

    # The public payment page is still kept simple in source, but the deployed
    # version loads the Cloudflare/Stripe bridge so checkout never falls back to
    # the old Netlify test endpoint or local card simulation.
    pago_path = ROOT / 'pago.html'
    if pago_path in text_cache:
        pago_html = text_cache[pago_path]
        bridge_tag = '<script src="stripe-checkout-bridge.js?v=20260906-1"></script>'
        if bridge_tag not in pago_html:
            if '</body>' not in pago_html:
                raise RuntimeError('pago.html is missing </body>; cannot inject Stripe checkout bridge')
            pago_html = pago_html.replace('</body>', bridge_tag + '</body>', 1)
            text_cache[pago_path] = pago_html
            rewritten_files.add(pago_path)

    for path in rewritten_files:
        path.write_text(text_cache[path], encoding='utf-8')

    if original_total:
        saved = original_total - optimized_total
        pct = saved / original_total * 100
        print(f'Site-wide optimized images: {optimized_count}')
        print(f'Referenced originals: {original_total / 1024 / 1024:.2f} MB')
        print(f'Optimized WebP: {optimized_total / 1024 / 1024:.2f} MB')
        print(f'Estimated transfer reduction: {saved / 1024 / 1024:.2f} MB ({pct:.1f}%)')
        print(f'Text files rewritten: {len(rewritten_files)}')
    else:
        print('No additional referenced images met the optimization threshold.')


if __name__ == '__main__':
    main()
