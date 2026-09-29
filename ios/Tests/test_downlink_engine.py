import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


PYTHON_DIR = pathlib.Path(__file__).resolve().parents[1] / "Downlink" / "Python"
sys.path.insert(0, str(PYTHON_DIR))

import downlink_engine as engine
from downlink_ffmpeg import patch_ytdlp


class DownlinkEngineTests(unittest.TestCase):
    def test_platform_detection(self):
        self.assertEqual(engine._platform("https://youtu.be/abc"), "youtube")
        self.assertEqual(engine._platform("https://www.instagram.com/reel/abc/"), "instagram")
        self.assertEqual(engine._platform("https://x.com/user/status/1"), "x")
        self.assertEqual(engine._platform("https://m.youtube.com/watch?v=abc"), "youtube")
        self.assertEqual(engine._platform("https://m.instagram.com/stories/example/"), "instagram")
        self.assertEqual(engine._platform("https://vm.tiktok.com/abc/"), "tiktok")
        self.assertEqual(engine._platform("https://old.reddit.com/comments/abc"), "reddit")
        self.assertEqual(engine._platform("https://player.twitch.tv/?video=v1"), "twitch")

    def test_duration_text(self):
        self.assertEqual(engine._duration_text(65), "1:05")
        self.assertEqual(engine._duration_text(3661), "1:01:01")

    def test_quality_normalization_handles_portrait_video(self):
        info = {
            "formats": [
                {"vcodec": "h264", "width": 1080, "height": 1920},
                {"vcodec": "h264", "width": 1280, "height": 720},
                {"vcodec": "none", "width": None, "height": None},
            ]
        }
        values = [quality["value"] for quality in engine._video_qualities(info)]
        self.assertEqual(values, ["best", "1080", "720"])

    def test_format_selector_limits_both_orientations(self):
        selector = engine._format_selector("1080")
        self.assertIn("height<=?1080", selector)
        self.assertIn("width<=?1080", selector)
        self.assertEqual(engine._format_selector("best"), "bv*+ba/b")

    def test_instagram_selection_uses_stable_video_id(self):
        match_filter, stable = engine._download_match_filter("instagram", "selected_123")
        self.assertTrue(stable)
        self.assertIsNone(match_filter({"id": "selected_123"}))
        self.assertIn("distinto", match_filter({"id": "another_456"}))
        self.assertIn("directo", match_filter({"id": "selected_123", "is_live": True}))

    def test_media_item_matches_native_contract(self):
        item = engine._media_item({
            "id": "abc",
            "title": "Demo",
            "channel": "Canal",
            "duration": 62,
            "view_count": 100,
            "formats": [{"vcodec": "h264", "acodec": "aac", "width": 1920, "height": 1080}],
        }, 1)
        self.assertEqual(item["durationString"], "1:02")
        self.assertEqual(item["videoFormats"][1]["label"], "1080p")
        self.assertTrue(item["hasAudio"])

    def test_video_detection_excludes_image_only_carousel_items(self):
        self.assertFalse(engine._has_video({"id": "photo", "ext": "jpg", "url": "https://example/photo.jpg"}))
        self.assertTrue(engine._has_video({"id": "direct", "ext": "mp4", "url": "https://example/video.mp4"}))
        self.assertTrue(engine._has_video({
            "id": "formats",
            "formats": [{"vcodec": "h264", "acodec": "none"}],
        }))

    def test_progress_file_is_atomic_json(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "progress.json"
            engine._write_progress(str(path), "downloading", 0.42, "42%")
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["fraction"], 0.42)

    def test_ffmpeg_subprocess_adapter_matches_ytdlp_contract(self):
        try:
            import yt_dlp.utils._utils as ytdlp_utils
        except ImportError:
            self.skipTest("yt-dlp se instala durante Scripts/bootstrap.sh")

        original = ytdlp_utils.Popen

        class FakeNative:
            def execute(self, tool, arguments):
                self.tool = tool
                self.arguments = arguments
                return 0, "ffmpeg version test\n", ""

        native = FakeNative()
        with tempfile.TemporaryDirectory() as directory:
            cancel_path = str(pathlib.Path(directory) / "cancel")
            with patch_ytdlp(native, cancel_path):
                stdout, stderr, code = ytdlp_utils.Popen.run(
                    ["ffmpeg", "-version"],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                )
                self.assertEqual(code, 0)
                self.assertEqual(stdout, b"ffmpeg version test\n")
                self.assertEqual(stderr, b"")
                self.assertEqual(native.tool, "ffmpeg")
                self.assertEqual(native.arguments, ["-version"])

        self.assertIs(ytdlp_utils.Popen, original)

    def test_preflight_cancellation_stops_before_network_access(self):
        try:
            import yt_dlp  # noqa: F401
        except ImportError:
            self.skipTest("yt-dlp se instala durante Scripts/bootstrap.sh")

        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            cancel = root / "cancel"
            cancel.write_text("", encoding="utf-8")
            request = {
                "url": "https://www.youtube.com/watch?v=jNQXAC9IVRw",
                "format": "mp4",
                "quality": "144",
                "playlistItem": 1,
                "videoID": "jNQXAC9IVRw",
                "outputDirectory": str(root / "output"),
                "cookieText": "",
            }
            with mock.patch.object(engine, "NativeFFmpeg", return_value=object()):
                response = json.loads(engine.download_json(
                    json.dumps(request), str(root / "progress.json"), str(cancel)
                ))
            progress = json.loads((root / "progress.json").read_text(encoding="utf-8"))
            self.assertFalse(response["ok"])
            self.assertEqual(response["error"], "Descarga cancelada")
            self.assertEqual(progress["stage"], "cancelled")


if __name__ == "__main__":
    unittest.main()
