# microWP — WordPress editorial dengan cache Worker + invalidasi pascakomit

Tanggal: 6 November 2026. Status: **E2E Workerd lokal PASS; belum diaktifkan di Cloudflare WordPress staging**.

## Tujuan

Mempertahankan **WordPress asli PHP-WASM di Durable Object**, bukan melakukan ekspor situs ke HTML statis. Cache berada sepenuhnya di Worker terpisah melalui Service Binding ke Durable Object cache internal, tanpa Redis eksternal, langganan, atau perubahan billing Cloudflare.

## Perubahan

1. `src/php/worker-cache-invalidation.ts` berisi kebijakan operasi tulis yang memerlukan flush (POST/PUT/PATCH/DELETE). Operasi baca GET/HEAD/OPTIONS, konfigurasi tanpa flag `MICROWP_WORKER_CACHE_ENABLED=yes`, dan tanpa binding selalu skip.
2. `src/index-durable.ts` memanggil `invalidatePublicCacheAfterCommit()` **setelah** snapshot WordPress tersimpan di D1 dan jurnal penghapusan R2 selesai. Hanya grup `microwp_public` yang dibersihkan; grup auth, users, posts internal, dan metadata lainnya tidak disentuh. Kegagalan RPC menghasilkan hasil `unavailable` dan warning, **tidak dipalsukan sebagai flush sukses**.
3. `wrangler.wp-cache-editorial-local.jsonc` adalah **konfigurasi lokal terpisah** dengan database placeholder `00000000-0000-4000-8000-000000000007`, bucket media lokal berbeda, WordPress D1 Durable Object, binding `REDIS_WORKER`, dan flag opt-in. `workers_dev:false`, tidak ada route publik, tidak memiliki `limits.cpu_ms`.
4. `src/probes/wp-cache-editorial-local.ts` menambahkan dua endpoint pengujian *loopback-only* dengan **key dan nilai tetap** untuk membuktikan hit→miss, bukan operasi cache arbitrer. Menggunakan runtime WordPress yang sama dengan staging untuk rute WordPress umum. **Tidak boleh di-deploy**.
5. `scripts/wp-cache-editorial-e2e.sh` menjalankan kedua Worker lewat Wrangler lokal, migrasi D1 dan R2 lokal, install WordPress 7.1.4, login, editorial REST, media, invalidasi, restart, pemeriksaan keberlanjutan data, dan jurnal. File autentikasi E2E dipisahkan di folder `.wrangler/` yang diabaikan Git.
6. `scripts/wp-cache-editorial-rest.ts` menguji kategori dibuat/diubah, artikel ditautkan ke kategori, judul situs diedit melalui authenticated REST API, lalu memverifikasi hasil segar dan persistensi setelah restart.
7. `scripts/wp-cache-editorial-invalidation.ts` menguji key publik benar-benar **hit sebelum** operasi tulis dan **miss sesudahnya**. Unit test menguji kegagalan RPC, ruang lingkup grup, dan gerbang opt-in.

## Hasil yang benar-benar teramati

| Test lokal Workerd | Hasil |
| --- | --- |
| WordPress installer dan login asli dengan cache aktif | PASS |
| REST buat/edit artikel | PASS |
| REST buat/edit kategori dan assign ke artikel | PASS |
| Ubah opsi publik `blogname` lewat REST, kemudian render HTML terbaru | PASS |
| Media PNG WordPress disimpan/diambil/dihapus via R2 lokal | PASS |
| Cache key tetap: seed → hit → POST editorial → miss | PASS |
| Cache key tetap: seed → edit kategori/opsi → miss | PASS |
| Cache key tetap: seed → POST media → miss | PASS |
| Setelah restart: sesi admin, artikel, relasi kategori, opsi judul dan R2 | PASS |
| Jurnal media delete D1 setelah operasi | 0 pending |
| Perbaikan regresi WordPress biasa tanpa opt-in | Masih memerlukan CI/regresi final |
| CPU/memori **Cloudflare Free asli**, bukan Workerd lokal | **Belum terbukti** |

Semua data E2E dibuat pada `.wrangler/wp-cache-editorial-e2e-state`; sumber daya Cloudflare staging dan Worker cache yang sudah di-deploy **tidak dimutasi**. Dua percobaan awal terhenti pada harness (redireksi stdout Windows, kemudian basename fixture, kemudian REST nonce setelah restart), diperbaiki dan diulang sampai **semua pemeriksaan sukses**. Itu bukan kegagalan WordPress PHP-WASM.

## Batasan produksi dan ketepatan data

- **Transient API masih blocker.** WordPress mengatur `wp_using_ext_object_cache(true)` saat drop-in aktif, sedangkan hanya grup `microwp_public` yang mempunyai persistensi antar-request. Akibatnya transient biasa mungkin tidak berperilaku sama dengan instalasi WordPress default. Jangan aktifkan staging sebelum kompatibilitas Transients API dibuktikan atau diperbaiki.
- Flush ini **best-effort**, bukan transaksi bersama D1+Worker cache. Jika Worker RPC gagal sesudah D1 commit, WordPress tetap mengembalikan hasil asli dan cache mungkin bertahan sampai TTL maksimum **300 detik**. Karena itu hanya key **immutable, revision-derived** yang sah untuk remote cache. Jangan cache public content dengan key mutable yang digunakan ulang. Pengukuran CPU tambahan diperlukan agar flush saat POST tidak memakan anggaran Free.
- WordPress sendiri **belum mengalihkan grup inti** seperti `posts`, `options`, `transient`, `users`, `auth` ke cache Worker. E2E membuktikan integritas dan mekanisme, **bukan peningkatan kecepatan WordPress dalam kondisi produksi**.
- Rute invalidasi hanya POST/PUT/PATCH/DELETE, tidak menjamin mencakup plugin yang secara buruk melakukan mutasi pada GET. Rute admin publik tetap tertutup.
- Belum ada benchmark CPU `cpuTime` asli Cloudflare pada invocation DO Free, tidak ada bukti peak isolate heap di bawah 128 MiB; status produksi tetap **NO-GO**. Canary sebelumnya masih memerlukan secret yang dipasang operator melalui jalur resmi (tidak boleh dibypass).
- Tidak ada cache eksternal/Upstash, Paid Workers, paid CPU limit, migrasi data remote, deploy Wordpress, atau pembukaan DNS.

## Cara menguji

```bash
bun run check
bun run wp-cache:editorial-build  # dry-run
bun run wp-cache:editorial-e2e    # Workerd lokal D1/R2 + cache Worker
bun run e2e:local                # WordPress lama tanpa cache
bun run staging:smoke            # staging public gate unchanged
```

Tahap berikut yang diperlukan **sebelum aktivasi**: buktikan/pulihkan Transients API across requests, test rollback dan kegagalan Service Binding, periksa semua hook term/post/options/plugin yang berpotensi menulis saat GET, dan lakukan real Cloudflare Free CPU/RAM measurement dengan secret canary resmi.
