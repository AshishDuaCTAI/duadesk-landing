/* DuaDesk webinar notifications: service worker (must live at the site root) */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('push', function (e) {
  e.waitUntil(fetch('/api/webinars?action=push_latest', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
    var m = j.message || { title: 'DuaDesk Webinars', body: 'A new free webinar has been announced.', url: '/webinars.html' };
    return self.registration.showNotification(m.title, { body: m.body, icon: '/og-image.png', badge: '/og-image.png', tag: 'dd-webinar', data: { url: m.url || '/webinars.html' } });
  }).catch(function () { return self.registration.showNotification('DuaDesk Webinars', { body: 'See the upcoming free webinars.', data: { url: '/webinars.html' } }); }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/webinars.html';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
    for (var i = 0; i < cs.length; i++) if (cs[i].url.indexOf('/webinars.html') > -1 && 'focus' in cs[i]) { cs[i].navigate(url); return cs[i].focus(); }
    return self.clients.openWindow(url);
  }));
});
