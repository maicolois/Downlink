# Android components

The Android implementation in this directory is provided under GPL-3.0; see [LICENSE](LICENSE). The pre-existing desktop files retain their original licensing status.

| Component | Version | License / corresponding source |
| --- | --- | --- |
| youtubedl-android | 0.18.1 | GPL-3.0, [source and build instructions](https://github.com/yausername/youtubedl-android/tree/0.18.1) |
| yt-dlp | 2026.08.19 bundled; optional stable updates | [Unlicense and bundled component notices](https://github.com/yt-dlp/yt-dlp/tree/2026.08.19) |
| FFmpeg Android package | Supplied by the wrapper's `ffmpeg:0.18.1` artifact | [FFmpeg sources](https://ffmpeg.org/download.html), [wrapper build instructions and package sources](https://github.com/yausername/youtubedl-android/blob/master/BUILD_FFMPEG.md); LGPL/GPL depending on compiled components |
| Python Android package | Supplied by `library:0.18.1` | [PSF license](https://docs.python.org/3/license.html), [wrapper build instructions and package sources](https://github.com/yausername/youtubedl-android/blob/master/BUILD_PYTHON.md) |
| QuickJS | Supplied by `library:0.18.1` | MIT, [source](https://bellard.org/quickjs/) |
| AndroidX | Versions pinned in app/build.gradle.kts and dependency metadata | Apache-2.0, [source](https://android.googlesource.com/platform/frameworks/support/) |
| Kotlin | 2.2.21 | Apache-2.0, [source](https://github.com/JetBrains/kotlin) |
| Jackson, Commons IO | Transitive dependencies of youtubedl-android | Apache-2.0, [Jackson](https://github.com/FasterXML/jackson), [Commons IO](https://github.com/apache/commons-io) |
| Gradle wrapper | 8.13 | Apache-2.0, [source](https://github.com/gradle/gradle/tree/v8.13.0) |

The test clip is an original three-second test pattern and sine tone generated with FFmpeg; it contains no third-party video. Regenerate it from the repository root:

```sh
ffmpeg -f lavfi -i 'testsrc2=size=320x180:rate=24' \
  -f lavfi -i 'sine=frequency=440:sample_rate=44100' -t 3 \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac \
  -movflags +faststart android/app/src/androidTest/assets/sample.mp4
```

Upstream Android runtime binaries are consumed unchanged from Maven Central. The yt-dlp executable is downloaded at build time from its official versioned GitHub release and checked against the pinned SHA-256 in `app/build.gradle.kts`. All app source required for this personal build is in this repository; `.signing`, SDKs, build outputs, and credentials are local files excluded from Git.
