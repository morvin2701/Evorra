# Evorra

Evorra is an event discovery and ticketing platform with attendee and organizer experiences, built with Flask-rendered pages, Firebase Authentication, and Firestore.

It includes:
- Event discovery and booking
- Multi-day event ticket selection
- Ticket pass and scan/check-in flows
- Organizer event creation and management
- Notifications and profile management
- Dark/light theme system across pages

---

## Tech Stack

- **Backend/Web Server**: Flask
- **Frontend Rendering**: Jinja templates + HTML/CSS/JavaScript
- **Database**: Firestore (Firebase)
- **Auth**: Firebase Authentication (client-side)
- **Server SDK**: Firebase Admin SDK
- **Environment Management**: python-dotenv
- **Ops Helper**: Cron-triggered metrics sync script

---

## Repository Layout

```text
Evorra/
├── app.py
├── requirements.txt
├── scripts/
│   └── sync_event_metrics.py
├── static/
│   ├── css/
│   │   ├── showmates-theme.css
│   │   ├── evorra-pages.css
│   │   ├── style.css
│   │   ├── home-premium.css
│   │   └── city-picker.css
│   └── js/
│       ├── city-picker.js
│       ├── city-match.js
│       └── ip-location.js
└── templates/
    ├── base.html
    ├── home.html
    ├── home_mobile.html
    ├── explore.html
    ├── auth.html
    ├── event_details.html
    ├── booking.html
    ├── payment.html
    ├── success.html
    ├── my_tickets.html
    ├── ticket_details.html
    ├── shared_tickets.html
    ├── ticket_scan.html
    ├── profile.html
    ├── edit_profile.html
    ├── change_password.html
    ├── notifications.html
    ├── support.html
    └── organizer/
        ├── add_event.html
        ├── manage_events.html
        └── my_events.html
```

---

## Features

### Attendee
- Browse and discover events
- View event details
- Book tickets with quantity controls
- Select day for multi-day events
- Complete payment flow and view success state
- Access tickets and ticket details
- Manage profile and account settings
- Receive notifications

### Organizer
- Add events (including optional multiple event days)
- Manage listed events
- View organizer dashboards and event states
- Scan tickets/check entry

### Shared System Features
- Persistent light/dark mode support
- Theme-consistent UI tokens across pages
- Geocode/reverse-geocode address support in profile edit
- Server-side event metrics reconciliation utility

---

## Environment Variables

Create a `.env` file in project root.

### Required for app basics
- `SECRET_KEY`
- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_APP_ID`

### Firebase Admin (server access to Firestore)
- `GOOGLE_APPLICATION_CREDENTIALS` (path to service account JSON)  
  If omitted, default credential chain is used.

### Optional cloud/media/runtime variables
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_UPLOAD_PRESET`
- `CLOUDINARY_UPLOAD_URL`
- `CLOUDINARY_UPLOAD_FOLDER` (default: `events`)
- `APP_PUBLIC_URL`

### Optional geocode proxy
- `GOOGLE_MAPS_API_KEY` (used by `/api/geocode/json` proxy endpoint)

### Admin maintenance endpoint protection
- `ADMIN_SYNC_TOKEN` (required for `/api/admin/sync-event-metrics`)

### Runtime
- `FLASK_DEBUG` (default `1`)
- `PORT` (default `5001`)

---

## Local Setup

### 1) Create and activate virtual environment

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 2) Install dependencies

```bash
pip install -r requirements.txt
```

### 3) Configure `.env`

Set all required variables listed above, especially Firebase values.

### 4) Run app

```bash
python3 app.py
```

Default local URL: `http://127.0.0.1:5001`

---

## Route Map (Current)

### Web Pages
- `/` - Home (auto switches to mobile home for mobile user agents)
- `/home-mobile`
- `/auth`
- `/explore`
- `/event/<event_id>`
- `/book/<event_id>`
- `/payment/<event_id>`
- `/payment_success`
- `/my-tickets`
- `/shared-tickets`
- `/ticket/<ticket_id>`
- `/scan-pass/<ticket_id>`
- `/scan-center`
- `/profile`
- `/profile/edit`
- `/profile/change-password`
- `/support`
- `/add-event`
- `/organizer/manage`
- `/my-events`
- `/notifications`

### API Endpoints
- `GET /api/geocode/json`  
  Server-side proxy to Google Geocoding API.

- `POST /api/admin/sync-event-metrics`  
  Protected maintenance endpoint to recompute:
  - `events.tickets_sold`
  - `events.total_revenue`

  Auth options:
  - `Authorization: Bearer <ADMIN_SYNC_TOKEN>`
  - `X-Admin-Token: <ADMIN_SYNC_TOKEN>`

---

## Application Flows

### 1) Auth and protected navigation
- User opens public pages.
- Protected actions (booking, ticket actions, profile/organizer utilities) redirect to auth when needed.
- After login, user returns to intended destination via `next` pattern.

### 2) Discovery to booking
- User explores event feeds and opens event details.
- User starts booking.
- For multi-day events, user selects a specific day slot.
- Booking details continue to payment screen.
- On success, user lands on success page and ticket is reflected in user ticket lists.

### 3) Ticket lifecycle
- Ticket appears in `my_tickets`.
- Ticket details display selected event day/time when present.
- Ticket can be scanned/validated from scanner flow.

### 4) Organizer lifecycle
- Organizer adds event (including optional extra day rows).
- Event can be managed from organizer pages.
- Scanner flow supports entry validation.

### 5) Profile and address
- User edits profile with identity + contact + city.
- Address display field supports geocoded/reverse-geocoded display names.
- Address value is stored as `address_display_name`.

---

## Multi-Day Event Support

Implemented across organizer, booking, payment, and ticket details views:

- Organizer can define multiple day slots while creating/editing events.
- Event payload persists:
  - `event_days` (normalized array)
  - `event_day_count`
- Booking UI renders selectable day cards.
- Selected day is persisted into booking context and ticket payload.
- Ticket details display selected day context (`Day X` + date/time formatting).

---

## Theming and UI Consistency

Theme consistency is handled primarily by:
- `static/css/showmates-theme.css`
- `static/css/evorra-pages.css`

Design approach:
- Shared CSS variables/tokens for light and dark themes
- Page-level consistency locks for cards, inputs, text, and shells
- Explicit dark overrides for previously inconsistent components

Recommendation:
- Keep new component colors token-based (avoid hardcoded hex inside templates unless necessary).

---

## Event Metrics Sync (Cron)

Use this to keep `events.tickets_sold` and `events.total_revenue` aligned with ticket data.

### Manual run

```bash
ADMIN_SYNC_TOKEN=your-token python3 scripts/sync_event_metrics.py
```

### Sync one event only

```bash
ADMIN_SYNC_TOKEN=your-token python3 scripts/sync_event_metrics.py --event-id EVENT_ID
```

### Custom base URL

```bash
ADMIN_SYNC_TOKEN=your-token APP_BASE_URL=http://127.0.0.1:5001 python3 scripts/sync_event_metrics.py
```

### Example cron (every 5 minutes)

```bash
*/5 * * * * cd /Users/morvinvekariya/Desktop/Evorra && /usr/bin/env ADMIN_SYNC_TOKEN=your-token APP_BASE_URL=http://127.0.0.1:5001 /usr/bin/python3 scripts/sync_event_metrics.py >> /tmp/evorra-metrics-sync.log 2>&1
```

---

## Security Notes

- Do not commit `.env` or service account JSON files.
- Keep `ADMIN_SYNC_TOKEN` strong and rotated periodically.
- Keep privileged operations server-side.
- Validate and sanitize all external payloads and geocode responses.
- Use HTTPS in all deployed environments.

---

## Deployment Notes

Minimum requirements for deployment:
- Python runtime with dependencies from `requirements.txt`
- All required `.env` keys configured
- Firebase Admin credentials available in runtime
- Reverse proxy / platform routing to Flask app port
- Proper CORS and security header policies for production

For production:
- Set `FLASK_DEBUG=0`
- Use managed process runner (systemd, gunicorn, container, etc.)
- Configure centralized logs and monitoring

---

## Troubleshooting

### App starts but Firebase calls fail
- Verify Firebase env vars.
- Verify `GOOGLE_APPLICATION_CREDENTIALS` path and permissions.

### Geocode endpoint returns denied/error
- Check `GOOGLE_MAPS_API_KEY`.
- Confirm API restrictions and billing on GCP.

### Admin sync endpoint returns `UNAUTHORIZED`
- Ensure `ADMIN_SYNC_TOKEN` is set on server.
- Pass token via `Authorization: Bearer ...` or `X-Admin-Token`.

### Theme appears inconsistent on one page
- Inspect for hardcoded background/text colors in template styles.
- Migrate colors to shared theme tokens and dark overrides.

---

## Roadmap (Suggested)

- Introduce dedicated `/api/v1` JSON endpoints for mobile clients
- Standardize booking/payment server-side contracts
- Add automated tests for auth-protected flow and ticket lifecycle
- Add CI checks for linting, template integrity, and deployment readiness

---

## Detailed Data Model (Firestore)

The current app is client-heavy with Firestore as the source of truth for most user-facing flows.

### Collection: `users`
Common fields used across UI and profile workflows:
- `display_name`: string
- `email`: string
- `email_lower`: string
- `phone_number`: string
- `phone_normalized`: string (digits-focused normalized version)
- `city`: string
- `role`: string (`attendee` or `organizer`)
- `address_display_name`: string (full geocoded display name)
- `updated_time`: server timestamp

Legacy-compatible fields may also be read:
- `cities` as array/string
- `location` object with `latitude`, `longitude`
- `latitude`, `longitude` as top-level numeric fields

### Collection: `events`
Typical fields used by explore/booking/organizer pages:
- `title`, `description`, `category`, `city`, `venue_name`
- `start_time`, `end_time` (overall event window)
- `event_days`: array of day slots for multi-day events
- `event_day_count`: integer
- `ticket_price`, `total_tickets`, `tickets_available`
- `tickets_sold`, `total_revenue` (reconciled by sync endpoint)
- `status` (upcoming/live/completed/cancelled model as used in UI)
- `created_by` / organizer identity fields

Suggested `event_days` item shape:
```json
{
  "day_index": 1,
  "start_time": "2026-10-03T19:00:00+05:30",
  "end_time": "2026-10-03T23:00:00+05:30"
}
```

### Collection: `tickets`
Core fields used in purchase, display, cancellation, and scan:
- `event_id`
- `user_id`
- `quantity`
- `total_amount`
- `status` (`confirmed`, `used`, `cancelled`, etc.)
- `selected_day` (for multi-day ticket selection)
- `event_snapshot` (title/time/venue details at purchase time)
- `created_time`, `updated_time`

### Collection: `notifications`
Used by notifications UI:
- `user_id`
- `type`
- `title`
- `body`
- `read` boolean
- `created_time`
- optional deep-link context (`event_id`, `ticket_id`)

---

## Multi-Day Booking Contract

### Organizer side
`templates/organizer/add_event.html` collects:
- primary start/end date-time
- optional additional day rows

Normalization behavior:
- All day rows are parsed and sorted
- `day_index` values are assigned sequentially
- Event stores both:
  - detailed `event_days`
  - aggregate `start_time` (first day start), `end_time` (last day end)

### Attendee side
`templates/booking.html`:
- reads/normalizes `event_days`
- shows selectable day cards
- stores selected day in session context (`booking_selected_day`)

`templates/payment.html`:
- reads selected day from session
- includes `selected_day` in final ticket payload
- mirrors in `event_snapshot` for resilient rendering

`templates/ticket_details.html`:
- renders day-specific label/time when `selected_day` exists

---

## API Contracts (Current)

Only two backend JSON endpoints are currently exposed.

### `GET /api/geocode/json`
Purpose:
- Proxy request to Google Geocoding API
- Avoid exposing raw Google API key in browser clients

Accepted query params:
- `latlng` OR `address`
- optional `result_type`

Example:
```bash
curl "http://127.0.0.1:5001/api/geocode/json?latlng=23.0241,72.4780&result_type=locality"
```

Response:
- Proxied Google Geocoding JSON response
- On config errors returns `REQUEST_DENIED`/`ERROR` style payload

### `POST /api/admin/sync-event-metrics`
Purpose:
- Recompute event-level metrics from tickets collection
- Writes:
  - `events.tickets_sold`
  - `events.total_revenue`

Auth:
- `Authorization: Bearer <ADMIN_SYNC_TOKEN>`
- or `X-Admin-Token: <ADMIN_SYNC_TOKEN>`

Optional body:
```json
{ "event_id": "EVENT_ID" }
```

Default behavior:
- No `event_id` -> iterates all events
- Counts only ticket statuses in `{confirmed, used}`

Example:
```bash
curl -X POST "http://127.0.0.1:5001/api/admin/sync-event-metrics" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"event_id":"abc123"}'
```

---

## Detailed Web Flow Sequences

### Attendee happy path
1. Open `/` (or `/home-mobile` depending on user agent).
2. Browse cards/sections; open `/event/<event_id>`.
3. Tap book -> auth gate if required.
4. At `/book/<event_id>`, choose quantity and day.
5. Continue to `/payment/<event_id>`.
6. Confirm payment and write ticket.
7. Redirect to `/payment_success`.
8. See tickets in `/my-tickets`; open `/ticket/<ticket_id>`.

### Organizer happy path
1. Switch/use organizer account role.
2. Open `/add-event`.
3. Fill event details and optional day rows.
4. Publish event and verify in `/my-events` and `/organizer/manage`.
5. Use `/scan-center` during event check-in.

### Profile/address update flow
1. Open `/profile/edit`.
2. App loads profile data from Firestore.
3. Address display value precedence:
   - existing `address_display_name`
   - reverse geocode by coordinates when available
   - city-based lookup fallback
4. Save writes consolidated fields back to `users/<uid>`.

---

## Frontend Architecture Notes

### Template strategy
- `templates/base.html` provides shared shell and common scripts.
- Screen templates compose route-specific logic.
- JS remains page-local for most screens today.

### CSS strategy
- `showmates-theme.css`: major shared tokens/components.
- `evorra-pages.css`: cross-page consistency and locks.
- Page-level styles inside templates for local custom behavior.

### Theming strategy
- `data-theme` toggling with CSS variables.
- Dedicated light/dark tokens for major UI surfaces.
- Consistency overrides for known edge cases using high-specificity selectors.

---

## Mobile (Flutter) Migration Blueprint

Because this codebase is currently Firestore-centric on the client side:
- Start Flutter with Firebase Auth + Firestore directly.
- Reuse data shapes from web (`events`, `tickets`, `users`, `notifications`).
- Keep naming parity (`selected_day`, `event_days`, `address_display_name`).

Suggested route modules:
- `auth`
- `discover/events`
- `booking/payment`
- `tickets/scan`
- `profile/settings`
- `organizer`

Suggested backend evolution for mobile hardening:
- Introduce `/api/v1/*` for booking/payment finalization.
- Keep sensitive operations server-authoritative.
- Add token verification middleware for mobile JWTs.

---

## Configuration Reference (`.env` Example)

```env
SECRET_KEY=replace_me

FIREBASE_API_KEY=...
FIREBASE_AUTH_DOMAIN=...
FIREBASE_PROJECT_ID=...
FIREBASE_STORAGE_BUCKET=...
FIREBASE_MESSAGING_SENDER_ID=...
FIREBASE_APP_ID=...

GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/service-account.json

GOOGLE_MAPS_API_KEY=...

ADMIN_SYNC_TOKEN=replace_with_strong_token
APP_PUBLIC_URL=https://your-domain.example

CLOUDINARY_CLOUD_NAME=
CLOUDINARY_UPLOAD_PRESET=
CLOUDINARY_UPLOAD_URL=
CLOUDINARY_UPLOAD_FOLDER=events

FLASK_DEBUG=1
PORT=5001
```

---

## Development Checklist

Before starting work:
- Confirm `.env` is populated
- Confirm Firebase project and rules are correct
- Run app and verify auth + home route

Before merging:
- Verify both dark/light modes for changed screens
- Verify auth-gated routes still redirect correctly
- Verify multi-day booking still stores `selected_day`
- Verify ticket details render selected day properly
- Verify profile save updates address and phone fields

Before release:
- Set `FLASK_DEBUG=0`
- Ensure HTTPS and domain config are correct
- Rotate admin tokens and check secret handling
- Run metrics sync and verify event counters

---

## Known Constraints

- Many business operations are still client-driven via Firestore.
- Limited dedicated REST APIs exist today.
- Payment integration paths are evolving and should be kept server-authoritative over time.
- Comprehensive automated test coverage is still pending.

---

## License

Private project. Add formal license text if/when open-sourcing.

