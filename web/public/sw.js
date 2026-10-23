// ReelForge app service worker. It doesn't cache your library (that always comes live from the
// server); it only shows a friendly page when the server can't be reached, and makes the app installable.
const OFFLINE = '/reelforge/offline';
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ReelForge</title><style>body{margin:0;min-height:100vh;display:grid;place-content:center;gap:12px;padding:24px;text-align:center;
background:#17202A;color:#E8EDF2;font:16px/1.5 system-ui,sans-serif}h1{font-size:24px;margin:0}p{color:#93A4B5;margin:0;max-width:34ch}
button{margin-top:8px;justify-self:center;padding:12px 22px;border:0;border-radius:8px;background:#FF8A1F;color:#17202A;font-weight:600;font-size:16px}</style></head>
<body><h1>Can’t reach your ReelForge server</h1><p>Check that this device is on your home network (or your VPN), and that the server computer is on.</p>
<button onclick="location.reload()">Try again</button></body></html>`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open('reelforge-v1').then((c) => c.put(OFFLINE, new Response(PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  // Only page loads; video, artwork and the API go straight to the server untouched.
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});
