/**
 * Evorra Firebase Messaging Initialization (Modular SDK)
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-messaging.js";

// Use the config already defined in base.html
const app = initializeApp(window.firebaseConfig, "evorra-messaging");
export const messaging = getMessaging(app);

// Web Push Certificate Key (VAPID Key)
const VAPID_KEY = "BFgB36aSoy-7BxC4UWyvxjZaqiOz3RCFD-wIspnD_--5NBh_GfvgbauAqJafXIkJ86LC0kanmb12Wa2jpWv_los"; 

/**
 * Request permission for push notifications and get the FCM token.
 */
export async function requestNotificationPermission() {
    console.log("[FCM] Requesting permission...");
    try {
        // Ensure Service Worker is ready before getting token
        const registration = await navigator.serviceWorker.ready;
        console.log("[FCM] Service Worker ready:", registration.scope);

        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
            console.warn("[FCM] Notification permission denied.");
            return null;
        }

        console.log("[FCM] Permission granted. Fetching token...");
        
        // Get the token with explicit registration
        const token = await getToken(messaging, {
            vapidKey: VAPID_KEY,
            serviceWorkerRegistration: registration
        });

        if (token) {
            console.log("[FCM] Token acquired:", token);
            await saveTokenToDatabase(token);
            return token;
        } else {
            console.warn("[FCM] No registration token available. Request permission to generate one.");
            return null;
        }
    } catch (err) {
        console.error("[FCM] An error occurred while retrieving token:", err);
        return null;
    }
}

/**
 * Save the FCM token to the user's profile in Firestore.
 */
async function saveTokenToDatabase(token) {
    if (!window.auth || !window.db) return;
    
    const user = window.auth.currentUser;
    if (!user) {
        console.log("[FCM] No user logged in, token not saved to DB.");
        return;
    }

    try {
        // Use arrayUnion to store multiple device tokens (Web, iOS, Android)
        await window.db.collection('users').doc(user.uid).update({
            fcm_tokens: firebase.firestore.FieldValue.arrayUnion(token),
            fcm_token_updated_at: new Date().toISOString(),
            notifications_enabled: true
        });
        console.log("[FCM] Token synced to device list for user:", user.uid);
    } catch (e) {
        // If document doesn't exist, use set
        await window.db.collection('users').doc(user.uid).set({
            fcm_tokens: [token],
            fcm_token_updated_at: new Date().toISOString(),
            notifications_enabled: true
        }, { merge: true });
        console.log("[FCM] Token list initialized for new user:", user.uid);
    }
}

/**
 * Handle foreground messages.
 * This is triggered when the app is open and in focus.
 */
// Handle foreground messages
onMessage(messaging, (payload) => {
    console.log("[FCM] Foreground message received:", payload);
    
    const notifData = {
        payload,
        timestamp: Date.now(),
        expiresAt: Date.now() + 6000, // 6 seconds total
        isRestored: false
    };
    
    localStorage.setItem('fcm_active_notif', JSON.stringify(notifData));
    showInAppNotification(notifData);

    // Force System OS Notification
    console.log("[FCM] System Permission State:", Notification.permission);
    if (Notification.permission === 'granted') {
        navigator.serviceWorker.ready.then(registration => {
            console.log("[FCM] Triggering System Alert...");
            registration.showNotification(payload.notification.title || 'Evorra Update', {
                body: payload.notification.body || '',
                icon: '/static/favicon.svg',
                badge: '/static/favicon.svg',
                tag: 'foreground-push-' + Date.now() // Unique tag to prevent stacking
            });
        }).catch(err => {
            console.error("[FCM] ServiceWorker not ready for notification:", err);
        });
    } else {
        console.warn("[FCM] System notifications are BLOCKED. Please check Mac System Settings.");
    }
});

/**
 * Check for active notifications on page load
 */
window.addEventListener('load', () => {
    const raw = localStorage.getItem('fcm_active_notif');
    if (!raw) return;

    const notifData = JSON.parse(raw);
    const now = Date.now();
    
    if (now < notifData.expiresAt) {
        // Notification is still valid!
        notifData.isRestored = true;
        showInAppNotification(notifData);
    } else {
        localStorage.removeItem('fcm_active_notif');
    }
});

/**
 * Show a premium in-app notification UI.
 */
function showInAppNotification(notifData) {
    if (document.querySelector('.fcm-in-app-notification')) return;

    const { payload, expiresAt, isRestored } = notifData;
    const remainingMs = expiresAt - Date.now();
    if (remainingMs <= 0) return;

    const { title, body } = payload.notification || {};
    
    const notif = document.createElement('div');
    notif.className = 'fcm-in-app-notification';
    if (isRestored) notif.style.animation = 'none'; // No entrance animation on reload
    
    notif.innerHTML = `
        <div class="fcm-notif-content">
            <div class="fcm-notif-icon">
                <img src="/static/favicon.svg" alt="Evorra">
            </div>
            <div class="fcm-notif-text">
                <div class="fcm-notif-title">${title || 'New Update'}</div>
                <div class="fcm-notif-body">${body || 'You have a new message.'}</div>
            </div>
            <button class="fcm-notif-close">&times;</button>
        </div>
        <div class="fcm-notif-progress"></div>
    `;

    // Calculate progress bar width based on remaining time
    const progressBar = notif.querySelector('.fcm-notif-progress');
    progressBar.style.transition = `width ${remainingMs}ms linear`;
    setTimeout(() => { progressBar.style.width = '0%'; }, 50);

    document.body.appendChild(notif);

    const timer = setTimeout(() => {
        notif.classList.add('fcm-notif-exit');
        localStorage.removeItem('fcm_active_notif');
        setTimeout(() => notif.remove(), 500);
    }, remainingMs);

    notif.querySelector('.fcm-notif-close').onclick = (e) => {
        e.stopPropagation();
        clearTimeout(timer);
        notif.classList.add('fcm-notif-exit');
        localStorage.removeItem('fcm_active_notif');
        setTimeout(() => notif.remove(), 500);
    };

    notif.onclick = () => {
        const targetUrl = payload.data?.action_target || '/notifications';
        window.location.href = targetUrl;
    };
}

// Export for global access
window.requestNotificationPermission = requestNotificationPermission;
