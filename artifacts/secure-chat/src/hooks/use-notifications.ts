import { useEffect, useRef, useCallback } from "react";

export function useNotifications() {
  const permissionRef = useRef<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "denied",
  );

  // Ask for permission once on mount (only if not already granted/denied)
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      Notification.requestPermission().then((p) => {
        permissionRef.current = p;
      });
    }
  }, []);

  const notify = useCallback(
    (title: string, options?: { body?: string; icon?: string; tag?: string }) => {
      if (typeof Notification === "undefined") return;
      if (permissionRef.current !== "granted") return;
      // Only notify when the tab is hidden / not focused
      if (!document.hidden && document.hasFocus()) return;

      try {
        const n = new Notification(title, {
          body: options?.body,
          icon: options?.icon ?? "/favicon.ico",
          tag: options?.tag,
          silent: false,
        });
        // Auto-close after 5 s
        setTimeout(() => n.close(), 5000);
        // Clicking the notification focuses the tab
        n.onclick = () => {
          window.focus();
          n.close();
        };
      } catch {
        // Some browsers block Notification in cross-origin iframes; ignore
      }
    },
    [],
  );

  return { notify };
}
