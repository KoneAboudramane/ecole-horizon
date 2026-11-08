"""Petits outils communs aux documents PDF (reçus, bulletins)."""
import base64
import colorsys
import io

from reportlab.lib import colors
from reportlab.lib.utils import ImageReader


def hue_color(hue: int, light: float = 0.30):
    r, g, b = colorsys.hls_to_rgb((hue % 360) / 360, light, 0.55)
    return colors.Color(r, g, b)


def logo_reader(data_url: str):
    """Logo de l'école (data URL) ; un logo illisible ne doit jamais empêcher un document."""
    try:
        if data_url and data_url.startswith("data:image/"):
            return ImageReader(io.BytesIO(base64.b64decode(data_url.split(",", 1)[1])))
    except Exception:  # noqa: BLE001
        return None
    return None


def fnum(v, digits: int = 2) -> str:
    return "—" if v is None else f"{v:.{digits}f}".replace(".", ",")


def rang_label(r, of=None) -> str:
    if r is None:
        return "—"
    s = "1er" if r == 1 else f"{r}e"
    return f"{s}/{of}" if of else s
