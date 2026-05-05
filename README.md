# Evorra

## Event Metrics Sync (Cron)

To keep `events.tickets_sold` and `events.total_revenue` in sync from server-side logic:

1. Set env values in `.env`:
   - `ADMIN_SYNC_TOKEN`
   - `APP_BASE_URL` (optional, defaults to `http://127.0.0.1:5001`)
2. Run manually:
   - `ADMIN_SYNC_TOKEN=your-token python3 scripts/sync_event_metrics.py`
3. Run one event only:
   - `ADMIN_SYNC_TOKEN=your-token python3 scripts/sync_event_metrics.py --event-id EVENT_ID`

Example cron (every 5 minutes):

`*/5 * * * * cd /Users/morvinvekariya/Desktop/Evorra && /usr/bin/env ADMIN_SYNC_TOKEN=your-token APP_BASE_URL=http://127.0.0.1:5001 /usr/bin/python3 scripts/sync_event_metrics.py >> /tmp/evorra-metrics-sync.log 2>&1`

