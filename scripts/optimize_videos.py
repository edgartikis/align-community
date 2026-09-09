from __future__ import annotations

from pathlib import Path
from urllib.parse import quote
import hashlib
import os
import re
import subprocess

ROOT = Path('.').resolve()
OUT_DIR = ROOT / 'assets' / 'videoopt'
OUT_DIR.mkdir(parents=True, exist_ok=True)

TEXT_EXTS = {'.html', '.css', '.js'}
MIN_BYTES = 2 * 1024 * 1024


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
    stem = ''.join(ch if ch.isalnum() or ch in '-_' else '-' for ch in source.stem)[:54].strip('-') or 'video'
    return f'{stem}-{digest}.mp4'


def encode(source: Path, target: Path) -> bool:
    # Keep the same broadly compatible MP4/H.264 format while reducing transfer size.
    # Max 1280px on the longest side is ample for background/hero playback on the site.
    scale = "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos"
    cmd = [
        'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
        '-i', str(source),
        '-map', '0:v:0', '-map', '0:a?',
        '-vf', scale,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '96k',
        '-movflags', '+faststart',
        str(target),
    ]
    try:
        subprocess.run(cmd, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        print(f'SKIP video {source.relative_to(ROOT)}: {exc}')
        target.unlink(missing_ok=True)
        return False

    # Only switch when the optimized file gives a meaningful bandwidth win.
    if target.stat().st_size >= source.stat().st_size * 0.85:
        target.unlink(missing_ok=True)
        return False
    return True


def main() -> None:
    text_files = [
        p for p in ROOT.rglob('*')
        if p.is_file()
        and p.suffix.lower() in TEXT_EXTS
        and '.git' not in p.parts
        and '.github' not in p.parts
    ]
    text_cache = {p: p.read_text(encoding='utf-8', errors='ignore') for p in text_files}

    videos = [
        p for p in ROOT.rglob('*.mp4')
        if p.is_file()
        and p.stat().st_size >= MIN_BYTES
        and 'assets/videoopt' not in p.as_posix()
    ]

    original_total = 0
    optimized_total = 0
    optimized_count = 0
    rewritten_files: set[Path] = set()

    for source in videos:
        hits: dict[Path, list[str]] = {}
        for text_file in text_files:
            data = text_cache[text_file]
            found = [variant for variant in ref_variants(source, text_file) if variant in data]
            if found:
                hits[text_file] = found

        # Ignore old/unreferenced videos instead of spending deploy time transcoding them.
        if not hits:
            continue

        target = OUT_DIR / output_name(source)
        if not encode(source, target):
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

    # Ask browsers to fetch only video metadata initially where the page did not
    # explicitly define a preload strategy. Autoplay/loop/muted/playsinline stay intact.
    for html_file in [p for p in text_files if p.suffix.lower() == '.html']:
        data = text_cache[html_file]
        def add_preload(match: re.Match[str]) -> str:
            tag = match.group(0)
            if 'preload=' in tag:
                return tag
            return tag[:-1] + ' preload="metadata">'
        updated = re.sub(r'<video\b[^>]*>', add_preload, data, flags=re.IGNORECASE)
        if updated != data:
            text_cache[html_file] = updated
            rewritten_files.add(html_file)

    for path in rewritten_files:
        path.write_text(text_cache[path], encoding='utf-8')

    if optimized_count:
        saved = original_total - optimized_total
        pct = saved / original_total * 100
        print(f'Optimized referenced videos: {optimized_count}')
        print(f'Video originals: {original_total / 1024 / 1024:.2f} MB')
        print(f'Video optimized: {optimized_total / 1024 / 1024:.2f} MB')
        print(f'Video transfer reduction: {saved / 1024 / 1024:.2f} MB ({pct:.1f}%)')
    else:
        print('No referenced MP4 over threshold benefited from re-encoding.')


if __name__ == '__main__':
    main()
