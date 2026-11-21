# Alat Download YT by Sofy — Versi Vercel

Ini versi publik dari **Alat Download YT by Sofy** yang siap di-upload sendiri ke Vercel.
Di dalamnya sudah ada:

- `index.html` — halaman utama (converter, pencarian, QRIS Traktir Kopi, riwayat, statistik, FAQ)
- `assets/doraemon.png` — logo Doraemon
- `assets/qris.png` — QRIS Traktir Kopi kamu
- `api/info.js`, `api/convert.js`, `api/search.js`, `api/suggest.js` — fungsi serverless Vercel yang menghubungi YouTube (Innertube) untuk ambil info video & menyiapkan konversi
- `api/download.js` — **(baru)** endpoint download lewat server: file diambil dulu dari YouTube oleh server, baru diunduh pengunjung dari server
- `api/_lib.js` — logika bersama (perbaikan anti cek bot: 9 versi client cadangan — ANDROID_VR / ANDROID / IOS / VISIONOS — gabung format dari semua client yang berhasil termasuk varian per-client-nya, cache 10 menit, dan 3x percobaan dengan jeda bertingkat)
- `vercel.json` + `package.json` — konfigurasi Vercel (tanpa dependency tambahan)

## Perbaikan download lewat server (yang baru di ZIP ini)

Sebelumnya tombol Unduh membuka link mentah dari CDN YouTube (googlevideo). Link itu **terikat ke IP server** yang mengambilnya, jadi pas dibuka dari HP pengunjung sering ditolak YouTube — konversinya berhasil, tapi download-nya gagal. Sekarang alurnya seperti yt-dlp: **server mengambil file-nya dulu, baru pengunjung mengunduh dari server**.

- `api/convert.js` sekarang mengembalikan alamat unduh `/api/download?...` milik situs ini sendiri, bukan link googlevideo mentah.
- `api/download.js` mengunduh file dari YouTube per potongan 1 MB (Range) secara berurutan, mencoba satu per satu varian format dari tiap client (varian ANDROID_VR yang link-nya mati dilewati ke varian ANDROID, dst.), dan meneruskannya ke pengunjung sebagai file unduhan bernama sesuai judul video. Kalau semua varian dari pengambilan pertama ditolak, video diambil ulang dengan penelusuran semua client untuk link bertanda tangan yang baru, lalu dicoba lagi.
- Kalau server tetap ditolak YouTube (kasus yang diketahui: audio adaptif kadang hanya diberi potongan pertama oleh sistem SABR YouTube ke IP datacenter), halaman otomatis fallback: browser pengunjung mengunduh sendiri link aslinya per potongan — koneksi rumahan diperlakukan YouTube sebagai client normal.
- Riwayat lama yang masih menyimpan link googlevideo mentah otomatis dialihkan ke jalur server pas tombol "Unduh lagi" diketuk.

Catatan jujur soal batasnya: fungsi serverless Vercel punya batas waktu jalan (diatur 60 detik di `vercel.json`), jadi video yang sangat panjang/besar bisa kehabisan waktu di tengah unduhan — untuk itu ada batas ukuran sekitar 250 MB. Mode MP3 tetap mengunduh audio asli YouTube (biasanya M4A/AAC kualitas terbaik), bukan MP3 hasil transcode, dan mode MP4 memakai MP4 yang sudah ada suaranya (tanpa proses gabung ffmpeg, karena ffmpeg tidak bisa jalan di serverless Vercel).

## Bedanya dengan versi server sebelumnya

- **Riwayat & statistik sekarang tersimpan di browser pengunjung** (localStorage), bukan di database server. Jadi riwayat tiap orang hanya ada di HP/browser dia sendiri, dan akan hilang kalau cache browser dibersihkan.
- Kadang YouTube tetap menolak beberapa video dari IP datacenter (cek bot / perlu login) walaupun sudah dicoba lewat 9 versi client dan 3x percobaan. Kalau itu terjadi, pesan error di halaman akan menjelaskannya — coba lagi sebentar atau coba video lain. Perbaikan ini mengurangi video yang gagal, tapi tidak bisa menjamin 100% lolos karena cek bot-nya dari sisi YouTube/IP Vercel.

## Cara upload ke Vercel (paling gampang — lewat GitHub)

1. Extract ZIP ini.
2. Buka github.com → **New repository** → beri nama misalnya `alat-download-yt-by-sofy` → Create.
3. Di repo itu klik **uploading an existing file**, lalu drag semua isi folder hasil extract (termasuk folder `api` dan `assets`) → Commit.
   - Pastikan `index.html` ada di paling luar (root repo), bukan di dalam folder ganda.
4. Buka vercel.com → login dengan GitHub → **Add New → Project** → pilih repo tadi → **Deploy**.
   - Framework Preset: **Other**. Root Directory: `./` (default). Tidak perlu build command / env variable.
5. Tunggu deploy selesai → klik link `*.vercel.app` yang diberikan Vercel. Itu link publiknya, bisa dibagikan ke siapa saja.

## Cara alternatif — Vercel CLI (tanpa GitHub)

1. Install Node.js, lalu di terminal: `npm i -g vercel`
2. Masuk ke folder hasil extract: `cd alat-download-yt-by-sofy`
3. Jalankan: `vercel --prod` dan ikuti pertanyaannya (login sekali).

## Cara test lokal (opsional)

```
npm i -g vercel
vercel dev
```
Lalu buka alamat lokal yang ditampilkan.

## Catatan

- Jangan ubah nama folder `api` — Vercel otomatis menjadikannya endpoint `/api/info`, `/api/convert`, `/api/download`, `/api/search`, `/api/suggest`.
- Kalau mau ganti QRIS / logo, cukup timpa file di folder `assets/` dengan nama yang sama.
- Harap hanya mengunduh konten yang berhak kamu gunakan.
