/**
 * Session-cached approximate location from https://ipapi.co/json/ (HTTPS only).
 * Global: window.EvorraIpLocation, window.__EVORRA_IP_LOCATION__
 */
(function (global) {
    var SESSION_KEY = 'evorra_ip_location_v1';
    var API_URL = 'https://ipapi.co/json/';

    var DEFAULT_LOCATION = {
        ip: '',
        city: 'Ahmedabad',
        region: 'Gujarat',
        country: 'India',
        latitude: 23.0225,
        longitude: 72.5714,
        _fallback: true,
    };

    var resolved = null;
    var inflight = null;

    function normalizePayload(raw) {
        if (!raw || typeof raw !== 'object') return null;
        if (raw.error || raw.reason) return null;

        var lat = Number(raw.latitude);
        var lng = Number(raw.longitude);
        return {
            ip: String(raw.ip || ''),
            city: String(raw.city || '').trim(),
            region: String(raw.region || raw.region_code || '').trim(),
            country: String(raw.country_name || raw.country || '').trim(),
            latitude: Number.isFinite(lat) ? lat : NaN,
            longitude: Number.isFinite(lng) ? lng : NaN,
            _fallback: false,
        };
    }

    function readSession() {
        try {
            var s = sessionStorage.getItem(SESSION_KEY);
            if (!s) return null;
            return JSON.parse(s);
        } catch (e) {
            return null;
        }
    }

    function writeSession(obj) {
        try {
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(obj));
        } catch (e) {}
    }

    function fetchFromApi() {
        return fetch(API_URL, { credentials: 'omit', cache: 'no-store' })
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (j) {
                if (j && (j.error || j.reason)) {
                    throw new Error(String(j.reason || j.error || 'ipapi error'));
                }
                var n = normalizePayload(j);
                if (!n) throw new Error('invalid ipapi response');
                return n;
            })
            .catch(function (err) {
                console.error('[EvorraIpLocation] ipapi.co failed, defaulting to Ahmedabad, Gujarat, India:', err);
                var fallback = Object.assign({}, DEFAULT_LOCATION);
                fallback._error = err && err.message ? String(err.message) : String(err);
                return fallback;
            })
            .then(function (data) {
                writeSession(data);
                resolved = data;
                global.__EVORRA_IP_LOCATION__ = data;
                return data;
            });
    }

    function ensureLoaded() {
        if (resolved) return Promise.resolve(resolved);
        if (inflight) return inflight;

        var cached = readSession();
        if (cached && typeof cached === 'object' && (cached.city || cached.ip || cached._fallback)) {
            resolved = cached;
            global.__EVORRA_IP_LOCATION__ = cached;
            return Promise.resolve(resolved);
        }

        inflight = fetchFromApi().finally(function () {
            inflight = null;
        });
        return inflight;
    }

    function get() {
        return resolved;
    }

    global.EvorraIpLocation = {
        ensureLoaded: ensureLoaded,
        get: get,
    };
})(window);
