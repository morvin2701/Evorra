importScripts("https://www.gstatic.com/firebasejs/10.0.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.0.0/firebase-messaging-compat.js");

// This config is injected by Flask from environment variables
firebase.initializeApp({
  apiKey: "{{ firebase_api_key }}",
  projectId: "{{ firebase_project_id }}",
  messagingSenderId: "{{ firebase_messaging_sender_id }}",
  appId: "{{ firebase_app_id }}"
});

const messaging = firebase.messaging();

/**
 * Handle background messages.
 * This is triggered when the app is in the background or closed.
 */
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  
  const notificationTitle = payload.notification.title || 'Evorra Update';
  const notificationOptions = {
    body: payload.notification.body || 'You have a new notification.',
    icon: payload.notification.icon || '/static/favicon.svg',
    data: payload.data, // Preserve data for click handling
    tag: payload.notification.tag || 'evorra-notification'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

/**
 * Handle notification clicks.
 */
self.addEventListener('notificationclick', (event) => {
  console.log('[firebase-messaging-sw.js] Notification clicked', event.notification.tag);
  event.notification.close();

  // Define the target URL (default to home or notifications page)
  const targetUrl = event.notification.data?.action_target || '/notifications';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // If a window is already open, focus it and navigate
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus().then((focusedClient) => {
            return focusedClient.navigate(targetUrl);
          });
        }
      }
      // If no window is open, open a new one
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
