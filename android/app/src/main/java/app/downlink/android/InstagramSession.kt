package app.downlink.android

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object InstagramSession {
    private const val ALIAS = "downlink-instagram"
    private fun file(context: Context) = File(context.noBackupFilesDir, "instagram-session.bin")
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    @Synchronized fun save(context: Context, cookies: String) {
        val accepted = parseCookies(cookies)
        require(!accepted["sessionid"].isNullOrBlank()) { "Todavía no hay una sesión de Instagram. Completa el inicio de sesión primero." }
        val payload = JSONObject().put("cookies", JSONObject(accepted as Map<*, *>))
            .put("expires", System.currentTimeMillis() + 8 * 60 * 60 * 1000L).toString().toByteArray()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        file(context).writeBytes(cipher.iv + cipher.doFinal(payload))
    }
    private fun read(context: Context): JSONObject? = runCatching {
        val data = file(context).readBytes()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, data.copyOfRange(0, 12))) }
        val json = JSONObject(String(cipher.doFinal(data.copyOfRange(12, data.size))))
        if (json.getLong("expires") <= System.currentTimeMillis()) { file(context).delete(); null } else json
    }.getOrNull()
    @Synchronized fun connected(context: Context) = read(context) != null
    @Synchronized fun clear(context: Context) { file(context).delete() }
    @Synchronized fun cookieFile(context: Context, url: String): File? {
        if (!DownloadOptions.isInstagram(url)) return null
        val session = read(context) ?: return null
        val cookies = session.getJSONObject("cookies")
        return File.createTempFile("instagram-", ".txt", context.cacheDir).apply {
            writeText(buildString {
                append("# Netscape HTTP Cookie File\n")
                cookies.keys().forEach { name ->
                    append(".instagram.com\tTRUE\t/\tTRUE\t${session.getLong("expires") / 1000}\t$name\t${cookies.getString(name)}\n")
                }
            })
        }
    }
    internal fun parseCookies(value: String): Map<String, String> = value.split(';').mapNotNull {
        val name = it.substringBefore('=').trim()
        val content = it.substringAfter('=', "").trim()
        if (name in setOf("sessionid", "csrftoken", "ds_user_id", "ig_did", "mid", "rur") && content.isNotBlank() && !content.any { c -> c == '\n' || c == '\r' || c == '\t' }) name to content else null
    }.toMap()
}
