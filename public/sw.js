// Build-stamped by vite.config.ts swBuildIdPlugin so every deploy ships a
// byte-different sw.js. Browsers detect the update, activate the new SW, fire
// `controllerchange`, and the main.tsx handler reloads the tab — including
// installed PWAs on iOS / Android / desktop.
const CACHE = 'salci-__BUILD_ID__';

// ── Lifecycle ──────────────────────────────────────────────────────────────────
self.addEventListener('install', () => {
  self.skipWaiting(); // activate immediately, don't wait for old tabs to close
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim()); // take control of existing open tabs
});

// ── Fetch strategy ─────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  // Cache-first for static assets (Vite hashes them so stale = impossible)
  if (event.request.destination === 'script' || event.request.destination === 'style') {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  }
  // Network-first for everything else (API calls, Supabase, etc.)
});

// ── Push notifications ─────────────────────────────────────────────────────────
self.addEventListener("push", function (event) {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "System Alert";

  const options = {
    body: data.body || "",
    icon: "/favicon.ico", // Add your actual logo path here later
    data: { url: "/" }, // The default URL to open when clicked
  };

  // Merge any extra options passed from the backend
  if (data.options) {
    Object.assign(options, data.options);
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close(); // Close the notification popup

  const urlToOpen = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      // Check if the portal is already open in a tab. If so, focus it.
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      // If no tab is open, open a brand new one.
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    }),
  );
});
