# Alat Download YT by Sofy — Versi Vercel (Anti Bot-Check v2)

Versi perbaikan dari **Alat Download YT by Sofy** yang siap di-upload ke GitHub & Vercel tanpa coding lokal.

## Apa yang diperbaiki?

1. **Multi-Engine Fallback Otomatis (4 Jalur)**:
   - Sebelumnya aplikasi hanya menembak API YouTube (Innertube) langsung dari IP datacenter Vercel, sehingga YouTube sering memblokir dengan pesan *"cek bot / perlu login"*.
   - Sekarang backend (`api/_lib.js`) otomatis menjalankan beberapa jalur secara paralel & bergantian:
     1. **Piped API publik** (link stream sudah di-proxy, jadi tidak kena blokir IP Vercel)
     2. **YouTube Innertube + `visitorData` + Embedded Players** (`WEB_EMBEDDED_PLAYER`, `TVHTML5_SIMPLY_EMBEDDED_PLAYER`, `ANDROID_VR`, `IOS`, `ANDROID`, `MWEB`)
     3. **Cobalt API publik** (auto-detect instance aktif, hasil langsung MP3/MP4 tanpa IP-lock)
     4. **Invidious API publik** (cadangan terakhir)
2. **Konversi 1x Request (Lebih Cepat)**:
   - Sebelumnya frontend memanggil `/api/info` lalu `/api/convert` (2x proses penuh). Sekarang langsung 1x ke `/api/convert`, jauh lebih cepat dan tidak gampang timeout.
3. **Dukungan Opsional Environment Variable Vercel (100% Stabil)**:
   - Kalau suatu saat IP gratis Vercel sedang ketat diblokir YouTube, kamu bisa tambahkan salah satu env variable berikut di **Vercel → Settings → Environment Variables** lalu Redeploy:
     - `YT_COOKIES` — isi dengan cookie dari akun YouTube cadangan (untuk langsung lolos cek bot YouTube).
     - `COBALT_API_URL` — isi dengan URL server Cobalt pribadi (opsional juga `COBALT_API_KEY`).

## Cara update ke GitHub & Vercel (lewat browser, tanpa CLI)

1. Extract ZIP ini.
2. Buka repo GitHub kamu (`alat-download-yt-by-sofy`).
3. Klik **Add file → Upload files**, lalu drag semua isi folder hasil extract (`index.html`, `README.md`, `package.json`, `vercel.json`, folder `api`, dan folder `assets`) ke GitHub → **Commit changes**.
   - Pastikan `index.html` ada di root repo (bukan di dalam folder ganda).
4. Vercel akan otomatis build ulang dalam ±30 detik. Buka link `.vercel.app` kamu dan coba konversi lagi!
