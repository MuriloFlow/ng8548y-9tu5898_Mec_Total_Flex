/* ==========================================================
   Total Flex – Service Worker
   Handles reminder notifications in the background.
   ========================================================== */

const CACHE_NAME = "tf-reminders-v1";
const CHECK_INTERVAL = 30 * 60 * 1000; // 30 minutes

// Install – activate immediately
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});

// Listen for messages from the main thread
self.addEventListener("message", (event) => {
  const { type, reminders, customers, vehicles } = event.data || {};

  if (type === "CHECK_REMINDERS") {
    checkReminders(reminders || [], customers || [], vehicles || []);
  }

  if (type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Periodic background sync (when supported)
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "check-reminders") {
    event.waitUntil(checkRemindersFromStorage());
  }
});

// Also check on notification click to bring app to focus
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Focus existing window or open new one
      for (const client of clientList) {
        if (client.url.includes(self.registration.scope) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(data.url || "/");
      }
    }),
  );
});

async function checkRemindersFromStorage() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match("/reminders-data");
    if (response) {
      const data = await response.json();
      checkReminders(data.reminders || [], data.customers || [], data.vehicles || []);
    }
  } catch {
    // Storage not available
  }
}

function checkReminders(reminders, customers, vehicles) {
  const now = new Date();
  const notifiedKey = "tf-notified-reminders";
  let notified = [];
  try {
    // Read from IndexedDB or fallback
    notified = JSON.parse(self._notifiedCache || "[]");
  } catch {
    notified = [];
  }

  const customerMap = {};
  customers.forEach((c) => {
    customerMap[c.id] = c;
  });

  const vehicleMap = {};
  vehicles.forEach((v) => {
    vehicleMap[v.id] = v;
  });

  reminders
    .filter((r) => r.status === "open" && r.dueDate)
    .forEach((reminder) => {
      const dueDate = new Date(reminder.dueDate);
      const diffMs = dueDate.getTime() - now.getTime();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      // Notify if due within 3 days or overdue (up to 7 days after)
      if (diffDays <= 3 && diffDays >= -7 && !notified.includes(reminder.id)) {
        const customer = customerMap[reminder.customerId];
        const vehicle = vehicleMap[reminder.vehicleId];

        let body = "";
        if (diffDays < 0) {
          body = `Vencido há ${Math.abs(diffDays)} dia(s)`;
        } else if (diffDays === 0) {
          body = "Vence hoje!";
        } else {
          body = `Vence em ${diffDays} dia(s)`;
        }

        if (customer) body += ` — ${customer.name}`;
        if (vehicle) body += ` · ${vehicle.brand} ${vehicle.model}`;

        self.registration.showNotification("Total Flex — Retorno", {
          body,
          icon: "/assets/logo.png",
          badge: "/assets/logo.png",
          tag: `reminder-${reminder.id}`,
          renotify: true,
          data: { reminderId: reminder.id, url: "/" },
        });

        notified.push(reminder.id);
      }
    });

  self._notifiedCache = JSON.stringify(notified);
}
