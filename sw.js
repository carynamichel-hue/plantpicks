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
var CACHE = 'plantpicks-202608260918';
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

  /* ⚑ caches.open(CACHE).match — NOT the bare caches.match.
     caches.match() searches EVERY cache in the origin and returns the first
     hit, and "first" is the OLDEST cache, not this deploy's. That silently
     defeated the entire per-deploy stamp: a photo URL is stable
     ("photos/t/29.jpg") while its CONTENT changes the moment the plant list is
     renumbered, so while yesterday's cache still existed — and its deletion in
     activate races the images the page is already loading — every thumbnail
     came back as yesterday's plant.
     Caryn caught it on her phone, 2026-08-26: the card for 29 showed the photo
     of 33, but opening 29 showed the right plant. The grid uses thumbnails,
     which had all been warmed the day before; the full-size images had not, so
     those fetched fresh and were correct. Two different answers for the same
     plant on one screen.
     Scoped to this deploy's cache, a renumbered photo can no longer be served
     out of an older one — which is what the stamp was always for. */
  e.respondWith(
    caches.open(CACHE).then(function (c) {
      return c.match(req).then(function (cached) {
        if (cached) return cached;
        return fetch(req).then(function (res) {
          if (res && res.ok) c.put(req, res.clone());
          return res;
        }).catch(function () {
          return cached || Response.error();
        });
      });
    })
  );
});
