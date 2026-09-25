package app.downlink.android

import org.junit.Assert.*
import org.junit.Test

class DownloadOptionsTest {
    @Test fun extractsLinkFromSharedSocialText() {
        assertEquals("https://youtu.be/abc?t=3", DownloadOptions.extractUrl("Mira este vídeo https://youtu.be/abc?t=3\nCompartido desde YouTube"))
        assertEquals("https://www.instagram.com/stories/test.user/", DownloadOptions.extractUrl("@test.user"))
    }
    @Test fun rejectsNonWebInputsAndEmbeddedCredentials() {
        listOf("file:///etc/passwd", "javascript:alert(1)", "--exec command", "https://user:password@example.com/v", "https://", "not a link").forEach { assertNull(it, DownloadOptions.extractUrl(it)) }
    }
    @Test fun instagramSessionIsOnlyUsedForActualInstagramHosts() {
        assertTrue(DownloadOptions.isInstagram("https://www.instagram.com/p/abc/"))
        assertFalse(DownloadOptions.isInstagram("https://instagram.com.example.org/p/abc/"))
        assertFalse(DownloadOptions.isInstagram("https://example.org/instagram.com"))
    }
    @Test(expected = IllegalArgumentException::class) fun rejectsInvalidAudioQuality() {
        DownloadOptions("https://example.com/video.mp4", "mp3", "1080")
    }
    @Test(expected = IllegalArgumentException::class) fun rejectsCommandLikeQuality() {
        DownloadOptions("https://example.com/video.mp4", "mp4", "1080;touch /tmp/test")
    }
    @Test fun bitrateIsAnExplicitBitrateAndVideoHasARealContainerConversion() {
        val audio = DownloadOptions("https://example.com/video.mp4", "mp3", "320").arguments("/tmp/a.%(ext)s")
        assertEquals("320K", audio[audio.indexOf("--audio-quality") + 1])
        val video = DownloadOptions("https://example.com/video.mp4", "mp4", "720").arguments("/tmp/a.%(ext)s")
        assertTrue(video.contains("--recode-video"))
        assertTrue(video[video.indexOf("-f") + 1].contains("[height<=?720]"))
        assertTrue(video[video.indexOf("-f") + 1].contains("[width<=?720]"))
        assertEquals("/tmp/a.%(ext)s", video[video.indexOf("-o") + 1])
    }
    @Test fun storiesKeepTheirIdentityWhenCollectionOrderChanges() {
        val args = DownloadOptions("https://www.instagram.com/stories/test/", item = 2, videoId = "Story_B").arguments("/tmp/a.%(ext)s")
        assertFalse(args.contains("--playlist-items"))
        assertEquals("!is_live & id = 'Story_B'", args[args.indexOf("--match-filters") + 1])
        assertEquals("https://www.instagram.com/stories/test.user/", DownloadOptions.extractUrl("https://instagram.com/test.user/"))
    }
}
