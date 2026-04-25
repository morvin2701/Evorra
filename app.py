from flask import Flask, render_template, jsonify, request
from flask_cors import CORS
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-secret-key')


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
    }

# --- Routes ---

@app.route('/')
def home():
    return render_template('home.html')

@app.route('/auth')
def auth():
    return render_template('auth.html')

@app.route('/explore')
def explore():
    return render_template('explore.html')

@app.route('/event/<event_id>')
def event_details(event_id):
    return render_template('event_details.html', event_id=event_id)

@app.route('/book/<event_id>')
def book_ticket(event_id):
    return render_template('booking.html', event_id=event_id)

@app.route('/payment/<event_id>')
def payment(event_id):
    return render_template('payment.html', event_id=event_id)

@app.route('/payment_success')
def payment_success():
    return render_template('success.html')

@app.route('/my-tickets')
def my_tickets():
    return render_template('my_tickets.html')

@app.route('/ticket/<ticket_id>')
def ticket_details(ticket_id):
    return render_template('ticket_details.html', ticket_id=ticket_id)

@app.route('/scan-pass/<ticket_id>')
def scan_pass(ticket_id):
    return render_template('ticket_scan.html', ticket_id=ticket_id)

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

if __name__ == '__main__':
    app.run(
        debug=os.getenv('FLASK_DEBUG', '1') == '1',
        port=int(os.getenv('PORT', '5001'))
    )
