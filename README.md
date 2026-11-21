# Alat Download YT by Sofy — Versi Vercel

Ini versi publik dari **Alat Download YT by Sofy** yang siap di-upload sendiri ke Vercel.
Di dalamnya sudah ada:

- `index.html` — halaman utama (converter, pencarian, QRIS Traktir Kopi, riwayat, statistik, FAQ)
- `assets/shark.webp` — maskot Sofy
- `assets/qris.png` — QRIS Traktir Kopi kamu
- `api/info.js`, `api/convert.js`, `api/search.js`, `api/suggest.js` — fungsi serverless Vercel yang menghubungi YouTube (Innertube) untuk ambil info & link download
- `api/_lib.js` — logika bersama (pilihan client cadangan, gabung format, cache 10 menit)
- `vercel.json` + `package.json` — konfigurasi Vercel (tanpa dependency tambahan)

## Bedanya dengan versi server sebelumnya

- **Riwayat & statistik sekarang tersimpan di browser pengunjung** (localStorage), bukan di database server. Jadi riwayat tiap orang hanya ada di HP/browser dia sendiri, dan akan hilang kalau cache browser dibersihkan.
- Download tetap sama: browser pengunjung mengunduh file **langsung dari server/CDN YouTube**. Mode MP3 mengunduh audio asli YouTube (biasanya M4A/AAC kualitas terbaik), bukan MP3 hasil transcode. Mode MP4 mengunduh MP4 yang sudah ada suaranya.
- Kadang YouTube menolak beberapa video dari IP datacenter (cek bot / perlu login). Kalau itu terjadi, pesan error di halaman akan menjelaskannya — coba lagi sebentar atau coba video lain.

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

- Jangan ubah nama folder `api` — Vercel otomatis menjadikannya endpoint `/api/info`, `/api/convert`, `/api/search`, `/api/suggest`.
- Kalau mau ganti QRIS / maskot, cukup timpa file di folder `assets/` dengan nama yang sama.
- Harap hanya mengunduh konten yang berhak kamu gunakan.
