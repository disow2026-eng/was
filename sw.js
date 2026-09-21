'use strict';

// Wasl Service Worker — handles background notifications

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e  => e.waitUntil(self.clients.claim()));

const scheduled = [];

self.addEventListener('message', event => {
  const { type } = event.data;

  if (type === 'SCHEDULE_NOTIFICATIONS') {
    // Clear any previously scheduled timers
    scheduled.forEach(id => clearTimeout(id));
    scheduled.length = 0;

    const now = Date.now();
    const { prayers } = event.data; // array of notification objects

    prayers.forEach(n => {
      const ms = n.at - now;
      if (ms < 0) return; // already passed
      if (ms > 23 * 60 * 60 * 1000) return; // too far (>23h)

      const id = setTimeout(() => {
        self.registration.showNotification(n.title, {
          body:              n.body,
          icon:              './icon-192.png',
          badge:             './icon-72.png',
          tag:               n.tag,
          requireInteraction: false,
          vibrate:           [150, 80, 150],
          data:              { url: n.url || './' },
        });
      }, ms);

      scheduled.push(id);
    });

    console.log(`[Wasl SW] Scheduled ${prayers.filter(p => (p.at - now) > 0).length} notifications`);
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes('wasl') && 'focus' in client) {
          client.focus();
          return;
        }
      }
      return clients.openWindow(url);
    })
  );
});
