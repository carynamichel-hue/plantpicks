/* PlantPicks service worker.
 *
 * The room is the reason this exists: a greenhouse full of people, one access
 * point, and a presentation that does not stop while someone's photo loads.
 * Once the page has been opened, everything it needs is on the phone.
 *
 * NAVIGATIONS ARE NETWORK-FIRST, and that is not a preference — it is what
 * makes a per-deploy cache stamp safe. BlightCast learned this live on
 * 2026-08-23: with a cache-first shell, a deploy replaced the content-hashed
 * assets, the new worker swept the old cache, and the stale shell went looking
 * for route chunks that no longer existed — the tabs silently died. If we
 * redeploy on the morning of the open house (we will), a phone that opened the
 * page earlier must pick the new one up, not break.
 *
 * PHOTOS ARE CACHE-FIRST FOREVER. They are content at a stable URL and they
 * never change within an event; re-fetching them on a bad connection is the
 * one thing guaranteed to ruin this.
 */
var CACHE = 'plantpicks-202608251626';
var SHELL = ['./', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); })
    .then(function () { return self.skipWaiting(); })
    .catch(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('plantpicks-') === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   /* the ratings form goes straight to the network */

  if (req.mode === 'navigate') {
    e.respondWith(
      Promise.race([
        fetch(req).then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put('./', copy); });
          }
          return res;
        }),
        /* lie-fi: connected to something that carries nothing. A bare fetch
           hangs and the app looks frozen, so the cached shell wins after 4s. */
        new Promise(function (resolve, reject) {
          setTimeout(function () {
            caches.match('./').then(function (c) { c ? resolve(c) : reject(new Error('timeout')); });
          }, 4000);
        }),
      ]).catch(function () {
        /* the last resort must be a RESPONSE — resolving undefined makes
           respondWith throw instead of letting the browser show its own page */
        return caches.match('./').then(function (c) { return c || Response.error(); });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return cached || Response.error();
      });
    })
  );
});
