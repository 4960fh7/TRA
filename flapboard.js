/**
 * Split-flap departure board (翻牌時刻表) for the station info panel.
 *
 * Shows the next ROWS departures of the selected station in two sections
 * (順行 / 逆行 from isClockwiseAtStation() in main.js: even / odd train numbers,
 * reversed for 成追線 trains at the 山線 stations 成功～苗栗).
 * Every cell is a split-flap unit. Once a minute (aligned to the minute
 * boundary) and whenever main.js delivers new data, the target rows are
 * recomputed; rows that differ are flipped one at a time, top to bottom, each
 * flap stepping quickly through its deck until it reaches the target value.
 *
 * Every station selection and every switch from the card list to the board
 * starts from a blank board. Closing the panel, switching views or selecting
 * another station stops any flipping immediately; the next pass starts again
 * from the first row. Trains terminating at the station are listed too.
 *
 * Depends on globals from main.js: getTrainTypeName(), globalStationsData
 * (with the CWDest / CCWDest lists from scripts/build_station_destinations.py),
 * scrollTrainListToUpcoming() and the train cards in #unified-train-list
 * (row clicks reuse their handler). main.js calls FlapBoard.stationSelected()
 * on every station selection and FlapBoard.setData() with each data snapshot.
 */
(function () {
    'use strict';

    /** Departures shown per direction. */
    const ROWS = 6;
    /** Duration of one half-flip (top leaf falling, then bottom leaf landing). */
    const HALF_FLIP_MS = 42;
    /** Rows departing within this many minutes (scheduled + delay) get the sweeping highlight. */
    const IMMINENT_MINUTES = 2;
    /** Digit flap deck, in mechanical order (blank first). */
    const DIGIT_DECK = [' ', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    /** 開車時刻 tens digits only carry the faces a clock can show (hours 0-2, minutes 0-5). */
    const HOUR_TENS_DECK = [' ', '0', '1', '2'];
    const MINUTE_TENS_DECK = [' ', '0', '1', '2', '3', '4', '5'];
    const VIEW_KEY = 'stationPanelView';
    /** Per-station faces stored by an earlier version; removed on load. */
    const LEGACY_SEEN_KEY = 'flapboardSeen';

    /** Header labels; widths live in style.css (.fb-row grid). */
    const COLUMN_LABELS = [
        ['dest', '開往'], ['no', '車次'], ['via', '經由'],
        ['type', '車種'], ['time', '開車時刻'], ['note', '備註']
    ];

    const SECTIONS = [
        { key: 'cw', zh: '順行', clockwise: true, destField: 'CWDest' },
        { key: 'ccw', zh: '逆行', clockwise: false, destField: 'CCWDest' }
    ];

    /** Shorter board names. */
    const VIA_NAMES = { '成追線': '成追' };
    const TYPE_NAMES = { '柴聯自強': '柴自強' };
    /** Deck order of the fixed columns; unseen values are appended. */
    const VIA_DECK = ['', '山線', '海線', '成追', '北迴', '南迴'];

    /**
     * 經由 for trains without a 山線/海線/成追線 label (board only), in priority
     * order: a train whose route covers the whole 花蓮～蘇澳新 stretch is 北迴,
     * otherwise one covering the whole 枋寮～臺東 stretch is 南迴.
     */
    const RING_SEGMENTS = [
        { via: '北迴', ends: ['花蓮', '蘇澳新'] },
        { via: '南迴', ends: ['枋寮', '臺東'] }
    ];
    const TYPE_DECK = ['', '區間', '區間快', '莒光', '自強', 'PP自強', '新自強', '普悠瑪', '太魯閣', '柴自強', '普通專列'];
    const NOTE_MARK_DECK = ['', '準', '晚'];
    const NOTE_UNIT_DECK = ['', '點', '分'];

    // Retro palette (warm white is the default text colour)
    const LATE_COLOR = '#e8774a';
    const ONTIME_COLOR = '#a3c98e';
    const TYPE_COLORS = {
        '普悠瑪': LATE_COLOR, '太魯閣': LATE_COLOR, '新自強': LATE_COLOR, 'PP自強': LATE_COLOR,
        '柴自強': LATE_COLOR, '自強': LATE_COLOR, '莒光': '#e8c25a', '區間快': '#8db8cf'
    };
    const NOTE_COLORS = { '準': ONTIME_COLOR, '點': ONTIME_COLOR, '晚': LATE_COLOR, '分': LATE_COLOR };

    const state = {
        trains: [],
        stationName: null,
        /** True when the next visible refresh must start from a blank board. */
        needsReset: true,
        delayMap: new Map(),
        /** Ordered 開往 deck per section key. */
        destDecks: { cw: [], ccw: [] },
        extraTypes: [],
        extraVias: [],
        sections: []
    };

    /* ------------------------------------------------------------------ */
    /* Helpers                                                             */
    /* ------------------------------------------------------------------ */

    /** Estimated rendered width in em: ASCII ~0.6em, CJK 1em. */
    function textWidthEm(text) {
        let width = 0;
        for (const ch of text) width += ch.charCodeAt(0) < 0x100 ? 0.6 : 1;
        return width;
    }

    function prefersReducedMotion() {
        return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    /** Minutes since service-day midnight; before 04:00 counts as the previous day (+24h), like main.js. */
    function serviceNowMinutes() {
        const now = new Date();
        let hours = now.getHours();
        if (hours < 4) hours += 24;
        return hours * 60 + now.getMinutes();
    }

    /** Station name of an info.end field ("HH:MM 站名"); mirrors the Python script. */
    /* --- 北迴 / 南迴 detection on the island ring --- */

    /** Ring context derived from globalStationsData, rebuilt when that array changes. */
    let ringCache = { source: null, ctx: null };
    /** Per train object: { ctx, via } so the route is scanned once per data set. */
    const ringViaCache = new WeakMap();

    /**
     * stations.json lists the stations in order around the island ring
     * (west coast -> 屏東 -> 南迴 -> 臺東 -> 花蓮 -> 北迴 -> 宜蘭線), with
     * branch lines next to their junctions; the list index is a ring position.
     * Each segment becomes the run of gaps (i, i+1) between its two ends.
     */
    function ringContext() {
        const stations = typeof globalStationsData !== 'undefined' ? globalStationsData : null;
        if (!Array.isArray(stations) || stations.length === 0) return null;
        if (ringCache.source === stations) return ringCache.ctx;
        const pos = new Map();
        stations.forEach((s, i) => { if (!pos.has(s.stationName)) pos.set(s.stationName, i); });
        const segments = [];
        RING_SEGMENTS.forEach(seg => {
            const [a, b] = seg.ends.map(name => pos.get(name));
            if (a === undefined || b === undefined) return;
            segments.push({ via: seg.via, from: Math.min(a, b), to: Math.max(a, b) });
        });
        ringCache = { source: stations, ctx: { pos, n: stations.length, segments } };
        return ringCache.ctx;
    }

    /**
     * 北迴 / 南迴 / '' for a train. Between two consecutive stops the train is
     * taken to run the shorter way round the ring (no hop spans half the
     * island), so express trains skipping a whole segment still cover it.
     * Time: O(S + G) per train for S stops and G ring gaps covered.
     */
    function ringVia(train) {
        const ctx = ringContext();
        if (!ctx) return '';
        const cached = ringViaCache.get(train);
        if (cached && cached.ctx === ctx) return cached.via;

        const n = ctx.n;
        const gaps = new Set();
        let prev = null;
        for (const stop of train.data || []) {
            const p = ctx.pos.get(stop.x);
            if (p === undefined || p === prev) continue;
            if (prev !== null) {
                const forward = ((p - prev) % n + n) % n;
                if (forward <= n / 2) {
                    for (let k = 0; k < forward; k++) gaps.add((prev + k) % n);
                } else {
                    for (let k = 0; k < n - forward; k++) gaps.add((p + k) % n);
                }
            }
            prev = p;
        }

        let via = '';
        for (const seg of ctx.segments) {
            let covered = true;
            for (let g = seg.from; g < seg.to && covered; g++) covered = gaps.has(g);
            if (covered) { via = seg.via; break; }
        }
        ringViaCache.set(train, { ctx, via });
        return via;
    }

    function cleanDestination(end) {
        return (end.length > 6 ? end.substring(6) : end).replace(/_/g, '');
    }

    function typeDisplayName(train) {
        let name = train.train || '';
        if (typeof getTrainTypeName === 'function') {
            // getTrainTypeName returns "<name> <number>"; keep the name only
            name = getTrainTypeName(name, train.number).replace(/\s*\d+$/, '');
        }
        return TYPE_NAMES[name] || name;
    }

    /** Deck with blank first, then `ordered`, then any extra values not in it. */
    function buildDeck(ordered, ...extras) {
        const deck = [''];
        const seen = new Set(deck);
        [ordered, ...extras].forEach(list => list.forEach(v => {
            if (!seen.has(v)) { seen.add(v); deck.push(v); }
        }));
        return deck;
    }

    /**
     * Faces of the remark number flap from `current` to `target`: counts up
     * from 1 (through blank when it has to go down), by 1 up to 10 and by
     * growing steps (+2, +3, ...) above that, always landing on `target`.
     */
    function countSequence(current, target) {
        const t = target === '' ? 0 : parseInt(target, 10);
        let v = current === '' ? 0 : parseInt(current, 10);
        if (t === 0) return [''];
        const seq = [];
        if (t < v) { seq.push(''); v = 0; }
        while (v < t) {
            v = Math.min(t, v + (v < 10 ? 1 : Math.max(2, Math.floor(v / 5))));
            seq.push(String(v));
        }
        return seq;
    }

    /* ------------------------------------------------------------------ */
    /* One split-flap unit                                                 */
    /* ------------------------------------------------------------------ */

    class Flap {
        /**
         * @param {object} opts
         * @param {'digit'|'word'|'count'} opts.kind
         * @param {string} opts.className   Size class (flap-digit, flap-word, ...)
         * @param {number} [opts.capacity]  Text width in em before squeezing
         * @param {function(): string[]} [opts.deck]  Ordered deck (word flaps)
         * @param {string[]} [opts.digits]  Digit deck override (default DIGIT_DECK)
         * @param {function(string): string} [opts.color]  Text colour per face
         */
        constructor(opts) {
            this.kind = opts.kind;
            this.capacityEm = opts.capacity || 0;
            this.deck = opts.deck || null;
            this.digits = opts.digits || DIGIT_DECK;
            this.color = opts.color || null;
            this.value = this.kind === 'digit' ? ' ' : '';
            /** Bumped by setInstant(); an in-flight flip with an older token stops. */
            this.token = 0;

            const el = document.createElement('span');
            el.className = 'flap ' + opts.className;
            el.innerHTML =
                '<span class="flap-half flap-top"><span class="flap-text"></span></span>' +
                '<span class="flap-half flap-bottom"><span class="flap-text"></span></span>' +
                '<span class="flap-half flap-top flap-leaf"><span class="flap-text"></span></span>' +
                '<span class="flap-half flap-bottom flap-leaf"><span class="flap-text"></span></span>';
            const halves = el.children;
            this.el = el;
            this.top = halves[0].firstChild;
            this.bottom = halves[1].firstChild;
            this.leafTop = halves[2];
            this.leafBottom = halves[3];
            this.leafTopText = this.leafTop.firstChild;
            this.leafBottomText = this.leafBottom.firstChild;
        }

        /** Write a face onto one half: text, colour and horizontal fit. */
        paint(textEl, value) {
            textEl.textContent = value;
            textEl.style.color = this.color ? this.color(value) : '';
            if (this.capacityEm) {
                const width = textWidthEm(value);
                textEl.style.transform = width > this.capacityEm
                    ? `scaleX(${(this.capacityEm / width).toFixed(3)})` : '';
            }
        }

        hideLeaves() {
            this.leafTop.style.visibility = 'hidden';
            this.leafBottom.style.visibility = 'hidden';
            this.leafBottom.style.transform = '';
        }

        /** Show `value` immediately, cancelling any flip in progress. */
        setInstant(value) {
            this.token++;
            this.hideLeaves();
            this.value = value;
            this.paint(this.top, value);
            this.paint(this.bottom, value);
        }

        /** Ordered faces to show after the current one, ending at `target`. */
        sequenceTo(target) {
            if (this.kind === 'count') return countSequence(this.value, target);
            const deck = this.kind === 'digit' ? this.digits : buildDeck(this.deck(), [this.value, target]);
            const n = deck.length;
            const from = deck.indexOf(this.value);
            const to = deck.indexOf(target);
            const steps = ((to - from) % n + n) % n || n;
            const seq = [];
            for (let i = 1; i <= steps; i++) seq.push(deck[(from + i) % n]);
            return seq;
        }

        /** One mechanical flip to `next`; returns false when cancelled. */
        async step(next, token) {
            const current = this.value;
            this.paint(this.top, next);              // revealed behind the falling leaf
            this.paint(this.leafTopText, current);   // top half of the old card falls
            this.paint(this.leafBottomText, next);   // bottom half of the new card lands
            this.leafTop.style.visibility = 'visible';
            this.leafBottom.style.visibility = 'visible';
            this.leafBottom.style.transform = 'rotateX(90deg)';

            const fall = this.leafTop.animate(
                [{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(-90deg)' }],
                { duration: HALF_FLIP_MS, easing: 'ease-in', fill: 'forwards' });
            await fall.finished;
            fall.cancel();
            if (token !== this.token) return false;
            this.leafTop.style.visibility = 'hidden';

            const land = this.leafBottom.animate(
                [{ transform: 'rotateX(90deg)' }, { transform: 'rotateX(0deg)' }],
                { duration: HALF_FLIP_MS, easing: 'ease-out', fill: 'forwards' });
            await land.finished;
            land.cancel();
            if (token !== this.token) return false;
            this.paint(this.bottom, next);
            this.hideLeaves();
            this.value = next;
            return true;
        }

        /** Flip through the deck until `target` shows (or a newer setInstant cancels it). */
        async flipTo(target) {
            if (target === this.value) return;
            const token = this.token;
            for (const face of this.sequenceTo(target)) {
                if (!(await this.step(face, token))) return;
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /* Rows and sections                                                   */
    /* ------------------------------------------------------------------ */

    function blankRow() {
        return { trainNumber: null, dest: '', no: '    ', via: '', type: '', time: '    ', note: ['', '', ''] };
    }

    /** A row's faces in flap order. */
    function rowFaces(values) {
        return [values.dest, ...values.no, values.via, values.type, ...values.time, ...values.note];
    }

    class BoardRow {
        constructor(sectionKey) {
            this.flaps = [];
            this.trainNumber = null;
            const el = document.createElement('div');
            el.className = 'fb-row';

            const cell = (key, ...flaps) => {
                const c = document.createElement('div');
                c.className = 'fb-cell fb-' + key;
                flaps.forEach(f => c.appendChild(f));
                el.appendChild(c);
            };
            const digit = (digits) => this.addFlap({ kind: 'digit', className: 'flap-digit', digits });
            const colon = document.createElement('span');
            colon.className = 'fb-colon';
            colon.textContent = ':';

            cell('dest', this.addFlap({
                kind: 'word', className: 'flap-word', capacity: 3.25,
                deck: () => state.destDecks[sectionKey]
            }));
            cell('no', digit(), digit(), digit(), digit());
            cell('via', this.addFlap({
                kind: 'word', className: 'flap-word', capacity: 2.05,
                deck: () => buildDeck(VIA_DECK, state.extraVias)
            }));
            cell('type', this.addFlap({
                kind: 'word', className: 'flap-word', capacity: 3.15,
                deck: () => buildDeck(TYPE_DECK, state.extraTypes),
                color: v => TYPE_COLORS[v] || ''
            }));
            cell('time', digit(HOUR_TENS_DECK), digit(), colon, digit(MINUTE_TENS_DECK), digit());
            const noteColor = v => NOTE_COLORS[v] || '';
            cell('note',
                this.addFlap({ kind: 'word', className: 'flap-glyph', deck: () => NOTE_MARK_DECK, color: noteColor }),
                this.addFlap({ kind: 'count', className: 'flap-count', capacity: 1.15, color: () => LATE_COLOR }),
                this.addFlap({ kind: 'word', className: 'flap-glyph', deck: () => NOTE_UNIT_DECK, color: noteColor }));

            el.addEventListener('click', () => openTrainSchedule(this.trainNumber, el));
            this.el = el;
        }

        addFlap(opts) {
            const flap = new Flap(opts);
            this.flaps.push(flap);
            return flap.el;
        }

        /** Bring every flap of this row to `values`; resolves when all have landed or been cancelled. */
        update(values, animate) {
            if (values.trainNumber !== this.trainNumber) this.el.classList.remove('fb-row-selected');
            this.trainNumber = values.trainNumber;
            this.el.classList.toggle('fb-row-active', values.trainNumber !== null);
            this.el.classList.toggle('fb-row-imminent', Boolean(values.imminent));
            const faces = rowFaces(values);
            const jobs = [];
            this.flaps.forEach((flap, i) => {
                if (animate) {
                    if (flap.value !== faces[i]) jobs.push(flap.flipTo(faces[i]));
                } else {
                    flap.setInstant(faces[i]);
                }
            });
            return Promise.all(jobs);
        }
    }

    class BoardSection {
        constructor(def) {
            this.def = def;
            this.running = false;
            this.pending = null;
            /** Bumped by reset(); a pass started under an older generation stops. */
            this.generation = 0;

            const el = document.createElement('section');
            el.className = 'fb-section';
            el.innerHTML =
                `<header class="fb-title"><span class="fb-title-zh">${def.zh}</span>` +
                '<span class="fb-title-target"></span></header>';
            const table = document.createElement('div');
            table.className = 'fb-table';
            const head = document.createElement('div');
            head.className = 'fb-row fb-head';
            head.innerHTML = COLUMN_LABELS.map(([key, zh]) => `<div class="fb-cell fb-${key}">${zh}</div>`).join('');
            table.appendChild(head);
            this.rows = [];
            for (let i = 0; i < ROWS; i++) {
                const row = new BoardRow(def.key);
                this.rows.push(row);
                table.appendChild(row.el);
            }
            el.appendChild(table);
            this.targetEl = el.querySelector('.fb-title-target');
            this.el = el;
        }

        /** Blank every row immediately, cancelling any pass and flip in progress. */
        reset() {
            this.generation++;
            this.pending = null;
            this.rows.forEach(row => row.update(blankRow(), false));
        }

        /** Queue new target rows; a running pass restarts from the top with them. */
        request(rowsValues) {
            this.pending = rowsValues;
            if (!this.running) this.drain();
        }

        async drain() {
            this.running = true;
            while (this.pending) {
                const target = this.pending;
                this.pending = null;
                const generation = this.generation;
                const animate = !prefersReducedMotion();
                for (let i = 0; i < this.rows.length; i++) {
                    // Newer data restarts from the top; a reset() stops this pass
                    if (this.pending || generation !== this.generation) break;
                    await this.rows[i].update(target[i], animate);
                }
            }
            this.running = false;
        }
    }

    /** Stop all flipping now and blank the board; the next visible refresh starts from row 1. */
    function stopAndBlank() {
        state.sections.forEach(s => s.reset());
        clearSelectedRows();
        state.needsReset = false;
    }

    /* ------------------------------------------------------------------ */
    /* Data -> rows                                                        */
    /* ------------------------------------------------------------------ */

    /**
     * Trains stopping at the current station, one record per train, including
     * trains that terminate here (their time is the arrival; 開往 is this station).
     * Time: O(T * S) for T trains with S stops each.
     */
    function stationDepartures() {
        const station = state.stationName;
        const departures = [];
        state.trains.forEach(train => {
            const stops = train.data || [];
            if (stops.length === 0) return;
            // Last occurrence = departure (or arrival at the terminal)
            let depStop = null;
            for (const stop of stops) if (stop.x === station) depStop = stop;
            if (!depStop) return;

            const number = parseInt(train.number, 10);
            if (isNaN(number)) return;
            const key = String(train.number);
            const rawDelay = state.delayMap.get(key);
            const isLive = state.delayMap.has(key) && !isNaN(parseInt(rawDelay, 10));
            const delay = isLive ? parseInt(rawDelay, 10) : 0;
            const info = train.info || {};
            const depMinutes = Math.floor(depStop.y);
            const hh = Math.floor(depMinutes / 60) % 24;
            const mm = depMinutes % 60;
            // 山線/海線/成追 first; otherwise 北迴 or 南迴 (board only, not the card list)
            const via = info.via && info.via !== '-' ? (VIA_NAMES[info.via] || info.via) : ringVia(train);

            let note = ['', '', ''];
            if (isLive) note = delay > 0 ? ['晚', String(delay), '分'] : ['準', '', '點'];

            departures.push({
                // Same rule as the card list (成追線 trains are reversed on 山線 stations)
                clockwise: typeof isClockwiseAtStation === 'function'
                    ? isClockwiseAtStation(train, station) : number % 2 === 0,
                depMinutes: depMinutes,
                effectiveMinutes: depMinutes + delay,
                travelMinutes: stops[stops.length - 1].y - depStop.y,
                values: {
                    trainNumber: key,
                    dest: cleanDestination(info.end || ''),
                    no: String(number).slice(-4).padStart(4, ' '),
                    via: via,
                    type: typeDisplayName(train),
                    time: String(hh).padStart(2, '0') + String(mm).padStart(2, '0'),
                    note: note
                }
            });
        });
        return departures;
    }

    /** Ordered 開往 deck of one direction: stations.json list, else today's terminals by travel time. */
    function destinationDeck(def, departures) {
        const stations = typeof globalStationsData !== 'undefined' ? globalStationsData : [];
        const entry = Array.isArray(stations) ? stations.find(s => s.stationName === state.stationName) : null;
        const today = departures
            .filter(d => d.clockwise === def.clockwise)
            .sort((a, b) => a.travelMinutes - b.travelMinutes)
            .map(d => d.values.dest);
        const recorded = entry && Array.isArray(entry[def.destField]) ? entry[def.destField] : [];
        return buildDeck(recorded, today);
    }

    /** Recompute both sections' target rows and queue the flips (only while the board is visible). */
    function refresh() {
        if (!state.stationName || !boardIsVisible()) return;
        if (state.needsReset) stopAndBlank();

        const departures = stationDepartures();
        state.extraTypes = departures.map(d => d.values.type).filter(v => !TYPE_DECK.includes(v)).sort();
        state.extraVias = departures.map(d => d.values.via).filter(v => !VIA_DECK.includes(v)).sort();
        const nowMinutes = serviceNowMinutes();

        state.sections.forEach(section => {
            state.destDecks[section.def.key] = destinationDeck(section.def, departures);
            const upcoming = departures
                .filter(d => d.clockwise === section.def.clockwise && d.effectiveMinutes >= nowMinutes)
                // Expected departure (scheduled + delay) first, scheduled time breaks ties
                .sort((a, b) => a.effectiveMinutes - b.effectiveMinutes || a.depMinutes - b.depMinutes)
                .slice(0, ROWS)
                .map(d => ({ ...d.values, imminent: d.effectiveMinutes - nowMinutes <= IMMINENT_MINUTES }));
            while (upcoming.length < ROWS) upcoming.push(blankRow());
            section.request(upcoming);
        });
    }

    /* ------------------------------------------------------------------ */
    /* View toggle, clicks and timers                                      */
    /* ------------------------------------------------------------------ */

    function boardIsVisible() {
        const wrapper = document.getElementById('flapboard-wrapper');
        return !document.hidden && wrapper !== null && wrapper.offsetParent !== null;
    }

    function clearSelectedRows() {
        document.querySelectorAll('.fb-row.fb-row-selected').forEach(r => r.classList.remove('fb-row-selected'));
    }

    /** Open the schedule panel for a row by reusing the (hidden) card's click handler. */
    function openTrainSchedule(trainNumber, rowEl) {
        if (!trainNumber) return;
        const header = document.querySelector(
            `#unified-train-list .train-card[data-train-number="${trainNumber}"] .train-header`);
        if (!header) return;
        header.click();
        clearSelectedRows();
        const card = header.closest('.train-card');
        if (card && card.classList.contains('expanded')) rowEl.classList.add('fb-row-selected');
    }

    function setView(view) {
        const panel = document.getElementById('info-panel');
        if (!panel) return;
        const wasBoard = panel.classList.contains('board-mode');
        const isBoard = view === 'board';
        panel.classList.toggle('board-mode', isBoard);
        if (wasBoard && !isBoard) {
            // Leaving the board: stop flipping, show the card list at the next train
            stopAndBlank();
            if (typeof scrollTrainListToUpcoming === 'function') {
                requestAnimationFrame(() => scrollTrainListToUpcoming());
            }
        } else if (isBoard && !wasBoard) {
            state.needsReset = true;   // entering the board: flip in from blank
        }
        document.querySelectorAll('.view-toggle-btn').forEach(btn => {
            const active = btn.dataset.view === view;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', String(active));
        });
        try { localStorage.setItem(VIEW_KEY, view); } catch (e) { /* storage unavailable */ }
        refresh();
    }

    /** Fire refresh() just after every minute boundary. */
    function scheduleMinuteTick() {
        const delay = 60000 - (Date.now() % 60000) + 300;
        setTimeout(() => {
            refresh();
            scheduleMinuteTick();
        }, delay);
    }

    function init() {
        const wrapper = document.getElementById('flapboard-wrapper');
        if (!wrapper) return;
        const board = document.createElement('div');
        board.className = 'fb-board';
        SECTIONS.forEach(def => {
            const section = new BoardSection(def);
            state.sections.push(section);
            board.appendChild(section.el);
            section.reset();
        });
        wrapper.appendChild(board);
        try { localStorage.removeItem(LEGACY_SEEN_KEY); } catch (e) { /* ignore */ }

        document.querySelectorAll('.view-toggle-btn').forEach(btn => {
            btn.addEventListener('click', () => setView(btn.dataset.view));
        });
        let saved = 'cards';
        try { saved = localStorage.getItem(VIEW_KEY) || 'cards'; } catch (e) { /* ignore */ }
        setView(saved);

        const closeSchedule = document.getElementById('close-schedule-btn');
        if (closeSchedule) closeSchedule.addEventListener('click', clearSelectedRows);
        // Closing the station panel stops the board at once; no station is shown any more
        const closePanel = document.getElementById('close-panel-btn');
        if (closePanel) {
            closePanel.addEventListener('click', () => {
                state.stationName = null;
                stopAndBlank();
            });
        }
        document.addEventListener('visibilitychange', refresh);
        scheduleMinuteTick();
    }

    window.FlapBoard = {
        /** A station was selected (new or the same one): stop now and start again from blank. */
        stationSelected() {
            stopAndBlank();
            state.needsReset = true;
        },

        /**
         * Receive a schedule snapshot from main.js.
         * @param {{trains: object[], stationName: string, delayMap: Map,
         *          cwTarget: string, ccwTarget: string}} data
         */
        setData(data) {
            state.trains = data.trains || [];
            state.stationName = data.stationName;
            state.delayMap = data.delayMap || new Map();
            state.sections.forEach(section => {
                const target = section.def.key === 'cw' ? data.cwTarget : data.ccwTarget;
                section.targetEl.textContent = target ? `往 ${target}` : '';
            });
            refresh();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
