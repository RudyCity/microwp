# microWP: riset WordPress asli di Cloudflare Workers Free (tanpa static export)
Tanggal: 2026-11-06

Status: **research and validation plan, not production implementation**

Repo: `G:\project\microWP`, branch `main`

## Keputusan produk yang harus dipertahankan

**Tujuan:** WordPress 7.1.4, PHP 8.4.x, wp-admin, tema/plugin, PHP dinamis, URL WordPress, D1 sebagai database utama, dan R2 untuk `wp-content/` benar-benar dieksekusi di **Cloudflare Workers / SQLite-backed Durable Objects** pada **paket Free**. **Bukan** konversi menjadi HTML statis, bukan PHP yang dijalankan di browser WordPress Playground, dan bukan backend PHP berbayar/VM.

Kode `src/free-site/` dari eksperimen terdahulu bukan solusi yang dipilih pengguna. Jangan mengaktifkan mode itu, mengganti `src/index-durable.ts`, membuat rute publik, atau menghapusnya tanpa persetujuan tersendiri. Fitur statis boleh dipakai untuk asset caching; rendering halaman tetap harus memakai PHP WordPress server-side.

## Fakta terbukti / diverifikasi

1. Cloudflare Workers **Free CPU 10 ms per HTTP request**; memori per isolate **128 MB**; 100.000 Worker requests/hari. CPU berbeda dari wall-clock. Free juga memiliki 50 subrequest eksternal dan 1000 subrequest internal per invocation. Dokumentasi: https://developers.cloudflare.com/workers/platform/limits/ ; https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/.
2. Cloudflare mendukung WebAssembly dan SIMD, tetapi **tidak mendukung multithreading di Workers**, sehingga menjalankan PHP di banyak thread dalam satu isolate bukan jalan keluar. https://developers.cloudflare.com/workers/runtime-apis/webassembly/.
3. microWP: PHP 8.4.27 + PDO SQLite canary *real Cloudflare* sudah pernah berhasil dengan **~8 ms CPU**. WordPress installer pada canary real Cloudflare gagal HTTP 503 `exceededCpu` dengan **~2.010 ms CPU**. Artinya ada gap sekitar **201×** dibanding batas Free; wall-clock lokal 3.216 ms cold / 1.522 ms warm **bukan** metrik CPU Cloudflare. Sumber proyek: `docs/reports/2026-11-05-cloudflare-private-runtime-canary.md` dan `docs/reports/2026-11-06-microwp-wordpress-cpu-path.md`.
**Nuansa yang sangat penting dari audit kode:** pada `src/index-durable.ts`, rute diagnostik privat `scope=wordpress` langsung memanggil `runNativeStagingProbe(env,scope)` di **Worker ingress**, *sebelum* pemanggilan `env.SITE_DO.get(id).fetch(request)`. Dengan demikian bukti `exceededCpu` sekitar 2.010 ms tadi adalah bukti kegagalan **PHP WordPress di Worker ingress**, **bukan** pengujian batas CPU untuk **invocation Durable Object**. Ini menjadikan pengujian terisolasi DO Free sebagai prioritas mutlak, bukan alasan untuk mengganti WordPress dengan HTML statis.

4. Runtime sekarang memakai PHP-WASM **Asyncify**. Dependency terpasang menyediakan varian yang sama-sama PHP 8.4.27: `@php-wasm/web-8-4/asyncify/8_4_27/php_8_4.wasm` **19.981.537 byte** dan `@php-wasm/web-8-4/jspi/8_4_27/php_8_4.wasm` **19.973.377 byte**. Varian JSPI **belum pernah diuji** dengan WordPress microWP di Cloudflare. Emscripten mendokumentasikan overhead Asyncify: https://emscripten.org/docs/porting/asyncify.html . Cloudflare telah memvalidasi JSPI untuk workload Emscripten/Rust di Workers tetapi bukan pembuktian PHP microWP: https://blog.cloudflare.com/rust-workers-emscripten-target/.
5. WordPress Playground resmi melaporkan **OpCache** mengurangi rata-rata waktu respons dalam *lingkungan mereka* 185 ms → 108 ms (42%). Hasil ini tidak otomatis berlaku untuk WordPress PHP-WASM di Cloudflare, tetapi merupakan jalur optimasi nyata untuk diuji; 42% bukan pengurangan 201×. https://make.wordpress.org/playground/2025/12/03/wordpress-playground-2025-year-in-review/.
6. WordPress Playground menjalankan PHP di **browser**, sehingga meskipun WordPress tampak berfungsi pada hosting Cloudflare Static Assets, hal itu **tidak** memenuhi syarat *PHP berjalan pada Cloudflare Worker server-side*. https://developer.wordpress.org/playground/developers/architecture/browser-concepts/.
7. **D1 query-level native** masih belum berfungsi sebagai `wpdb` lengkap; kode `src/php/d1-wpdb/db.php` adalah pembuktian SELECT terbatas dan **tidak aktif**. Isu upstream terkait dukungan D1 pada plugin SQLite WordPress masih terbuka pada saat riset: https://github.com/WordPress/sqlite-database-integration/issues/288 . Jangan menganggap SQLite snapshot BLOB pada D1 sama dengan native D1 query.
8. Penelitian pihak ketiga `Automattic/wp-codebox` (#1838) telah memindahkan PHP-WASM, ZIP WordPress, dan SQLite seed ke Cloudflare, namun full WordPress bootstrap masih menghasilkan 1102; kasus mereka bahkan melaporkan kegagalan setelah menaikkan batas CPU di lingkungan **Paid**, sehingga batas **memori/isolasi** juga perlu diteliti, bukan CPU saja. Itu laporan proyek lain, bukan hasil microWP: https://github.com/Automattic/wp-codebox/issues/1838 .

## Penemuan terpenting: ambiguitas kuota CPU Durable Object Free

Cloudflare Durable Objects tersedia pada paket Free bila memakai SQLite-backed storage: https://developers.cloudflare.com/durable-objects/platform/pricing/.

Dokumentasi DO terbaru pada https://developers.cloudflare.com/durable-objects/platform/limits/ secara eksplisit menuliskan **CPU per request = 30 detik default** dan mencantumkan bahwa tiap request DO mengatur ulang budget 30 detik. **Tetapi** halaman yang sama menyatakan DO adalah Worker dan tunduk pada batas sesuai paket Workers, sementara halaman Workers Free menyatakan **10 ms/request**.

Ini **kontradiksi/ketidakjelasan dokumentasi** yang tidak boleh diperlakukan sebagai jaminan gratis 30 detik. **Prioritas #1 adalah canary khusus di akun Free** yang membandingkan CPU nyata Worker ingress dengan CPU DO saat menjalankan tugas **murni JS kecil yang dibatasi**—misalnya kelompok 2, 8, 15, 30, dan 80 ms target CPU—menggunakan logs `cpuTime`, `wallTime`, dan `outcome`. Jangan gunakan `Date.now()` atau `performance.now()` di dalam loop sebagai jam CPU karena Clock Worker bisa membeku selama eksekusi tanpa I/O. Gunakan workload deterministik lokal-terkalibrasi dan klasifikasikan hasil dari trace runtime. Hindari loop tak terbatas, CPU besar, konten pengguna, dan perubahan billing. Canary harus terlindung token, hanya pada staging terpisah, dan **tidak otomatis mengaktifkan WordPress**.

Jika pengujian membuktikan **DO Free benar-benar mendapatkan budget yang memadai**, jalur utama yang patut dicoba adalah:

```
Incoming request
  -> minimal Worker router (<10ms CPU) [no PHP]
  -> SQLite-backed Durable Object (single-writer)
        -> WordPress PHP-WASM server-side (persistent/warm runtime)
        -> direct D1 wpdb adapter / native SQL
        -> R2 wp-content uploads and guarded static media
  -> WordPress-generated response (not pre-rendered export)
```

Akan tetapi, **128 MB isolate**, lifecycle (eviction/restart), PHP state, DB integrity, dan real WordPress wp-admin/REST tetap harus lulus. Jika DO Free tetap 10 ms, arsitektur ini belum layak sebagai WordPress server-side penuh tanpa penelitian lanjutan.

## Kandidat teknis, urutan pengujian

| Urutan | Eksperimen spesifik | Syarat sukses | Status |
| --- | --- | --- | --- |
| P0 | **Real Cloudflare DO Free CPU canary** dengan request protected, tanpa WordPress | Bukti trace eksplisit budget riil DO dan Worker Free; tidak melebihi kuota | BELUM |
| P1 | PHP-WASM phase probes di DO: wasm init; ZIP mount; config; `wp-load.php`; installer; REST; admin | `outcome=ok`, CPU/Wall tiap fase, bukan angka dari local Workerd saja | BELUM |
| P2 | **JSPI vs Asyncify** menggunakan paket PHP 8.4.27 yang sudah ada | PHP+PDO+async D1 message parity, CPU trace nyata, no regressions | BELUM |
| P3 | **OpCache / persistent PHP** dan kode WordPress warm, cache config dan drop-in tanpa mendisable sistem keamanan | Cold/warm CPU dan peak WASM memory menurun signifikan; tidak bocor state antar request | BELUM |
| P4 | **Native D1 `wpdb` lengkap** via bounded PHP↔JS SQL protocol (not REST public route) | Install/login/create/edit/media/plugin/transaction/DDL and rollback parity | BELUM |
| P5 | **R2 wp-content** dan recovery, security/memory/quotas, independent tests | E2E real Cloudflare Free, memory <128MB, no stale/missing data | BELUM |

### Pengujian P1 harus membedakan lima jenis masalah

- CPU instruksi interpreter PHP vs CPU kode WordPress/PDO (mis. instrumen per include dari PHP dan trace Cloudflare).
- JS heap + PHP Wasm linear memory + ZIP/mount; `WebAssembly.Memory.buffer.byteLength` hanyalah **satu komponen**, bukan ukuran peak isolate total.
- Cold start vs reused singleton PHP; setiap permintaan `php.run()` saat ini tetap menjalankan entrypoint WordPress lagi, bukan otomatis persist bootstrap PHP.
- Biaya I/O D1/R2 (wall-clock vs CPU), termasuk iterasi SELECT dan batas subrequests.
- 1102 dari **CPU vs memori**; selalu korelasikan invocation outcome/trace Cloudflare dengan fase terakhir sebelum crash.

### Mengapa hack sederhana tidak cukup

- Menambahkan `await`, `setTimeout`, `scheduler.wait()`, D1, atau R2 tidak mengurangi total **CPU aktif** WordPress; hanya menambah/menyebar wall time. Timer CPU tidak reset begitu saja setelah sebuah `await`.
- Membagi WordPress bootstrap ke banyak Worker request memerlukan **checkpoint/continuation interpreter PHP** yang benar-benar resumable beserta state yang aman dari crash. Menyimpan wasm memori mentah tidak menyimpan JS host closures, stack/async state dan hasil I/O secara lengkap.
- Mengurangi 0.7 ms ZIP index atau kompresi binary tidak menghapus lebih dari 2000 ms CPU eksekusi WordPress.
- Menonaktifkan plugin/theme dan menjadikan Worker sebagai renderer JavaScript bukan lagi kompatibilitas WordPress penuh. Jangan mengklaim plugin ecosystem kompatibel jika melewati hooks.

## Kebijakan dan gerbang keputusan

**Tidak boleh:** beralih ke HTML statis sebagai produk utama, WordPress yang hanya jalan dalam browser, paket Cloudflare Paid, VM/VPS berbayar, meningkatkan billing, membuka `wp-admin` sebelum keamanan lulus, atau migrasi DB data pengguna tanpa backup terverifikasi.

**GO riset lanjut** hanya dengan CPU/memori **real Free Cloudflare** dan PHP WordPress yang benar-benar dijalankan di **Worker/DO**, lalu wpdb E2E. **Production tetap NO-GO** sampai tes asli membuktikannya.

Urutan tindakan berikut yang paling bernilai: (1) isolated Free DO vs Worker CPU probe; (2) JSPI compatibility + PHP-only probes; (3) wp-load/init memory breakdown; (4) OpCache persistent PHP; (5) native wpdb D1 integration. Riset yang ada mengidentifikasi eksperimen; ia **tidak** membuktikan kelayakan yang belum diuji.

## Implemented research canary update — 2026-11-06

A standalone token-gated Cloudflare Worker + SQLite-backed Durable Object has been developed and deployed **without paid-limit settings**. Its ingress only authenticates and forwards, while `MicroWPFreeCpuDO.fetch()` directly executes fixed PHP-WASM and actual WordPress installer probes. Local Workerd returned HTTP 200 for all three CPU, PHP and WordPress modes. The remote Worker `microwp-free-do-cpu-probe` currently returns HTTP 404 to unauthenticated requests; the private secret provisioning step was blocked and **no remote CPU invocation evidence has been collected**. See `docs/reports/2026-11-06-microwp-free-do-canary-development.md`.

**The 30-second default Durable Object CPU figure is still a hypothesis for actual Free account invocation until observed in Cloudflare runtime logs; it is not a production gate that has passed.**
