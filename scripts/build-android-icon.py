#!/usr/bin/env python3
"""Build the inset adaptive-icon foreground used only by Android.

The regular Tauri icon source is intentionally left unchanged: desktop, Windows,
macOS, and the legacy Android launcher images all use it at full size. Android's
adaptive foreground has a smaller safe area because launchers apply a mask to the
108dp adaptive-icon canvas, so this script places an inset copy of the complete
artwork on a transparent canvas.

Requires Pillow when run locally. The generated PNG is committed, so CI only
needs the Tauri CLI and does not run this helper.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "desktop/src-tauri/icons/icon-source.png"
OUTPUT = ROOT / "desktop/src-tauri/icons/icon-android-foreground.png"
DEFAULT_SCALE = 0.75


def inset_foreground(source: Image.Image, scale: float) -> Image.Image:
    """Crop transparent padding, scale the artwork, and re-center it."""

    if not 0 < scale <= 1:
        raise ValueError("scale must be greater than 0 and no greater than 1")

    source = source.convert("RGBA")
    alpha_bbox = source.getchannel("A").getbbox()
    if alpha_bbox is None:
        raise ValueError("source icon has no visible pixels")

    artwork = source.crop(alpha_bbox)
    resized = artwork.resize(
        (round(artwork.width * scale), round(artwork.height * scale)),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", source.size, (0, 0, 0, 0))
    canvas.alpha_composite(
        resized,
        (
            (canvas.width - resized.width) // 2,
            (canvas.height - resized.height) // 2,
        ),
    )
    return canvas


def render_previews(source: Image.Image, output_dir: Path) -> None:
    """Write temporary mask previews for the three candidate scales."""

    output_dir.mkdir(parents=True, exist_ok=True)
    preview_size = 600
    background = (183, 68, 10, 255)

    for scale in (0.72, DEFAULT_SCALE, 0.78):
        foreground = inset_foreground(source, scale).resize(
            (preview_size, preview_size), Image.Resampling.LANCZOS
        )
        composite = Image.new("RGBA", (preview_size, preview_size), background)
        composite.alpha_composite(foreground)

        masks: dict[str, Image.Image] = {}
        circle = Image.new("L", composite.size, 0)
        ImageDraw.Draw(circle).ellipse((0, 0, preview_size - 1, preview_size - 1), fill=255)
        masks["circle"] = circle

        rounded = Image.new("L", composite.size, 0)
        ImageDraw.Draw(rounded).rounded_rectangle(
            (0, 0, preview_size - 1, preview_size - 1),
            radius=round(preview_size * 0.22),
            fill=255,
        )
        masks["rounded"] = rounded

        for mask_name, mask in masks.items():
            preview = Image.new("RGBA", composite.size, (0, 0, 0, 0))
            preview.paste(composite, mask=mask)
            preview.save(output_dir / f"android-icon-{scale:.2f}-{mask_name}.png", optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--scale",
        type=float,
        default=DEFAULT_SCALE,
        help="fraction of the source artwork content to keep (default: 0.75)",
    )
    parser.add_argument(
        "--preview-dir",
        type=Path,
        help="also write temporary circle and rounded-mask previews for 0.72/0.75/0.78",
    )
    args = parser.parse_args()

    source = Image.open(SOURCE).convert("RGBA")
    foreground = inset_foreground(source, args.scale)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    foreground.save(OUTPUT, format="PNG", optimize=True)

    alpha_bbox = foreground.getchannel("A").getbbox()
    assert alpha_bbox is not None
    print(
        f"wrote {OUTPUT.relative_to(ROOT)}: "
        f"canvas={foreground.width}x{foreground.height}, "
        f"content={alpha_bbox[2] - alpha_bbox[0]}x{alpha_bbox[3] - alpha_bbox[1]}"
    )

    if args.preview_dir:
        render_previews(source, args.preview_dir)
        print(f"wrote previews to {args.preview_dir}")


if __name__ == "__main__":
    main()