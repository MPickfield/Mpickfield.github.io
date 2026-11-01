/*
 * Scrabble Dojo — Game 1: Anagram Trainer
 * Find every valid word that can be formed from a hand of 7 tiles.
 */
(function () {
  'use strict';

  // Standard English Scrabble tile distribution (blanks excluded).
  // letter: [count, value]
  var TILE_DIST = {
    A: [9, 1], B: [2, 3], C: [2, 3], D: [4, 2], E: [12, 1],
    F: [2, 4], G: [3, 2], H: [2, 4], I: [9, 1], J: [1, 8],
    K: [1, 5], L: [4, 1], M: [2, 3], N: [6, 1], O: [8, 1],
    P: [2, 3], Q: [1, 10], R: [6, 1], S: [4, 1], T: [6, 1],
    U: [4, 1], V: [2, 4], W: [2, 4], X: [1, 8], Y: [2, 4],
    Z: [1, 10]
  };

  // Celebration words for a correct play, ordered mild -> exuberant.
  // High-value letters (5 points or more) draw from a more exciting pool,
  // and longer words reach toward the more exuberant end of each pool.
  var PRAISE_NORMAL = [
    'Nice!', 'Sweet!', 'Good one!', 'Nice find!', 'Great!',
    'Well played!', 'Solid!', 'Good job!', 'Excellent!', 'Brilliant!'
  ];
  var PRAISE_HIGH_VALUE = [
    'Wow!', 'Amazing!', 'Fantastic!', 'Tremendous!', 'Splendid!',
    'Spectacular!', 'Magnificent!', 'Incredible!', 'Outstanding!', 'Phenomenal!'
  ];
  var HIGH_VALUE_MIN = 5;

  var HAND_SIZE = 7;
  var MIN_WORD_LEN = 2;
  var BLANK = '_';
  var BLANK_COUNT = 2;

  var cfg = window.DOJO_CONFIG || {};
  var dictionaryUrl = cfg.dictionaryUrl || '/assets/data/dictionary.txt';
  // Cache-bust the dictionary with the deploy revision so browsers always pick
  // up a fresh word list after an update.
  if (cfg.version) {
    dictionaryUrl += (dictionaryUrl.indexOf('?') === -1 ? '?' : '&') + 'v=' + encodeURIComponent(cfg.version);
  }

  var state = {
    dict: null,            // Set of uppercase words
    hand: [],              // [{id, letter, value}]
    tray: [],              // tiles currently in the build tray
    found: new Set(),      // words found
    target: [],            // every valid word formable from the hand
    hints: new Map(),      // word -> number of letters revealed (left to right)
    hintCount: 0,          // hints used this hand
    hintFlash: null,       // word whose hint was just revealed (for a flash effect)
    nextId: 1,
    sortables: [],         // SortableJS instances for hand + tray
    blanksEnabled: false,  // include the two blank tiles in new hands
    mode: 'normal',        // 'normal' or 'daily'
    dailyDate: null,       // 'YYYY-MM-DD' when mode is 'daily'
    handCompleted: false,  // this hand has already been recorded as completed
    collapsedLengths: {},  // word-length -> true when its group is collapsed
    completedLengths: {}   // word-length -> true once its check burst has shown
  };

  var el = {};
  var toastTimer = null;
  var hintLocked = false;
  var dragActive = false;
  var lastCompletedCount = null;
  var pendingConfirm = null;

  var STORAGE_KEY_GAME = 'dojo.currentGame';
  var STORAGE_KEY_HANDS = 'dojo.completedHands';

  /* ---------------------------------------------------------------
   * Helpers
   * ------------------------------------------------------------- */
  function seedFromString(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeSeededRng(seedString) {
    return mulberry32(seedFromString(seedString));
  }

  function shuffle(arr, rng) {
    var a = arr.slice();
    var rand = rng || Math.random;
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function buildBag(rng, includeBlanks) {
    var bag = [];
    Object.keys(TILE_DIST).forEach(function (letter) {
      var count = TILE_DIST[letter][0];
      for (var i = 0; i < count; i++) bag.push(letter);
    });
    if (includeBlanks === undefined) includeBlanks = state.blanksEnabled;
    if (includeBlanks) {
      for (var b = 0; b < BLANK_COUNT; b++) bag.push(BLANK);
    }
    return shuffle(bag, rng);
  }

  function countLetters(word) {
    var c = {};
    for (var i = 0; i < word.length; i++) {
      var ch = word[i];
      c[ch] = (c[ch] || 0) + 1;
    }
    return c;
  }

  function canForm(word, handCount, blanks) {
    var wc = countLetters(word);
    var needed = 0;
    for (var ch in wc) {
      var have = handCount[ch] || 0;
      if (have < wc[ch]) needed += wc[ch] - have;
    }
    return needed <= blanks;
  }

  function computeTarget(handTiles) {
    var handCount = {};
    var blanks = 0;
    handTiles.forEach(function (t) {
      if (t.isBlank) blanks++;
      else handCount[t.letter] = (handCount[t.letter] || 0) + 1;
    });
    var result = [];
    state.dict.forEach(function (word) {
      if (word.length >= MIN_WORD_LEN && canForm(word, handCount, blanks)) {
        result.push(word);
      }
    });
    result.sort(function (a, b) {
      return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
    });
    return result;
  }

  /* ---------------------------------------------------------------
   * Persistence (localStorage)
   * ------------------------------------------------------------- */
  function loadJSON(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      // Storage may be unavailable (private mode, quota, etc.). Ignore.
    }
  }

  function serializeTile(tile) {
    if (tile.isBlank) return { b: true, a: tile.assigned || '' };
    return { l: tile.letter };
  }

  function hydrateTile(raw) {
    if (!raw) return null;
    if (raw.b) {
      var blank = makeTileObject(BLANK);
      blank.assigned = raw.a || '';
      return blank;
    }
    if (raw.l && TILE_DIST[raw.l]) return makeTileObject(raw.l);
    return null;
  }

  function loadCompletedHands() {
    var hands = loadJSON(STORAGE_KEY_HANDS);
    return Array.isArray(hands) ? hands : [];
  }

  function renderCompletedCount() {
    if (!el.completedCount) return;
    var count = loadCompletedHands().length;
    var increased = lastCompletedCount !== null && count > lastCompletedCount;
    el.completedCount.textContent = count;

    if (el.completedCheck) {
      el.completedCheck.hidden = count === 0;
      if (increased && count > 0) burstCompletedCheck();
    }
    lastCompletedCount = count;
  }

  function burstCompletedCheck() {
    if (!el.completedCheck) return;
    var old = el.completedCheck.querySelector('.check-burst');
    if (old) old.parentNode.removeChild(old);
    addBurst(el.completedCheck);
  }

  function completeHand() {
    if (state.handCompleted) return;
    state.handCompleted = true;
    var hands = loadCompletedHands();
    hands.push({
      date: new Date().toISOString(),
      letters: state.hand.map(function (t) { return t.isBlank ? BLANK : t.letter; })
    });
    saveJSON(STORAGE_KEY_HANDS, hands);
    renderCompletedCount();
  }

  function saveGame() {
    if (!state.dict) return; // dictionary not loaded yet
    saveJSON(STORAGE_KEY_GAME, {
      version: 1,
      mode: state.mode,
      dailyDate: state.dailyDate,
      hand: state.hand.map(serializeTile),
      tray: state.tray.map(serializeTile),
      found: Array.from(state.found),
      hints: Array.from(state.hints.entries()),
      hintCount: state.hintCount,
      blanksEnabled: state.blanksEnabled
    });
  }

  function loadGame() {
    var data = loadJSON(STORAGE_KEY_GAME);
    if (!data || !Array.isArray(data.hand) || !Array.isArray(data.found)) return null;
    return data;
  }

  function restoreGame(data) {
    state.nextId = 1;
    state.hand = data.hand.map(hydrateTile).filter(Boolean);
    state.tray = (Array.isArray(data.tray) ? data.tray : []).map(hydrateTile).filter(Boolean);
    state.found = new Set(data.found);
    state.hints = new Map(Array.isArray(data.hints) ? data.hints : []);
    state.hintCount = typeof data.hintCount === 'number' ? data.hintCount : 0;
    state.blanksEnabled = !!data.blanksEnabled;
    state.mode = data.mode === 'daily' ? 'daily' : 'normal';
    state.dailyDate = typeof data.dailyDate === 'string' ? data.dailyDate : null;
    state.target = computeTarget(state.hand);
    state.handCompleted = state.found.size >= state.target.length;
    state.collapsedLengths = {};
    state.completedLengths = {};
    // Collapse (and pre-mark) any length that is already fully found so the
    // check bursts don't replay when a saved game is restored.
    var totals = {};
    var foundCounts = {};
    state.target.forEach(function (w) { totals[w.length] = (totals[w.length] || 0) + 1; });
    state.found.forEach(function (w) { foundCounts[w.length] = (foundCounts[w.length] || 0) + 1; });
    Object.keys(totals).forEach(function (len) {
      if ((foundCounts[len] || 0) >= totals[len]) {
        state.completedLengths[len] = true;
        state.collapsedLengths[len] = true;
      }
    });
    renderBlanksToggle();
    render();
  }

  /* ---------------------------------------------------------------
   * Game actions
   * ------------------------------------------------------------- */
  function makeTileObject(letter) {
    if (letter === BLANK) {
      return { id: state.nextId++, letter: BLANK, value: 0, isBlank: true, assigned: '' };
    }
    return { id: state.nextId++, letter: letter, value: TILE_DIST[letter][1] };
  }

  function drawHand(fixedLetters, rng, includeBlanks) {
    var fixed = (fixedLetters || []).slice(0, HAND_SIZE);
    var bag = buildBag(rng, includeBlanks);
    var chosen = [];
    var i;
    var idx;

    // Pre-draw the requested letters, taking each out of the bag. Blanks are
    // always honoured so a preset hand can include them regardless of the bag.
    for (i = 0; i < fixed.length; i++) {
      if (fixed[i] === BLANK) {
        chosen.push(BLANK);
        continue;
      }
      idx = bag.indexOf(fixed[i]);
      if (idx === -1) continue; // not enough of that letter left in the bag
      chosen.push(bag.splice(idx, 1)[0]);
    }

    // Fill the rest of the hand from the remaining (shuffled) bag.
    while (chosen.length < HAND_SIZE && bag.length) {
      chosen.push(bag.shift());
    }

    return chosen.map(makeTileObject);
  }

  function todaySeed() {
    var d = new Date();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return '' + d.getFullYear() + m + day;
  }

  function todayDate() {
    var d = new Date();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function newHand(fixedLetters) {
    state.mode = 'normal';
    state.dailyDate = null;
    state.handCompleted = false;
    var hand;
    var target;
    var guard = 0;
    do {
      hand = drawHand(fixedLetters);
      target = computeTarget(hand);
      guard++;
    } while (target.length === 0 && guard < 100);

    state.hand = hand;
    state.tray = [];
    state.found = new Set();
    state.hints = new Map();
    state.hintCount = 0;
    state.target = target;
    state.collapsedLengths = {};
    state.completedLengths = {};
    render();
  }

  function newDailyHand() {
    state.mode = 'daily';
    state.dailyDate = todayDate();
    state.handCompleted = false;
    var seed = todaySeed();
    var hand;
    var target;
    var attempt = 0;
    var guard = 0;
    do {
      hand = drawHand(null, makeSeededRng(seed + ':' + attempt), false);
      target = computeTarget(hand);
      attempt++;
      guard++;
    } while ((target.length === 0 || target.length > 120) && guard < 500);

    state.hand = hand;
    state.tray = [];
    state.found = new Set();
    state.hints = new Map();
    state.hintCount = 0;
    state.target = target;
    state.collapsedLengths = {};
    state.completedLengths = {};
    render();
  }

  function moveToTray(id) {
    var idx = state.hand.findIndex(function (t) { return t.id === id; });
    if (idx === -1) return;
    state.tray.push(state.hand.splice(idx, 1)[0]);
    render();
  }

  function moveToHand(id) {
    var idx = state.tray.findIndex(function (t) { return t.id === id; });
    if (idx === -1) return;
    var tile = state.tray.splice(idx, 1)[0];
    if (tile.isBlank) tile.assigned = '';
    state.hand.unshift(tile);
    render();
  }

  function backspace() {
    // Return the last played tile to the front of the hand.
    if (state.tray.length) {
      state.hand.unshift(state.tray.pop());
      render();
    }
  }

  function clearTray() {
    // Return the played tiles to the front of the hand, preserving their order.
    state.hand = state.tray.concat(state.hand);
    state.tray = [];
    render();
  }

  function shuffleHand() {
    state.hand = shuffle(state.hand);
    render();
  }

  // A high-value play uses any letter worth HIGH_VALUE_MIN points or more.
  function hasHighValueLetter(word) {
    for (var i = 0; i < word.length; i++) {
      var info = TILE_DIST[word.charAt(i)];
      if (info && info[1] >= HIGH_VALUE_MIN) return true;
    }
    return false;
  }

  // Pick a celebration word. High-value letters draw from the exuberant
  // pool, and longer words celebrate higher-scoring plays with a word
  // from closer to the excited end of whichever pool is chosen.
  function pickPraise(word) {
    var pool = hasHighValueLetter(word) ? PRAISE_HIGH_VALUE : PRAISE_NORMAL;
    var t = (word.length - MIN_WORD_LEN) / (HAND_SIZE - MIN_WORD_LEN);
    var idx = Math.round(t * (pool.length - 1));
    idx += Math.floor(Math.random() * 3) - 1; // small jitter for variety
    idx = Math.max(0, Math.min(pool.length - 1, idx));
    return pool[idx];
  }

  function submit() {
    var unassigned = state.tray.some(function (t) { return t.isBlank && !t.assigned; });
    if (unassigned) {
      toast('Tap each blank to choose its letter.', 'error');
      shakeTray();
      return;
    }
    var word = state.tray.map(function (t) { return t.isBlank ? t.assigned : t.letter; }).join('');
    var score = state.tray.reduce(function (sum, t) { return sum + t.value; }, 0);
    if (word.length < MIN_WORD_LEN) {
      toast('That word is too short.', 'error');
      shakeTray();
      return;
    }
    if (state.found.has(word)) {
      toast('Already found: ' + word, 'error');
      shakeTray();
      return;
    }
    if (!state.dict.has(word)) {
      toast('Not a valid word: ' + word, 'error');
      shakeTray();
      return;
    }
    state.found.add(word);
    if (state.hints.has(word)) state.hints.delete(word);
    toast(pickPraise(word) + ' ' + word + ' (' + score + ' pts)');
    clearTray();
    if (state.found.size >= state.target.length) completeHand();
  }

  /* ---------------------------------------------------------------
   * Hints
   * ------------------------------------------------------------- */
  function makeHintPattern(word, revealed) {
    var chars = [];
    for (var i = 0; i < word.length; i++) {
      chars.push(i < revealed ? word.charAt(i) : '_');
    }
    return chars.join('');
  }

  // Words we can still reveal a hint for: not yet found and not already hinted.
  function hintableWords(length) {
    return state.target.filter(function (w) {
      if (length !== undefined && w.length !== length) return false;
      return !state.found.has(w) && !state.hints.has(w);
    });
  }

  function giveHint(length) {
    var options = hintableWords(length);
    if (!options.length) return;
    var pick = options[Math.floor(Math.random() * options.length)];
    state.hints.set(pick, 1); // always start by revealing the first letter
    state.hintCount++;
    render();
  }

  function revealNextHint(word) {
    if (hintLocked) return;
    var revealed = state.hints.get(word);
    if (revealed === undefined) return;
    if (revealed >= word.length - 1) return; // "guess" state is handled by tapHint
    hintLocked = true;
    state.hints.set(word, revealed + 1);
    state.hintFlash = word;
    setTimeout(function () { hintLocked = false; }, 400);
    render();
  }

  function tapHint(entry, chipEl) {
    if (entry.canReveal) {
      revealNextHint(entry.word);
    } else {
      shakeChip(chipEl);
      toast('Guess! You can do it!');
    }
  }

  function shakeChip(chipEl) {
    chipEl.classList.remove('chip-shake-no');
    void chipEl.offsetWidth; // restart the animation if it is already running
    chipEl.classList.add('chip-shake-no');
  }

  function openHintModal() {
    var byLen = {};
    hintableWords().forEach(function (w) {
      (byLen[w.length] = byLen[w.length] || []).push(w);
    });
    var lengths = Object.keys(byLen).map(Number).sort(function (a, b) { return a - b; });

    el.hintModalOptions.innerHTML = '';
    if (!lengths.length) {
      var empty = document.createElement('p');
      empty.className = 'hint-modal-empty';
      empty.textContent = 'No words left to hint.';
      el.hintModalOptions.appendChild(empty);
    } else {
      lengths.forEach(function (len) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hint-option';

        var label = document.createElement('span');
        label.className = 'hint-option-label';
        label.textContent = len + ' letters';

        var count = document.createElement('span');
        count.className = 'hint-option-count';
        count.textContent = byLen[len].length + ' left';

        btn.appendChild(label);
        btn.appendChild(count);
        btn.addEventListener('click', function () {
          closeHintModal();
          giveHint(len);
        });
        el.hintModalOptions.appendChild(btn);
      });
    }

    el.hintModal.hidden = false;
  }

  function closeHintModal() {
    el.hintModal.hidden = true;
  }

  /* ---------------------------------------------------------------
   * Rendering
   * ------------------------------------------------------------- */
  function tileDisplayLetter(tile, inTray) {
    if (!tile.isBlank) return tile.letter;
    if (inTray && tile.assigned) return tile.assigned;
    return BLANK;
  }

  function tileAriaLabel(tile, inTray) {
    if (!tile.isBlank) return tile.letter + ', ' + tile.value + ' points';
    if (inTray && tile.assigned) return 'Blank playing ' + tile.assigned + ', 0 points';
    return 'Blank, 0 points';
  }

  function makeTile(tile, inTray) {
    var d = document.createElement('button');
    d.type = 'button';
    d.className = 'tile' + (inTray ? ' tile-tray' : '') + (tile.isBlank ? ' tile-blank' : '');
    d.setAttribute('data-id', tile.id);
    d.setAttribute('aria-label', tileAriaLabel(tile, inTray));

    if (inTray) {
      // Tapping a tile already in the play area: blanks cycle their letter,
      // while a letter tile returns to the hand.
      if (tile.isBlank) {
        d.addEventListener('click', function () { cycleBlank(tile.id); });
      } else {
        d.addEventListener('click', function () {
          if (dragActive) return;
          moveToHand(tile.id);
        });
      }
    } else {
      // Tapping a hand tile (without dragging) appends it to the end of the
      // play area. Dragging still reorders tiles via SortableJS.
      d.addEventListener('click', function () {
        if (dragActive) return;
        moveToTray(tile.id);
      });
    }

    var letter = document.createElement('span');
    letter.className = 'letter';
    letter.textContent = tileDisplayLetter(tile, inTray);

    var value = document.createElement('span');
    value.className = 'value';
    value.textContent = tile.value;

    d.appendChild(letter);
    d.appendChild(value);
    return d;
  }

  function cycleBlank(id) {
    var tile = state.tray.find(function (t) { return t.id === id; });
    if (!tile || !tile.isBlank) return;
    var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (!tile.assigned) tile.assigned = 'A';
    else if (tile.assigned === 'Z') tile.assigned = '';
    else tile.assigned = alphabet.charAt(alphabet.indexOf(tile.assigned) + 1);
    render();
  }

  function renderTiles() {
    state.sortables.forEach(function (s) { s.destroy(); });
    state.sortables = [];

    el.hand.innerHTML = '';
    el.tray.innerHTML = '';
    state.hand.forEach(function (t) { el.hand.appendChild(makeTile(t, false)); });
    state.tray.forEach(function (t) { el.tray.appendChild(makeTile(t, true)); });

    createSortable(el.hand);
    createSortable(el.tray);
    renderMeta();
  }

  function renderMeta() {
    var word = state.tray.map(function (t) {
      return t.isBlank ? (t.assigned || BLANK) : t.letter;
    }).join('');
    var score = state.tray.reduce(function (sum, t) { return sum + t.value; }, 0);
    var alreadyPlayed = word.length >= MIN_WORD_LEN && state.found.has(word);

    if (alreadyPlayed) {
      el.trayScore.textContent = 'Already Played!';
      el.trayScore.classList.add('tray-score-played');
    } else {
      el.trayScore.textContent = state.tray.length ? score + ' pts' : '';
      el.trayScore.classList.remove('tray-score-played');
    }
    el.submit.disabled = state.tray.length === 0;
  }

  /* ---------------------------------------------------------------
   * Drag & drop (SortableJS)
   * ------------------------------------------------------------- */
  function createSortable(container) {
    if (typeof Sortable === 'undefined') return;
    var s = new Sortable(container, {
      group: 'dojo-tiles',
      draggable: '.tile',
      animation: 140,
      forceFallback: true,
      fallbackOnBody: true,
      fallbackTolerance: 8, // require a real move before dragging, so a tap stays a tap
      ghostClass: 'tile-ghost',
      dragClass: 'tile-drag',
      chosenClass: 'tile-chosen',
      onStart: function () {
        // A real drag (not a tap) is now in progress.
        dragActive = true;
      },
      onEnd: function () {
        // Defer until SortableJS has fully finished its drop cleanup.
        setTimeout(syncFromDom, 0);
        // Keep the tap guard armed through the trailing click browsers fire
        // after a drag, then disarm it so the next tap still works.
        setTimeout(function () { dragActive = false; }, 300);
      }
    });
    state.sortables.push(s);
  }

  function readOrder(container, byId) {
    var result = [];
    Array.prototype.forEach.call(container.querySelectorAll('.tile'), function (n) {
      var tile = byId[+n.getAttribute('data-id')];
      if (tile) result.push(tile);
    });
    return result;
  }

  function syncFromDom() {
    var byId = {};
    state.hand.concat(state.tray).forEach(function (t) { byId[t.id] = t; });
    state.hand = readOrder(el.hand, byId);
    state.tray = readOrder(el.tray, byId);

    // A blank loses its assigned letter once it returns to the hand.
    state.hand.forEach(function (t) { if (t.isBlank) t.assigned = ''; });

    refreshTiles(el.hand, false, byId);
    refreshTiles(el.tray, true, byId);

    renderMeta();
    saveGame();
  }

  function refreshTiles(container, inTray, byId) {
    Array.prototype.forEach.call(container.querySelectorAll('.tile'), function (node) {
      var tile = byId[+node.getAttribute('data-id')];
      if (!tile) return;
      node.classList.toggle('tile-tray', inTray);
      var letter = node.querySelector('.letter');
      if (letter) letter.textContent = tileDisplayLetter(tile, inTray);
      node.setAttribute('aria-label', tileAriaLabel(tile, inTray));
    });
  }

  function addBurst(parent) {
    var burst = document.createElement('span');
    burst.className = 'check-burst';
    for (var i = 0; i < 8; i++) {
      var bar = document.createElement('span');
      bar.className = 'burst-bar';
      burst.appendChild(bar);
    }
    parent.appendChild(burst);
    setTimeout(function () {
      if (burst.parentNode) burst.parentNode.removeChild(burst);
    }, 550);
  }

  function makeCompletedCheck(animate) {
    var wrap = document.createElement('span');
    wrap.className = 'completed-check';
    wrap.setAttribute('aria-hidden', 'true');

    var icon = document.createElement('i');
    icon.className = 'fas fa-check';
    wrap.appendChild(icon);

    if (animate) addBurst(wrap);
    return wrap;
  }

  function toggleCollapse(len) {
    if (state.collapsedLengths[len]) delete state.collapsedLengths[len];
    else state.collapsedLengths[len] = true;
    renderFound();
  }

  function renderFound() {
    var listEl = el.foundList;
    var flashWord = state.hintFlash;
    state.hintFlash = null;
    var best = bestWords();
    listEl.innerHTML = '';

    // Totals per length (from the target), found words, and hints per length.
    var totals = {};
    var foundWords = {};
    var hintedWords = {};

    state.target.forEach(function (w) {
      totals[w.length] = (totals[w.length] || 0) + 1;
    });

    state.found.forEach(function (w) {
      (foundWords[w.length] = foundWords[w.length] || []).push(w);
    });

    state.hints.forEach(function (revealed, word) {
      (hintedWords[word.length] = hintedWords[word.length] || []).push({ word: word, revealed: revealed });
    });

    var lengths = Object.keys(totals).map(Number).sort(function (a, b) { return a - b; });

    if (!lengths.length) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'Words you play will appear here.';
      listEl.appendChild(empty);
      return;
    }

    lengths.forEach(function (len) {
      var foundLen = foundWords[len] || [];
      var complete = foundLen.length >= totals[len];
      var newlyComplete = complete && !state.completedLengths[len];
      if (complete) state.completedLengths[len] = true;
      if (newlyComplete) state.collapsedLengths[len] = true;

      var group = document.createElement('div');
      group.className = 'found-group';
      if (state.collapsedLengths[len]) group.classList.add('collapsed');

      var header = document.createElement('h3');
      header.className = 'found-group-header';
      header.setAttribute('role', 'button');
      header.setAttribute('tabindex', '0');
      header.setAttribute('aria-expanded', state.collapsedLengths[len] ? 'false' : 'true');

      var label = document.createElement('span');
      label.className = 'found-group-label';
      label.textContent = len + ' Letters ';
      header.appendChild(label);

      var count = document.createElement('span');
      count.className = 'found-group-count';
      count.textContent = '(' + foundLen.length + '/' + totals[len] + ')';
      header.appendChild(count);

      if (complete) header.appendChild(makeCompletedCheck(newlyComplete));

      header.addEventListener('click', function () { toggleCollapse(len); });
      header.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          toggleCollapse(len);
        }
      });
      group.appendChild(header);

      // Merge found words and hints, sorted by the underlying word so a hint
      // is simply replaced in place when its word is played.
      var entries = [];
      foundLen.forEach(function (w) {
        entries.push({ word: w, text: w, isFound: true });
      });
      (hintedWords[len] || []).forEach(function (h) {
        entries.push({
          word: h.word,
          text: makeHintPattern(h.word, h.revealed),
          isFound: false,
          canReveal: h.revealed < h.word.length - 1
        });
      });
      entries.sort(function (a, b) {
        return a.word < b.word ? -1 : a.word > b.word ? 1 : 0;
      });

      // Always render the chips container so each section reserves a row of
      // space; this prevents the page from jumping when the first pill appears.
      var chips = document.createElement('div');
      chips.className = 'chips';
      entries.forEach(function (e) {
        var chip = document.createElement('span');
        chip.className = 'chip' + (e.isFound ? ' chip-word' : ' chip-hint');
        chip.textContent = e.text;
        if (e.isFound && best.has(e.word)) chip.classList.add('chip-best');
        if (!e.isFound && e.word === flashWord) chip.classList.add('chip-flash');
        if (e.isFound) {
          chip.setAttribute('role', 'button');
          chip.setAttribute('tabindex', '0');
          chip.addEventListener('click', function () { openWordModal(e.word); });
          chip.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault();
              openWordModal(e.word);
            }
          });
        } else {
          if (e.canReveal) {
            chip.classList.add('chip-hint-live');
            chip.setAttribute('title', 'Tap to reveal the next letter');
          } else {
            chip.classList.add('chip-hint-done');
            chip.setAttribute('title', 'No more hints — guess!');
          }
          chip.setAttribute('role', 'button');
          chip.setAttribute('tabindex', '0');
          chip.addEventListener('click', function () { tapHint(e, chip); });
          chip.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault();
              tapHint(e, chip);
            }
          });
        }
        chips.appendChild(chip);
      });
      group.appendChild(chips);

      listEl.appendChild(group);
    });
  }

  function renderProgress() {
    var total = state.target.length;
    var found = state.found.size;
    el.foundCount.textContent = found;
    el.totalCount.textContent = total;
    el.progressFill.style.width = (total ? (found / total) * 100 : 0) + '%';
    var done = total > 0 && found >= total;
    el.success.classList.toggle('show', done);
    if (done) el.success.querySelector('.success-count').textContent = total;
  }

  function render() {
    state.hand.forEach(function (t) { if (t.isBlank) t.assigned = ''; });
    renderTiles();
    renderFound();
    renderProgress();
    renderHintState();
    renderDailyOption();
    saveGame();
  }

  function renderHintState() {
    var hintable = hintableWords();
    el.btnHint.style.display = hintable.length ? '' : 'none';
    el.hintCount.textContent = state.hintCount
      ? state.hintCount + (state.hintCount === 1 ? ' hint' : ' hints')
      : '';
  }

  function renderDailyOption() {
    var isDaily = state.mode === 'daily';
    el.btnDailyGame.disabled = isDaily;
    el.btnDailyGame.title = isDaily ? 'Already playing a daily game' : '';
  }

  /* ---------------------------------------------------------------
   * Word modal
   * ------------------------------------------------------------- */
  function wordScore(word) {
    var total = 0;
    for (var i = 0; i < word.length; i++) {
      total += TILE_DIST[word.charAt(i)][1];
    }
    return total;
  }

  // Words (possibly tied) with the highest face-value score in the hand.
  function bestWords() {
    var max = 0;
    var i;
    var s;
    for (i = 0; i < state.target.length; i++) {
      s = wordScore(state.target[i]);
      if (s > max) max = s;
    }
    var best = new Set();
    for (i = 0; i < state.target.length; i++) {
      if (wordScore(state.target[i]) === max) best.add(state.target[i]);
    }
    return best;
  }

  function openWordModal(word) {
    el.wordModalWord.textContent = word;
    el.wordModalTiles.innerHTML = '';

    var total = 0;
    for (var i = 0; i < word.length; i++) {
      var letter = word.charAt(i);
      var value = TILE_DIST[letter][1];
      total += value;

      var tile = document.createElement('span');
      tile.className = 'tile';

      var l = document.createElement('span');
      l.className = 'letter';
      l.textContent = letter;

      var v = document.createElement('span');
      v.className = 'value';
      v.textContent = value;

      tile.appendChild(l);
      tile.appendChild(v);
      el.wordModalTiles.appendChild(tile);
    }

    el.wordModalScore.textContent = total + ' point' + (total === 1 ? '' : 's');
    el.wordModalLink.href = 'https://scrabble.merriam.com/finder/' + word.toLowerCase();
    el.wordModalBest.hidden = !bestWords().has(word);
    el.wordModal.hidden = false;
  }

  function closeWordModal() {
    el.wordModal.hidden = true;
  }

  /* ---------------------------------------------------------------
   * Custom hand modal
   * ------------------------------------------------------------- */
  function openCustomModal() {
    el.customInput.value = '';
    el.customError.textContent = '';
    el.customModal.hidden = false;
    el.customInput.focus();
  }

  function closeCustomModal() {
    el.customModal.hidden = true;
  }

  function startCustomHand() {
    var value = el.customInput.value.trim().toUpperCase();
    if (!/^[A-Z_]{1,7}$/.test(value)) {
      if (value.length === 0) {
        el.customError.textContent = 'Enter at least one letter.';
      } else if (value.length > 7) {
        el.customError.textContent = 'Enter at most 7 letters.';
      } else {
        el.customError.textContent = 'Use letters (A\u2013Z) or _ for a blank.';
      }
      return;
    }
    el.customError.textContent = '';
    setMenu(false);
    closeCustomModal();
    newHand(value.split(''));
  }

  /* ---------------------------------------------------------------
   * Confirmation modal
   * ------------------------------------------------------------- */
  function openConfirm(onConfirm) {
    pendingConfirm = onConfirm;
    el.confirmModal.hidden = false;
  }

  function closeConfirm() {
    pendingConfirm = null;
    el.confirmModal.hidden = true;
  }

  function confirmYes() {
    var fn = pendingConfirm;
    closeConfirm();
    if (fn) fn();
  }

  /* ---------------------------------------------------------------
   * Feedback
   * ------------------------------------------------------------- */
  function toast(msg, kind) {
    el.toast.textContent = msg;
    el.toast.className = 'toast show' + (kind === 'error' ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.className = 'toast'; }, 1800);
  }

  function shakeTray() {
    el.tray.classList.remove('shake');
    void el.tray.offsetWidth; // force reflow to restart animation
    el.tray.classList.add('shake');
  }

  /* ---------------------------------------------------------------
   * Input
   * ------------------------------------------------------------- */
  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!el.wordModal.hidden) closeWordModal();
      else if (!el.confirmModal.hidden) closeConfirm();
      else if (!el.hintModal.hidden) closeHintModal();
      else if (!el.customModal.hidden) closeCustomModal();
      else clearTray();
      return;
    }
    // Ignore gameplay shortcuts while interacting with the custom-hand modal
    // (e.g. typing letters, or Backspace/Enter inside its text input).
    if (!el.customModal.hidden && el.customModal.contains(e.target)) return;
    if (e.key === 'Backspace') { e.preventDefault(); backspace(); }
    else if (e.key === 'Enter') { e.preventDefault(); submit(); }
    else if (/^[a-zA-Z]$/.test(e.key)) {
      var letter = e.key.toUpperCase();
      var idx = state.hand.findIndex(function (t) { return t.letter === letter; });
      if (idx !== -1) moveToTray(state.hand[idx].id);
    }
  }

  /* ---------------------------------------------------------------
   * Boot
   * ------------------------------------------------------------- */
  function cacheDom() {
    el.hand = document.getElementById('hand');
    el.tray = document.getElementById('tray');
    el.trayScore = document.getElementById('tray-score');
    el.foundList = document.getElementById('found-list');
    el.btnHint = document.getElementById('btn-hint');
    el.hintCount = document.getElementById('hint-count');
    el.foundCount = document.getElementById('found-count');
    el.totalCount = document.getElementById('total-count');
    el.progressFill = document.getElementById('progress-fill');
    el.success = document.getElementById('success');
    el.toast = document.getElementById('toast');
    el.submit = document.getElementById('btn-submit');
    el.backspace = document.getElementById('btn-backspace');
    el.shuffle = document.getElementById('btn-shuffle');
    el.menuBtn = document.getElementById('btn-menu');
    el.menuPanel = document.getElementById('dojo-menu');
    el.btnNewGame = document.getElementById('btn-new-game');
    el.btnDailyGame = document.getElementById('btn-daily-game');
    el.btnNewGameLetters = document.getElementById('btn-new-game-letters');
    el.btnToggleBlanks = document.getElementById('btn-toggle-blanks');
    el.btnToggleBlanksIcon = el.btnToggleBlanks.querySelector('.toggle-icon');
    el.wordModal = document.getElementById('word-modal');
    el.wordModalWord = document.getElementById('word-modal-word');
    el.wordModalTiles = document.getElementById('word-modal-tiles');
    el.wordModalScore = document.getElementById('word-modal-score');
    el.wordModalBest = document.getElementById('word-modal-best');
    el.wordModalLink = document.getElementById('word-modal-link');
    el.wordModalClose = document.getElementById('word-modal-close');
    el.wordModalBackdrop = document.getElementById('word-modal-backdrop');
    el.hintModal = document.getElementById('hint-modal');
    el.hintModalOptions = document.getElementById('hint-options');
    el.hintModalClose = document.getElementById('hint-modal-close');
    el.hintModalBackdrop = document.getElementById('hint-modal-backdrop');
    el.customModal = document.getElementById('custom-modal');
    el.customModalClose = document.getElementById('custom-modal-close');
    el.customModalBackdrop = document.getElementById('custom-modal-backdrop');
    el.customInput = document.getElementById('custom-input');
    el.customError = document.getElementById('custom-error');
    el.customSubmit = document.getElementById('custom-submit');
    el.confirmModal = document.getElementById('confirm-modal');
    el.confirmModalBackdrop = document.getElementById('confirm-modal-backdrop');
    el.confirmCancel = document.getElementById('confirm-cancel');
    el.confirmOk = document.getElementById('confirm-ok');
    el.completedCount = document.getElementById('completed-count');
    el.completedCheck = document.getElementById('completed-check');
  }

  function bind() {
    el.submit.addEventListener('click', submit);
    el.backspace.addEventListener('click', backspace);
    el.shuffle.addEventListener('click', shuffleHand);
    el.btnHint.addEventListener('click', openHintModal);
    el.menuBtn.addEventListener('click', function () {
      setMenu(!el.menuPanel.classList.contains('open'));
    });
    el.btnNewGame.addEventListener('click', function () {
      setMenu(false);
      openConfirm(function () { newHand(); });
    });
    el.btnDailyGame.addEventListener('click', function () {
      setMenu(false);
      openConfirm(function () { newDailyHand(); });
    });
    el.btnNewGameLetters.addEventListener('click', function () {
      setMenu(false);
      openCustomModal();
    });
    el.btnToggleBlanks.addEventListener('click', toggleBlanks);
    el.wordModalClose.addEventListener('click', closeWordModal);
    el.wordModalBackdrop.addEventListener('click', closeWordModal);
    el.hintModalClose.addEventListener('click', closeHintModal);
    el.hintModalBackdrop.addEventListener('click', closeHintModal);
    el.customModalClose.addEventListener('click', closeCustomModal);
    el.customModalBackdrop.addEventListener('click', closeCustomModal);
    el.customSubmit.addEventListener('click', startCustomHand);
    el.confirmModalBackdrop.addEventListener('click', closeConfirm);
    el.confirmCancel.addEventListener('click', closeConfirm);
    el.confirmOk.addEventListener('click', confirmYes);
    el.customInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation(); // don't let document onKey also fire submit()
        startCustomHand();
      }
    });
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
  }

  function setMenu(open) {
    el.menuPanel.classList.toggle('open', open);
    el.menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function toggleBlanks() {
    state.blanksEnabled = !state.blanksEnabled;
    renderBlanksToggle();
    saveGame();
    toast(state.blanksEnabled ? 'Blanks on. New games include 2 blanks.' : 'Blanks off.');
  }

  function renderBlanksToggle() {
    el.btnToggleBlanks.setAttribute('aria-checked', state.blanksEnabled ? 'true' : 'false');
    el.btnToggleBlanks.classList.toggle('is-on', state.blanksEnabled);
    el.btnToggleBlanksIcon.className = state.blanksEnabled
      ? 'toggle-icon fas fa-square-check'
      : 'toggle-icon far fa-square';
  }

  function onDocClick(e) {
    if (!el.menuPanel.classList.contains('open')) return;
    if (!el.menuBtn.contains(e.target) && !el.menuPanel.contains(e.target)) {
      setMenu(false);
    }
  }

  function startGame() {
    var saved = loadGame();
    if (saved) restoreGame(saved);
    else newHand();
  }

  async function loadDictionary(url) {
    var res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var text = await res.text();
    state.dict = new Set(
      text.split(/\r?\n/)
        .map(function (w) { return w.trim().toUpperCase(); })
        .filter(function (w) { return w.length >= MIN_WORD_LEN; })
    );
  }

  function showDictionaryError() {
    el.foundList.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Could not load the dictionary. Please try again.';
    el.foundList.appendChild(p);
  }

  async function init() {
    cacheDom();
    bind();
    renderBlanksToggle();
    renderCompletedCount();
    try {
      await loadDictionary(dictionaryUrl);
      startGame();
    } catch (err) {
      // The cached copy may be stale or missing; retry once with a unique
      // query string to force a full reload.
      var retryUrl = dictionaryUrl + (dictionaryUrl.indexOf('?') === -1 ? '?' : '&') + '_=' + Date.now();
      try {
        await loadDictionary(retryUrl);
        startGame();
      } catch (err2) {
        showDictionaryError();
        if (window.console) console.error('Scrabble Dojo: failed to load dictionary', err2);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
