// ─── Push Notification Handler ───────────────────────────────────────────────

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "Peoplo", body: event.data.text() };
  }

  const options = {
    body: data.body || "",
    icon: data.icon || "/pwa-192x192.png",
    badge: "/pwa-192x192.png",
    data: { url: data.url || "/" },
    vibrate: [200, 100, 200],
    tag: data.title,
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(data.title || "Peoplo", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});

// ─── Background Sync: Location Heartbeat ─────────────────────────────────────
//
// When the main thread enqueues a position and calls sync.register("location-heartbeat"),
// this handler fires — even if the tab is backgrounded or the network was temporarily
// down. The browser retries automatically (with exponential backoff) until the fetch
// succeeds.
//
// Auth: reads the JWT from IndexedDB (stored there by locationDb.ts in the main thread)
// so we can send a valid Bearer token without touching localStorage (unavailable in SW).

const IDB_NAME    = "hrms-location";
const IDB_VERSION = 1;

function swOpenDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("meta"))  db.createObjectStore("meta");
      if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function swGetJwt(db) {
  return new Promise((resolve) => {
    const tx  = db.transaction("meta", "readonly");
    const req = tx.objectStore("meta").get("jwt");
    req.onsuccess = () => resolve(req.result || null);
    req.onerror   = () => resolve(null);
  });
}

function swGetQueue(db) {
  return new Promise((resolve) => {
    const tx      = db.transaction("queue", "readonly");
    const results = [];
    const req     = tx.objectStore("queue").openCursor();
    req.onsuccess = (e) => {
      const c = e.target.result;
      if (c) { results.push({ key: c.key, value: c.value }); c.continue(); }
      else resolve(results);
    };
    req.onerror = () => resolve(results);
  });
}

function swClearQueue(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("queue", "readwrite");
    tx.objectStore("queue").clear();
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

async function flushLocationQueue() {
  let db;
  try { db = await swOpenDb(); } catch { return; }

  const jwt = await swGetJwt(db);
  if (!jwt) return; // user is logged out — nothing to send

  const queue = await swGetQueue(db);
  if (!queue.length) return;

  // Send only the most-recent position — older ones are stale
  const latest = queue[queue.length - 1].value;

  try {
    const res = await fetch(`${self.location.origin}/api/location/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        latitude:  latest.latitude,
        longitude: latest.longitude,
        accuracy:  latest.accuracy ?? null,
      }),
    });

    if (res.ok || res.status === 401) {
      // 200 = success | 401 = token expired (stale positions, no point retrying)
      await swClearQueue(db);
    }
    // 5xx or network error — leave queue, browser will schedule a retry
  } catch {
    // Network down — leave queue intact for next sync attempt
  }
}

// Triggered by: navigator.serviceWorker.ready.then(r => r.sync.register("location-heartbeat"))
self.addEventListener("sync", (event) => {
  if (event.tag === "location-heartbeat") {
    event.waitUntil(flushLocationQueue());
  }
});

// Periodic Background Sync — Android Chrome grants this for installed PWAs.
// Fires roughly every 30 minutes when the browser wakes the SW independently.
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "location-heartbeat-periodic") {
    event.waitUntil(flushLocationQueue());
  }
});
