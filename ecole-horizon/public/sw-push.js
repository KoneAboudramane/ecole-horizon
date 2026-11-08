// Alertes sur le téléphone (Web Push) : affiche les notifications de l'école, même application fermée.
// Ce fichier ne met rien en cache : l'application se charge toujours normalement depuis le réseau.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Notification de l’école', {
    body: d.body || 'Vous avez une nouvelle notification.',
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-72.png',
    lang: 'fr',
    data: { page: d.page || '', url: d.url || self.registration.scope },
  }));
});

// Toucher l'alerte : revient sur l'application déjà ouverte (et ouvre la bonne page), sinon l'ouvre
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const { page, url } = e.notification.data || {};
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => w.url.startsWith(self.registration.scope));
    if (win) {
      await win.focus();
      win.postMessage({ type: 'ecole-notification', page });
      return;
    }
    await self.clients.openWindow(url || self.registration.scope);
  })());
});
