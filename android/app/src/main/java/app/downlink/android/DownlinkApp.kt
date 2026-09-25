package app.downlink.android

import android.app.Application

class DownlinkApp : Application() {
    override fun onCreate() {
        super.onCreate()
        DownloadStore.init(this)
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        Thumbnails.trimMemory()
    }
}
