#!/usr/bin/env python3
"""SessionStats — turn a GPX or FIT session into a transparent stats image.

The interface in ui/ is opened as a file:// page in a frameless pywebview
window: no local server (nothing on 127.0.0.1) and no Internet access.
Python reads the GPX/FIT file, shows the dialogs and saves the PNG drawn by the UI.

Run from source:
    pip install -r requirements.txt
    python src/sessionstats.py
"""

import base64
import os
import pathlib
import sys

import webview

import activity

APP_NAME = "SessionStats"
BASE_DIR = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
UI_FILE = os.path.join(BASE_DIR, "ui", "index.html")
ICON_FILE = os.path.join(BASE_DIR, "icon.ico")
MIN_SIZE = (1100, 760)

window = None


def _first(result):
    """File dialogs return a tuple, a string or None depending on the platform."""
    if not result:
        return None
    return result[0] if isinstance(result, (list, tuple)) else result


class Api:
    """Methods callable from JavaScript as window.pywebview.api.<name>()."""

    def __init__(self):
        self._drag = None
        self._resize = None

    # --- Window controls ---
    def close_window(self):
        window.destroy()

    def minimize_window(self):
        window.minimize()

    def toggle_fullscreen(self):
        window.toggle_fullscreen()

    def start_drag(self, screen_x, screen_y):
        self._drag = (window.x, window.y, int(screen_x), int(screen_y))

    def drag_to(self, screen_x, screen_y):
        if self._drag:
            wx, wy, sx, sy = self._drag
            window.move(wx + int(screen_x) - sx, wy + int(screen_y) - sy)

    def end_drag(self):
        self._drag = None

    def start_resize(self, edge, screen_x, screen_y):
        self._resize = (edge, window.x, window.y, window.width, window.height,
                        int(screen_x), int(screen_y))

    def resize_to(self, screen_x, screen_y):
        if not self._resize:
            return
        edge, x0, y0, w0, h0, sx, sy = self._resize
        dx, dy = int(screen_x) - sx, int(screen_y) - sy
        x, y, w, h = x0, y0, w0, h0
        if "e" in edge:
            w = max(MIN_SIZE[0], w0 + dx)
        if "s" in edge:
            h = max(MIN_SIZE[1], h0 + dy)
        if "w" in edge:
            w = max(MIN_SIZE[0], w0 - dx)
            x = x0 + (w0 - w)
        if "n" in edge:
            h = max(MIN_SIZE[1], h0 - dy)
            y = y0 + (h0 - h)
        window.resize(w, h)
        window.move(x, y)

    def end_resize(self):
        self._resize = None

    # --- App ---
    def pick_activity(self):
        path = _first(window.create_file_dialog(webview.FileDialog.OPEN,
                                                file_types=("Activity files (*.gpx;*.fit)", "GPX (*.gpx)",
                                                            "FIT (*.fit)", "All files (*.*)")))
        if not path:
            return {"ok": False}
        try:
            return {"ok": True, "activity": activity.load_activity(path)}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def save_png(self, data_url):
        path = _first(window.create_file_dialog(webview.FileDialog.SAVE, save_filename="sessionstats.png",
                                                file_types=("PNG (*.png)",)))
        if not path:
            return {"ok": False}
        if not path.lower().endswith(".png"):
            path += ".png"
        try:
            with open(path, "wb") as fh:
                fh.write(base64.b64decode(data_url.split(",", 1)[1]))
        except OSError as exc:
            return {"ok": False, "error": str(exc)}
        return {"ok": True, "path": path}


def main():
    global window
    if not os.path.exists(UI_FILE):
        sys.exit(f"UI not found: {UI_FILE}")
    window = webview.create_window(
        APP_NAME, url=pathlib.Path(UI_FILE).as_uri(), js_api=Api(),
        width=1300, height=900, min_size=MIN_SIZE, background_color="#0c0b09",
        frameless=True, easy_drag=False)
    webview.start(http_server=False, icon=ICON_FILE if os.path.exists(ICON_FILE) else None)


if __name__ == "__main__":
    main()
