from __future__ import annotations

import math
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "docs" / "assets" / "readme"
WIDTH = 960
HEIGHT = 640
FPS = 10

BACKGROUND = "#f3ede2"
BACKGROUND_WASH = "#e9dcc9"
BACKGROUND_WASH_2 = "#d9eadf"
CARD_BG = "#fbf8f2"
CARD_BORDER = "#dfd5c7"
CARD_SHADOW = "#cabba9"
TEXT = "#4b4036"
MUTED = "#907f72"
LABEL = "#7c6c61"
BUBBLE_LIGHT = "#fffaf5"
BUBBLE_LIGHT_BORDER = "#eadfce"
BUBBLE_SOFT = "#e2efe4"
BUBBLE_SOFT_BORDER = "#bfd4c3"
ACCENT = "#8cae98"
DIVIDER = "#ebe2d6"
CURSOR = "#73957f"

BODY_FONT_EN = Path(r"C:\Windows\Fonts\segoeui.ttf")
BODY_FONT_EN_BOLD = Path(r"C:\Windows\Fonts\segoeuib.ttf")
BODY_FONT_ZH = Path(r"C:\Windows\Fonts\msyh.ttc")
BODY_FONT_ZH_BOLD = Path(r"C:\Windows\Fonts\msyhbd.ttc")


@dataclass(frozen=True)
class BubbleSpec:
    x: int
    y: int
    max_width: int
    fill: str
    border: str
    text: str
    keep_prefix: str | None = None
    tail_side: str = "left"


CONFIGS = {
    "zh": {
        "output": OUTPUT_DIR / "hero-chat-zh.gif",
        "header": "Codeksei",
        "subheader": "轻轻问一句",
        "alt": "Codeksei gently checking in with warm Chinese chat bubbles.",
        "specs": [
            BubbleSpec(
                x=174,
                y=184,
                max_width=540,
                fill=BUBBLE_LIGHT,
                border=BUBBLE_LIGHT_BORDER,
                text="看到你安静了一会儿，我来问一句。",
            ),
            BubbleSpec(
                x=212,
                y=284,
                max_width=548,
                fill=BUBBLE_LIGHT,
                border=BUBBLE_LIGHT_BORDER,
                text="昨天停下来的地方，我还替你记着。",
            ),
            BubbleSpec(
                x=394,
                y=398,
                max_width=328,
                fill=BUBBLE_SOFT,
                border=BUBBLE_SOFT_BORDER,
                text="现在要不要继续那条线？",
                keep_prefix="要不要",
                tail_side="right",
            ),
        ],
        "final_text": "要不要我陪你慢慢接上？",
    },
    "en": {
        "output": OUTPUT_DIR / "hero-chat-en.gif",
        "header": "Codeksei",
        "subheader": "gentle check-in",
        "alt": "Codeksei gently checking in with warm English chat bubbles.",
        "specs": [
            BubbleSpec(
                x=164,
                y=180,
                max_width=600,
                fill=BUBBLE_LIGHT,
                border=BUBBLE_LIGHT_BORDER,
                text="You've been quiet for a little while, so I thought I'd check in.",
            ),
            BubbleSpec(
                x=208,
                y=308,
                max_width=562,
                fill=BUBBLE_LIGHT,
                border=BUBBLE_LIGHT_BORDER,
                text="I still remember where you left off yesterday.",
            ),
            BubbleSpec(
                x=360,
                y=418,
                max_width=410,
                fill=BUBBLE_SOFT,
                border=BUBBLE_SOFT_BORDER,
                text="Want to pick that thread back up now?",
                keep_prefix="Want ",
                tail_side="right",
            ),
        ],
        "final_text": "Want me to ease you back into it?",
    },
}


def load_font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size=size)


def clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def mix(color_a: str, color_b: str, ratio: float) -> tuple[int, int, int, int]:
    ratio = clamp(ratio, 0.0, 1.0)
    rgba_a = ImageColor.getrgb(color_a) + (255,)
    rgba_b = ImageColor.getrgb(color_b) + (255,)
    return tuple(
        round((1.0 - ratio) * rgba_a[index] + ratio * rgba_b[index]) for index in range(4)
    )


def ease_out(value: float) -> float:
    value = clamp(value, 0.0, 1.0)
    return 1.0 - math.pow(1.0 - value, 3)


def wrap_text(text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    if not text:
        return [""]
    units = text.split(" ") if " " in text else list(text)
    joiner = " " if " " in text else ""
    lines: list[str] = []
    current = ""
    for unit in units:
        candidate = unit if not current else f"{current}{joiner}{unit}"
        if font.getlength(candidate) <= max_width:
            current = candidate
            continue
        if current:
            lines.append(current)
        current = unit
    if current:
        lines.append(current)
    return lines or [text]


def measure_lines(
    text: str,
    font: ImageFont.FreeTypeFont,
    max_width: int,
    line_gap: int,
) -> tuple[list[str], int, int]:
    lines = wrap_text(text, font, max_width)
    widths = [math.ceil(font.getlength(line)) for line in lines]
    line_height = font.getbbox("Ag")[3] - font.getbbox("Ag")[1]
    block_height = len(lines) * line_height + max(0, len(lines) - 1) * line_gap
    return lines, max(widths or [0]), block_height


def bubble_box(
    text: str,
    font: ImageFont.FreeTypeFont,
    max_width: int,
    padding_x: int,
    padding_y: int,
    line_gap: int,
) -> tuple[int, int]:
    _, text_width, text_height = measure_lines(text, font, max_width - padding_x * 2, line_gap)
    return text_width + padding_x * 2, text_height + padding_y * 2


def shift_mask(mask: Image.Image, dx: int, dy: int) -> Image.Image:
    shifted = Image.new("L", mask.size, 0)
    shifted.paste(mask, (dx, dy))
    return shifted


def add_background(base: Image.Image) -> None:
    draw = ImageDraw.Draw(base)
    draw.rectangle((0, 0, WIDTH, HEIGHT), fill=BACKGROUND)
    wash = Image.new("RGBA", base.size, (0, 0, 0, 0))
    wash_draw = ImageDraw.Draw(wash)
    wash_draw.ellipse((-120, -150, 420, 360), fill=mix(BACKGROUND_WASH, BACKGROUND, 0.10))
    wash_draw.ellipse((560, -80, 1080, 440), fill=mix(BACKGROUND_WASH_2, BACKGROUND, 0.26))
    wash_draw.ellipse((600, 420, 1100, 940), fill=mix(BACKGROUND_WASH, BACKGROUND, 0.12))
    base.alpha_composite(wash)


def build_static_base(language: str, label_font: ImageFont.FreeTypeFont, detail_font: ImageFont.FreeTypeFont) -> Image.Image:
    base = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    add_background(base)

    card = Image.new("RGBA", base.size, (0, 0, 0, 0))
    card_draw = ImageDraw.Draw(card)

    card_x = 118
    card_y = 84
    card_w = 724
    card_h = 500
    radius = 36

    shadow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle(
        (card_x, card_y + 6, card_x + card_w, card_y + card_h + 6),
        radius=radius,
        fill=mix(CARD_SHADOW, BACKGROUND, 0.55),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(26))
    base.alpha_composite(shadow)

    card_draw.rounded_rectangle(
        (card_x, card_y, card_x + card_w, card_y + card_h),
        radius=radius,
        fill=CARD_BG,
        outline=CARD_BORDER,
        width=2,
    )

    header_y = card_y + 38
    dot_box = (card_x + 42, header_y + 6, card_x + 58, header_y + 22)
    card_draw.ellipse(dot_box, fill=ACCENT)
    card_draw.text((card_x + 74, header_y - 8), CONFIGS[language]["header"], font=label_font, fill=LABEL)
    card_draw.text((card_x + card_w - 156, header_y - 2), CONFIGS[language]["subheader"], font=detail_font, fill=MUTED)
    card_draw.line((card_x + 40, card_y + 82, card_x + card_w - 40, card_y + 82), fill=DIVIDER, width=2)

    base.alpha_composite(card)
    return base


def draw_bubble(
    base: Image.Image,
    x: int,
    y: int,
    width: int,
    height: int,
    fill: str,
    border: str,
    text: str,
    font: ImageFont.FreeTypeFont,
    text_color: str,
    alpha: float,
    offset_x: int,
    offset_y: int,
    padding_x: int,
    padding_y: int,
    line_gap: int,
    cursor: bool = False,
    tail_side: str = "left",
) -> Image.Image:
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    radius = 28
    box = (x + offset_x, y + offset_y, x + offset_x + width, y + offset_y + height)
    fill_rgba = mix(fill, CARD_BG, 0.0)
    border_rgba = mix(border, CARD_BG, 0.0)
    alpha_scale = clamp(alpha, 0.0, 1.0)
    fill_rgba = fill_rgba[:3] + (round(255 * alpha_scale),)
    border_rgba = border_rgba[:3] + (round(255 * alpha_scale),)
    text_rgba = ImageColor.getrgb(text_color) + (round(255 * alpha_scale),)

    draw.rounded_rectangle(box, radius=radius, fill=fill_rgba, outline=border_rgba, width=2)
    if tail_side == "left":
        tail = [
            (box[0] + 34, box[3] - 20),
            (box[0] + 8, box[3] - 10),
            (box[0] - 8, box[3] + 8),
        ]
    else:
        tail = [
            (box[2] - 34, box[3] - 20),
            (box[2] - 8, box[3] - 10),
            (box[2] + 8, box[3] + 8),
        ]
    draw.polygon(tail, fill=fill_rgba, outline=border_rgba)
    lines, _, _ = measure_lines(text, font, width - padding_x * 2, line_gap)
    line_height = font.getbbox("Ag")[3] - font.getbbox("Ag")[1]
    text_y = box[1] + padding_y
    for line in lines:
        draw.text((box[0] + padding_x, text_y), line, font=font, fill=text_rgba)
        text_y += line_height + line_gap

    if cursor:
        current_line = lines[-1] if lines else ""
        cursor_x = box[0] + padding_x + math.ceil(font.getlength(current_line))
        cursor_y = box[1] + padding_y + (len(lines) - 1) * (line_height + line_gap)
        draw.rounded_rectangle(
            (cursor_x + 4, cursor_y + 6, cursor_x + 9, cursor_y + line_height - 2),
            radius=3,
            fill=ImageColor.getrgb(CURSOR) + (round(255 * alpha_scale),),
        )

    return Image.alpha_composite(base, overlay)


def transform_states(initial: str, final: str, keep_prefix: str) -> list[str]:
    states: list[str] = []
    current = initial
    states.append(current)

    while current and not current.startswith(keep_prefix):
        current = current[1:]
        states.append(current)

    suffix_len = max(0, len(current) - len(keep_prefix))
    if suffix_len:
        steps = min(8, suffix_len)
        for step in range(1, steps + 1):
            remaining = suffix_len - round(step * suffix_len / steps)
            next_state = keep_prefix + current[len(current) - remaining :] if remaining > 0 else keep_prefix
            if states[-1] != next_state:
                states.append(next_state)
        current = keep_prefix

    suffix = final[len(keep_prefix) :]
    for index in range(1, len(suffix) + 1):
        states.append(keep_prefix + suffix[:index])
    return states


def render_language(language: str) -> None:
    spec_one, spec_two, spec_three = CONFIGS[language]["specs"]
    final_text = CONFIGS[language]["final_text"]

    if language == "zh":
        body_font = load_font(BODY_FONT_ZH, 28)
        label_font = load_font(BODY_FONT_EN_BOLD, 24)
        detail_font = load_font(BODY_FONT_ZH, 19)
    else:
        body_font = load_font(BODY_FONT_EN, 27)
        label_font = load_font(BODY_FONT_EN_BOLD, 24)
        detail_font = load_font(BODY_FONT_EN, 18)

    padding_x = 28
    padding_y = 20
    line_gap = 10

    bubble_one_box = bubble_box(spec_one.text, body_font, spec_one.max_width, padding_x, padding_y, line_gap)
    bubble_two_box = bubble_box(spec_two.text, body_font, spec_two.max_width, padding_x, padding_y, line_gap)
    bubble_three_initial = spec_three.text
    bubble_three_keep = spec_three.keep_prefix or ""
    bubble_three_width, bubble_three_height = bubble_box(
        max([bubble_three_initial, final_text], key=len),
        body_font,
        spec_three.max_width,
        padding_x,
        padding_y,
        line_gap,
    )

    base = build_static_base(language, label_font, detail_font)
    frames: list[Image.Image] = []

    def push(progress_one: float = 1.0, progress_two: float = 1.0, bubble_three_text: str | None = None, cursor: bool = False) -> None:
        frame = base.copy()
        if progress_one > 0:
            eased = ease_out(progress_one)
            frame = draw_bubble(
                frame,
                spec_one.x,
                spec_one.y,
                bubble_one_box[0],
                bubble_one_box[1],
                spec_one.fill,
                spec_one.border,
                spec_one.text,
                body_font,
                TEXT,
                alpha=eased,
                offset_x=0,
                offset_y=round((1.0 - eased) * 18),
                padding_x=padding_x,
                padding_y=padding_y,
                line_gap=line_gap,
                tail_side=spec_one.tail_side,
            )
        if progress_two > 0:
            eased = ease_out(progress_two)
            frame = draw_bubble(
                frame,
                spec_two.x,
                spec_two.y,
                bubble_two_box[0],
                bubble_two_box[1],
                spec_two.fill,
                spec_two.border,
                spec_two.text,
                body_font,
                TEXT,
                alpha=eased,
                offset_x=0,
                offset_y=round((1.0 - eased) * 18),
                padding_x=padding_x,
                padding_y=padding_y,
                line_gap=line_gap,
                tail_side=spec_two.tail_side,
            )
        if bubble_three_text is not None:
            frame = draw_bubble(
                frame,
                spec_three.x,
                spec_three.y,
                bubble_three_width,
                bubble_three_height,
                spec_three.fill,
                spec_three.border,
                bubble_three_text,
                body_font,
                TEXT,
                alpha=1.0,
                offset_x=0,
                offset_y=0,
                padding_x=padding_x,
                padding_y=padding_y,
                line_gap=line_gap,
                cursor=cursor,
                tail_side=spec_three.tail_side,
            )
        frames.append(frame.convert("P", palette=Image.ADAPTIVE, colors=80))

    for _ in range(8):
        push(progress_one=1.0, progress_two=1.0)

    states = transform_states(bubble_three_initial, final_text, bubble_three_keep)
    for index, state in enumerate(states):
        push(
            progress_one=1.0,
            progress_two=1.0,
            bubble_three_text=state,
            cursor=index < len(states) - 1,
        )
    for _ in range(8):
        push(progress_one=1.0, progress_two=1.0, bubble_three_text=final_text, cursor=False)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    direct_output = CONFIGS[language]["output"]
    direct_output.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix=f"codeksei-readme-hero-{language}-") as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        for index, frame in enumerate(frames):
            frame_path = temp_dir / f"frame_{index:03d}.png"
            frame.save(frame_path, optimize=True)

        palette_path = temp_dir / "palette.png"
        ffmpeg = shutil.which("ffmpeg")
        if ffmpeg:
            subprocess.run(
                [
                    ffmpeg,
                    "-y",
                    "-framerate",
                    str(FPS),
                    "-i",
                    str(temp_dir / "frame_%03d.png"),
                    "-vf",
                    "palettegen=max_colors=80:stats_mode=diff",
                    str(palette_path),
                ],
                check=True,
                capture_output=True,
            )
            subprocess.run(
                [
                    ffmpeg,
                    "-y",
                    "-framerate",
                    str(FPS),
                    "-i",
                    str(temp_dir / "frame_%03d.png"),
                    "-i",
                    str(palette_path),
                    "-lavfi",
                    "paletteuse=dither=sierra2_4a",
                    str(direct_output),
                ],
                check=True,
                capture_output=True,
            )
        else:
            frames[0].save(
                direct_output,
                save_all=True,
                append_images=frames[1:],
                duration=round(1000 / FPS),
                loop=0,
                optimize=True,
                disposal=2,
            )

    size_kb = math.ceil(os.path.getsize(direct_output) / 1024)
    print(f"{language}: wrote {direct_output.relative_to(ROOT)} ({size_kb} KB)")


def main() -> None:
    for language in ("zh", "en"):
        render_language(language)


if __name__ == "__main__":
    main()
