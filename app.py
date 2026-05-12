from flask import Flask, render_template, jsonify, request, send_from_directory, redirect, url_for
from flask_cors import CORS
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore, messaging

load_dotenv()

app = Flask(__name__)
CORS(app)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-secret-key')
app.config['GOOGLE_MAPS_API_KEY'] = (os.getenv('GOOGLE_MAPS_API_KEY') or '').strip()
app.config['ADMIN_SYNC_TOKEN'] = (os.getenv('ADMIN_SYNC_TOKEN') or '').strip()


def _init_firebase_admin():
    """Initialize Firebase Admin SDK once and return Firestore client."""
    if not firebase_admin._apps:
        # Check for JSON string (Vercel/Production)
        service_account_json = os.getenv('FIREBASE_SERVICE_ACCOUNT_JSON')
        if service_account_json:
            try:
                import json
                cred_dict = json.loads(service_account_json)
                cred = credentials.Certificate(cred_dict)
                firebase_admin.initialize_app(cred)
                return firestore.client()
            except Exception as e:
                print(f"[Firebase] Error loading JSON from env: {e}")

        # Fallback to file path (Local)
        service_account_path = (os.getenv('GOOGLE_APPLICATION_CREDENTIALS') or '').strip()
        if service_account_path and os.path.exists(service_account_path):
            cred = credentials.Certificate(service_account_path)
            firebase_admin.initialize_app(cred)
        else:
            # Last resort: Default credentials
            try:
                firebase_admin.initialize_app()
            except:
                pass
    return firestore.client()


def _is_event_expired(data: dict) -> bool:
    """Return True if the event's effective end date is before today (midnight local).

    Checks (in order): event_days[].end_at, end_time, date, start_time.
    Uses UTC midnight as the comparison threshold so that an event whose last
    day is *today* is still considered active.
    """
    if not data:
        return True
    status = str(data.get('status') or '').lower()
    if status in {'closed', 'cancelled', 'completed', 'ended', 'archived'}:
        return True
    if data.get('is_closed') is True:
        return True

    today_utc = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    def _to_dt(val):
        """Convert Firestore Timestamp, datetime, or str to an aware datetime."""
        if val is None:
            return None
        if hasattr(val, 'tzinfo'):  # already a datetime
            return val if val.tzinfo else val.replace(tzinfo=timezone.utc)
        # Firestore Timestamp from Admin SDK has .timestamp() and .ToDatetime()
        if hasattr(val, 'timestamp_pb') or hasattr(val, 'seconds'):
            try:
                return datetime.fromtimestamp(val.timestamp(), tz=timezone.utc)
            except Exception:
                pass
        try:
            dt = datetime.fromisoformat(str(val))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except Exception:
            pass
        return None

    # Check multi-day event_days
    event_days = data.get('event_days') or []
    if isinstance(event_days, list) and event_days:
        best = None
        for day in event_days:
            if not isinstance(day, dict):
                continue
            raw = day.get('end_at') or day.get('end_time') or day.get('end')
            dt = _to_dt(raw)
            if dt and (best is None or dt > best):
                best = dt
        if best:
            return best < today_utc

    # Fallback chain: end_time -> date -> start_time
    for field in ('end_time', 'endTime', 'date', 'start_time', 'startTime'):
        raw = data.get(field)
        dt = _to_dt(raw)
        if dt:
            return dt < today_utc

    return False  # No date found – do not block


def _extract_bearer_token():
    auth_header = (request.headers.get('Authorization') or '').strip()
    if auth_header.lower().startswith('bearer '):
        return auth_header[7:].strip()
    return ''


def _admin_sync_authorized():
    """Shared-secret authorization for server maintenance endpoints."""
    configured = app.config.get('ADMIN_SYNC_TOKEN') or ''
    if not configured:
        return False
    provided = _extract_bearer_token() or (request.headers.get('X-Admin-Token') or '').strip()
    return bool(provided) and provided == configured


def send_fcm_notification(token, title, body, data=None):
    """Send a push notification to a specific device token."""
    try:
        message = messaging.Message(
            notification=messaging.Notification(
                title=title,
                body=body,
            ),
            data=data or {},
            token=token,
        )
        response = messaging.send(message)
        print(f'Successfully sent message: {response}')
        return True
    except Exception as e:
        print(f'Error sending FCM message: {e}')
        return False


@app.route('/api/send-push', methods=['POST'])
def api_send_push():
    """
    Endpoint to manually trigger a push notification.
    Payload: { "token": "...", "title": "...", "body": "...", "data": {} }
    """
    if not _admin_sync_authorized():
        return jsonify({'ok': False, 'error': 'UNAUTHORIZED'}), 401
    
    body = request.get_json(silent=True) or {}
    token = body.get('token')
    title = body.get('title', 'Evorra Update')
    msg_body = body.get('body', 'You have a new update.')
    data = body.get('data', {})

    if not token:
        return jsonify({'ok': False, 'error': 'MISSING_TOKEN'}), 400

    success = send_fcm_notification(token, title, msg_body, data)
    return jsonify({'ok': success})


@app.route('/api/notify-purchase', methods=['POST'])
def api_notify_purchase():
    """
    Endpoint called by the frontend after a successful purchase.
    Expects: { "user_id": "...", "event_title": "...", "ticket_count": 1, "amount": 100 }
    """
    body = request.get_json(silent=True) or {}
    user_id = body.get('user_id')
    event_title = body.get('event_title', 'Your Event')
    ticket_count = body.get('ticket_count', 1)
    amount = body.get('amount', 0)

    if not user_id:
        return jsonify({'ok': False, 'error': 'MISSING_USER_ID'}), 400

    try:
        db = _init_firebase_admin()
        user_doc = db.collection('users').document(user_id).get()
        if not user_doc.exists:
            return jsonify({'ok': False, 'error': 'USER_NOT_FOUND'}), 404
        
        data = user_doc.to_dict()
        token = data.get('fcm_token')
        
        if not token:
            return jsonify({'ok': False, 'error': 'NO_FCM_TOKEN'}), 200 # Silent fail if user hasn't enabled notifications

        title = "🎟️ Booking Confirmed!"
        msg = f"Success! Your {ticket_count} ticket(s) for {event_title} are ready. View them in 'My Tickets'."
        
        success = send_fcm_notification(token, title, msg, {
            "action_target": "/my-tickets",
            "type": "purchase_success"
        })
        return jsonify({'ok': success})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.context_processor
def inject_public_runtime_config():
    return {
        'firebase_api_key': os.getenv('FIREBASE_API_KEY', ''),
        'firebase_auth_domain': os.getenv('FIREBASE_AUTH_DOMAIN', ''),
        'firebase_project_id': os.getenv('FIREBASE_PROJECT_ID', ''),
        'firebase_storage_bucket': os.getenv('FIREBASE_STORAGE_BUCKET', ''),
        'firebase_messaging_sender_id': os.getenv('FIREBASE_MESSAGING_SENDER_ID', ''),
        'firebase_app_id': os.getenv('FIREBASE_APP_ID', ''),
        'cloudinary_cloud_name': os.getenv('CLOUDINARY_CLOUD_NAME', ''),
        'cloudinary_upload_preset': os.getenv('CLOUDINARY_UPLOAD_PRESET', ''),
        'cloudinary_upload_url': os.getenv('CLOUDINARY_UPLOAD_URL', ''),
        'cloudinary_upload_folder': os.getenv('CLOUDINARY_UPLOAD_FOLDER', 'events'),
        'app_public_url': os.getenv('APP_PUBLIC_URL', ''),
    }


def _proxy_google_geocode():
    """Forward allowed query params to Google Geocoding JSON API (key from server env only)."""
    key = (app.config.get('GOOGLE_MAPS_API_KEY') or '').strip()
    if not key:
        return jsonify(
            {
                'status': 'REQUEST_DENIED',
                'error_message': 'GOOGLE_MAPS_API_KEY is not set on the server (.env).',
                'results': [],
            }
        )

    latlng = request.args.get('latlng', '').strip()
    address = request.args.get('address', '').strip()
    result_type = request.args.get('result_type', '').strip()
    if not latlng and not address:
        return jsonify(
            {'status': 'INVALID_REQUEST', 'error_message': 'Missing latlng or address', 'results': []}
        ), 400

    params = {'key': key}
    if latlng:
        params['latlng'] = latlng
    if address:
        params['address'] = address
    if result_type:
        params['result_type'] = result_type

    url = 'https://maps.googleapis.com/maps/api/geocode/json?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(
        url,
        headers={
            'Accept': 'application/json',
            'Accept-Language': 'en',
            'User-Agent': 'Evorra/1.0 (Flask geocode proxy)',
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=18) as resp:
            payload = json.loads(resp.read().decode('utf-8'))
        return jsonify(payload)
    except urllib.error.HTTPError as e:
        return jsonify(
            {'status': 'ERROR', 'error_message': str(e.reason or e.code), 'results': []}
        ), 502
    except Exception as e:
        return jsonify({'status': 'ERROR', 'error_message': str(e), 'results': []}), 502


# --- Routes ---


@app.route('/favicon.ico')
def favicon():
    """Serve default favicon path for browsers that request /favicon.ico."""
    return send_from_directory(app.static_folder, 'favicon.ico', mimetype='image/vnd.microsoft.icon')


@app.route('/api/geocode/json')
def api_geocode_json():
    """Browser-safe proxy: same-origin fetch avoids CORS and keeps the API key on the server."""
    return _proxy_google_geocode()


@app.route('/firebase-messaging-sw.js')
def firebase_messaging_sw():
    """Serve the Firebase Messaging service worker with injected config."""
    return render_template('firebase-messaging-sw.js'), 200, {'Content-Type': 'application/javascript'}


@app.route('/api/admin/sync-event-metrics', methods=['POST'])
def sync_event_metrics():
    """
    Recompute and persist event metrics from confirmed/used tickets.

    Security:
      - Requires ADMIN_SYNC_TOKEN in env.
      - Send via Authorization: Bearer <token> OR X-Admin-Token.
    Payload (optional):
      { "event_id": "<id>" } to sync one event only.
    """
    if not _admin_sync_authorized():
        return jsonify({'ok': False, 'error': 'UNAUTHORIZED'}), 401

    try:
        db = _init_firebase_admin()
    except Exception as e:
        return jsonify({'ok': False, 'error': 'FIREBASE_ADMIN_INIT_FAILED', 'detail': str(e)}), 500

    body = request.get_json(silent=True) or {}
    requested_event_id = str(body.get('event_id') or '').strip()
    valid_statuses = {'confirmed', 'used'}

    try:
        if requested_event_id:
            event_ids = [requested_event_id]
        else:
            event_ids = [doc.id for doc in db.collection('events').stream()]

        updated = []
        for event_id in event_ids:
            ticket_query = db.collection('tickets').where('event_id', '==', event_id).stream()
            sold_count = 0
            revenue_total = 0
            for tdoc in ticket_query:
                t = tdoc.to_dict() or {}
                status = str(t.get('status') or '').lower()
                if status not in valid_statuses:
                    continue
                qty = int(t.get('quantity') or 0)
                amt = int(t.get('total_amount') or 0)
                if qty < 0:
                    qty = 0
                if amt < 0:
                    amt = 0
                sold_count += qty
                revenue_total += amt

            db.collection('events').document(event_id).set(
                {
                    'tickets_sold': sold_count,
                    'total_revenue': revenue_total,
                    'updatedAt': firestore.SERVER_TIMESTAMP,
                },
                merge=True,
            )
            updated.append(
                {
                    'event_id': event_id,
                    'tickets_sold': sold_count,
                    'total_revenue': revenue_total,
                }
            )

        return jsonify(
            {
                'ok': True,
                'synced_events': len(updated),
                'results': updated,
            }
        )
    except Exception as e:
        return jsonify({'ok': False, 'error': 'SYNC_FAILED', 'detail': str(e)}), 500


@app.route('/')
def home():
    user_agent = (request.headers.get('User-Agent') or '').lower()
    ch_mobile = (request.headers.get('sec-ch-ua-mobile') or '').strip()
    is_mobile = any(token in user_agent for token in ['mobile', 'android', 'iphone', 'ipod', 'windows phone', 'ipad', 'tablet']) or ch_mobile == '?1'
    if is_mobile:
        return render_template('home_mobile.html')
    return render_template('home.html')

@app.route('/home-mobile')
def home_mobile():
    return render_template('home_mobile.html')

@app.route('/auth')
def auth():
    return render_template('auth.html')

@app.route('/explore')
def explore():
    return render_template('explore.html')

@app.route('/event/<event_id>')
def event_details(event_id):
    try:
        db = _init_firebase_admin()
        doc = db.collection('events').document(event_id).get()
        if doc.exists:
            data = doc.to_dict() or {}
            if _is_event_expired(data):
                return redirect(url_for('explore'))
    except Exception:
        pass  # On error, still render the page; JS will handle it
    return render_template('event_details.html', event_id=event_id)

@app.route('/book/<event_id>')
def book_ticket(event_id):
    try:
        db = _init_firebase_admin()
        doc = db.collection('events').document(event_id).get()
        if doc.exists:
            data = doc.to_dict() or {}
            if _is_event_expired(data):
                return redirect(url_for('event_details', event_id=event_id))
    except Exception:
        pass
    return render_template('booking.html', event_id=event_id)

@app.route('/payment/<event_id>')
def payment(event_id):
    try:
        db = _init_firebase_admin()
        doc = db.collection('events').document(event_id).get()
        if doc.exists:
            data = doc.to_dict() or {}
            if _is_event_expired(data):
                return redirect(url_for('event_details', event_id=event_id))
    except Exception:
        pass
    return render_template('payment.html', event_id=event_id)

@app.route('/payment_success')
def payment_success():
    return render_template('success.html')

@app.route('/my-tickets')
def my_tickets():
    return render_template('my_tickets.html')

@app.route('/shared-tickets')
def shared_tickets():
    return render_template('shared_tickets.html')

@app.route('/ticket/<ticket_id>')
def ticket_details(ticket_id):
    return render_template('ticket_details.html', ticket_id=ticket_id)

@app.route('/scan-pass/<ticket_id>')
def scan_pass(ticket_id):
    return render_template('ticket_scan.html', ticket_id=ticket_id)

@app.route('/scan-center')
def scan_center():
    return render_template('ticket_scan.html', ticket_id='', scanner_mode=True)

@app.route('/profile')
def profile():
    return render_template('profile.html')

@app.route('/add-event')
def add_event():
    return render_template('organizer/add_event.html')

@app.route('/support')
def support():
    return render_template('support.html')

# --- Organizer Routes ---

@app.route('/organizer/manage')
def manage_events():
    return render_template('organizer/manage_events.html')

@app.route('/my-events')
def my_events():
    return render_template('organizer/my_events.html')

@app.route('/notifications')
def notifications():
    return render_template('notifications.html')

@app.route('/profile/edit')
def edit_profile():
    return render_template('edit_profile.html')


@app.route('/profile/change-password')
def change_password():
    return render_template('change_password.html')

if __name__ == '__main__':
    app.run(
        debug=os.getenv('FLASK_DEBUG', '1') == '1',
        port=int(os.getenv('PORT', '5001'))
    )
