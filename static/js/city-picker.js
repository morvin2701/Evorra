/**
 * Global city picker (Evorra) — works on any page including Profile.
 * Depends: Firebase compat (firebase.firestore), base nav helpers (evorraSyncBrowseCityNav).
 *
 * Geocoding uses same-origin /api/geocode/json (Flask proxy; set GOOGLE_MAPS_API_KEY in .env on the server).
 * Enable "Geocoding API" in Google Cloud. Falls back to OpenStreetMap Nominatim if the server has no key or on error.
 */
(function () {
    'use strict';

    var STORAGE_KEY = 'evorra_selected_city';
    var eventsCache = [];
    var eventsPromise = null;
    var searchDebounce = null;
    var gridGen = 0;

    /** Taluka/tehsil names don't match event.city (usually "Ahmedabad"). */
    function isTalukaLike(name) {
        return /\b(taluka|tehsil|subdistrict)\b/i.test(String(name || ''));
    }

    /** "Ahmedabad District" / "... Taluka" → "Ahmedabad" for matching Firestore event.city. */
    function normalizeMetroAreaLabel(name) {
        var s = String(name || '').trim();
        if (!s) return '';
        s = s
            .replace(/\s+Metropolitan\s+Region$/i, '')
            .replace(/\s+District$/i, '')
            .replace(/\s+Taluka$/i, '')
            .replace(/\s+Tehsil$/i, '')
            .trim();
        return s;
    }

    /** Same rules as home browse filter (case + spelling variants). */
    function pickerCityMatches(a, b) {
        if (typeof EvorraCityMatch !== 'undefined') {
            return EvorraCityMatch.keysMatch(a, b);
        }
        var la = String(a || '').toLowerCase().trim();
        var lb = String(b || '').toLowerCase().trim();
        return la === lb || (la && lb && (la.indexOf(lb) >= 0 || lb.indexOf(la) >= 0));
    }

    /** Pick first matching address_components type. */
    function pickGoogleComponent(components, type) {
        if (!components || !components.length) return '';
        var i;
        var types;
        for (i = 0; i < components.length; i++) {
            types = components[i].types || [];
            if (types.indexOf(type) >= 0 && components[i].long_name) {
                return String(components[i].long_name).trim();
            }
        }
        return '';
    }

    /** Single-result fallback — avoids taluka before city when possible. */
    function cityLabelFromGoogleComponentsFallback(components) {
        if (!components || !components.length) return '';
        var v = pickGoogleComponent(components, 'locality');
        if (v) return v;
        v = pickGoogleComponent(components, 'postal_town');
        if (v) return v;
        v = pickGoogleComponent(components, 'administrative_area_level_2');
        if (v && !isTalukaLike(v)) return v;
        v = pickGoogleComponent(components, 'administrative_area_level_3');
        if (v && !isTalukaLike(v)) return v;
        v =
            pickGoogleComponent(components, 'sublocality') ||
            pickGoogleComponent(components, 'sublocality_level_1') ||
            pickGoogleComponent(components, 'neighborhood');
        if (v) return v;
        v = pickGoogleComponent(components, 'administrative_area_level_3');
        if (v) return v;
        return '';
    }

    /**
     * Google lists coarse → fine (city before neighborhood when iterating backward).
     * Forward scan picked ward-level locality (e.g. Ghatlodiya) first.
     */
    function findLocalityAcrossGoogleResults(results) {
        if (!results || !results.length) return '';
        var r;
        var c;
        var comps;
        var types;
        for (r = results.length - 1; r >= 0; r--) {
            comps = results[r].address_components || [];
            for (c = 0; c < comps.length; c++) {
                types = comps[c].types || [];
                if (types.indexOf('locality') >= 0 && comps[c].long_name) {
                    return normalizeMetroAreaLabel(String(comps[c].long_name).trim());
                }
            }
        }
        return '';
    }

    function findAdminLevel2AcrossGoogleResults(results) {
        if (!results || !results.length) return '';
        var r;
        var c;
        var comps;
        var types;
        for (r = 0; r < results.length; r++) {
            comps = results[r].address_components || [];
            for (c = 0; c < comps.length; c++) {
                types = comps[c].types || [];
                if (types.indexOf('administrative_area_level_2') >= 0 && comps[c].long_name) {
                    var n = normalizeMetroAreaLabel(String(comps[c].long_name).trim());
                    if (n && !isTalukaLike(n)) return n;
                }
            }
        }
        return '';
    }

    function googleGeocodeIsIndia(results) {
        if (!results || !results.length) return false;
        var r;
        var c;
        var comps;
        var types;
        for (r = 0; r < results.length; r++) {
            comps = results[r].address_components || [];
            for (c = 0; c < comps.length; c++) {
                types = comps[c].types || [];
                if (types.indexOf('country') >= 0 && comps[c].short_name === 'IN') return true;
            }
        }
        return false;
    }

    /** Metro / district city for matching event.city — not the long street line shown in the nav chip. */
    function browseCityFromGoogleResults(results) {
        if (!results || !results.length) return '';
        if (googleGeocodeIsIndia(results)) {
            var adIn = findAdminLevel2AcrossGoogleResults(results);
            if (adIn) return adIn;
        }
        var loc = findLocalityAcrossGoogleResults(results);
        if (loc) return loc;
        return findAdminLevel2AcrossGoogleResults(results) || '';
    }

    function cityLabelFromGoogleResults(results) {
        if (!results || !results.length) return '';
        if (googleGeocodeIsIndia(results)) {
            var adIn = findAdminLevel2AcrossGoogleResults(results);
            if (adIn) return adIn;
        }
        var loc = findLocalityAcrossGoogleResults(results);
        if (loc) return loc;
        var ad2 = findAdminLevel2AcrossGoogleResults(results);
        if (ad2) return ad2;
        var i;
        var label;
        for (i = 0; i < results.length; i++) {
            label = normalizeMetroAreaLabel(cityLabelFromGoogleComponentsFallback(results[i].address_components || []));
            if (label && !isTalukaLike(label)) return label;
        }
        for (i = 0; i < results.length; i++) {
            label = normalizeMetroAreaLabel(cityLabelFromGoogleComponentsFallback(results[i].address_components || []));
            if (label) return label;
        }
        var fa = results[0].formatted_address || '';
        return normalizeMetroAreaLabel(fa.split(',')[0].trim());
    }

    function cityFromGoogleResult(result) {
        if (!result) return '';
        return cityLabelFromGoogleResults([result]);
    }

    /** Same-origin Flask proxy — avoids CORS and browser blocks on maps.googleapis.com; key stays in .env. */
    function reverseGeocodeGoogle(lat, lng) {
        var ll = lat + ',' + lng;
        var fullUrl =
            '/api/geocode/json?' +
            new URLSearchParams({
                latlng: ll,
            });

        function parseGoogleGeocodeJson(data) {
            if (data.status === 'REQUEST_DENIED' || data.status === 'INVALID_REQUEST') {
                throw new Error(data.error_message || data.status);
            }
            if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
                throw new Error(data.status);
            }
            if (!data.results || !data.results.length) return '';
            var metro = browseCityFromGoogleResults(data.results);
            if (metro) return metro;
            return cityLabelFromGoogleResults(data.results);
        }

        return fetch(fullUrl)
            .then(function (r) {
                return r.json();
            })
            .then(function (data) {
                return parseGoogleGeocodeJson(data);
            });
    }

    function reverseGeocodeNominatim(lat, lng) {
        return fetch(
            'https://nominatim.openstreetmap.org/reverse?lat=' +
                encodeURIComponent(lat) +
                '&lon=' +
                encodeURIComponent(lng) +
                '&format=json&addressdetails=1',
            { headers: { 'Accept-Language': 'en' } }
        )
            .then(function (r) {
                return r.json();
            })
            .then(function (data) {
                return reverseGeocodeLabelFromNominatim(data);
            });
    }

    function reverseGeocodeCoords(lat, lng) {
        return reverseGeocodeGoogle(lat, lng)
            .then(function (label) {
                if (label && String(label).trim()) return label;
                return reverseGeocodeNominatim(lat, lng);
            })
            .catch(function () {
                return reverseGeocodeNominatim(lat, lng);
            });
    }

    function fetchGoogleGeocodeSearch(query) {
        var q = String(query || '').trim();
        if (q.length < 2) return Promise.resolve([]);
        var url = '/api/geocode/json?' + new URLSearchParams({ address: q });
        return fetch(url)
            .then(function (r) {
                return r.json();
            })
            .then(function (data) {
                if (data.status === 'REQUEST_DENIED' || data.status === 'INVALID_REQUEST') {
                    throw new Error(data.error_message || data.status);
                }
                if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
                    throw new Error(data.status);
                }
                var seen = {};
                var out = [];
                var results = data.results || [];
                for (var i = 0; i < results.length && out.length < 10; i++) {
                    var city = cityLabelFromGoogleResults([results[i]]);
                    if (!city) continue;
                    var k = city.toLowerCase();
                    if (seen[k]) continue;
                    seen[k] = true;
                    var parts = String(results[i].formatted_address || '')
                        .split(',')
                        .map(function (s) {
                            return s.trim();
                        })
                        .filter(Boolean);
                    var sub = parts.slice(1, 4).join(' · ');
                    out.push({ displayName: city, sub: sub });
                }
                return out;
            });
    }

    function fetchRemotePlaces(query) {
        return fetchGoogleGeocodeSearch(query).catch(function () {
            return fetchNominatimPlaces(query);
        });
    }

    var CITY_EMOJIS = {
        ahmedabad: '🏙️',
        gandhinagar: '🏛️',
        bengaluru: '💻',
        bangalore: '💻',
        mumbai: '🌊',
        delhi: '🏛️',
        'new delhi': '🏛️',
        pune: '🎓',
        surat: '💎',
        rajkot: '🏰',
        vadodara: '🏰',
        hyderabad: '🕌',
        chennai: '🌅',
        kolkata: '🌸',
        jaipur: '🏯',
        lucknow: '🌙',
        chandigarh: '🌿',
        indore: '🏙️',
        goa: '🏖️',
    };

    function esc(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/"/g, '&quot;');
    }

    function getDb() {
        try {
            if (typeof firebase !== 'undefined' && firebase.firestore) {
                return firebase.firestore();
            }
        } catch (e) {}
        return null;
    }

    function isEventClosed(e) {
        if (!e) return true;
        if (e.is_closed === true) return true;
        var status = String(e.status || '').toLowerCase();
        if (['closed', 'cancelled', 'completed', 'ended', 'archived'].indexOf(status) >= 0) return true;
        var endRaw = e.end_time || e.endTime;
        if (endRaw) {
            var endDate = endRaw.toDate ? endRaw.toDate() : new Date(endRaw);
            if (!isNaN(endDate.getTime()) && endDate < new Date()) return true;
        }
        return false;
    }

    function getStoredCity() {
        try {
            return localStorage.getItem(STORAGE_KEY);
        } catch (e) {
            return null;
        }
    }

    function getCityEmoji(name) {
        var c = String(name || '').toLowerCase();
        for (var k in CITY_EMOJIS) {
            if (CITY_EMOJIS.hasOwnProperty(k) && c.indexOf(k) >= 0) return CITY_EMOJIS[k];
        }
        return '📍';
    }

    function buildCityListFromCache() {
        var bucket = {};
        for (var i = 0; i < eventsCache.length; i++) {
            var e = eventsCache[i];
            if (e.is_published === false || isEventClosed(e) || !e.city) continue;
            var name = String(e.city).trim();
            if (!name) continue;
            var key = name.toLowerCase();
            if (!bucket[key]) bucket[key] = { name: name, count: 0 };
            bucket[key].count++;
        }
        var out = [];
        for (var k2 in bucket) {
            if (bucket.hasOwnProperty(k2)) out.push(bucket[k2]);
        }
        out.sort(function (a, b) {
            return b.count - a.count;
        });
        return out;
    }

    function ensureEventsLoaded() {
        if (eventsCache.length) return Promise.resolve(eventsCache);
        if (eventsPromise) return eventsPromise;
        var db = getDb();
        if (!db) {
            return Promise.resolve([]);
        }
        eventsPromise = db
            .collection('events')
            .get()
            .then(function (snap) {
                eventsCache = [];
                snap.forEach(function (doc) {
                    var data = doc.data();
                    data.id = doc.id;
                    eventsCache.push(data);
                });
                eventsPromise = null;
                return eventsCache;
            })
            .catch(function () {
                eventsPromise = null;
                return [];
            });
        return eventsPromise;
    }

    function nominatimPickPlaceLabel(addr) {
        if (!addr || typeof addr !== 'object') return '';
        return (
            addr.state_district ||
            addr.city ||
            addr.town ||
            addr.city_district ||
            addr.village ||
            addr.municipality ||
            addr.county ||
            ''
        );
    }

    function fetchNominatimPlaces(query) {
        var q = String(query || '').trim();
        if (q.length < 2) return Promise.resolve([]);
        var url =
            'https://nominatim.openstreetmap.org/search?' +
            new URLSearchParams({
                q: q,
                format: 'json',
                addressdetails: '1',
                limit: '12',
                dedupe: '1',
            }).toString();
        return fetch(url, { headers: { 'Accept-Language': 'en' } }).then(function (r) {
            if (!r.ok) throw new Error('search');
            return r.json();
        }).then(function (arr) {
            var seen = {};
            var out = [];
            for (var i = 0; i < arr.length; i++) {
                var item = arr[i];
                var addr = item.address || {};
                var label = nominatimPickPlaceLabel(addr);
                if (!label && item.display_name) {
                    label = String(item.display_name).split(',')[0].trim();
                }
                if (!label) continue;
                var key = label.toLowerCase();
                if (seen[key]) continue;
                seen[key] = true;
                var parts = String(item.display_name || '')
                    .split(',')
                    .map(function (s) {
                        return s.trim();
                    })
                    .filter(Boolean);
                var sub = parts.slice(1, 4).join(' · ');
                out.push({ displayName: label, sub: sub });
                if (out.length >= 10) break;
            }
            return out;
        });
    }

    function reverseGeocodeLabelFromNominatim(data) {
        var a = data.address || {};
        /** OSM India: state_district is the district city (e.g. Ahmedabad); county is often "… Taluka". */
        if (a.state_district) return String(a.state_district).trim();
        var raw =
            a.city ||
            a.town ||
            a.city_district ||
            a.village ||
            a.municipality ||
            a.suburb ||
            '';
        if (!raw && a.county && !/\b(taluka|tehsil|subdistrict)\b/i.test(String(a.county))) {
            raw = a.county;
        }
        if (!raw && data.name) raw = String(data.name);
        if (!raw && data.display_name) {
            raw = String(data.display_name).split(',')[0].trim();
        }
        return raw ? String(raw).trim() : '';
    }

    function overlayEl() {
        return document.getElementById('ev-cp-overlay');
    }
    function bodyEl() {
        return document.getElementById('ev-cp-body');
    }
    function searchInput() {
        return document.getElementById('ev-cp-search');
    }

    function closePicker() {
        gridGen++;
        clearTimeout(searchDebounce);
        var o = overlayEl();
        if (!o) return;
        o.classList.remove('ev-cp-open');
        o.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
    }

    function selectedCityNorm() {
        var s = getStoredCity();
        if (s === null) return '';
        return String(s).trim().toLowerCase();
    }

    function fillDefaultGrid(container, cities) {
        container.innerHTML = '';
        var sel = selectedCityNorm();

        var allRow = document.createElement('div');
        allRow.className = 'ev-cp-row' + (!sel ? ' ev-cp-row--active' : '');
        allRow.innerHTML =
            '<div class="ev-cp-row-ico"><i class="fa-solid fa-globe"></i></div>' +
            '<div><div class="ev-cp-row-title">All Cities</div><div class="ev-cp-row-sub">Show events from everywhere</div></div>' +
            '<span class="ev-cp-row-emoji">🌍</span>';
        allRow.addEventListener('click', function () {
            applySelection('');
        });
        container.appendChild(allRow);

        var h = document.createElement('p');
        h.className = 'ev-cp-sec-label';
        h.innerHTML = '<i class="fa-solid fa-fire"></i> Cities on Evorra';
        container.appendChild(h);

        var grid = document.createElement('div');
        grid.className = 'ev-cp-grid';
        for (var i = 0; i < cities.length; i++) {
            var c = cities[i];
            var active = sel && c.name.toLowerCase() === sel;
            var card = document.createElement('div');
            card.className = 'ev-cp-card' + (active ? ' ev-cp-card--active' : '');
            card.innerHTML =
                '<div class="ev-cp-card-ico">' +
                getCityEmoji(c.name) +
                '</div>' +
                '<div class="ev-cp-card-name">' +
                esc(c.name) +
                '</div>' +
                '<div class="ev-cp-card-meta">' +
                c.count +
                ' event' +
                (c.count !== 1 ? 's' : '') +
                '</div>';
            (function (name) {
                card.addEventListener('click', function () {
                    applySelection(name);
                });
            })(c.name);
            grid.appendChild(card);
        }
        container.appendChild(grid);
    }

    function scheduleSearch(raw) {
        clearTimeout(searchDebounce);
        var t = String(raw || '').trim();
        var delay = t.length === 0 ? 40 : t.length < 2 ? 140 : 400;
        searchDebounce = setTimeout(function () {
            renderCityGrid(raw || '');
        }, delay);
    }

    function renderCityGrid(query) {
        var gen = gridGen;
        var body = bodyEl();
        if (!body) return;

        ensureEventsLoaded().then(function () {
            if (gen !== gridGen) return;
            _renderCityGridInner(gen, query);
        });
    }

    function _renderCityGridInner(gen, query) {
        var body = bodyEl();
        if (!body || gen !== gridGen) return;

        var rawQ = String(query || '').trim();
        var qLower = rawQ.toLowerCase();
        var cities = buildCityListFromCache();

        if (!eventsCache.length) {
            body.innerHTML =
                '<div class="ev-cp-empty"><i class="fa-solid fa-spinner fa-spin"></i> Loading cities… please wait.</div>';
            return;
        }

        if (!rawQ) {
            fillDefaultGrid(body, cities);
            return;
        }

        var localFiltered = cities.filter(function (c) {
            return c.name.toLowerCase().indexOf(qLower) >= 0;
        });

        body.innerHTML = '';

        if (localFiltered.length) {
            var h = document.createElement('p');
            h.className = 'ev-cp-sec-label';
            h.innerHTML = '<i class="fa-solid fa-ticket"></i> Cities with events on Evorra';
            body.appendChild(h);
            var list = document.createElement('div');
            list.className = 'ev-cp-list';
            var sel = selectedCityNorm();
            for (var i = 0; i < localFiltered.length; i++) {
                var c = localFiltered[i];
                var row = document.createElement('div');
                row.className =
                    'ev-cp-row' +
                    (sel === c.name.toLowerCase() ? ' ev-cp-row--active' : '');
                row.innerHTML =
                    '<div class="ev-cp-row-ico"><i class="fa-solid fa-location-dot"></i></div>' +
                    '<div><div class="ev-cp-row-title">' +
                    esc(c.name) +
                    '</div><div class="ev-cp-row-sub">' +
                    c.count +
                    ' event' +
                    (c.count !== 1 ? 's' : '') +
                    '</div></div>' +
                    '<span class="ev-cp-row-emoji">' +
                    getCityEmoji(c.name) +
                    '</span>';
                (function (name) {
                    row.addEventListener('click', function () {
                        applySelection(name);
                    });
                })(c.name);
                list.appendChild(row);
            }
            body.appendChild(list);
        }

        if (rawQ.length >= 2) {
            var loading = document.createElement('div');
            loading.className = 'ev-cp-loading';
            loading.innerHTML =
                '<i class="fa-solid fa-globe fa-spin" style="color:#ea580c"></i>' +
                '<span>Searching places…</span>' +
                '<span class="ev-cp-shimmer" aria-hidden="true"></span>';
            body.appendChild(loading);

            fetchRemotePlaces(rawQ)
                .then(function (remote) {
                    if (gen !== gridGen) return;
                    loading.remove();
                    if (remote.length) {
                        var h2 = document.createElement('p');
                        h2.className = 'ev-cp-sec-label';
                        h2.style.marginTop = localFiltered.length ? '16px' : '0';
                        h2.innerHTML = '<i class="fa-solid fa-earth-asia"></i> Places worldwide';
                        body.appendChild(h2);

                        var list2 = document.createElement('div');
                        list2.className = 'ev-cp-list';
                        var sel2 = selectedCityNorm();
                        for (var j = 0; j < remote.length; j++) {
                            var r = remote[j];
                            var row2 = document.createElement('div');
                            row2.className =
                                'ev-cp-row' +
                                (sel2 === String(r.displayName).toLowerCase() ? ' ev-cp-row--active' : '');
                            row2.innerHTML =
                                '<div class="ev-cp-row-ico"><i class="fa-solid fa-map-pin"></i></div>' +
                                '<div><div class="ev-cp-row-title">' +
                                esc(r.displayName) +
                                '</div><div class="ev-cp-row-sub">' +
                                esc(r.sub || 'Places') +
                                '</div></div>' +
                                '<span class="ev-cp-row-emoji">' +
                                getCityEmoji(r.displayName) +
                                '</span>';
                            (function (dn) {
                                row2.addEventListener('click', function () {
                                    applySelection(dn);
                                });
                            })(r.displayName);
                            list2.appendChild(row2);
                        }
                        body.appendChild(list2);
                    }
                    finishEmptyState(gen, rawQ, body);
                })
                .catch(function () {
                    if (gen !== gridGen) return;
                    loading.remove();
                    finishEmptyState(gen, rawQ, body);
                });
            return;
        }

        finishEmptyState(gen, rawQ, body);
    }

    function finishEmptyState(gen, rawQ, body) {
        if (gen !== gridGen) return;
        var anyPick = body.querySelector('.ev-cp-row,.ev-cp-card');
        if (!anyPick) {
            if (rawQ.length >= 2) {
                body.innerHTML =
                    '<div class="ev-cp-empty"><i class="fa-regular fa-face-frown-open"></i> No matches for "<strong>' +
                    esc(rawQ) +
                    '</strong>".</div>';
            } else {
                body.innerHTML =
                    '<div class="ev-cp-empty"><i class="fa-solid fa-keyboard"></i> Type one more letter to search places worldwide.</div>';
            }
        }
    }

    function applySelection(cityName) {
        var canon =
            cityName === '' || cityName === undefined || cityName === null
                ? ''
                : normalizeMetroAreaLabel(String(cityName).trim()) || String(cityName).trim();

        try {
            localStorage.setItem(STORAGE_KEY, canon);
        } catch (e) {}

        var pill = document.getElementById('city-pill-label');
        if (pill) pill.textContent = canon || 'All Cities';
        var mpill = document.getElementById('m-city-pill-label');
        if (mpill) mpill.textContent = canon || 'All Cities';

        if (typeof window.evorraSyncBrowseCityNav === 'function') {
            window.evorraSyncBrowseCityNav(canon);
        }

        try {
            window.dispatchEvent(
                new CustomEvent('evorra:city-changed', {
                    detail: { city: canon },
                })
            );
        } catch (e) {}

        closePicker();

        if (typeof window.__evorraCityChangedHook === 'function') {
            try {
                window.__evorraCityChangedHook(canon);
            } catch (e2) {}
        }
    }

    function detectLocation() {
        var btn = document.getElementById('ev-cp-detect');
        if (!navigator.geolocation) {
            alert('Geolocation is not supported.');
            return;
        }
        if (btn) {
            btn.classList.add('ev-cp-detect--busy');
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Detecting…';
        }
        var resetBtn = function () {
            if (btn) {
                btn.classList.remove('ev-cp-detect--busy');
                btn.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> Detect My Location';
            }
        };

        function applyCityLabelFromString(raw) {
            mapRawCityToSelection(raw)
                .then(function (ok) {
                    resetBtn();
                    if (!ok) alert('Could not determine your city.');
                })
                .catch(function () {
                    resetBtn();
                    alert('Could not fetch your location.');
                });
        }

        function finishDetectFromCoords(lat, lng) {
            reverseGeocodeCoords(lat, lng)
                .then(function (raw) {
                    applyCityLabelFromString(raw);
                })
                .catch(function () {
                    resetBtn();
                    alert('Could not fetch your location.');
                });
        }

        function tryDetectViaIpApi() {
            if (!window.EvorraIpLocation || typeof window.EvorraIpLocation.ensureLoaded !== 'function') {
                resetBtn();
                alert('Location service is not ready. Refresh the page and try again.');
                return;
            }
            window.EvorraIpLocation.ensureLoaded()
                .then(function () {
                    var loc = window.EvorraIpLocation.get();
                    if (!loc) {
                        resetBtn();
                        alert('Could not approximate your area from your network.');
                        return;
                    }
                    if (Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)) {
                        finishDetectFromCoords(loc.latitude, loc.longitude);
                        return;
                    }
                    if (loc.city) {
                        applyCityLabelFromString(loc.city);
                        return;
                    }
                    resetBtn();
                    alert('Could not approximate your area from your network.');
                })
                .catch(function () {
                    resetBtn();
                    alert('Could not approximate your area from your network.');
                });
        }

        if (!navigator.geolocation) {
            tryDetectViaIpApi();
            return;
        }

        navigator.geolocation.getCurrentPosition(
            function (pos) {
                finishDetectFromCoords(pos.coords.latitude, pos.coords.longitude);
            },
            function () {
                tryDetectViaIpApi();
            },
            {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 60000,
            }
        );
    }

    function mapRawCityToSelection(raw) {
        var cityStr = String(raw || '').trim();
        if (!cityStr) return Promise.resolve(false);
        return ensureEventsLoaded().then(function () {
            var list = buildCityListFromCache();
            var matched = null;
            for (var i = 0; i < list.length; i++) {
                var c = list[i];
                if (pickerCityMatches(c.name, cityStr)) {
                    matched = c;
                    break;
                }
            }
            applySelection(matched ? matched.name : cityStr);
            return true;
        });
    }

    function storedCityLooksUsable() {
        var stored = String(getStoredCity() || '').trim();
        if (!stored) return false;
        return ensureEventsLoaded().then(function () {
            var list = buildCityListFromCache();
            for (var i = 0; i < list.length; i++) {
                if (pickerCityMatches(list[i].name, stored)) return true;
            }
            return false;
        });
    }

    function autoDetectAccurateLocationOnLoad() {
        var ssKey = 'evorra_auto_loc_checked_v2';
        try {
            if (sessionStorage.getItem(ssKey) === '1') return;
            sessionStorage.setItem(ssKey, '1');
        } catch (e) {}

        storedCityLooksUsable().then(function (usable) {
            if (usable) return;

            function tryIpFallback() {
                if (!window.EvorraIpLocation || typeof window.EvorraIpLocation.ensureLoaded !== 'function') return;
                window.EvorraIpLocation.ensureLoaded()
                    .then(function () {
                        var loc = window.EvorraIpLocation.get();
                        if (!loc) return;
                        if (Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)) {
                            reverseGeocodeCoords(loc.latitude, loc.longitude)
                                .then(function (raw) { mapRawCityToSelection(raw); })
                                .catch(function () {});
                            return;
                        }
                        if (loc.city) mapRawCityToSelection(loc.city);
                    })
                    .catch(function () {});
            }

            if (!navigator.geolocation) {
                tryIpFallback();
                return;
            }

            navigator.geolocation.getCurrentPosition(
                function (pos) {
                    reverseGeocodeCoords(pos.coords.latitude, pos.coords.longitude)
                        .then(function (raw) { mapRawCityToSelection(raw); })
                        .catch(function () { tryIpFallback(); });
                },
                function () {
                    tryIpFallback();
                },
                { enableHighAccuracy: true, timeout: 14000, maximumAge: 120000 }
            );
        });
    }

    function bindUi() {
        var closeBtn = document.getElementById('ev-cp-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', closePicker);
        }
        var detectBtn = document.getElementById('ev-cp-detect');
        if (detectBtn) {
            detectBtn.addEventListener('click', detectLocation);
        }
        var inp = searchInput();
        if (inp) {
            inp.addEventListener('input', function () {
                scheduleSearch(inp.value);
            });
        }
        window.__evCpOverlayClick = function (e) {
            if (e.target === overlayEl()) closePicker();
        };
    }

    window.openCityModal = function () {
        gridGen++;
        clearTimeout(searchDebounce);
        var o = overlayEl();
        if (!o) return;
        o.classList.add('ev-cp-open');
        o.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        var inp = searchInput();
        if (inp) {
            inp.value = '';
            setTimeout(function () {
                try {
                    inp.focus();
                } catch (e) {}
            }, 80);
        }
        renderCityGrid('');
    };
    window.closeCityModal = closePicker;

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && overlayEl() && overlayEl().classList.contains('ev-cp-open')) {
            closePicker();
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            bindUi();
            autoDetectAccurateLocationOnLoad();
        });
    } else {
        bindUi();
        autoDetectAccurateLocationOnLoad();
    }
})();
