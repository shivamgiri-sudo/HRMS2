// Break Desk Service Worker - Offline Support
const CACHE_NAME = 'break-desk-v2';
const API_CACHE = 'break-desk-api-v2';
const OFFLINE_QUEUE_STORE = 'offline-actions';
const DB_NAME = 'BreakDeskDB';
const DB_VERSION = 1;

// Install event - cache essential assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Break Desk Service Worker');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/break-desk',
        '/assets/index.js',
        '/assets/index.css',
      ]).catch((err) => {
        console.warn('[SW] Failed to cache some assets:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Break Desk Service Worker');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('break-desk-') && name !== CACHE_NAME && name !== API_CACHE)
          .map((name) => caches.delete(name))
      );
    })
  );
  return self.clients.claim();
});

// Fetch event - handle requests
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only intercept break-desk API calls
  if (!url.pathname.includes('/api/break-desk/')) {
    return;
  }

  // Handle GET requests (cache with network fallback)
  if (request.method === 'GET') {
    event.respondWith(
      caches.open(API_CACHE).then((cache) => {
        return fetch(request)
          .then((response) => {
            // Cache successful responses
            if (response.ok) {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(async () => {
            // Network failed, try cache
            const cached = await cache.match(request);
            if (cached) {
              console.log('[SW] Serving from cache (offline):', url.pathname);
              return cached;
            }
            // Return offline response
            return new Response(
              JSON.stringify({
                success: false,
                offline: true,
                message: 'Offline: Using cached data',
              }),
              {
                status: 503,
                headers: { 'Content-Type': 'application/json' },
              }
            );
          });
      })
    );
    return;
  }

  // Handle POST requests (queue when offline)
  if (request.method === 'POST') {
    event.respondWith(
      fetch(request.clone())
        .then((response) => {
          // Network succeeded
          return response;
        })
        .catch(async () => {
          // Network failed, queue for later
          console.log('[SW] Network failed, queuing action:', url.pathname);

          try {
            const body = await request.text();
            const actionData = {
              url: request.url,
              method: request.method,
              headers: Array.from(request.headers.entries()),
              body,
              timestamp: Date.now(),
            };

            await saveToQueue(actionData);

            return new Response(
              JSON.stringify({
                success: false,
                offline: true,
                queued: true,
                message: 'Action queued. Will sync when back online.',
              }),
              {
                status: 202, // Accepted
                headers: { 'Content-Type': 'application/json' },
              }
            );
          } catch (err) {
            console.error('[SW] Failed to queue action:', err);
            return new Response(
              JSON.stringify({
                success: false,
                offline: true,
                message: 'Offline and unable to queue action.',
              }),
              {
                status: 503,
                headers: { 'Content-Type': 'application/json' },
              }
            );
          }
        })
    );
    return;
  }
});

// Background sync - retry queued actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-break-desk-queue') {
    console.log('[SW] Background sync triggered');
    event.waitUntil(syncQueue());
  }
});

// IndexedDB helpers
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(OFFLINE_QUEUE_STORE)) {
        db.createObjectStore(OFFLINE_QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
  });
}

async function saveToQueue(actionData) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([OFFLINE_QUEUE_STORE], 'readwrite');
    const store = tx.objectStore(OFFLINE_QUEUE_STORE);
    const request = store.add(actionData);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAllFromQueue() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([OFFLINE_QUEUE_STORE], 'readonly');
    const store = tx.objectStore(OFFLINE_QUEUE_STORE);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function removeFromQueue(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([OFFLINE_QUEUE_STORE], 'readwrite');
    const store = tx.objectStore(OFFLINE_QUEUE_STORE);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function syncQueue() {
  console.log('[SW] Syncing queued actions...');
  const queue = await getAllFromQueue();

  if (queue.length === 0) {
    console.log('[SW] Queue is empty');
    return;
  }

  console.log(`[SW] Processing ${queue.length} queued actions`);

  for (const item of queue) {
    try {
      const headers = new Headers(item.headers);
      const response = await fetch(item.url, {
        method: item.method,
        headers,
        body: item.body,
      });

      if (response.ok) {
        console.log('[SW] Successfully synced action:', item.url);
        await removeFromQueue(item.id);
      } else {
        console.warn('[SW] Failed to sync action (non-ok response):', item.url, response.status);
        // Keep in queue for next sync attempt
      }
    } catch (err) {
      console.error('[SW] Failed to sync action (network error):', item.url, err);
      // Keep in queue for next sync attempt
    }
  }

  const remainingQueue = await getAllFromQueue();
  console.log(`[SW] Sync complete. ${remainingQueue.length} actions still in queue`);
}

// Message handler - manual sync trigger
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SYNC_QUEUE') {
    console.log('[SW] Manual sync requested');
    event.waitUntil(syncQueue());
  }
});
