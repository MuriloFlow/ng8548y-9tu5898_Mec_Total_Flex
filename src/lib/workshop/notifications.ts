/**
 * Total Flex – Reminder Notifications
 *
 * Handles service worker registration, browser notification permission,
 * and periodic reminder checks that fire native notifications.
 */

import type { WorkshopState } from "./types";

const NOTIFIED_STORAGE_KEY = "tf-notified-reminder-ids";
const LAST_CHECK_KEY = "tf-last-reminder-check";
const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// ─────────────────────────────────────────────────────────────
// Service Worker Registration
// ─────────────────────────────────────────────────────────────

let swRegistration: ServiceWorkerRegistration | null = null;

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;

  try {
    swRegistration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    console.log("[TF] Service Worker registered.", swRegistration.scope);
    return swRegistration;
  } catch (error) {
    console.warn("[TF] Service Worker registration failed:", error);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Notification Permission
// ─────────────────────────────────────────────────────────────

export type PermissionState = "granted" | "denied" | "default" | "unsupported";

export function getNotificationPermission(): PermissionState {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission as PermissionState;
}

export async function requestNotificationPermission(): Promise<PermissionState> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";

  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";

  const result = await Notification.requestPermission();
  return result as PermissionState;
}

// ─────────────────────────────────────────────────────────────
// Reminder Checking
// ─────────────────────────────────────────────────────────────

function getNotifiedIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(NOTIFIED_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveNotifiedIds(ids: string[]) {
  try {
    localStorage.setItem(NOTIFIED_STORAGE_KEY, JSON.stringify(ids.slice(-200))); // keep last 200
  } catch {
    // storage full or unavailable
  }
}

function getLastCheckTime(): number {
  try {
    return Number(localStorage.getItem(LAST_CHECK_KEY) || "0");
  } catch {
    return 0;
  }
}

function saveLastCheckTime() {
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

export type ReminderCheckResult = {
  notified: number;
  upcoming: number;
  overdue: number;
};

/**
 * Checks reminders and fires browser notifications for ones approaching
 * their due date (within 3 days) or already overdue (up to 7 days).
 * Deduplicates using localStorage so each reminder is notified only once.
 */
export function checkAndNotifyReminders(state: WorkshopState): ReminderCheckResult {
  if (typeof window === "undefined") return { notified: 0, upcoming: 0, overdue: 0 };
  if (getNotificationPermission() !== "granted") return { notified: 0, upcoming: 0, overdue: 0 };

  const now = new Date();
  const notifiedIds = getNotifiedIds();
  let notifiedCount = 0;
  let upcomingCount = 0;
  let overdueCount = 0;

  const customerMap = new Map(state.customers.map((c) => [c.id, c]));
  const vehicleMap = new Map(state.vehicles.map((v) => [v.id, v]));

  for (const reminder of state.reminders) {
    if (reminder.status !== "open" || !reminder.dueDate) continue;

    const dueDate = new Date(reminder.dueDate);
    const diffMs = dueDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays <= 3 && diffDays >= -7) {
      if (diffDays < 0) overdueCount++;
      else upcomingCount++;

      if (!notifiedIds.includes(reminder.id)) {
        const customer = customerMap.get(reminder.customerId);
        const vehicle = vehicleMap.get(reminder.vehicleId);

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

        try {
          new Notification("Total Flex — Retorno", {
            body,
            icon: "/assets/logo.png",
            tag: `tf-reminder-${reminder.id}`,
          });
          notifiedIds.push(reminder.id);
          notifiedCount++;
        } catch {
          // notification failed silently
        }
      }
    }
  }

  saveNotifiedIds(notifiedIds);
  saveLastCheckTime();

  return { notified: notifiedCount, upcoming: upcomingCount, overdue: overdueCount };
}

/**
 * Should we run a check right now? Returns true if enough time has passed
 * since the last check or if we've never checked.
 */
export function shouldCheckReminders(): boolean {
  return Date.now() - getLastCheckTime() > CHECK_INTERVAL_MS;
}

// ─────────────────────────────────────────────────────────────
// Send data to service worker for background checks
// ─────────────────────────────────────────────────────────────

export function notifyServiceWorker(state: WorkshopState) {
  if (!swRegistration?.active) return;

  swRegistration.active.postMessage({
    type: "CHECK_REMINDERS",
    reminders: state.reminders,
    customers: state.customers,
    vehicles: state.vehicles,
  });
}
