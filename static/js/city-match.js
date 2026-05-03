/**
 * Case-insensitive city matching + common spelling variants (e.g. Ahmedabad / AHMEDABAD / ahemdabad).
 * window.EvorraCityMatch
 */
(function (global) {
    function squashSpaces(s) {
        return String(s || '')
            .trim()
            .replace(/\s+/g, ' ');
    }

    /** Known spelling variants → canonical lowercase key */
    var ALIASES = {
        ahemdabad: 'ahmedabad',
        amdavad: 'ahmedabad',
        ahmadabad: 'ahmedabad',
        ahmedbad: 'ahmedabad',
        ahmedabd: 'ahmedabad',
        amdavada: 'ahmedabad',
        bombay: 'mumbai',
        bengaluru: 'bengaluru',
        bangalore: 'bengaluru',
        calcutta: 'kolkata',
        culcutta: 'kolkata',
    };

    function stripSuffixes(lower) {
        return lower
            .replace(/\s+metropolitan region$/i, '')
            .replace(/\s+taluka$/i, '')
            .replace(/\s+tehsil$/i, '')
            .replace(/\s+subdistrict$/i, '')
            .replace(/\s+district$/i, '')
            .trim();
    }

    function levenshtein(a, b) {
        if (a === b) return 0;
        var i;
        var j;
        var al = a.length;
        var bl = b.length;
        if (!al) return bl;
        if (!bl) return al;
        var row = [];
        for (j = 0; j <= bl; j++) row[j] = j;
        for (i = 1; i <= al; i++) {
            var n = i;
            var p = i - 1;
            row[0] = i;
            for (j = 1; j <= bl; j++) {
                var c = p + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1);
                p = row[j];
                row[j] = Math.min(Math.min(n + 1, p + 1), c);
                n = row[j - 1];
            }
        }
        return row[bl];
    }

    function canonicalKey(raw) {
        var s = squashSpaces(String(raw || ''));
        if (!s) return '';
        var lower = stripSuffixes(s.toLowerCase());
        if (!lower) return '';
        if (ALIASES[lower]) return ALIASES[lower];
        return lower;
    }

    /**
     * True if two city strings refer to the same place for browse filtering.
     */
    function keysMatch(a, b) {
        var ca = canonicalKey(a);
        var cb = canonicalKey(b);
        if (!ca || !cb) return false;
        if (ca === cb) return true;
        if (ca.includes(cb) || cb.includes(ca)) return true;
        var maxLen = Math.max(ca.length, cb.length);
        if (maxLen >= 5 && levenshtein(ca, cb) <= 2) return true;
        return false;
    }

    global.EvorraCityMatch = {
        canonicalKey: canonicalKey,
        keysMatch: keysMatch,
    };
})(window);
