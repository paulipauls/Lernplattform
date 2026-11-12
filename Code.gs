/* =====================================================================
   LERNPLATTFORM – KERN
   Wird unverändert im Server (Google Apps Script) und im Browser benutzt:
   Dokument-Parser, Aufgabentypen, Bewertung, Zeiträume, Aktionen.
   ===================================================================== */
var LP = (function () {
  'use strict';

  /* ---------- Tabellen (Google Tabelle: ein Blatt je Tabelle) ---------- */
  var TABELLEN = {
    klassen:  { blatt: 'Klassen',          spalten: ['id', 'name', 'erstellt'], num: ['erstellt'], json: [] },
    schueler: { blatt: 'Schueler',         spalten: ['code', 'name', 'klasse', 'erstellt'], num: ['erstellt'], json: [] },
    sets:     { blatt: 'Aufgabenblaetter', spalten: ['id', 'titel', 'art', 'klassen', 'start', 'ende', 'quelle', 'erstellt', 'aufsicht'], num: ['start', 'ende', 'erstellt'], json: ['klassen', 'aufsicht'] },
    abgaben:  { blatt: 'Abgaben',          spalten: ['set', 'code', 'antworten', 'bewertung', 'status', 'aktualisiert', 'verlassen', 'wegzeit'], num: ['aktualisiert', 'verlassen', 'wegzeit'], json: ['antworten', 'bewertung'] },
    dateien:  { blatt: 'Dateien',          spalten: ['id', 'name', 'groesse', 'teile', 'erstellt', 'art'], num: ['groesse', 'teile', 'erstellt'], json: [] },
    dateiteile: { blatt: 'Dateiinhalt',    spalten: ['id', 'teil', 'inhalt'], num: ['teil'], json: [] }
  };
  var TEIL_GROESSE = 45000, MAX_DATEI = 5000000;

  var ARTEN = { erarbeitung: 'Erarbeitungsaufgabe', lernen: 'Lernaufgabe' };

  var TYPEN = [
    { id: 'mc',     name: 'Multiple Choice', re: /^(multiple[\s-]?choice|mehrfachauswahl|auswahlaufgabe|auswahl|mc)/i },
    { id: 'rf',     name: 'Richtig/Falsch',  re: /^(richtig\s*(?:\/|oder|-|und)?\s*falsch|wahr\s*(?:\/|oder|-|und)?\s*falsch|r\s*\/\s*f)/i },
    { id: 'zu',     name: 'Zuordnung',       re: /^(zuordnungsaufgabe|zuordnung|zuordnen)/i },
    { id: 'text',   name: 'Texteingabe',     re: /^(texteingabe|kurzantwort|kurze\s+antwort|eingabe)/i },
    { id: 'luecke', name: 'Lückentext',      re: /^(l(?:ü|ue|u)ckentext|l(?:ü|ue)cken)/i },
    { id: 'reihe',  name: 'Reihenfolge',     re: /^(reihenfolge|sortieren|sortierung|ordnen)/i },
    { id: 'frei',   name: 'Freitext',        re: /^(freitext|offene\s+(?:frage|aufgabe)|freie\s+antwort|langantwort)/i },
    { id: 'info',   name: 'Info/Material',   re: /^(informationstext|information|infotext|info|material|lesetext)/i }
  ];
  var TYPNAME = {};
  TYPEN.forEach(function (t) { TYPNAME[t.id] = t.name; });

  var MAX_QUELLE = 45000;

  /* ---------- kleine Helfer ---------- */
  function trimLines(arr) {
    var a = arr.slice();
    while (a.length && !a[0].trim()) a.shift();
    while (a.length && !a[a.length - 1].trim()) a.pop();
    var out = [];
    a.forEach(function (l) { if (!l.trim() && out.length && !out[out.length - 1].trim()) return; out.push(l.replace(/\s+$/, '')); });
    return out.join('\n');
  }
  function splitAlts(s) {
    return String(s).split(/\s*[;|]\s*/).map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function round2(x) { return Math.round(x * 100) / 100; }
  function norm(s, gross) {
    s = String(s == null ? '' : s);
    if (s.normalize) s = s.normalize('NFC');
    s = s.replace(/[ \s]+/g, ' ').trim()
      .replace(/[„“”"«»‚‘’']/g, '')
      .replace(/(\d),(\d)/g, '$1.$2')
      .replace(/\s*([+\-*/=:])\s*/g, '$1')
      .replace(/[.!?;,]+$/, '').trim()
      .replace(/(\d)\s+(?=[^\d\s+\-*\/=:.,;!?])/g, '$1');   // „20 N“ = „20N“, „5 cm“ = „5cm“
    return gross ? s : s.toLowerCase();
  }

  /* Großzügiger Vergleich für Texteingabe und Lückentext.
     Ergebnis: 0 = falsch, 1 = richtig, 2 = richtig mit kleinem Tippfehler,
     3 = Wert stimmt, aber der Bruch ist nicht wie verlangt gekürzt (zählt als falsch) */
  var RE_TOL = /\s*(?:±|\+\/-|\+-)\s*(\d+(?:[.,]\d+)?)\s*(%)?/;
  function ohneToleranz(x) { return String(x == null ? '' : x).replace(RE_TOL, ' ').replace(/\s+/g, ' ').trim(); }
  function ggT(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { var t = b; b = a % b; a = t; } return a; }
  // Zerlegt „x=3/4 m“, „2 3/4“, „-0.75“ in Text davor, Zahlenwert (auch Bruch / gemischte Zahl) und Text danach
  function zahlTeile(n) {
    var m = n.match(/^(.*?)(-?\d+ \d+\/\d+|-?\d+\/\d+|-?\d+(?:\.\d+)?)(.*)$/);
    if (!m || /\d/.test(m[1]) || /\d/.test(m[3])) return null;
    var tok = m[2], wert, bruch = null, mm;
    if ((mm = tok.match(/^(-?)(\d+) (\d+)\/(\d+)$/))) {
      if (+mm[4] === 0) return null;
      wert = (+mm[2] + mm[3] / mm[4]) * (mm[1] ? -1 : 1); bruch = { z: +mm[3], n: +mm[4] };
    } else if ((mm = tok.match(/^(-?\d+)\/(\d+)$/))) {
      if (+mm[2] === 0) return null;
      wert = mm[1] / mm[2]; bruch = { z: Math.abs(+mm[1]), n: +mm[2] };
    } else wert = parseFloat(tok);
    return { vor: m[1].trim(), zahl: wert, nach: m[3].trim(), bruch: bruch };
  }
  function abstand(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 3;
    var d = [], i, j;
    for (i = 0; i <= a.length; i++) { d[i] = [i]; }
    for (j = 1; j <= b.length; j++) d[0][j] = j;
    for (i = 1; i <= a.length; i++) for (j = 1; j <= b.length; j++) {
      var k = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + k);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
    return d[a.length][b.length];
  }
  function stimmt(antwort, loesung, opt) {
    opt = opt || {};
    var a = norm(antwort, opt.gross), l = norm(ohneToleranz(loesung), opt.gross);
    if (!a || !l) return 0;
    if (a === l) return 1;
    var za = zahlTeile(a), zl = zahlTeile(l);
    if (za && zl && za.vor === zl.vor && za.nach === zl.nach) {
      var tol = String(loesung).match(RE_TOL), grenze = 1e-9;
      if (tol) { var tw = parseFloat(tol[1].replace(',', '.')); grenze += tol[2] ? Math.abs(zl.zahl) * tw / 100 : tw; }
      if (Math.abs(za.zahl - zl.zahl) > grenze) return 0;
      if (opt.gekuerzt && zl.bruch && (!za.bruch || ggT(za.bruch.z, za.bruch.n) !== 1)) return 3;
      return 1;
    }
    if (opt.tippfehler && !/\d/.test(a + l) && l.length >= 5 && abstand(a, l) <= (l.length >= 10 ? 2 : 1)) return 2;
    return 0;
  }
  function besteTreffer(antwort, loesungen, opt) {
    var best = 0;
    var rang = [0, 3, 2, 1]; // 1 vor 2 vor 3 vor 0
    loesungen.forEach(function (x) { var r = stimmt(antwort, x, opt); if (rang[r] > rang[best]) best = r; });
    return best;
  }
  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    var a = hashStr(String(seed));
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, seed) {
    var a = arr.slice(), r = rng(seed);
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function uniq(arr) { var s = {}, o = []; arr.forEach(function (x) { if (!s['_' + x]) { s['_' + x] = 1; o.push(x); } }); return o; }

  /* =====================================================================
     PARSER  – aus Dokumenttext werden Aufgaben
     ===================================================================== */
  var RE_HEAD = /^\s*(?:#{1,6}\s*)?Aufgabe\b\.?\s*(?:\d+[a-z]?)?\s*[:.)\-–]?\s*(.*)$/i;
  var RE_KEY = /^\s*(lösung|loesung|lösungen|antwort|antworten|richtige antwort|musterlösung|musterloesung|erwartungshorizont|erklärung|erklaerung|begründung|begruendung|feedback|ablenker|distraktoren|distraktor|wortspeicher|wörterkasten|punkte|bild|tippfehler|bruch|brüche|simulation|html|einbetten|höhe|hoehe|groß-?\/?kleinschreibung|gross-?\/?kleinschreibung)\s*:\s*(.*)$/i;

  function erkenneKopf(line) {
    var m = line.match(RE_HEAD);
    if (!m) return null;
    var rest = m[1].replace(/^[(\[]\s*/, '');
    for (var i = 0; i < TYPEN.length; i++) {
      var tm = rest.match(TYPEN[i].re);
      if (!tm) continue;
      var after = rest.slice(tm[0].length);
      if (/^[A-Za-zÄÖÜäöüß]/.test(after)) continue;
      var punkte = null;
      var pm = after.match(/^\s*[,;|\/–-]?\s*(\d+(?:[.,]\d+)?)\s*(?:punkte|punkt|pkt\.?|p\.?)(?![a-zäöüß])/i);
      if (pm) { punkte = parseFloat(pm[1].replace(',', '.')); after = after.slice(pm[0].length); }
      after = after.replace(/^\s*[)\]]?\s*[:.\-–]?\s*/, '');
      return { typ: TYPEN[i].id, punkte: punkte, text: after };
    }
    return null;
  }

  function parse(quelle) {
    var text = String(quelle || '').replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/\t/g, '    ');
    var lines = text.split('\n');
    var res = { titel: '', art: '', aufgaben: [], warnungen: [] };
    var cur = null, vorText = 0;
    var bloecke = [];
    lines.forEach(function (line) {
      if (/^\s*seite\s+\d+(\s+von\s+\d+)?\s*$/i.test(line)) return;
      if (/^\s*\/\//.test(line)) return;
      var kopf = erkenneKopf(line);
      if (kopf) {
        cur = { typ: kopf.typ, punkte: kopf.punkte, zeilen: kopf.text ? [kopf.text] : [] };
        bloecke.push(cur);
        return;
      }
      if (/^\s*#*\s*Aufgabe\s*\d+[a-z]?\s*[:.)\-–(]?\s*\S{0,40}\s*$/i.test(line) || /^\s*#*\s*Aufgabe\s*\d*\s*\(/i.test(line)) {
        res.warnungen.push({ nr: cur ? bloecke.length : 0, text: '„' + line.trim().slice(0, 50) + '“ sieht wie eine Aufgaben-Überschrift aus, aber die Aufgabenart fehlt, z. B. „Aufgabe 3 (Lückentext)“.' });
      }
      if (!cur) {
        var tm = line.match(/^\s*titel\s*:\s*(.+)$/i);
        var am = line.match(/^\s*art\s*:\s*(.+)$/i);
        if (tm) res.titel = tm[1].trim();
        else if (am) res.art = /erarb/i.test(am[1]) ? 'erarbeitung' : (/lern|üb|ueb/i.test(am[1]) ? 'lernen' : '');
        else if (/^\s*tippfehler\s*:/i.test(line)) res.tippfehler = !/:\s*(nein|aus|false|0|nicht)/i.test(line);
        else if (/^\s*br(u|ü|ue)che?\s*:/i.test(line)) res.gekuerzt = /gek(ü|ue)rzt|k(ü|ue)rzen|ja/i.test(line);
        else if (line.trim()) vorText++;
        return;
      }
      cur.zeilen.push(line);
    });
    if (vorText > 2) res.warnungen.push({ nr: 0, text: 'Text vor der ersten Aufgaben-Überschrift wird nicht angezeigt (' + vorText + ' Zeile' + (vorText > 1 ? 'n' : '') + ').' });
    bloecke.forEach(function (b, i) {
      b.tippfehler = !!res.tippfehler; b.gekuerzt = !!res.gekuerzt;
      var t = baueAufgabe(b, i + 1, res.warnungen);
      res.aufgaben.push(t);
    });
    return res;
  }

  function baueAufgabe(b, nr, warn) {
    var t = { id: 't' + nr, nr: nr, typ: b.typ, frage: '', punkte: b.punkte, erklaerung: '', bilder: [] };
    var frage = [], loesung = [], erkl = [], modus = 'frage';
    var ablenker = [], wortspeicher = false, gross = false, tippfehler = !!b.tippfehler, gekuerzt = !!b.gekuerzt;
    var items = [];
    function w(text) { warn.push({ nr: nr, text: text }); }

    b.zeilen.forEach(function (line) {
      var km = line.match(RE_KEY);
      if (km) {
        var k = km[1].toLowerCase(), v = km[2].trim();
        if (/^(lösung|loesung|lösungen|antwort|antworten|richtige antwort|musterlösung|musterloesung|erwartungshorizont)$/.test(k)) { modus = 'loesung'; if (v) loesung.push(v); return; }
        if (/^(erklärung|erklaerung|begründung|begruendung|feedback)$/.test(k)) { modus = 'erkl'; if (v) erkl.push(v); return; }
        if (/^(ablenker|distraktor|distraktoren)$/.test(k)) { ablenker = ablenker.concat(splitAlts(v)); return; }
        if (/^(wortspeicher|wörterkasten)$/.test(k)) { wortspeicher = !/^(nein|aus|false|0)$/i.test(v); return; }
        if (k === 'punkte') { var p = parseFloat(v.replace(',', '.')); if (!isNaN(p)) t.punkte = p; return; }
        if (k === 'bild') {
          var bm = v.match(/datei:\s*([\w-]+)(?:\s*\(([^)]*)\))?/i);
          if (bm) t.bilder.push({ datei: bm[1], name: (bm[2] || '').trim() });
          else if (/^(https?:\/\/\S+|[\w.\/-]+\.(png|jpe?g|gif|webp|svg|bmp))$/i.test(v)) t.bilder.push({ url: v });
          else w('„Bild:“ braucht eine Internetadresse (https://…) oder ein hochgeladenes Bild (datei:…).');
          return;
        }
        if (k === 'simulation' || k === 'html' || k === 'einbetten') {
          var dm = v.match(/datei:\s*([\w-]+)(?:\s*\(([^)]*)\))?/i);
          if (dm) t.sim = { datei: dm[1], name: (dm[2] || '').trim(), hoehe: (t.sim && t.sim.hoehe) || 0 };
          else if (/^(https?:\/\/|[\w.\/-]+\.html?(?:[?#]\S*)?$)/i.test(v)) t.sim = { url: v.split(/\s+/)[0], hoehe: (t.sim && t.sim.hoehe) || 0 };
          else w('„Simulation:“ braucht eine Internetadresse (https://…) oder eine hochgeladene Datei (datei:…).');
          return;
        }
        if (k === 'höhe' || k === 'hoehe') { var hh = parseInt(v, 10); if (hh >= 150 && hh <= 2000) { t.sim = t.sim || {}; t.sim.hoehe = hh; } return; }
        if (k === 'tippfehler') { tippfehler = !/^(nein|aus|false|0|nicht)/i.test(v); return; }
        if (k === 'bruch' || k === 'brüche') { gekuerzt = /gek(ü|ue)rzt|k(ü|ue)rzen|ja/i.test(v); return; }
        gross = /beacht|ja|an/i.test(v); return;
      }
      if (modus === 'loesung') { if (line.trim()) loesung.push(line.trim()); else if (loesung.length) loesung.push(''); return; }
      if (modus === 'erkl') { erkl.push(line); return; }

      var it = erkenneItem(b.typ, line);
      if (it) { items.push(it); return; }
      if (items.length && b.typ !== 'luecke' && !line.trim()) return;
      if (b.typ === 'luecke') { items.push({ roh: line }); return; }
      if (items.length && b.typ !== 'info' && b.typ !== 'frei' && line.trim()) { frage.push(line); return; }
      frage.push(line);
    });

    t.frage = trimLines(frage);
    t.erklaerung = trimLines(erkl);
    var loesungText = trimLines(loesung);

    if (b.typ === 'mc') {
      var opts = items.map(function (it) { return { text: it.text, richtig: !!it.richtig, label: it.label }; });
      if (loesungText) {
        var toks = loesungText.toLowerCase().replace(/[().]/g, ' ').split(/(?:\s+und\s+|[\s,;|]+)/).filter(Boolean);
        opts.forEach(function (o, i) {
          var buch = String.fromCharCode(97 + i), zahl = String(i + 1);
          var lab = (o.label || '').toLowerCase();
          if (toks.indexOf(lab) >= 0 || (!lab && (toks.indexOf(buch) >= 0 || toks.indexOf(zahl) >= 0)) || norm(o.text) === norm(loesungText)) o.richtig = true;
        });
      }
      t.optionen = opts.map(function (o) { return { text: o.text, richtig: o.richtig }; });
      if (t.optionen.length < 2) w('Multiple Choice braucht mindestens zwei Antwortmöglichkeiten, z. B. „[x] richtig“ und „[ ] falsch“.');
      else if (!t.optionen.some(function (o) { return o.richtig; })) w('Keine richtige Antwort markiert. Markiere sie mit [x] oder schreibe „Lösung: b“.');
      if (t.punkte == null) t.punkte = 1;
    } else if (b.typ === 'rf') {
      t.aussagen = items.map(function (it) { return { text: it.text, wahr: it.wahr }; });
      if (!t.frage) t.frage = 'Richtig oder falsch?';
      if (!t.aussagen.length) w('Keine Aussagen gefunden. Schreibe z. B. „(r) Wale sind Säugetiere.“ oder „(f) Wale sind Fische.“');
      if (t.punkte == null) t.punkte = Math.max(1, t.aussagen.length);
    } else if (b.typ === 'zu') {
      t.paare = items.map(function (it) { return { l: it.l, r: it.r }; });
      t.ablenker = ablenker;
      if (!t.frage) t.frage = 'Ordne richtig zu.';
      if (t.paare.length < 2) w('Zuordnung braucht mindestens zwei Paare, z. B. „Hund = bellt“.');
      if (t.punkte == null) t.punkte = Math.max(1, t.paare.length);
    } else if (b.typ === 'text') {
      t.antworten = splitAlts(loesung.join(';'));
      t.gross = gross; t.tippfehler = tippfehler; t.gekuerzt = gekuerzt;
      if (!t.antworten.length) w('Keine Lösung angegeben. Schreibe z. B. „Lösung: Berlin“. Ohne Lösung bewertest du die Antwort selbst.');
      if (t.punkte == null) t.punkte = 1;
    } else if (b.typ === 'luecke') {
      var rows = items.map(function (it) { return it.roh; });
      var first = -1;
      for (var i = 0; i < rows.length; i++) { if (/\[[^\]\n]+\]|\{[^}\n]+\}/.test(rows[i])) { first = i; break; } }
      var intro = [], body = rows;
      if (first > 0) { intro = rows.slice(0, first); body = rows.slice(first); }
      if (intro.length) t.frage = trimLines(frage.concat(intro));
      if (!t.frage) t.frage = 'Fülle die Lücken aus.';
      var src = trimLines(body), teile = [], luecken = [], last = 0, m;
      var re = /\[([^\]\n]+)\]|\{([^}\n]+)\}/g;
      while ((m = re.exec(src))) {
        if (m.index > last) teile.push(src.slice(last, m.index));
        teile.push({ l: luecken.length });
        luecken.push(splitAlts(m[1] || m[2]));
        last = re.lastIndex;
      }
      if (last < src.length) teile.push(src.slice(last));
      t.teile = teile; t.luecken = luecken; t.wortspeicher = wortspeicher; t.gross = gross; t.tippfehler = tippfehler; t.gekuerzt = gekuerzt;
      t.ablenker = ablenker;
      if (!luecken.length) w('Keine Lücken gefunden. Setze das Lösungswort in eckige Klammern: „Die Hauptstadt ist [Berlin].“');
      if (t.punkte == null) t.punkte = Math.max(1, luecken.length);
    } else if (b.typ === 'reihe') {
      var sorted = items.slice().sort(function (a, c) { return a.n - c.n; });
      t.elemente = sorted.map(function (it) { return it.text; });
      if (!t.frage) t.frage = 'Bringe in die richtige Reihenfolge.';
      if (t.elemente.length < 2) w('Reihenfolge braucht mindestens zwei nummerierte Schritte: „1. …“, „2. …“.');
      if (t.punkte == null) t.punkte = Math.max(1, t.elemente.length);
    } else if (b.typ === 'frei') {
      t.muster = loesungText;
      if (t.punkte == null) t.punkte = 1;
    } else if (b.typ === 'info') {
      t.punkte = 0;
    }
    if (b.typ !== 'info' && !t.frage) w('Die Aufgabe hat keinen Aufgabentext.');
    if (b.typ !== 'info' && !(t.punkte > 0)) t.punkte = 1;
    return t;
  }

  function erkenneItem(typ, line) {
    var m;
    if (typ === 'mc') {
      if ((m = line.match(/^\s*[\[(]\s*([xX✓✔✗*+]?)\s*[\])]\s*(.+)$/))) return { text: stripRichtig(m[2]).text, richtig: !!m[1] || stripRichtig(m[2]).r };
      if ((m = line.match(/^\s*([☐☑☒□■▢◻◼✅❑❒])\s*(.+)$/))) return { text: stripRichtig(m[2]).text, richtig: /[☑☒■◼✅❒]/.test(m[1]) || stripRichtig(m[2]).r };
      if ((m = line.match(/^\s*([a-hA-H]|\d{1,2})\s*[).]\s+(.+)$/))) { var s = stripRichtig(m[2]); return { text: s.text, richtig: s.r, label: m[1].toLowerCase() }; }
      if ((m = line.match(/^\s*([*+])\s+(.+)$/))) return { text: stripRichtig(m[2]).text, richtig: true };
      if ((m = line.match(/^\s*([-•–])\s+(.+)$/))) { var s2 = stripRichtig(m[2]); return { text: s2.text, richtig: s2.r }; }
      return null;
    }
    if (typ === 'rf') {
      var W = /^(r|w|richtig|wahr|true|ja|stimmt)$/i;
      if ((m = line.match(/^\s*[\[(]\s*(r|f|w|richtig|falsch|wahr|true|false|ja|nein)\s*[\])]\s*(.+)$/i))) return { text: m[2].trim(), wahr: W.test(m[1]) };
      if ((m = line.match(/^\s*(?:[-•*]\s*)?(.+?)\s*[\[(]\s*(r|f|w|richtig|falsch|wahr)\s*[\])]\s*$/i))) return { text: m[1].trim(), wahr: W.test(m[2]) };
      return null;
    }
    if (typ === 'zu') {
      if ((m = line.match(/^\s*(?:[-•*]\s+)?(.+?)\s*(?:=>|->|→|⟶|⇒|=|\|)\s*(.+?)\s*$/))) return { l: m[1].trim(), r: m[2].trim() };
      if ((m = line.match(/^\s*(?:[-•*]\s+)?(\S.*?)\s{3,}(\S.*?)\s*$/))) return { l: m[1].trim(), r: m[2].trim() };
      return null;
    }
    if (typ === 'reihe') {
      if ((m = line.match(/^\s*(\d{1,3})\s*[.)]\s+(.+)$/))) return { n: parseInt(m[1], 10), text: m[2].trim() };
      return null;
    }
    return null;
  }
  function stripRichtig(s) {
    var m = s.match(/^(.*?)\s*(?:\((?:richtig|r|x|✓)\)|\*)\s*$/i);
    return m ? { text: m[1].trim(), r: true } : { text: s.trim(), r: false };
  }

  /* =====================================================================
     SCHÜLERANSICHT EINER AUFGABE – ohne Lösungen
     ===================================================================== */
  function schuelerAufgabe(t, seed) {
    var o = { id: t.id, nr: t.nr, typ: t.typ, frage: t.frage, punkte: t.punkte, bilder: t.bilder || [], sim: t.sim || null };
    var s = seed + '|' + t.id;
    if (t.typ === 'mc') { o.optionen = t.optionen.map(function (x) { return x.text; }); o.mehrere = t.optionen.filter(function (x) { return x.richtig; }).length > 1; }
    else if (t.typ === 'rf') o.aussagen = t.aussagen.map(function (x) { return x.text; });
    else if (t.typ === 'zu') { o.links = t.paare.map(function (p) { return p.l; }); o.rechts = shuffle(uniq(t.paare.map(function (p) { return p.r; }).concat(t.ablenker || [])), s); }
    else if (t.typ === 'luecke') {
      o.teile = t.teile; o.anzahl = t.luecken.length;
      if (t.wortspeicher) o.wortspeicher = shuffle(uniq(t.luecken.map(function (a) { return ohneToleranz(a[0]); }).concat(t.ablenker || [])), s);
    }
    else if (t.typ === 'reihe') {
      var sh = shuffle(t.elemente, s);
      if (sh.length > 1 && sh.join('\n') === t.elemente.join('\n')) sh.push(sh.shift());
      o.elemente = sh;
    }
    return o;
  }

  /* =====================================================================
     BEWERTUNG
     ===================================================================== */
  function leer(v) { return v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.some(function (x) { return x != null && String(x).trim() !== ''; })); }

  function bewerteAufgabe(t, antwort, manuell) {
    var max = t.typ === 'info' ? 0 : (t.punkte || 0);
    var r = { id: t.id, max: max, punkte: 0, anteil: 0, beantwortet: false, offen: false, richtig: null, manuell: false };
    if (t.typ === 'info') { r.max = 0; return r; }
    var a = antwort;
    var frac = 0;
    if (t.typ === 'mc') {
      var sel = Array.isArray(a) ? a.map(Number) : [];
      r.beantwortet = sel.length > 0; r.anteil = r.beantwortet ? 1 : 0;
      var korrekt = []; t.optionen.forEach(function (o, i) { if (o.richtig) korrekt.push(i); });
      if (korrekt.length <= 1) frac = sel.length === 1 && korrekt.indexOf(sel[0]) >= 0 ? 1 : 0;
      else {
        var hits = sel.filter(function (i) { return korrekt.indexOf(i) >= 0; }).length;
        var falsch = sel.length - hits;
        frac = Math.max(0, (hits - falsch) / korrekt.length);
      }
      r.richtig = t.optionen.map(function (o, i) { return o.richtig === (sel.indexOf(i) >= 0); });
    } else if (t.typ === 'rf') {
      var arr = Array.isArray(a) ? a : [];
      var n = t.aussagen.length || 1, ok = 0, done = 0;
      r.richtig = t.aussagen.map(function (x, i) {
        var v = arr[i]; if (v === 'r' || v === 'f') done++;
        var good = (v === 'r' && x.wahr) || (v === 'f' && !x.wahr); if (good) ok++; return good;
      });
      frac = ok / n; r.anteil = done / n; r.beantwortet = done > 0;
    } else if (t.typ === 'zu') {
      var map = a && typeof a === 'object' ? a : {};
      var n2 = t.paare.length || 1, ok2 = 0, done2 = 0;
      r.richtig = t.paare.map(function (p, i) {
        var v = map[i]; if (v != null && v !== '') done2++;
        var good = v != null && norm(v, true) === norm(p.r, true); if (good) ok2++; return good;
      });
      frac = ok2 / n2; r.anteil = done2 / n2; r.beantwortet = done2 > 0;
    } else if (t.typ === 'text') {
      r.beantwortet = !leer(a); r.anteil = r.beantwortet ? 1 : 0;
      if (!t.antworten.length) { r.offen = r.beantwortet; frac = 0; }
      else { var bt = besteTreffer(a, t.antworten, t); frac = bt === 1 || bt === 2 ? 1 : 0; r.richtig = frac === 1; r.tipp = bt === 2; r.ungekuerzt = bt === 3; }
    } else if (t.typ === 'luecke') {
      var arr3 = Array.isArray(a) ? a : [];
      var n3 = t.luecken.length || 1, ok3 = 0, done3 = 0;
      r.tipp = []; r.ungekuerzt = [];
      r.richtig = t.luecken.map(function (alts, i) {
        var v = arr3[i]; if (!leer(v)) done3++;
        var bt = leer(v) ? 0 : besteTreffer(v, alts, t); r.tipp[i] = bt === 2; r.ungekuerzt[i] = bt === 3;
        var good = bt === 1 || bt === 2; if (good) ok3++; return good;
      });
      frac = ok3 / n3; r.anteil = done3 / n3; r.beantwortet = done3 > 0;
    } else if (t.typ === 'reihe') {
      var arr4 = Array.isArray(a) ? a : [];
      r.beantwortet = arr4.length > 0; r.anteil = r.beantwortet ? 1 : 0;
      var n4 = t.elemente.length || 1, ok4 = 0;
      r.richtig = t.elemente.map(function (x, i) { var good = arr4[i] === x; if (good) ok4++; return good; });
      frac = r.beantwortet ? ok4 / n4 : 0;
    } else if (t.typ === 'frei') {
      r.beantwortet = !leer(a); r.anteil = r.beantwortet ? 1 : 0;
      r.offen = r.beantwortet;
      frac = 0;
    }
    r.punkte = round2(frac * max);
    if (manuell != null && manuell !== '' && !isNaN(Number(manuell))) {
      r.punkte = round2(Math.max(0, Math.min(max, Number(manuell))));
      r.offen = false; r.manuell = true;
    }
    return r;
  }

  // Auswertung eines Aufgabenblatts für eine Abgabe (abgabe darf fehlen)
  function bewerteSet(aufgaben, abgabe) {
    var antworten = (abgabe && abgabe.antworten) || {};
    var bew = (abgabe && abgabe.bewertung) || {};
    var res = { punkte: 0, max: 0, prozent: null, bearbeitet: 0, offen: 0, anzahl: 0, beantwortet: 0, aufgaben: [], status: abgabe ? (abgabe.status || 'offen') : 'nicht begonnen' };
    var summeAnteil = 0;
    aufgaben.forEach(function (t) {
      var r = bewerteAufgabe(t, antworten[t.id], bew[t.id]);
      res.aufgaben.push(r);
      if (t.typ === 'info') return;
      res.anzahl++;
      summeAnteil += r.anteil;
      if (r.beantwortet) res.beantwortet++;
      if (r.offen) { res.offen++; return; }
      res.punkte += r.punkte; res.max += r.max;
    });
    res.punkte = round2(res.punkte); res.max = round2(res.max);
    res.prozent = res.max > 0 ? Math.round(res.punkte / res.max * 1000) / 10 : null;
    res.bearbeitet = res.anzahl ? Math.round(summeAnteil / res.anzahl * 100) : 0;
    if (!abgabe) res.status = 'nicht begonnen';
    return res;
  }

  function summiere(liste) {
    var p = 0, m = 0;
    liste.forEach(function (e) { if (e) { p += e.punkte; m += e.max; } });
    return { punkte: round2(p), max: round2(m), prozent: m > 0 ? Math.round(p / m * 1000) / 10 : null };
  }

  function phase(set, jetzt) { return jetzt < set.start ? 'geplant' : (jetzt < set.ende ? 'laeuft' : 'beendet'); }

  /* =====================================================================
     AKTIONEN (API).  S = Speicher-Adapter:
       all(t) insert(t,o) update(t,pred,patch) remove(t,pred)
       getSetting(k) setSetting(k,v) hash(s) now() lock(fn)
     ===================================================================== */
  var CODE_ZEICHEN = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function normCode(c) {
    var s = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0');
    return s.length === 6 ? s.slice(0, 3) + '-' + s.slice(3) : s;
  }
  function neuerCode(vorhanden) {
    for (var v = 0; v < 1000; v++) {
      var s = '';
      for (var i = 0; i < 6; i++) s += CODE_ZEICHEN.charAt(Math.floor(Math.random() * CODE_ZEICHEN.length));
      s = s.slice(0, 3) + '-' + s.slice(3);
      if (!vorhanden[s]) { vorhanden[s] = 1; return s; }
    }
    throw new Error('Kein freier Code gefunden.');
  }
  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function fehler(msg) { var e = new Error(msg); e.lp = true; return e; }
  function txt(s, max) { return String(s == null ? '' : s).trim().slice(0, max || 200); }

  function findeSchueler(S, code) {
    var c = normCode(code);
    var s = S.all('schueler').filter(function (x) { return x.code === c; })[0];
    if (!s) throw fehler('Diesen Code gibt es nicht. Prüfe die Schreibweise, z. B. „K7M-4PX“.');
    return s;
  }
  function pruefeLehrer(S, pw) {
    var h = S.getSetting('pwHash');
    if (!h) throw fehler('Es ist noch kein Passwort festgelegt.');
    if (!pw || S.hash(String(pw)) !== h) throw fehler('Die Anmeldung ist abgelaufen oder das Passwort ist falsch.');
  }
  function lehrerDaten(S) {
    return { klassen: S.all('klassen'), schueler: S.all('schueler'), sets: S.all('sets'), abgaben: S.all('abgaben'), dateien: S.all('dateien'), jetzt: S.now(), ki: !!S.ki };
  }
  function setKurz(set) { return { id: set.id, titel: set.titel, art: set.art, start: set.start, ende: set.ende, aufsicht: !!set.aufsicht }; }

  var H = {};

  H.status = function (S) { return { hatPasswort: !!S.getSetting('pwHash'), demo: !!S.demo, ki: !!S.ki, jetzt: S.now() }; };

  H.schuelerDaten = function (S, a) {
    var s = findeSchueler(S, a.code);
    var jetzt = S.now();
    var klasse = S.all('klassen').filter(function (k) { return k.id === s.klasse; })[0];
    var abg = {};
    S.all('abgaben').forEach(function (x) { if (x.code === s.code) abg[x.set] = x; });
    var aktiv = [], bald = [], ergebnisse = [];
    S.all('sets').forEach(function (set) {
      var zugewiesen = (set.klassen || []).indexOf(s.klasse) >= 0;
      var ab = abg[set.id];
      if (!zugewiesen && !ab) return;
      var ph = phase(set, jetzt);
      if (ph === 'beendet') {
        var aufg = parse(set.quelle).aufgaben;
        var e = setKurz(set);
        e.aufgaben = aufg; e.antworten = ab ? ab.antworten || {} : {}; e.auswertung = bewerteSet(aufg, ab);
        ergebnisse.push(e);
      } else if (!zugewiesen) {
        return;
      } else if (ph === 'laeuft') {
        var e2 = setKurz(set);
        e2.aufgaben = parse(set.quelle).aufgaben.map(function (t) { return schuelerAufgabe(t, s.code + '|' + set.id); });
        e2.antworten = ab ? ab.antworten || {} : {};
        e2.status = ab ? ab.status : 'offen';
        aktiv.push(e2);
      } else {
        bald.push(setKurz(set));
      }
    });
    aktiv.sort(function (x, y) { return x.ende - y.ende; });
    bald.sort(function (x, y) { return x.start - y.start; });
    ergebnisse.sort(function (x, y) { return y.ende - x.ende; });
    return {
      schueler: { code: s.code, name: s.name, klasse: klasse ? klasse.name : '' },
      jetzt: jetzt, aktiv: aktiv, bald: bald, ergebnisse: ergebnisse,
      gesamt: summiere(ergebnisse.map(function (e) { return e.auswertung; }))
    };
  };

  H.antwortenSpeichern = function (S, a) {
    var s = findeSchueler(S, a.code);
    var set = S.all('sets').filter(function (x) { return x.id === a.setId; })[0];
    if (!set || (set.klassen || []).indexOf(s.klasse) < 0) throw fehler('Dieses Aufgabenblatt ist für dich nicht freigegeben.');
    var jetzt = S.now();
    if (jetzt < set.start) throw fehler('Dieses Aufgabenblatt ist noch nicht freigeschaltet.');
    if (jetzt >= set.ende) throw fehler('Der Bearbeitungszeitraum ist vorbei. Änderungen werden nicht mehr gespeichert.');
    var antworten = a.antworten && typeof a.antworten === 'object' ? a.antworten : {};
    // Verlassen der Seite: Zuwachs seit dem letzten Speichern (nur wenn für das Blatt eingeschaltet)
    var plusAnzahl = 0, plusZeit = 0;
    if (set.aufsicht) {
      plusAnzahl = Math.max(0, Math.min(100, Math.round(Number(a.verlassen) || 0)));
      plusZeit = Math.max(0, Math.min(set.ende - set.start, Math.round(Number(a.wegzeit) || 0)));
    }
    if (JSON.stringify(antworten).length > 40000) throw fehler('Deine Antworten sind zu lang. Kürze bitte die Freitexte.');
    return S.lock(function () {
      var vorh = S.all('abgaben').filter(function (x) { return x.set === set.id && x.code === s.code; })[0];
      var status = a.abgeben ? 'abgegeben' : (vorh ? vorh.status || 'offen' : 'offen');
      if (vorh) S.update('abgaben', function (x) { return x.set === set.id && x.code === s.code; }, { antworten: antworten, status: status, aktualisiert: jetzt, verlassen: (vorh.verlassen || 0) + plusAnzahl, wegzeit: (vorh.wegzeit || 0) + plusZeit });
      else S.insert('abgaben', { set: set.id, code: s.code, antworten: antworten, bewertung: {}, status: status, aktualisiert: jetzt, verlassen: plusAnzahl, wegzeit: plusZeit });
      return { ok: true, status: status, gespeichert: jetzt };
    });
  };

  H.lehrerLogin = function (S, a) {
    var h = S.getSetting('pwHash');
    if (!h) {
      if (!a.pw || String(a.pw).length < 6) throw fehler('Das neue Passwort muss mindestens 6 Zeichen lang sein.');
      S.setSetting('pwHash', S.hash(String(a.pw)));
      return { ok: true, neu: true };
    }
    if (S.hash(String(a.pw || '')) !== h) throw fehler('Das Passwort ist falsch.');
    return { ok: true };
  };

  H.lehrerDaten = function (S) { return lehrerDaten(S); };

  H.klasseSpeichern = function (S, a) {
    var name = txt(a.name, 60);
    if (!name) throw fehler('Gib einen Namen für die Klasse ein, z. B. „7a“.');
    S.lock(function () {
      var dup = S.all('klassen').filter(function (k) { return k.name.toLowerCase() === name.toLowerCase() && k.id !== a.id; })[0];
      if (dup) throw fehler('Eine Klasse „' + name + '“ gibt es schon.');
      if (a.id) S.update('klassen', function (k) { return k.id === a.id; }, { name: name });
      else S.insert('klassen', { id: uid('k'), name: name, erstellt: S.now() });
    });
    return lehrerDaten(S);
  };

  H.klasseLoeschen = function (S, a) {
    S.lock(function () {
      var codes = {};
      S.all('schueler').forEach(function (s) { if (s.klasse === a.id) codes[s.code] = 1; });
      S.remove('abgaben', function (x) { return codes[x.code]; });
      S.remove('schueler', function (s) { return s.klasse === a.id; });
      S.remove('klassen', function (k) { return k.id === a.id; });
      S.all('sets').forEach(function (set) {
        if ((set.klassen || []).indexOf(a.id) >= 0) S.update('sets', function (x) { return x.id === set.id; }, { klassen: set.klassen.filter(function (k) { return k !== a.id; }) });
      });
    });
    return lehrerDaten(S);
  };

  H.schuelerAnlegen = function (S, a) {
    var namen = (a.namen || []).map(function (n) { return txt(n, 80); }).filter(Boolean);
    if (!namen.length) throw fehler('Gib mindestens einen Namen ein (ein Name pro Zeile).');
    if (namen.length > 200) throw fehler('Bitte höchstens 200 Namen auf einmal.');
    S.lock(function () {
      if (!S.all('klassen').some(function (k) { return k.id === a.klasse; })) throw fehler('Die Klasse gibt es nicht mehr.');
      var vorhanden = {};
      S.all('schueler').forEach(function (s) { vorhanden[s.code] = 1; });
      namen.forEach(function (n) { S.insert('schueler', { code: neuerCode(vorhanden), name: n, klasse: a.klasse, erstellt: S.now() }); });
    });
    return lehrerDaten(S);
  };

  H.schuelerAendern = function (S, a) {
    var patch = {};
    if (a.name != null) { patch.name = txt(a.name, 80); if (!patch.name) throw fehler('Der Name darf nicht leer sein.'); }
    if (a.klasse != null) patch.klasse = a.klasse;
    S.lock(function () { S.update('schueler', function (s) { return s.code === a.code; }, patch); });
    return lehrerDaten(S);
  };

  H.schuelerLoeschen = function (S, a) {
    S.lock(function () {
      S.remove('abgaben', function (x) { return x.code === a.code; });
      S.remove('schueler', function (s) { return s.code === a.code; });
    });
    return lehrerDaten(S);
  };

  H.setSpeichern = function (S, a) {
    var x = a.set || {};
    var titel = txt(x.titel, 120);
    if (!titel) throw fehler('Gib dem Aufgabenblatt einen Titel.');
    if (!ARTEN[x.art]) throw fehler('Wähle aus, ob es Erarbeitungs- oder Lernaufgaben sind.');
    var klassen = (x.klassen || []).filter(Boolean);
    if (!klassen.length) throw fehler('Wähle mindestens eine Klasse aus.');
    var start = Number(x.start), ende = Number(x.ende);
    if (!start || !ende || isNaN(start) || isNaN(ende)) throw fehler('Gib Beginn und Ende des Bearbeitungszeitraums an.');
    if (ende <= start) throw fehler('Das Ende des Zeitraums muss nach dem Beginn liegen.');
    var quelle = String(x.quelle || '');
    if (quelle.length > MAX_QUELLE) throw fehler('Das Aufgabenblatt ist zu lang (' + quelle.length + ' von höchstens ' + MAX_QUELLE + ' Zeichen). Teile es auf zwei Blätter auf.');
    if (!parse(quelle).aufgaben.length) throw fehler('Es wurden keine Aufgaben erkannt. Jede Aufgabe beginnt mit einer Zeile wie „Aufgabe 1 (Multiple Choice)“.');
    var obj = { titel: titel, art: x.art, klassen: klassen, start: start, ende: ende, quelle: quelle, aufsicht: !!x.aufsicht };
    S.lock(function () {
      if (x.id && S.all('sets').some(function (s) { return s.id === x.id; })) S.update('sets', function (s) { return s.id === x.id; }, obj);
      else { obj.id = uid('a'); obj.erstellt = S.now(); S.insert('sets', obj); }
    });
    return lehrerDaten(S);
  };

  H.setLoeschen = function (S, a) {
    S.lock(function () {
      S.remove('abgaben', function (x) { return x.set === a.id; });
      S.remove('sets', function (s) { return s.id === a.id; });
    });
    return lehrerDaten(S);
  };

  H.bewerten = function (S, a) {
    S.lock(function () {
      var pred = function (x) { return x.set === a.setId && x.code === a.code; };
      var vorh = S.all('abgaben').filter(pred)[0];
      var bew = vorh ? JSON.parse(JSON.stringify(vorh.bewertung || {})) : {};
      if (a.punkte === null || a.punkte === '' || a.punkte === undefined) delete bew[a.taskId];
      else bew[a.taskId] = Number(a.punkte);
      if (vorh) S.update('abgaben', pred, { bewertung: bew });
      else S.insert('abgaben', { set: a.setId, code: a.code, antworten: {}, bewertung: bew, status: 'nicht abgegeben', aktualisiert: S.now(), verlassen: 0, wegzeit: 0 });
    });
    return lehrerDaten(S);
  };

  /* ---------- HTML-Dateien (Simulationen) ---------- */
  // Inhalt wird in Teilen gespeichert (eine Tabellenzelle fasst max. 50.000 Zeichen).
  // Jeder Teil beginnt mit „|“, damit die Tabelle nichts als Formel deutet.
  function dateiTeile(id, inhalt) {
    var teile = [];
    for (var i = 0; i * TEIL_GROESSE < inhalt.length || i === 0; i++) teile.push({ id: id, teil: i, inhalt: '|' + inhalt.slice(i * TEIL_GROESSE, (i + 1) * TEIL_GROESSE) });
    return teile;
  }
  function zeilenMit(S, t, spalte, wert) {
    return S.rowsWhere ? S.rowsWhere(t, spalte, wert) : S.all(t).filter(function (x) { return x[spalte] === wert; });
  }
  H.dateiHochladen = function (S, a) {
    var name = txt(a.name, 120).replace(/[^\w.\- äöüÄÖÜß()]/g, '_') || 'datei.html';
    var inhalt = String(a.inhalt || '');
    if (!inhalt.trim()) throw fehler('Die Datei ist leer.');
    if (inhalt.length > MAX_DATEI) throw fehler('Die Datei ist zu groß (' + Math.round(inhalt.length / 1e6 * 10) / 10 + ' MB, höchstens 5 MB). Verkleinere eingebettete Bilder oder lege die Datei auf GitHub ab.');
    var art = /^data:image\/(png|jpe?g|gif|webp|svg\+xml|bmp);base64,[A-Za-z0-9+\/=]+$/.test(inhalt) ? 'bild' : 'html';
    if (art === 'html' && !/<(html|body|script|div|canvas|svg|p|h1|style)\b/i.test(inhalt)) throw fehler('Das sieht weder nach einer HTML-Datei noch nach einem Bild aus.');
    var id = uid('d');
    var teile = dateiTeile(id, inhalt);
    S.lock(function () {
      if (S.insertMany) S.insertMany('dateiteile', teile); else teile.forEach(function (x) { S.insert('dateiteile', x); });
      S.insert('dateien', { id: id, name: name, groesse: inhalt.length, teile: teile.length, erstellt: S.now(), art: art });
    });
    var d = lehrerDaten(S); d.neu = { id: id, name: name, art: art };
    return d;
  };
  H.dateiLoeschen = function (S, a) {
    S.lock(function () {
      if (S.removeWhere) S.removeWhere('dateiteile', 'id', a.id); else S.remove('dateiteile', function (x) { return x.id === a.id; });
      S.remove('dateien', function (x) { return x.id === a.id; });
    });
    return lehrerDaten(S);
  };
  // Öffentlich lesbar über die (nicht erratbare) Kennung – Lernende brauchen die Datei in ihren Aufgaben.
  H.datei = function (S, a) {
    var id = String(a.id || '');
    var meta = zeilenMit(S, 'dateien', 'id', id)[0];
    if (!meta) throw fehler('Die Simulation wurde nicht gefunden. Vielleicht wurde sie gelöscht.');
    var teile = zeilenMit(S, 'dateiteile', 'id', id).sort(function (x, y) { return x.teil - y.teil; });
    return { name: meta.name, inhalt: teile.map(function (x) { return String(x.inhalt || '').slice(1); }).join('') };
  };

  H.passwortAendern = function (S, a) {
    if (!a.neu || String(a.neu).length < 6) throw fehler('Das neue Passwort muss mindestens 6 Zeichen lang sein.');
    S.setSetting('pwHash', S.hash(String(a.neu)));
    return { ok: true };
  };

  var LEHRER = { lehrerDaten: 1, klasseSpeichern: 1, klasseLoeschen: 1, schuelerAnlegen: 1, schuelerAendern: 1, schuelerLoeschen: 1, setSpeichern: 1, setLoeschen: 1, bewerten: 1, passwortAendern: 1, kiUmwandeln: 1, dateiHochladen: 1, dateiLoeschen: 1 };

  function api(S, name, args) {
    args = args || {};
    var fn = H[name] || (S.extra && S.extra[name]);
    if (!fn) throw fehler('Unbekannte Aktion: ' + name);
    if (LEHRER[name]) pruefeLehrer(S, args.pw);
    return fn(S, args);
  }

  return {
    TABELLEN: TABELLEN, ARTEN: ARTEN, TYPEN: TYPEN, TYPNAME: TYPNAME, MAX_QUELLE: MAX_QUELLE,
    dateiTeile: dateiTeile, parse: parse, stimmt: stimmt, ohneToleranz: ohneToleranz, schuelerAufgabe: schuelerAufgabe, bewerteAufgabe: bewerteAufgabe, bewerteSet: bewerteSet,
    summiere: summiere, phase: phase, norm: norm, normCode: normCode, shuffle: shuffle, api: api
  };
})();


/* =====================================================================
   GOOGLE APPS SCRIPT – Server
   Speichert alles in der Google Tabelle, an die dieses Skript gebunden ist.
   Die Webseite selbst liegt auf GitHub Pages (index.html + config.js).
   Einmalig im Editor die Funktion „einrichten“ ausführen (▶ Ausführen).
   ===================================================================== */

/* Die Webseite liegt auf GitHub Pages und schickt ihre Anfragen hierher
   (POST mit {name, args}). Antwort: {ok:true, daten} oder {ok:false, fehler}. */

function doPost(e) {
  var antwort;
  try {
    var anfrage = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    antwort = { ok: true, daten: JSON.parse(api(anfrage.name, anfrage.args)) };
  } catch (err) {
    antwort = { ok: false, fehler: String(err && err.message || err).replace(/^(Error|Fehler):\s*/i, '') };
  }
  return ContentService.createTextOutput(JSON.stringify(antwort)).setMimeType(ContentService.MimeType.JSON);
}

/** Zum Testen: Die Web-App-Adresse im Browser öffnen zeigt diese Meldung. */
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, nachricht: 'Die Lernplattform-Schnittstelle ist bereit. Trage diese Adresse in config.js auf GitHub ein.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Einmal ausführen: legt die Tabellenblätter an und merkt sich die Tabelle. */
function einrichten() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Bitte das Skript aus der Google Tabelle heraus öffnen (Erweiterungen → Apps Script).');
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());
  var S = new SheetStore_();
  Object.keys(LP.TABELLEN).forEach(function (t) { S.sheet_(t); });
  var leer = ss.getSheetByName('Tabelle1') || ss.getSheetByName('Sheet1');
  if (leer && ss.getSheets().length > 1 && leer.getLastRow() === 0) ss.deleteSheet(leer);
  Logger.log('Fertig. Jetzt „Bereitstellen → Neue Bereitstellung → Web-App“ wählen (Ausführen als: Ich, Zugriff: Jeder).');
}

/** Führt eine Aktion aus. Antwort als JSON-Text. */
function api(name, args) {
  var S = new SheetStore_();
  try {
    return JSON.stringify(LP.api(S, name, args || {}));
  } catch (e) {
    if (e && e.lp) throw new Error(e.message);
    console.error(e && e.stack || e);
    throw new Error('Serverfehler: ' + (e && e.message || e));
  }
}

/* ---------- Speicher-Adapter für Google Tabellen ---------- */
function SheetStore_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  this.ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!this.ss) throw new Error('Keine Tabelle gefunden. Bitte im Skript-Editor einmal „einrichten“ ausführen.');
  this.props = props;
  this.cache = {};
  this.geprueft_ = {};
  this.ki = !!props.getProperty('ANTHROPIC_API_KEY');
  this.extra = { kiUmwandeln: kiUmwandeln_ };
}

SheetStore_.prototype.sheet_ = function (t) {
  var def = LP.TABELLEN[t];
  var sh = this.ss.getSheetByName(def.blatt);
  if (!sh) {
    sh = this.ss.insertSheet(def.blatt);
    sh.getRange(1, 1, 1, def.spalten.length).setValues([def.spalten]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), def.spalten.length).setNumberFormat('@');
  } else if (!this.geprueft_[t]) {
    // Nach einem Update: neue Spalten in der Kopfzeile ergänzen
    var kopf = sh.getRange(1, 1, 1, def.spalten.length).getValues()[0];
    if (kopf.join('|') !== def.spalten.join('|')) sh.getRange(1, 1, 1, def.spalten.length).setValues([def.spalten]).setFontWeight('bold');
  }
  this.geprueft_[t] = true;
  return sh;
};

SheetStore_.prototype.encode_ = function (t, o) {
  var def = LP.TABELLEN[t];
  return def.spalten.map(function (c) {
    var v = o[c];
    if (def.json.indexOf(c) >= 0) return JSON.stringify(v == null ? null : v);
    if (v == null) return '';
    v = String(v);
    if (/^[=+@]/.test(v)) v = "'" + v;
    return v;
  });
};

SheetStore_.prototype.all = function (t) {
  if (this.cache[t]) return JSON.parse(JSON.stringify(this.cache[t]));
  var def = LP.TABELLEN[t], sh = this.sheet_(t), last = sh.getLastRow(), rows = [];
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, def.spalten.length).getValues();
    vals.forEach(function (v, i) {
      if (v[0] === '' || v[0] == null) return;
      var o = { _r: i + 2 };
      def.spalten.forEach(function (c, j) {
        var x = v[j];
        if (x instanceof Date) x = x.getTime();
        if (def.json.indexOf(c) >= 0) { try { o[c] = x === '' ? null : JSON.parse(String(x)); } catch (e) { o[c] = null; } }
        else if (def.num.indexOf(c) >= 0) o[c] = x === '' ? null : Number(x);
        else o[c] = String(x);
      });
      rows.push(o);
    });
  }
  this.cache[t] = rows;
  return JSON.parse(JSON.stringify(rows));
};

SheetStore_.prototype.insert = function (t, o) {
  var sh = this.sheet_(t), row = this.encode_(t, o);
  var r = sh.getLastRow() + 1;
  var rg = sh.getRange(r, 1, 1, row.length);
  rg.setNumberFormat('@');
  rg.setValues([row]);
  delete this.cache[t];
};

SheetStore_.prototype.insertMany = function (t, liste) {
  if (!liste.length) return;
  var self = this, sh = this.sheet_(t);
  var rows = liste.map(function (o) { return self.encode_(t, o); });
  var rg = sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length);
  rg.setNumberFormat('@');
  rg.setValues(rows);
  delete this.cache[t];
};

/* Schnelle Suche nach Zeilen mit einem bestimmten Wert (ohne das ganze Blatt zu lesen) */
SheetStore_.prototype.zeilenNr_ = function (t, spalte, wert) {
  var def = LP.TABELLEN[t], sh = this.sheet_(t), last = sh.getLastRow();
  if (last < 2) return [];
  var ci = def.spalten.indexOf(spalte) + 1;
  return sh.getRange(2, ci, last - 1, 1).createTextFinder(String(wert)).matchEntireCell(true).matchCase(true)
    .findAll().map(function (c) { return c.getRow(); }).sort(function (a, b) { return a - b; });
};
SheetStore_.prototype.rowsWhere = function (t, spalte, wert) {
  var def = LP.TABELLEN[t], sh = this.sheet_(t), nr = this.zeilenNr_(t, spalte, wert);
  if (!nr.length) return [];
  var von = nr[0], bis = nr[nr.length - 1];
  var vals = sh.getRange(von, 1, bis - von + 1, def.spalten.length).getValues();
  var out = [];
  vals.forEach(function (v, i) {
    if (nr.indexOf(von + i) < 0) return;
    var o = {};
    def.spalten.forEach(function (c, j) {
      var x = v[j];
      if (def.json.indexOf(c) >= 0) { try { o[c] = x === '' ? null : JSON.parse(String(x)); } catch (e) { o[c] = null; } }
      else if (def.num.indexOf(c) >= 0) o[c] = x === '' ? null : Number(x);
      else o[c] = String(x);
    });
    out.push(o);
  });
  return out;
};
SheetStore_.prototype.removeWhere = function (t, spalte, wert) {
  var sh = this.sheet_(t), nr = this.zeilenNr_(t, spalte, wert);
  // zusammenhängende Bereiche von unten nach oben löschen
  for (var i = nr.length - 1; i >= 0;) {
    var ende = nr[i], start = ende;
    while (i > 0 && nr[i - 1] === start - 1) { i--; start--; }
    sh.deleteRows(start, ende - start + 1);
    i--;
  }
  delete this.cache[t];
  return nr.length;
};

SheetStore_.prototype.update = function (t, pred, patch) {
  var self = this, sh = this.sheet_(t), n = 0;
  this.all(t).forEach(function (o) {
    if (!pred(o)) return;
    for (var k in patch) o[k] = patch[k];
    var row = self.encode_(t, o);
    sh.getRange(o._r, 1, 1, row.length).setNumberFormat('@').setValues([row]);
    n++;
  });
  delete this.cache[t];
  return n;
};

SheetStore_.prototype.remove = function (t, pred) {
  var sh = this.sheet_(t);
  var rs = this.all(t).filter(pred).map(function (o) { return o._r; }).sort(function (a, b) { return b - a; });
  rs.forEach(function (r) { sh.deleteRow(r); });
  delete this.cache[t];
  return rs.length;
};

SheetStore_.prototype.getSetting = function (k) { return this.props.getProperty(k); };
SheetStore_.prototype.setSetting = function (k, v) { this.props.setProperty(k, v); };
SheetStore_.prototype.now = function () { return Date.now(); };
SheetStore_.prototype.hash = function (s) {
  var salt = this.props.getProperty('SALT');
  if (!salt) { salt = Utilities.getUuid(); this.props.setProperty('SALT', salt); }
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + s, Utilities.Charset.UTF_8);
  return b.map(function (x) { return ('0' + (x & 255).toString(16)).slice(-2); }).join('');
};
SheetStore_.prototype.lock = function (fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { this.cache = {}; return fn(); } finally { lock.releaseLock(); }
};

/* ---------- Optional: Arbeitsblatt mit KI in das Aufgabenformat umwandeln ----------
   Nur aktiv, wenn in den Skripteigenschaften ANTHROPIC_API_KEY gesetzt ist.
   Der Text des Arbeitsblatts wird dabei an die Anthropic-API gesendet. */
function kiUmwandeln_(S, a) {
  var key = S.getSetting('ANTHROPIC_API_KEY');
  if (!key) throw new Error('Die KI-Umwandlung ist nicht eingerichtet.');
  var text = String(a.text || '').slice(0, 30000);
  if (!text.trim()) throw new Error('Das Dokument enthält keinen Text.');
  var anleitung = [
    'Wandle das folgende Arbeitsblatt in Übungsaufgaben für Schülerinnen und Schüler um.',
    'Antworte NUR mit dem Aufgabentext im folgenden Format, ohne Einleitung und ohne Markdown-Codeblock.',
    'Jede Aufgabe beginnt mit einer Zeile „Aufgabe N (Typ)“ oder „Aufgabe N (Typ, P Punkte)“.',
    'Typen und Schreibweise:',
    'Multiple Choice: Frage, dann Optionen „[x] richtig“ / „[ ] falsch“ je Zeile.',
    'Richtig/Falsch: Aussagen je Zeile mit „(r) …“ oder „(f) …“.',
    'Zuordnung: Paare je Zeile „links = rechts“; optional „Ablenker: a; b“.',
    'Texteingabe: Frage, dann „Lösung: Antwort1; Antwort2“ (kurze, eindeutige Antworten). Bei Rechenergebnissen mit Einheit eine sinnvolle Toleranz angeben, z. B. „Lösung: 9,81 N ± 0,05“. Bei Fachbegriffen „Tippfehler: erlaubt“ ergänzen.',
    'Lückentext: Text mit Lösungswörtern in eckigen Klammern [Wort|Alternative]; optional „Wortspeicher: ja“.',
    'Reihenfolge: Schritte in richtiger Reihenfolge „1. …“, „2. …“.',
    'Freitext: offene Frage, dann „Musterlösung: …“.',
    'Info: Lese- oder Materialtext ohne Fragen.',
    'Optional bei jeder Aufgabe: „Erklärung: …“ (wird nach Ende des Zeitraums gezeigt).',
    'Brüche immer als 3/4 bzw. gemischte Zahlen als 2 1/2 schreiben. Zeilen „Bild: …“ unverändert an ihrer Stelle lassen.',
    'Übernimm vorhandene Aufgaben möglichst genau, ergänze Lösungen, wenn sie eindeutig sind.'
  ].join('\n');
  var resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: S.getSetting('ANTHROPIC_MODEL') || 'claude-sonnet-5-5',
      max_tokens: 8000,
      messages: [{ role: 'user', content: anleitung + '\n\nARBEITSBLATT:\n' + text }]
    })
  });
  var code = resp.getResponseCode();
  var body = JSON.parse(resp.getContentText() || '{}');
  if (code !== 200) throw new Error('KI-Anfrage fehlgeschlagen (' + code + '): ' + (body.error && body.error.message || ''));
  var out = (body.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join('\n');
  return { quelle: out.replace(/^```\w*\n?|```$/g, '').trim() };
}
