#!/usr/bin/env node
/*
 * Regenerates assets/data/dictionary.txt.
 *
 * The game dictionary is every word of length 2-7 from the NASPA Word
 * List 2023 (NWL2023), the official North American tournament lexicon.
 * NWL2023 is also the word authority behind Merriam-Webster's official
 * Scrabble Word Finder, so it matches the game's "view definition" links.
 *
 * NWL2023 is a single authoritative source, so this replaces the earlier
 * two-source build (hand-curated core + ENABLE/SOWPODS supplement). That
 * approach had two problems:
 *   - ENABLE is an old public-domain list that contains offensive words
 *     (slurs) not permitted in official play.
 *   - SOWPODS is the international (Collins) lexicon: it contains many
 *     non-North-American words and, being an older CSW15 snapshot, is
 *     missing newer NA additions such as ROID.
 *
 * assets/data/scrabble-core.txt is now superseded: it was a hand-curated
 * subset of NWL2023 (all 2- and 3-letter words plus every J/Q/X/Z word),
 * and every one of its entries is already present in NWL2023.
 *
 * Usage:
 *   node scripts/build-dictionary.js                 # downloads NWL2023 fresh
 *   node scripts/build-dictionary.js path/to/NWL2023.txt
 */
'use strict';

const fs = require('fs');
const path = require('path');

const NWL2023_URL =
  'https://raw.githubusercontent.com/scrabblewords/scrabblewords/main/words/North-American/NWL2023.txt';
const DICT = path.join(__dirname, '..', 'assets', 'data', 'dictionary.txt');

const MIN_LEN = 2; // the game only deals 7 tiles, so 2-7 letters is the window
const MAX_LEN = 7;

// Each NWL2023 line is "WORD <definition…>"; the word is the first token.
async function readNwl2023(arg) {
  let text;
  if (arg) {
    text = fs.readFileSync(arg, 'utf8');
  } else {
    const res = await fetch(NWL2023_URL);
    if (!res.ok) throw new Error('Failed to fetch NWL2023: HTTP ' + res.status);
    text = await res.text();
  }
  return text
    .replace(/^\uFEFF/, '') // strip any byte-order mark
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((word) => /^[A-Z]+$/.test(word))
    .filter((word) => word.length >= MIN_LEN && word.length <= MAX_LEN);
}

(async function main() {
  const words = [...new Set(await readNwl2023(process.argv[2]))].sort();
  fs.writeFileSync(DICT, words.join('\n') + '\n');

  console.log('source: NWL2023 (official North American Scrabble lexicon)');
  console.log('total dictionary words (' + MIN_LEN + '-' + MAX_LEN + ' letters):', words.length);
})();
