/**
 * Service Worker — EVE Triage PWA
 * Handles push notifications for emergency/announcement alerts.
 * Keeps the app alive when backgrounded on iOS (home-screen PWA).
 */

const CACHE_NAME = 'eve-triage-v1';

// Assets to pre-cache for offline support
const PRE_CACHE = [
  '/',
  '/data/sounds/triage announcement.wav',
  '/data/sounds/General_start.wav',
  '/data/sounds/General_end.wav',
  '/data/sounds/message alert.wav',
  '/icon-192.svg',
  '/icon-512.svg',
];

// Install — pre-cache critical assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRE_CACHE))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network-first, fallback to cache (keeps working offline)
self.addEventListener('fetch', (event) => {
  // Skip non-GET and API/WebSocket requests
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/tts/') || url.pathname.startsWith('/inference/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Push — handle push notifications from the server
self.addEventListener('push', (event) => {
  let data = { title: '📢 Triage Alert', body: '', tag: 'eve-alert', urgent: false };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch { /* ignore parse errors */ }

  const options = {
    body: data.body,
    tag: data.tag,
    icon: '/icon-192.svg',
    badge: '/icon-192.svg',
    vibrate: data.urgent ? [300, 100, 300, 100, 600] : [200, 100, 200],
    requireInteraction: data.urgent,
    silent: false,
    data: { url: '/' },
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Notification click — focus or open the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing window if available
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      return self.clients.openWindow('/');
    })
  );
});
