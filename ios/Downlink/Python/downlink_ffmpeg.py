"""Small subprocess-compatible adapter from yt-dlp to the in-process Swift FFmpeg wrapper."""

from __future__ import annotations

import contextlib
import ctypes
import io
import json
import os
import shlex
import subprocess
import urllib.parse


class NativeFFmpeg:
    def __init__(self):
        executable = os.environ.get("DOWNLINK_EXECUTABLE_PATH") or None
        last_error = None
        for candidate in (None, executable):
            if candidate is None and last_error is not None:
                continue
            try:
                library = ctypes.CDLL(candidate)
                self._run = library.downlink_ffmpeg_bridge_run
                self._run.argtypes = [ctypes.c_char_p]
                self._run.restype = ctypes.c_void_p
                self._free = library.downlink_ffmpeg_bridge_free
                self._free.argtypes = [ctypes.c_void_p]
                self._free.restype = None
                return
            except Exception as error:
                last_error = error
        raise RuntimeError(f"No se pudo cargar el puente FFmpeg: {last_error}")

    def execute(self, tool, arguments):
        args = [self._normalize(value) for value in arguments]
        if tool == "ffmpeg":
            if "-nostdin" not in args:
                args.insert(0, "-nostdin")
            if "-loglevel" not in args:
                args[0:0] = ["-loglevel", "warning"]
        payload = json.dumps({"tool": tool, "args": args}).encode()
        pointer = self._run(payload)
        if not pointer:
            raise RuntimeError("FFmpeg no devolvió ninguna respuesta")
        try:
            response = json.loads(ctypes.string_at(pointer).decode("utf-8", "replace"))
        finally:
            self._free(pointer)
        if not response.get("executed") and not response.get("ok"):
            raise RuntimeError(response.get("error") or "FFmpeg no pudo iniciarse")
        return (
            int(response.get("exit_code", 1)),
            response.get("stdout") or "",
            response.get("stderr") or "",
        )

    @staticmethod
    def _normalize(value):
        text = str(value)
        if text.startswith("file:/"):
            return urllib.parse.unquote(text[5:])
        return text


def _command(args):
    values = [str(value) for value in args] if isinstance(args, (list, tuple)) else shlex.split(str(args))
    name = os.path.basename(values[0]).lower().removesuffix(".exe") if values else ""
    return name, values


@contextlib.contextmanager
def patch_ytdlp(native, cancellation_path):
    from yt_dlp import YoutubeDL
    from yt_dlp.downloader.common import FileDownloader
    import yt_dlp.downloader.external as external
    import yt_dlp.postprocessor.ffmpeg as ffmpeg_pp
    import yt_dlp.utils as public_utils
    import yt_dlp.utils._utils as private_utils

    original = {
        "screen": YoutubeDL.to_screen,
        "progress": FileDownloader.report_progress,
        "public": getattr(public_utils, "Popen", None),
        "private": private_utils.Popen,
        "external": getattr(external, "Popen", None),
        "ffmpeg": getattr(ffmpeg_pp, "Popen", None),
    }

    def check_cancelled():
        if cancellation_path and os.path.exists(cancellation_path):
            raise KeyboardInterrupt("cancel requested")

    class BridgePopen:
        def __init__(self, args, *remaining, **kwargs):
            name, command = _command(args)
            self.args = args
            self.returncode = None
            self.stdout = None
            self.stderr = None
            self._delegate = None
            self._stdout = None
            self._stderr = None
            if name not in ("ffmpeg", "ffprobe"):
                self._delegate = original["private"](args, *remaining, **kwargs)
                return

            check_cancelled()
            code, stdout, stderr = native.execute(name, command[1:])
            check_cancelled()
            text_mode = bool(kwargs.get("text") or kwargs.get("universal_newlines"))
            encoding = kwargs.get("encoding") or "utf-8"
            self.returncode = code
            self._stdout = stdout if text_mode else stdout.encode(encoding, "replace")
            self._stderr = stderr if text_mode else stderr.encode(encoding, "replace")
            if kwargs.get("stderr") == subprocess.STDOUT:
                self._stdout += self._stderr
                self._stderr = None
            if kwargs.get("stdout") == subprocess.PIPE:
                self.stdout = io.StringIO(self._stdout) if text_mode else io.BytesIO(self._stdout)
            if kwargs.get("stderr") == subprocess.PIPE and self._stderr is not None:
                self.stderr = io.StringIO(self._stderr) if text_mode else io.BytesIO(self._stderr)

        @classmethod
        def run(cls, *args, **kwargs):
            input_value = kwargs.pop("input", None)
            with cls(*args, **kwargs) as process:
                stdout, stderr = process.communicate(input_value)
                return stdout, stderr, process.wait()

        def communicate(self, input=None, timeout=None):
            if self._delegate:
                return self._delegate.communicate(input=input, timeout=timeout)
            return self._stdout, self._stderr

        def wait(self, timeout=None):
            return self._delegate.wait(timeout=timeout) if self._delegate else self.returncode

        def poll(self):
            return self._delegate.poll() if self._delegate else self.returncode

        def kill(self):
            return self._delegate.kill() if self._delegate else None

        def terminate(self):
            return self._delegate.terminate() if self._delegate else None

        def send_signal(self, signal):
            return self._delegate.send_signal(signal) if self._delegate else None

        def __enter__(self):
            if self._delegate:
                self._delegate.__enter__()
            return self

        def __exit__(self, exc_type, exc, traceback):
            return self._delegate.__exit__(exc_type, exc, traceback) if self._delegate else False

        def __getattr__(self, name):
            if self._delegate:
                return getattr(self._delegate, name)
            raise AttributeError(name)

    def checked_screen(instance, message, *args, **kwargs):
        check_cancelled()
        return original["screen"](instance, message, *args, **kwargs)

    def checked_progress(instance, status):
        check_cancelled()
        return original["progress"](instance, status)

    YoutubeDL.to_screen = checked_screen
    FileDownloader.report_progress = checked_progress
    private_utils.Popen = BridgePopen
    if original["public"] is not None:
        public_utils.Popen = BridgePopen
    if original["external"] is not None:
        external.Popen = BridgePopen
    if original["ffmpeg"] is not None:
        ffmpeg_pp.Popen = BridgePopen
    try:
        yield check_cancelled
    finally:
        YoutubeDL.to_screen = original["screen"]
        FileDownloader.report_progress = original["progress"]
        private_utils.Popen = original["private"]
        if original["public"] is not None:
            public_utils.Popen = original["public"]
        if original["external"] is not None:
            external.Popen = original["external"]
        if original["ffmpeg"] is not None:
            ffmpeg_pp.Popen = original["ffmpeg"]
