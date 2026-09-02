#!/usr/bin/env python3
"""Generate committed GardenFlow icon assets from the approved watercolor source."""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / 'branding' / 'visual-theme.json'


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def rounded_master(source: Image.Image, config: dict) -> Image.Image:
    crop = config['crop']
    master = config['master']
    box = (
        crop['x'],
        crop['y'],
        crop['x'] + crop['width'],
        crop['y'] + crop['height'],
    )
    content = source.crop(box).resize(
        (master['contentSize'], master['contentSize']),
        Image.Resampling.LANCZOS,
    )
    mask = Image.new('L', content.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, content.width - 1, content.height - 1),
        radius=master['cornerRadius'],
        fill=255,
    )
    content.putalpha(mask)
    canvas = Image.new('RGBA', (master['size'], master['size']), (0, 0, 0, 0))
    canvas.alpha_composite(content, (master['padding'], master['padding']))
    return canvas


def optical_small_icon(master: Image.Image, size: int, scale: float) -> Image.Image:
    visible_size = round(master.width / scale)
    offset = (master.width - visible_size) // 2
    icon = master.crop((offset, offset, offset + visible_size, offset + visible_size))
    icon = icon.resize((size, size), Image.Resampling.LANCZOS)
    return icon.filter(ImageFilter.UnsharpMask(radius=0.55, percent=72, threshold=2))


def save_png(image: Image.Image, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, format='PNG', optimize=True)


def main() -> None:
    visual = json.loads(CONFIG_PATH.read_text(encoding='utf-8'))
    artwork = visual['artwork']
    source_path = ROOT / artwork['source']
    actual_hash = sha256(source_path)
    if actual_hash != artwork['sourceSha256']:
        raise SystemExit(f'Unexpected source artwork hash: {actual_hash}')

    source = Image.open(source_path).convert('RGBA')
    if source.size != (artwork['sourceWidth'], artwork['sourceHeight']):
        raise SystemExit(f'Unexpected source artwork size: {source.size}')

    master = rounded_master(source, artwork)
    master_path = ROOT / 'branding' / 'gardenflow-iris-master.png'
    save_png(master, master_path)

    for relative_path in [
        'desktop/gardenflow.png',
        'desktop/public/branding/app-icon.png',
        'desktop/public/branding/logo.png',
        'desktop/public/onboarding/brand/gardenflow-logo.png',
        'desktop/public/provider-logos/gardenflow.png',
    ]:
        destination = ROOT / relative_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(master_path, destination)

    for size in (16, 32, 48, 128):
        icon = optical_small_icon(master, size, artwork['smallIconOpticalScale']) if size <= 32 else master.resize((size, size), Image.Resampling.LANCZOS)
        save_png(icon, ROOT / 'Plugin' / 'src' / 'icons' / f'icon{size}.png')

    print('GardenFlow watercolor brand assets generated.')


if __name__ == '__main__':
    main()
