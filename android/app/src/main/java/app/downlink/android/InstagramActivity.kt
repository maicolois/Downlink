package app.downlink.android

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import android.webkit.*
import android.widget.*
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class InstagramActivity : Activity() {
    private lateinit var web: WebView
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.rgb(16, 20, 16)) }
        val hint = TextView(this).apply {
            text = "Inicia sesión en instagram.com. Después confirma para conectar esta cuenta a Downlink durante un máximo de 8 horas."
            setPadding(20, 16, 20, 8); setTextColor(Color.WHITE); textSize = 14f
        }
        root.addView(hint)
        val confirm = Button(this).apply { text = "Ya he iniciado sesión"; isAllCaps = false }
        root.addView(confirm)
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val uri = request.url
                    if (uri.scheme == "https" && DownloadOptions.isInstagram(uri.toString())) return false
                    if (request.isForMainFrame && uri.scheme in listOf("https", "http")) {
                        runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                    }
                    return true
                }
            }
        }
        root.addView(web, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom); insets
        }
        CookieManager.getInstance().removeAllCookies {
            if (!isFinishing) web.loadUrl("https://www.instagram.com/accounts/login/")
        }
        confirm.setOnClickListener {
            runCatching {
                InstagramSession.save(this, CookieManager.getInstance().getCookie("https://www.instagram.com").orEmpty())
            }.onSuccess {
                Toast.makeText(this, "Instagram conectado", Toast.LENGTH_SHORT).show(); finish()
            }.onFailure { Toast.makeText(this, it.message, Toast.LENGTH_LONG).show() }
        }
    }
    override fun onDestroy() {
        web.stopLoading()
        web.clearHistory()
        web.clearCache(true)
        web.destroy()
        CookieManager.getInstance().removeAllCookies(null)
        CookieManager.getInstance().flush()
        WebStorage.getInstance().deleteAllData()
        super.onDestroy()
    }
}
