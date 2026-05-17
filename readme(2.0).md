# Evorra — Complete Technical Documentation

> Every detail of the project, from architecture to Firestore rules, routes to deployment.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Repository Structure](#2-repository-structure)
3. [Technology Stack](#3-technology-stack)
4. [Backend — app.py Deep Dive](#4-backend--apppy-deep-dive)
5. [Routes Reference](#5-routes-reference)
6. [Environment Configuration](#6-environment-configuration)
7. [Frontend Architecture](#7-frontend-architecture)
8. [Page-by-Page Breakdown](#8-page-by-page-breakdown)
9. [Firestore Data Model](#9-firestore-data-model)
10. [Firestore Security Rules — Line-by-Line](#10-firestore-security-rules--line-by-line)
11. [Firebase Authentication](#11-firebase-authentication)
12. [Cloudinary Image Pipeline](#12-cloudinary-image-pipeline)
13. [Google Maps Geocoding Proxy](#13-google-maps-geocoding-proxy)
14. [Mobile Detection Strategy](#14-mobile-detection-strategy)
15. [Ticket Sharing System](#15-ticket-sharing-system)
16. [QR Code Scan System](#16-qr-code-scan-system)
17. [Notification System](#17-notification-system)
18. [Organiser Studio](#18-organiser-studio)
19. [Deployment — Vercel](#19-deployment--vercel)
20. [Python Dependencies](#20-python-dependencies)
21. [Security Considerations](#21-security-considerations)
22. [Known Patterns & Design Decisions](#22-known-patterns--design-decisions)

---

## 1. Project Overview

**Evorra** is a full-stack event discovery and ticketing web application targeting city-based audiences. It serves two user personas:

- **Attendees** — Browse events, book tickets, receive shared passes, and attend with a QR code scan-in.
- **Organisers** — Create and manage events, set ticket types and promo codes, and scan attendees at the door.

The application is live at [https://evorra-jade.vercel.app](https://evorra-jade.vercel.app) and hosted on Vercel. The backend is a Python Flask server; the database and authentication layer is Firebase (Firestore + Firebase Auth); images are stored on Cloudinary; and geocoding uses Google Maps Platform.

The codebase is intentionally lean: 4 Python dependencies, a single `app.py`, and all application logic implemented on the frontend via Jinja2 templates and Firebase SDK calls directly from the browser.

---

## 2. Repository Structure

```
Evorra/
├── app.py                         # Flask entry point — all routes and proxy logic
├── requirements.txt               # 4 Python packages
├── firestore.rules                # 201-line Firestore security rule set
├── .env.example                   # Template for all required env vars (27 lines)
├── .gitignore                     # Excludes .env, __pycache__, venv, etc.
├── README.md                      # Project README (was empty; now regenerated)
│
├── templates/                     # Jinja2 HTML templates (rendered by Flask)
│   ├── home.html                  # Desktop home feed
│   ├── home_mobile.html           # Mobile-optimised home feed
│   ├── auth.html                  # Firebase Auth login/signup page
│   ├── explore.html               # Event search, filters, browse
│   ├── event_details.html         # Single event — details, agenda, booking CTA
│   ├── booking.html               # Ticket selection and booking form
│   ├── payment.html               # Payment step
│   ├── success.html               # Payment success / booking confirmed
│   ├── my_tickets.html            # Attendee ticket wallet
│   ├── shared_tickets.html        # Tickets received via sharing
│   ├── ticket_details.html        # Single ticket detail + embedded QR code
│   ├── ticket_scan.html           # QR scanner — dual-mode (ticket pass or scan centre)
│   ├── profile.html               # User profile view
│   ├── edit_profile.html          # Profile edit form
│   ├── notifications.html         # In-app notification centre
│   ├── support.html               # Help, privacy, and terms
│   └── organizer/
│       ├── add_event.html         # Event creation studio (full form + Cloudinary upload)
│       ├── manage_events.html     # Organiser management dashboard
│       └── my_events.html        # Organiser's published event list
│
└── static/                        # Static assets served directly
    ├── favicon.ico
    ├── css/                       # Stylesheets
    └── js/                        # Client-side JavaScript (incl. city-picker.js)
```

**Language breakdown (from GitHub):**
- HTML: 81.4%
- CSS: 13.9%
- JavaScript: 4.1%
- Python: 0.6%

---

## 3. Technology Stack

### Backend
| Component | Detail |
|---|---|
| Runtime | Python 3 |
| Web framework | Flask |
| CORS | Flask-CORS (all origins enabled) |
| Environment | python-dotenv — loads `.env` at startup |
| Server port | `5001` by default (configurable via `PORT` env var) |
| Debug mode | Controlled by `FLASK_DEBUG` env var (default `"1"` = on) |

### Frontend
| Component | Detail |
|---|---|
| Templating | Jinja2 (Flask's default) |
| Markup | HTML5 |
| Styling | CSS3 (custom, no framework like Bootstrap) |
| Scripting | Vanilla JavaScript |
| Firebase SDK | Loaded client-side from CDN in templates |

### External Services
| Service | Purpose |
|---|---|
| Firebase Firestore | NoSQL document database for all app data |
| Firebase Authentication | User sign-up, login, and session management |
| Cloudinary | Event image upload and delivery |
| Google Maps Platform – Geocoding API | Reverse geocoding (lat/lng → city) and forward geocoding (city name → coordinates), proxied through Flask |
| Vercel | Hosting and deployment |

---

## 4. Backend — app.py Deep Dive

`app.py` is 190 lines long (152 lines of active code). It has three responsibilities:

### 4.1 App Initialisation

```python
app = Flask(__name__)
CORS(app)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-secret-key')
app.config['GOOGLE_MAPS_API_KEY'] = (os.getenv('GOOGLE_MAPS_API_KEY') or '').strip()
```

- `CORS(app)` enables cross-origin requests on all routes.
- The `SECRET_KEY` defaults to `'dev-secret-key'`; this **must** be overridden in production.
- The Google Maps API key is stored server-side and never rendered into any HTML template directly.

### 4.2 Context Processor — `inject_public_runtime_config`

```python
@app.context_processor
def inject_public_runtime_config():
    return {
        'firebase_api_key': ...,
        'firebase_auth_domain': ...,
        ...
        'cloudinary_cloud_name': ...,
        'cloudinary_upload_preset': ...,
        'cloudinary_upload_url': ...,
        'cloudinary_upload_folder': ...,
        'app_public_url': ...,
    }
```

This injects 10 configuration values into **every** Jinja2 template's context. Templates use these variables to initialise the Firebase and Cloudinary SDKs on the client side. This pattern avoids hardcoding any credentials in HTML files while still making them available in the rendered page.

> **Security note:** These values (Firebase web config, Cloudinary upload preset) are intended to be public — they are scoped by Firebase Security Rules and Cloudinary's unsigned-upload configuration. The Google Maps key, however, is NOT injected here; it stays exclusively on the server.

### 4.3 Geocode Proxy — `_proxy_google_geocode()`

This private function is the most technically interesting part of `app.py`. It acts as a server-side proxy for the Google Maps Geocoding API, keeping the API key off the browser.

**Request flow:**
1. The browser JS (in `city-picker.js`) calls `GET /api/geocode/json?latlng=...` or `?address=...`
2. Flask validates the parameters and checks that the API key is set
3. Flask constructs the full Google Maps URL with the server-side key appended
4. Flask makes the request using Python's `urllib` (no third-party HTTP library) with an 18-second timeout
5. The JSON response from Google is forwarded verbatim to the browser

**Error handling:**
- Missing key → returns `REQUEST_DENIED` status
- Missing latlng and address → returns `INVALID_REQUEST` with HTTP 400
- HTTP errors from Google → returns `ERROR` with HTTP 502
- Any other exception → returns `ERROR` with HTTP 502

**Headers sent to Google:**
```
Accept: application/json
Accept-Language: en
User-Agent: Evorra/1.0 (Flask geocode proxy)
```

### 4.4 Route Handlers

All route handlers are thin — they simply call `render_template()` with the appropriate template. The only exceptions are:

- `/` — performs mobile detection before choosing which template to serve
- `/api/geocode/json` — calls the geocode proxy
- `/favicon.ico` — serves the icon from the static folder with the correct MIME type

---

## 5. Routes Reference

### Public / Attendee Routes

| Route | Template | Notes |
|---|---|---|
| `GET /` | `home.html` or `home_mobile.html` | Auto-detects mobile via User-Agent |
| `GET /home-mobile` | `home_mobile.html` | Force mobile view |
| `GET /auth` | `auth.html` | Firebase Auth UI |
| `GET /explore` | `explore.html` | Search + filters |
| `GET /event/<event_id>` | `event_details.html` | `event_id` passed to template as variable |
| `GET /book/<event_id>` | `booking.html` | `event_id` passed as variable |
| `GET /payment/<event_id>` | `payment.html` | `event_id` passed as variable |
| `GET /payment_success` | `success.html` | Post-booking confirmation |
| `GET /my-tickets` | `my_tickets.html` | Requires auth (enforced client-side) |
| `GET /shared-tickets` | `shared_tickets.html` | Requires auth (enforced client-side) |
| `GET /ticket/<ticket_id>` | `ticket_details.html` | `ticket_id` passed as variable |
| `GET /scan-pass/<ticket_id>` | `ticket_scan.html` | `ticket_id` passed; scanner_mode=False |
| `GET /scan-center` | `ticket_scan.html` | `ticket_id=''`, `scanner_mode=True` |
| `GET /profile` | `profile.html` | |
| `GET /profile/edit` | `edit_profile.html` | |
| `GET /notifications` | `notifications.html` | |
| `GET /support` | `support.html` | |

### Organiser Routes

| Route | Template | Notes |
|---|---|---|
| `GET /add-event` | `organizer/add_event.html` | Event creation studio |
| `GET /organizer/manage` | `organizer/manage_events.html` | Full dashboard |
| `GET /my-events` | `organizer/my_events.html` | Organiser event list |

### API Routes

| Route | Handler | Notes |
|---|---|---|
| `GET /api/geocode/json` | `_proxy_google_geocode()` | Accepts `latlng` and/or `address` query params |
| `GET /favicon.ico` | Static file | MIME: `image/vnd.microsoft.icon` |

---

## 6. Environment Configuration

All configuration is driven by a `.env` file (loaded by `python-dotenv` at startup). The `.env.example` file documents all 14 variables:

```
FLASK_ENV=development
FLASK_DEBUG=1
PORT=5001
SECRET_KEY=

# Firebase (injected into every template via context processor)
FIREBASE_API_KEY=
FIREBASE_AUTH_DOMAIN=
FIREBASE_PROJECT_ID=
FIREBASE_STORAGE_BUCKET=
FIREBASE_MESSAGING_SENDER_ID=
FIREBASE_APP_ID=

# Cloudinary
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_UPLOAD_PRESET=
CLOUDINARY_UPLOAD_URL=
CLOUDINARY_UPLOAD_FOLDER=events

# Public base URL for shareable ticket links (WhatsApp, etc.)
APP_PUBLIC_URL=https://evorra-jade.vercel.app

# Google Maps — server-side only, never sent to browser
GOOGLE_MAPS_API_KEY=

# Admin endpoint protection
ADMIN_SYNC_TOKEN=

# Used by maintenance scripts
APP_BASE_URL=https://evorra-jade.vercel.app
```

### Variable purposes

**`PORT`** — The Flask dev server listens on this port (default 5001). On Vercel, the platform manages the port.

**`SECRET_KEY`** — Used by Flask for session cookie signing. Must be a long random string in production.

**`FIREBASE_*`** — Standard Firebase web config. These are injected into all templates and used to initialise the Firebase SDK in the browser. Because Firebase Security Rules protect the data, it is safe to expose the web config.

**`CLOUDINARY_UPLOAD_PRESET`** — Must be an **unsigned** preset in Cloudinary for browser-side uploads to work without a server-side signature step.

**`APP_PUBLIC_URL`** — Used when generating shareable ticket URLs (e.g., for WhatsApp share links). Must be a publicly reachable HTTPS URL; `localhost` won't work for recipients on a different device.

**`GOOGLE_MAPS_API_KEY`** — Restricted to server-side use only. Passed to Google via the `/api/geocode/json` proxy; never rendered into HTML.

**`ADMIN_SYNC_TOKEN`** — Protects the `/api/admin/sync-event-metrics` endpoint referenced in comments. Not exposed in the current `app.py` (may be used by external scripts).

---

## 7. Frontend Architecture

Evorra's frontend follows a **server-rendered shell + client-side data** pattern:

1. Flask renders a Jinja2 template (HTML shell with nav, layout, and empty data containers)
2. The template includes Firebase SDK scripts and app-specific JS
3. On page load, JavaScript reads the injected Firebase config variables, initialises the Firebase SDK, authenticates the user (if logged in), and then queries Firestore directly
4. Data is rendered into the DOM by the client-side JS

This means Flask is essentially a **static file server** for the HTML structure — all real-time data reads and writes go directly from the browser to Firestore, governed by Security Rules.

### Navigation

The nav bar includes links to: Home, Events (Explore), Studio (Add Event), Scan, Tickets, Shared Tickets, Profile, and Login/Logout. A city picker is always visible, powered by the Google Maps geocode proxy.

### Mobile layout

Two home templates exist — `home.html` (desktop) and `home_mobile.html` (mobile). Flask detects device type and serves accordingly (see Section 14). The remaining templates are assumed to be responsive via CSS.

---

## 8. Page-by-Page Breakdown

### Home (`/`)
Sections rendered on the home page:
- **Spotlight carousel** — Hero marquee events; swipeable on mobile
- **Trending** — Events ranked by bookings, buzz, and ratings
- **Category filter bar** — Tap to filter the feed instantly
- **Personalised section** — Recommendations built from the user's past tickets (stronger when signed in)
- **Near [City]** — Events within ~55 km, distance-ranked when location is available
- **Featured** — Handpicked/curated events by organisers
- **Hot Picks / Popular Right Now** — Highest booked events this week
- **Upcoming** — Events launching soon
- **City selector modal** — Allows manual city selection or GPS detect
- **Email subscribe footer** — Newsletter opt-in
- **Footer** — Social links, category/explore/organiser links, placeholder App Store / Google Play buttons

### Explore (`/explore`)
- Search bar with real-time Firestore query
- Category tab bar (All + dynamic categories)
- **Advanced filter panel** (slide-in drawer):
  - Price range
  - City
  - Event type
  - Featured-only toggle
  - Online-only toggle
  - Reset and Apply buttons
- Results grid rendered dynamically

### Auth (`/auth`)
- Firebase Authentication UI
- Handles sign-up and sign-in
- Redirects back to home on success

### Event Details (`/event/<event_id>`)
- Hero image
- Title, date, time, venue
- Ticket types with prices
- Event agenda/schedule
- Reviews section
- Book Now CTA → `/book/<event_id>`

### Booking (`/book/<event_id>`)
- Ticket type selection
- Quantity picker
- Promo code input (validates against Firestore `promo_codes` collection)
- Order summary
- Proceeds to payment

### Payment (`/payment/<event_id>`)
- Payment details entry
- On success → creates ticket document in Firestore, creates payment record
- Redirects to `/payment_success`

### My Tickets (`/my-tickets`)
- Lists all tickets where `user_id == currentUser.uid`
- Each ticket shows event name, date, seat info, QR code
- Share button to initiate ticket sharing

### Shared Tickets (`/shared-tickets`)
- Tickets received from other users (where `shared_by != currentUser.uid` but `user_id == currentUser.uid`)
- Accept / Reject actions

### Ticket Details (`/ticket/<ticket_id>`)
- Full ticket info
- Embedded QR code for scan-in
- Sharing controls

### Scan Pass / Scan Centre (`/scan-pass/<ticket_id>`, `/scan-center`)
- Uses device camera to scan QR codes
- `ticket_scan.html` is reused in two modes:
  - **Ticket mode** (`scan_pass`): shows a specific ticket's QR for the attendee to present
  - **Scanner mode** (`scan_center`): opens the camera for the organiser to scan attendees; validates against Firestore and logs the scan to `/events/{eventId}/scan_logs`

### Profile (`/profile`) & Edit Profile (`/profile/edit`)
- Displays display name, email, avatar
- Edit form allows updating name, avatar (uploaded to Cloudinary), and other profile fields

### Notifications (`/notifications`)
- Reads from Firestore `notifications` collection where `user_id == currentUser.uid`
- Shows ticket share invitations, acceptances, rejections
- Mark-as-read updates the document

### Add Event / Organiser Studio (`/add-event`)
- Multi-step form: basic info → tickets → agenda → images → publish
- Image upload uses Cloudinary unsigned upload
- Creates document in Firestore `events` collection with `organizer_id = currentUser.uid`
- Creates sub-collections: `ticketTypes`, `agenda`

### Manage Events (`/organizer/manage`) & My Events (`/my-events`)
- Lists all events where `organizer_id == currentUser.uid`
- Edit, update metrics, delete

### Support (`/support`)
- Static content: help, privacy policy, terms of service

---

## 9. Firestore Data Model

The following Firestore collections are referenced in `firestore.rules` and the application code:

### `users/{userId}`
User profile documents. Document ID = Firebase Auth UID.

Sub-collection: `share_rejections/{rejId}` — Records of ticket share rejections by this user.

### `categories/{categoryId}`
Event categories. Read-only for all users; write-protected (no public writes).

### `events/{eventId}`
Event documents. Key fields:
- `organizer_id` — Firebase Auth UID of the creator
- `title`, `description`, `date`, `time`, `venue`, `city`
- `is_featured`, `is_online`
- `image_url` (Cloudinary)

Sub-collections:
- `ticketTypes/{ticketTypeId}` — Ticket tiers and prices
- `ticket_types/{ticketTypeId}` — Alternate path (legacy or alias)
- `agenda/{agendaId}` — Schedule items
- `scan_logs/{logId}` — QR scan-in records (append-only)

### `promo_codes/{code}`
Promo code documents. Public read. No public write.

Sub-collection: `redemptions/{redemptionId}` — Each use of a promo code (create-only for signed-in users).

### `bookmarks/{bookmarkId}`
Saved events. Each document has `user_id`. Owner can create/delete; no updates.

### `tickets/{ticketId}`
The core booking record. Key fields:
- `user_id` — Current holder's UID
- `event_id` — Reference to the event
- `status` — e.g., `'confirmed'`
- `checked_in` — Boolean; set to `true` on scan-in
- `shared_by` — UID of the user who shared this ticket (if shared)
- `shared_from_ticket_id` — Reference to the original ticket (if split)
- `shared_recipient_uid` — UID of the intended recipient
- `quantity` — Number of seats

### `payments/{paymentId}`
Payment records. Key fields:
- `user_id` — Payer's UID

Create-only after creation; no updates or deletes.

### `reviews/{reviewId}`
Event reviews. Key fields:
- `user_id` — Author's UID

Public read; owner can create, update, and delete.

### `notifications/{notifId}`
In-app notifications. Key fields:
- `user_id` — Recipient's UID
- `type` — `'ticket_share'` | `'ticket_share_update'`
- `ref_ticket_id` — Reference to the related ticket

Read and update by owner; create with strict validation.

### `qr_validations/{scanId}`
QR scan validation records. Create-only after creation. No updates or deletes.

---

## 10. Firestore Security Rules — Line-by-Line

`firestore.rules` is 201 lines. Here is a breakdown of every rule and helper function.

### Helper Functions

```javascript
function signedIn() {
  return request.auth != null;
}
```
Returns `true` if the request comes from an authenticated user.

```javascript
function isOwner(userId) {
  return signedIn() && request.auth.uid == userId;
}
```
Returns `true` if the authenticated user's UID matches the given `userId`.

```javascript
function isEventOrganizer(eventId) {
  return signedIn()
    && exists(/databases/$(database)/documents/events/$(eventId))
    && get(/databases/$(database)/documents/events/$(eventId)).data.organizer_id == request.auth.uid;
}
```
Cross-document read: fetches the event document and checks `organizer_id`. Used to gate ticket scanning, scan log reads, and event sub-collection writes.

```javascript
function ticketDoc(ticketId) {
  return get(/databases/$(database)/documents/tickets/$(ticketId));
}
function sourceTicket(sourceId) {
  return get(/databases/$(database)/documents/tickets/$(sourceId));
}
```
Helpers to fetch ticket documents by ID for use in other rule conditions.

```javascript
function canCreateSharedTicket() { ... }
```
Enforces the business rules for ticket sharing:
- User must be signed in
- The new ticket's `shared_by` must equal the requester's UID
- The source ticket must exist and belong to the requester
- The source ticket must have `status == 'confirmed'` and `checked_in != true`
- The recipient (`user_id`) must be different from the sharer
- `quantity` must be a positive integer

```javascript
function ticketHasEventId() { ... }
function canReadSplitDerivedFromOwnedRoot(data) { ... }
```
Helper functions for the multi-clause ticket read rules. The split-derived ticket read checks that the ticket's source (`shared_from_ticket_id`) belongs to the requester.

```javascript
function notifTicketRefOk() { ... }
function notifTicketData() { ... }
function canCreateTicketShareNotif() { ... }
function canCreateTicketShareUpdateNotif() { ... }
```
Notification creation rules. These validate that a `ticket_share` notification is created by the sharer, and a `ticket_share_update` notification (accept/reject) is created by the recipient.

### Collection Rules Summary

| Collection | Read | Create | Update | Delete |
|---|---|---|---|---|
| `users` | Any signed-in user | Owner only | Owner only | Never |
| `users/.../share_rejections` | Owner | Owner | Owner | Owner |
| `categories` | Anyone | Never | Never | Never |
| `events` | Anyone | Signed-in (must set own organizer_id) | Organiser | Organiser |
| `events/.../ticketTypes` | Anyone | Organiser | Organiser | Organiser |
| `events/.../ticket_types` | Anyone | Organiser | Organiser | Organiser |
| `events/.../agenda` | Anyone | Organiser | Organiser | Organiser |
| `events/.../scan_logs` | Organiser | Organiser | Never | Never |
| `promo_codes` | Anyone | Never | Never | Never |
| `promo_codes/.../redemptions` | Signed-in | Signed-in | Never | Never |
| `bookmarks` | Signed-in | Signed-in (own user_id) | Never | Owner |
| `tickets` | Owner / Organiser / Sharer / Derived | Signed-in (own or valid share) | Owner or Organiser | Never |
| `payments` | Owner | Signed-in (own user_id) | Never | Never |
| `reviews` | Anyone | Signed-in (own user_id) | Owner | Owner |
| `notifications` | Owner | Owner or validated share notif | Owner | Never |
| `qr_validations` | Signed-in | Signed-in | Never | Never |

---

## 11. Firebase Authentication

Authentication is handled entirely client-side using the Firebase JS SDK. Flask plays no role in auth — it has no session management for users. The server trusts Firebase's client-side ID tokens only indirectly through Firestore's security rules (which evaluate `request.auth` from the token).

Supported methods (configurable in Firebase Console):
- Email/password
- Google OAuth (likely, given the target audience)

After authentication, the Firebase UID is used as the document ID in `users/{userId}` and as the `user_id` field in all user-owned documents.

---

## 12. Cloudinary Image Pipeline

Event images are uploaded directly from the browser to Cloudinary using an **unsigned upload preset**. This avoids any image data touching the Flask server.

**Upload flow:**
1. Organiser selects an image in the event creation form (`add_event.html`)
2. JS POSTs the image directly to `CLOUDINARY_UPLOAD_URL` with the `upload_preset` parameter
3. Cloudinary returns a `secure_url`
4. The URL is stored in the Firestore `events` document as `image_url`

**Folder:** All uploads go into the `CLOUDINARY_UPLOAD_FOLDER` (default: `events`).

User avatars likely follow the same pattern, uploaded during profile edit and stored in `users/{userId}`.

---

## 13. Google Maps Geocoding Proxy

### Why a proxy?

Browser-side API key usage exposes the key to anyone who inspects network requests. Evorra keeps the key server-side and routes all geocoding through Flask at `/api/geocode/json`.

### How it works

The client-side script (`static/js/city-picker.js`) calls:

```
GET /api/geocode/json?latlng=23.0225,72.5714
GET /api/geocode/json?address=Ahmedabad
```

Flask's `_proxy_google_geocode()` function:
1. Reads `GOOGLE_MAPS_API_KEY` from the server environment
2. Appends the key to the Google Maps URL
3. Makes the outbound request with `urllib.request` (standard library, no `requests` dependency)
4. Forwards Google's JSON response to the browser

### Supported query parameters

- `latlng` — Latitude and longitude string (`"lat,lng"`) for reverse geocoding
- `address` — Address string for forward geocoding
- `result_type` — Optional filter (e.g., `"locality"`)

### Usage in the UI

- **Detect My Location** — Uses `navigator.geolocation.getCurrentPosition()` to get lat/lng, then calls `/api/geocode/json?latlng=...` to resolve it to a city name
- **City search** — Types a city name, calls `/api/geocode/json?address=...` to validate and retrieve coordinates

The resolved city is displayed in the nav bar ("Near Ahmedabad") and used to filter nearby events.

---

## 14. Mobile Detection Strategy

Flask detects mobile clients in the `home()` route using two signals:

```python
user_agent = (request.headers.get('User-Agent') or '').lower()
ch_mobile = (request.headers.get('sec-ch-ua-mobile') or '').strip()

is_mobile = any(token in user_agent for token in [
    'mobile', 'android', 'iphone', 'ipod', 'windows phone', 'ipad', 'tablet'
]) or ch_mobile == '?1'
```

**Signal 1 — User-Agent string:** Checked for six mobile/tablet keywords (case-insensitive).

**Signal 2 — `Sec-CH-UA-Mobile` Client Hint:** A modern browser header that explicitly signals `?1` for mobile devices. This is more reliable than UA string parsing for modern browsers.

If either signal is `True`, Flask renders `home_mobile.html` instead of `home.html`. All other routes serve a single template assumed to be responsive.

The `/home-mobile` route forces the mobile template regardless of device — useful for testing.

---

## 15. Ticket Sharing System

The ticket sharing system is the most complex feature in the application, with dedicated Firestore rules to enforce its business logic.

### Sharing flow

1. An attendee opens their ticket (must be `status == 'confirmed'` and `checked_in != true`)
2. They initiate a share — the app creates a new ticket document in Firestore with:
   - `shared_by`: sharer's UID
   - `shared_from_ticket_id`: original ticket ID
   - `user_id`: recipient's UID
   - `quantity`: number of seats shared (positive integer)
3. A `ticket_share` notification is created for the recipient

### Recipient actions

4. The recipient sees the shared ticket in `/shared-tickets`
5. They accept or reject
6. On accept: the ticket status is updated; the sharer's original ticket may be updated accordingly
7. A `ticket_share_update` notification is sent back to the sharer

### Security rule enforcement

The `canCreateSharedTicket()` function in `firestore.rules` ensures:
- Only the original ticket owner can share
- The source ticket must be confirmed and not yet checked in
- The recipient cannot be the sharer themselves
- Quantity must be valid

The `canReadSplitDerivedFromOwnedRoot()` function allows the sharer to read the derived ticket even though they are not its `user_id`.

### Rejection tracking

When a recipient rejects a share, a document is created in `users/{userId}/share_rejections/{rejId}` to track the rejection.

---

## 16. QR Code Scan System

### Attendee side

Each ticket has an embedded QR code. The `ticket_details.html` and `ticket_scan.html` pages display this QR code for the attendee to present at the event entrance.

### Organiser side — Scan Centre (`/scan-center`)

`ticket_scan.html` is reused in scanner mode (`scanner_mode=True`, `ticket_id=''`). In this mode:
1. The organiser's camera is activated
2. The app reads QR codes from the camera feed
3. Each scanned QR code is validated against Firestore:
   - Check the ticket exists
   - Check `event_id` matches the organiser's event
   - Check `checked_in != true`
4. If valid: updates `tickets/{ticketId}.checked_in = true` and creates a record in `events/{eventId}/scan_logs/{logId}`
5. The scan log is append-only (no update or delete allowed by security rules)

### `qr_validations` collection

An additional `qr_validations` collection exists, writable by any signed-in user. This may be used as a deduplication or audit trail mechanism separate from the scan logs.

---

## 17. Notification System

Notifications are stored in Firestore under `notifications/{notifId}`.

### Document structure

| Field | Type | Description |
|---|---|---|
| `user_id` | string | Recipient's UID |
| `type` | string | `'ticket_share'` or `'ticket_share_update'` |
| `ref_ticket_id` | string | ID of the related ticket |
| `read` | boolean | Whether the user has seen it |

### Creation rules

- `ticket_share`: Created by the sharer. `ref_ticket_id` must exist in `tickets`, and that ticket's `shared_by` must match the sharer's UID.
- `ticket_share_update`: Created by the recipient (accept/reject). The notification's `user_id` must be the sharer's UID, and the ref ticket's `user_id` or `shared_recipient_uid` must match the requester.

### Read / update rules

- Only the `user_id` (recipient) can read and mark notifications as read
- No deletions

---

## 18. Organiser Studio

The organiser studio (`/add-event`) is a full event creation form. Based on the route structure and Firestore model, it covers:

- **Basic info** — Title, description, date, time, city, venue, online flag
- **Images** — Cloudinary unsigned upload; `image_url` stored in Firestore
- **Ticket types** — Multiple tiers (e.g., General, VIP) with name, price, and capacity; written to `events/{id}/ticketTypes`
- **Agenda** — Schedule items with time and description; written to `events/{id}/agenda`
- **Promo codes** — Created in `promo_codes` (if this is wired in the studio)
- **Publish** — Creates the root `events/{id}` document with `organizer_id = currentUser.uid`

The **Manage Events dashboard** (`/organizer/manage`) lets organisers:
- View all their events
- Edit event details
- View booking metrics (booked ticket count, revenue, etc.)
- Delete events

---

## 19. Deployment — Vercel

The project is deployed at `https://evorra-jade.vercel.app`.

### Vercel + Flask

Vercel supports Python via serverless functions. A `vercel.json` config (not visible in the repo but required) would map all routes to the Flask app as a serverless function.

### Environment variables on Vercel

All values from `.env.example` must be set in the Vercel project's **Environment Variables** dashboard. They are injected at build/runtime, just as `python-dotenv` would inject them locally.

### Static assets

The `static/` folder is served by Flask (`send_from_directory`). On Vercel, static files may be served directly by Vercel's CDN if configured in `vercel.json`, bypassing the Flask function for better performance.

### Port

Vercel manages the port; the `PORT` env var is ignored in the serverless context.

---

## 20. Python Dependencies

`requirements.txt` contains exactly 4 packages:

| Package | Purpose |
|---|---|
| `flask` | Web framework — routing, Jinja2 templating, request/response handling |
| `flask-cors` | CORS headers on all responses |
| `firebase-admin` | Listed but not visibly used in `app.py`; likely available for server-side Firestore operations in scripts or future endpoints |
| `python-dotenv` | Loads `.env` file into `os.environ` at startup |

No HTTP client library (requests, httpx) — the geocode proxy uses Python's built-in `urllib`.

---

## 21. Security Considerations

### Secrets management
- `.env` is gitignored; `.env.example` has no real values
- Google Maps API key is **never** sent to the browser
- Firebase web config is intentionally public (protected by Firestore rules)
- Cloudinary uses unsigned upload preset (scoped to a folder)

### Firestore rules
- All data access is gated by authenticated UID checks
- Cross-document reads in rules are used carefully (count against Firestore read quota)
- Tickets and payments can never be deleted — immutable audit trail
- Scan logs are append-only

### CORS
- `CORS(app)` enables all origins. This is appropriate for a public-facing app but could be tightened to allow only the production domain in a stricter deployment.

### Flask `SECRET_KEY`
- Falls back to `'dev-secret-key'` if not set. **Must** be overridden in production.

### Client-side auth enforcement
- Route access control (e.g., `/my-tickets` redirecting unauthenticated users) is enforced in client-side JS, not Flask. Flask routes themselves are unprotected — security comes from Firestore rules, not Flask.

---

## 22. Known Patterns & Design Decisions

**Pattern: Thin Flask, fat client**
Flask is a dumb template server. All business logic (querying events, booking, sharing) happens in browser JS talking directly to Firestore. This gives a snappy UX without server round-trips for data, but means Firebase Security Rules are the only real backend security layer.

**Pattern: Two home templates**
Rather than a single CSS-responsive home template, the project ships separate `home.html` and `home_mobile.html`. This allows radical layout differences between desktop and mobile without complex CSS breakpoints.

**Pattern: Server-side API key proxy**
The geocode proxy (`/api/geocode/json`) is a well-engineered solution to the common problem of needing a secret API key on the client. It adds a minimal server hop while keeping the key completely off the browser.

**Pattern: No ORM / no traditional DB**
Firestore is a NoSQL document store. There is no SQLAlchemy, no migrations, no schema definitions in Python. The data model is defined implicitly by the Firestore rules and the JS code that reads/writes it.

**Pattern: Unsigned Cloudinary uploads**
Using an unsigned preset means image data never touches Flask. The trade-off is slightly weaker upload control (any user can upload to the preset), mitigated by folder isolation and Cloudinary's own access controls.

**Pattern: `firebase-admin` in requirements but unused in app.py**
The `firebase-admin` package is installed but not imported in `app.py`. It is likely used by maintenance/admin scripts (referenced in `.env.example` as `scripts/sync_event_metrics.py`) that run outside the web server context.

---

*This document reflects the codebase as of commit history on the `main` branch as of May 2026.*
