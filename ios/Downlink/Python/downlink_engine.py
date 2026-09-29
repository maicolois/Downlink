"""In-process yt-dlp facade used by the native iOS application."""

from __future__ import annotations

import json
import os
import re
import time
import traceback
import urllib.parse

from downlink_ffmpeg import NativeFFmpeg, patch_ytdlp


AUDIO_QUALITIES = [
    {"value": "320", "label": "320 kbps", "detail": "Mejor"},
    {"value": "256", "label": "256 kbps", "detail": "Muy alta"},
    {"value": "224", "label": "224 kbps", "detail": "Alta"},
    {"value": "192", "label": "192 kbps", "detail": "Media alta"},
    {"value": "160", "label": "160 kbps", "detail": "Media"},
    {"value": "128", "label": "128 kbps", "detail": "Normal"},
    {"value": "96", "label": "96 kbps", "detail": "Media baja"},
    {"value": "80", "label": "80 kbps", "detail": "Baja"},
    {"value": "64", "label": "64 kbps", "detail": "Muy baja"},
    {"value": "48", "label": "48 kbps", "detail": "Peor"},
]

RESOLUTION_DETAILS = {
    4320: "8K", 2160: "4K", 1440: "2K", 1080: "Full HD", 720: "HD",
    480: "SD", 360: "SD", 240: "SD", 144: "SD",
}


def _platform(url):
    host = (urllib.parse.urlparse(url).hostname or "").lower().removeprefix("www.")
    if host == "youtu.be" or host == "youtube.com" or host.endswith(".youtube.com"):
        return "youtube"
    if host == "instagram.com" or host.endswith(".instagram.com"):
        return "instagram"
    if host in ("x.com", "twitter.com") or host.endswith((".x.com", ".twitter.com")):
        return "x"
    if host == "tiktok.com" or host.endswith(".tiktok.com"):
        return "tiktok"
    if host in ("reddit.com", "redditmedia.com", "redd.it") or host.endswith((".reddit.com", ".redditmedia.com")):
        return "reddit"
    if host == "twitch.tv" or host.endswith(".twitch.tv"):
        return "twitch"
    return host


def _base_options(cookie_text=""):
    options = {
        "quiet": True,
        "no_warnings": True,
        "cachedir": False,
        "socket_timeout": 20,
        "retries": 2,
        "extractor_retries": 2,
        "fragment_retries": 2,
        "ignoreconfig": True,
    }
    if cookie_text:
        options["cookiefile"] = _write_cookie_file(cookie_text)
    return options


def _write_cookie_file(cookie_text):
    import tempfile
    descriptor, path = tempfile.mkstemp(prefix="downlink-instagram-", suffix=".cookies.txt")
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        output.write(cookie_text)
    return path


def _remove_cookie_file(options):
    path = options.get("cookiefile")
    if path:
        try:
            os.unlink(path)
        except OSError:
            pass


def _thumbnail(info):
    direct = str(info.get("thumbnail") or "")
    if direct.startswith(("http://", "https://")):
        return direct
    for item in reversed(info.get("thumbnails") or []):
        candidate = str((item or {}).get("url") or "")
        if candidate.startswith(("http://", "https://")):
            return candidate
    return ""


def _duration_text(seconds):
    seconds = max(0, int(seconds or 0))
    hours, rest = divmod(seconds, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"


def _resolution(format_info):
    note = str(format_info.get("format_note") or "")
    noted = re.search(r"(?:^|\D)(\d{3,4})p(?:\D|$)", note, re.I)
    if noted:
        return int(noted.group(1))
    width = format_info.get("width")
    height = format_info.get("height")
    values = [int(value) for value in (width, height) if isinstance(value, (int, float)) and value > 0]
    return min(values) if values else None


def _video_qualities(info):
    resolutions = set()
    for format_info in info.get("formats") or []:
        if format_info.get("vcodec") in (None, "none"):
            continue
        resolution = _resolution(format_info)
        if resolution:
            standard = min(RESOLUTION_DETAILS, key=lambda item: abs(item - resolution))
            if abs(standard - resolution) / standard <= 0.08:
                resolution = standard
            resolutions.add(resolution)
    values = [{"value": "best", "label": "Mejor disponible", "detail": "Original"}]
    values.extend({
        "value": str(value),
        "label": f"{value}p",
        "detail": RESOLUTION_DETAILS.get(value, "2K" if value >= 1440 else "Full HD" if value >= 1080 else "HD" if value >= 720 else "SD"),
    } for value in sorted(resolutions, reverse=True))
    return values


def _has_audio(info):
    if info.get("acodec") not in (None, "none"):
        return True
    return any(item.get("acodec") not in (None, "none") for item in info.get("formats") or [])


def _has_video(info):
    if info.get("vcodec") not in (None, "none"):
        return True
    if any(item.get("vcodec") not in (None, "none") for item in info.get("formats") or []):
        return True
    return bool(info.get("url")) and str(info.get("ext") or "").lower() in {
        "flv", "m4v", "mkv", "mov", "mp4", "webm",
    }


def _media_item(info, index):
    duration = float(info.get("duration") or 0)
    return {
        "id": str(info.get("id") or f"item-{index}"),
        "playlistItem": int(info.get("playlist_index") or index),
        "title": str(info.get("title") or "Sin título"),
        "thumbnail": _thumbnail(info),
        "duration": duration,
        "durationString": _duration_text(duration),
        "channel": str(info.get("channel") or info.get("uploader") or "Desconocido"),
        "viewCount": int(info["view_count"]) if isinstance(info.get("view_count"), (int, float)) else None,
        "isLive": bool(info.get("is_live")),
        "hasAudio": _has_audio(info),
        "videoFormats": _video_qualities(info),
    }


def inspect_json(url, cookie_text=""):
    options = _base_options(cookie_text)
    platform = _platform(url)
    options.update({
        "skip_download": True,
        "noplaylist": platform != "instagram",
        "playlistend": 100,
        "extract_flat": False,
    })
    try:
        from yt_dlp import YoutubeDL
        with YoutubeDL(options) as ydl:
            info = ydl.extract_info(url, download=False)
        entries = [item for item in (info.get("entries") or []) if isinstance(item, dict)]
        source = entries or [info]
        videos = [
            _media_item(item, index)
            for index, item in enumerate(source, 1)
            if _has_video(item)
        ]
        if not videos:
            raise RuntimeError("No hay vídeos accesibles en este enlace.")
        payload = {
            "url": url,
            "platform": platform,
            "contentType": "instagram-story" if platform == "instagram" and "/stories/" in url else None,
            "videos": videos,
            "audioQualities": AUDIO_QUALITIES,
        }
        return json.dumps(payload, ensure_ascii=False)
    except Exception as error:
        return json.dumps({"error": _friendly_error(error)}, ensure_ascii=False)
    finally:
        _remove_cookie_file(options)


def _write_progress(path, stage, fraction, detail):
    if not path:
        return
    temporary = f"{path}.tmp"
    payload = {"stage": stage, "fraction": max(0.0, min(float(fraction), 1.0)), "detail": detail}
    with open(temporary, "w", encoding="utf-8") as output:
        json.dump(payload, output, ensure_ascii=False)
    os.replace(temporary, path)


def _format_selector(quality):
    if quality == "best":
        return "bv*+ba/b"
    return (
        f"bv*[height<=?{quality}]+ba/"
        f"bv*[width<=?{quality}]+ba/"
        f"b[height<=?{quality}]/b[width<=?{quality}]"
    )


def _download_match_filter(platform, selected_video_id):
    stable_id = str(selected_video_id or "")
    has_stable_id = bool(re.fullmatch(r"[A-Za-z0-9_-]{1,160}", stable_id)) and not stable_id.startswith("item-")

    def match_filter(info, *, incomplete=False):
        if info.get("is_live"):
            return "No se admiten emisiones en directo"
        if platform == "instagram" and has_stable_id and str(info.get("id") or "") != stable_id:
            return "Elemento de Instagram distinto al seleccionado"
        return None

    return match_filter, has_stable_id


def download_json(request_json, progress_path, cancellation_path):
    request = json.loads(request_json)
    os.makedirs(request["outputDirectory"], exist_ok=True)
    options = _base_options(request.get("cookieText") or "")
    native = NativeFFmpeg()
    _write_progress(progress_path, "starting", 0, "Iniciando preparación…")

    def progress_hook(status):
        if cancellation_path and os.path.exists(cancellation_path):
            raise KeyboardInterrupt("cancel requested")
        state = status.get("status")
        if state == "downloading":
            total = status.get("total_bytes") or status.get("total_bytes_estimate") or 0
            downloaded = status.get("downloaded_bytes") or 0
            fraction = downloaded / total if total else 0
            eta = status.get("eta")
            speed = status.get("speed")
            detail = f"{fraction * 100:.0f}%"
            if eta:
                detail += f" · {int(eta)} s restantes"
            elif speed:
                detail += f" · {speed / 1_000_000:.1f} MB/s"
            _write_progress(progress_path, "downloading", min(fraction, 0.98), detail)
        elif state == "finished":
            _write_progress(progress_path, "converting", 0.99, "Preparando el archivo final…")

    def postprocessor_hook(status):
        if status.get("status") == "started":
            name = status.get("postprocessor") or "FFmpeg"
            _write_progress(progress_path, "converting", 0.99, f"Procesando con {name}…")

    try:
        from yt_dlp import YoutubeDL
        format_name = request["format"]
        platform = _platform(request["url"])
        match_filter, has_stable_video_id = _download_match_filter(platform, request.get("videoID"))

        options.update({
            "outtmpl": os.path.join(request["outputDirectory"], "%(title).160B [%(id)s].%(ext)s"),
            "noplaylist": platform != "instagram",
            "match_filter": match_filter,
            "progress_hooks": [progress_hook],
            "postprocessor_hooks": [postprocessor_hook],
            "overwrites": False,
            "windowsfilenames": False,
            "restrictfilenames": False,
        })
        if platform == "instagram" and has_stable_video_id:
            options["playlistend"] = 100
        elif platform == "instagram":
            options["playlist_items"] = str(int(request.get("playlistItem") or 1))
        if format_name == "mp3":
            options.update({
                "format": "bestaudio/best",
                "postprocessors": [{
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": str(request["quality"]),
                }],
            })
            expected_extension = ".mp3"
        else:
            options.update({
                "format": _format_selector(str(request["quality"])),
                "format_sort": ["vcodec:h264", "acodec:aac"],
                "merge_output_format": "mp4",
                "postprocessors": [{"key": "FFmpegVideoConvertor", "preferedformat": "mp4"}],
            })
            expected_extension = ".mp4"

        with patch_ytdlp(native, cancellation_path) as check_cancelled:
            check_cancelled()
            with YoutubeDL(options) as ydl:
                code = ydl.download([request["url"]])
            check_cancelled()
        if code:
            raise RuntimeError(f"yt-dlp terminó con código {code}")

        candidates = []
        for name in os.listdir(request["outputDirectory"]):
            path = os.path.join(request["outputDirectory"], name)
            if os.path.isfile(path) and name.lower().endswith(expected_extension):
                candidates.append(path)
        if not candidates:
            raise RuntimeError(f"No se generó un archivo {format_name.upper()}.")
        result = max(candidates, key=os.path.getsize)
        _write_progress(progress_path, "finished", 1, "Descarga completada")
        return json.dumps({"ok": True, "path": result, "error": None}, ensure_ascii=False)
    except KeyboardInterrupt:
        _write_progress(progress_path, "cancelled", 0, "Descarga cancelada")
        return json.dumps({"ok": False, "path": None, "error": "Descarga cancelada"}, ensure_ascii=False)
    except Exception as error:
        traceback.print_exc()
        message = _friendly_error(error)
        _write_progress(progress_path, "failed", 0, message)
        return json.dumps({"ok": False, "path": None, "error": message}, ensure_ascii=False)
    finally:
        _remove_cookie_file(options)


def _friendly_error(error):
    raw = str(error).strip()
    lowered = raw.lower()
    if "sign in" in lowered or "login" in lowered or "cookies" in lowered:
        hint = "El sitio requiere una sesión. En Instagram, conecta tu cuenta desde el menú."
    elif "unsupported url" in lowered:
        hint = "Este enlace no está admitido. Comparte el enlace directo del vídeo o publicación."
    elif "requested format" in lowered:
        hint = "Esa calidad no está disponible. Prueba Mejor disponible."
    elif "timed out" in lowered or "network" in lowered or "resolve" in lowered:
        hint = "No se pudo conectar. Comprueba Internet e inténtalo de nuevo."
    elif "no space" in lowered or "enospc" in lowered:
        hint = "No queda espacio libre en el iPhone."
    else:
        hint = "No se pudo completar. Comprueba el enlace o actualiza el motor al recompilar."
    detail = next((line.strip() for line in reversed(raw.splitlines()) if line.strip()), "")
    return f"{hint}\n\n{detail[:500]}" if detail and detail != hint else hint
