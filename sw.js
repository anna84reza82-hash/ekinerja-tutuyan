// ekinerja-tutuyan service worker
// Perbaikan #9: sebelumnya hanya index.html & manifest.json yang di-cache, sehingga
//   saat offline, Tailwind/FontAwesome/Google Fonts/Firebase SDK (semua dari CDN)
//   gagal dimuat dan aplikasi tampil rusak total tanpa styling.
// Perbaikan #10: sebelumnya tidak ada versioning/cleanup, sehingga update kode
//   butuh 2x refresh dan cache lama menumpuk tanpa pernah dihapus.

const CACHE_VERSION = 'v3';
const CACHE_NAME = `ekinerja-tutuyan-${CACHE_VERSION}`;
const CACHE_PREFIX = 'ekinerja-tutuyan-';

// Aset inti aplikasi (same-origin, aman pakai cache.addAll biasa)
const CORE_ASSETS = [
  './',
  'index.html',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png'
];

// Aset eksternal (CDN) yang dipakai index.html — wajib di-cache agar tampilan &
// fungsi tetap utuh saat offline, bukan cuma data localStorage-nya saja.
const EXTERNAL_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-database-compat.js'
];

self.addEventListener('install', (e) => {
  // Aktifkan service worker baru secepatnya, tidak menunggu semua tab ditutup.
  self.skipWaiting();

  e.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Aset inti: sama origin, pakai addAll (gagal salah satu = gagal semua, itu OK
      // karena semuanya memang wajib ada).
      await cache.addAll(CORE_ASSETS);

      // Aset eksternal: banyak CDN tidak mengirim header CORS, jadi kalau dipaksa
      // pakai addAll (mode 'cors') satu saja gagal -> install SW gagal total.
      // Di sini tiap aset diambil terpisah dengan mode 'no-cors' (opaque response)
      // dan kegagalannya tidak menggagalkan aset lain.
      await Promise.all(
        EXTERNAL_ASSETS.map((url) =>
          fetch(url, { mode: 'no-cors' })
            .then((res) => cache.put(url, res))
            .catch((err) => console.warn('[SW] Gagal cache aset eksternal:', url, err))
        )
      );
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => {
              console.log('[SW] Menghapus cache lama:', key);
              return caches.delete(key);
            })
        )
      )
      .then(() => self.clients.claim()) // Ambil alih tab yang sudah terbuka tanpa perlu refresh
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;

  // Biarkan request non-GET (mis. ke Firebase) lewat jaringan langsung tanpa campur tangan SW.
  if (req.method !== 'GET') return;

  e.respondWith(
    caches.match(req).then((cachedRes) => {
      // Strategi stale-while-revalidate: kembalikan versi cache (kalau ada) secepat
      // mungkin, sambil tetap mengambil versi terbaru dari jaringan di latar belakang
      // untuk memperbarui cache — jadi app tetap dapat update tanpa mengorbankan
      // kecepatan/dukungan offline.
      const networkFetch = fetch(req)
        .then((networkRes) => {
          if (networkRes && (networkRes.ok || networkRes.type === 'opaque')) {
            const resClone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return networkRes;
        })
        .catch(() => undefined);

      if (cachedRes) {
        e.waitUntil(networkFetch);
        return cachedRes;
      }
      return networkFetch.then((res) => res || cachedRes);
    })
  );
});
