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
        await window.db.collection('users').doc(user.uid).set({
            fcm_token: token,
            fcm_token_updated_at: new Date().toISOString(),
            notifications_enabled: true
        }, { merge: true });
        console.log("[FCM] Token saved to database for user:", user.uid);
    } catch (e) {
        console.error("[FCM] Error saving token to database:", e);
    }
}

/**
 * Handle foreground messages.
 * This is triggered when the app is open and in focus.
 */
onMessage(messaging, (payload) => {
    console.log("[FCM] Foreground message received:", payload);
    
    // For a premium feel, show a custom in-app notification
    showInAppNotification(payload);
});

/**
 * Show a premium in-app notification UI.
 */
function showInAppNotification(payload) {
    const { title, body, icon } = payload.notification || {};
    
    // Create notification element
    const notif = document.createElement('div');
    notif.className = 'fcm-in-app-notification';
    notif.innerHTML = `
        <div class="fcm-notif-content">
            <div class="fcm-notif-icon">
                <img src="${icon || '/static/favicon.svg'}" alt="Notification Icon">
            </div>
            <div class="fcm-notif-text">
                <div class="fcm-notif-title">${title || 'New Update'}</div>
                <div class="fcm-notif-body">${body || 'You have a new message.'}</div>
            </div>
            <button class="fcm-notif-close">&times;</button>
        </div>
        <div class="fcm-notif-progress"></div>
    `;

    document.body.appendChild(notif);

    // Auto-remove after 6 seconds
    const timer = setTimeout(() => {
        notif.classList.add('fcm-notif-exit');
        setTimeout(() => notif.remove(), 500);
    }, 6000);

    notif.querySelector('.fcm-notif-close').onclick = () => {
        clearTimeout(timer);
        notif.classList.add('fcm-notif-exit');
        setTimeout(() => notif.remove(), 500);
    };

    notif.onclick = (e) => {
        if (e.target.classList.contains('fcm-notif-close')) return;
        const targetUrl = payload.data?.action_target || '/notifications';
        window.location.href = targetUrl;
    };
}

// Export for global access if needed (e.g. for simple script tags)
window.requestNotificationPermission = requestNotificationPermission;
