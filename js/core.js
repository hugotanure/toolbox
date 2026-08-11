/* ===========================================================
   Data Toolbox — core logic (no DOM access)
   Exposed as window.DTB so both the app and the test page
   can use the exact same functions.
   Depends on: vendor/diff.min.js (Diff), vendor/js-yaml.min.js (jsyaml)
   =========================================================== */

(function (global) {
  'use strict';

  var DTB = {};

  /* ---------------- text helpers ---------------- */

  // Normalize Windows (\r\n) and old Mac (\r) line endings to \n so the
  // diff treats equivalent lines as equal regardless of platform.
  DTB.normalizeNewlines = function (text) {
    return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  };

  // Split a string into user-perceived characters (grapheme clusters).
  // Uses Intl.Segmenter when available; falls back to code points, which
  // still keeps surrogate pairs (e.g. most emoji) intact.
  var segmenter = null;
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    try {
      segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    } catch (e) {
      segmenter = null;
    }
  }

  DTB.graphemes = function (text) {
    var s = String(text);
    if (s === '') { return []; }
    if (segmenter) {
      var out = [];
      var it = segmenter.segment(s);
      var iter = it[Symbol.iterator]();
      var step = iter.next();
      while (!step.done) {
        out.push(step.value.segment);
        step = iter.next();
      }
      return out;
    }
    return Array.from(s);
  };

  DTB.graphemeCount = function (text) {
    return DTB.graphemes(text).length;
  };

  /* ---------------- character-level diff ---------------- */

  // Custom jsdiff differ that tokenizes by grapheme cluster, so accents,
  // combining marks and emoji are treated as single visual characters.
  function makeGraphemeDiff() {
    var d = new Diff.Diff();
    d.tokenize = function (value) {
      return DTB.graphemes(value);
    };
    d.join = function (tokens) {
      return tokens.join('');
    };
    d.equals = function (left, right) {
      var opts = this.options || {};
      var a = left;
      var b = right;
      if (opts.ignoreCase) {
        a = a.toLowerCase();
        b = b.toLowerCase();
      }
      if (opts.ignoreWhitespace && /^\s+$/.test(a) && /^\s+$/.test(b)) {
        return true;
      }
      return a === b;
    };
    return d;
  }

  var graphemeDiff = makeGraphemeDiff();

  // Diff two single-line strings character by character.
  // Returns jsdiff-style parts: [{ value, added, removed }]
  DTB.charDiff = function (a, b, opts) {
    opts = opts || {};
    return graphemeDiff.diff(String(a), String(b), {
      ignoreCase: !!opts.ignoreCase,
      ignoreWhitespace: !!opts.ignoreWhitespace
    });
  };

  /* ---------------- two-stage text diff ---------------- */

  function splitAllLines(text) {
    // "a\nb\n" -> ["a", "b"]; "a\nb" -> ["a", "b"]; "" -> []
    if (text === '') { return []; }
    var lines = text.split('\n');
    if (lines[lines.length - 1] === '') { lines.pop(); }
    return lines;
  }

  // Compare two texts. Stage 1 aligns lines with Diff.diffLines; stage 2
  // computes a per-character diff inside pairs of changed lines.
  //
  // Returns:
  // {
  //   identical: boolean,
  //   rows: [{
  //     kind: 'same' | 'modified' | 'removed' | 'added',
  //     leftNum, rightNum,          // 1-based or null (placeholder side)
  //     left, right,                // raw line text or null
  //     parts                       // char diff parts for 'modified' rows
  //   }],
  //   stats: { addedChars, removedChars, changedBlocks, changedLines }
  // }
  DTB.compareTexts = function (original, altered, opts) {
    opts = opts || {};
    var a = DTB.normalizeNewlines(original);
    var b = DTB.normalizeNewlines(altered);

    // Ensure both texts end with \n so jsdiff's line tokens always carry a
    // trailing newline; otherwise "last line" vs "last line\n" would be
    // reported as a change even though the visible content is identical.
    if (a !== '' && a.charAt(a.length - 1) !== '\n') { a += '\n'; }
    if (b !== '' && b.charAt(b.length - 1) !== '\n') { b += '\n'; }

    var leftLines = splitAllLines(a);
    var rightLines = splitAllLines(b);

    var lineOpts = {};
    if (opts.ignoreCase) { lineOpts.ignoreCase = true; }
    if (opts.ignoreWhitespace) { lineOpts.ignoreWhitespace = true; }

    var changes = Diff.diffLines(a, b, lineOpts);

    var rows = [];
    var stats = { addedChars: 0, removedChars: 0, changedBlocks: 0, changedLines: 0 };
    var li = 0; // index into leftLines
    var ri = 0; // index into rightLines
    var i, k, n;

    for (i = 0; i < changes.length; i++) {
      var c = changes[i];
      if (!c.added && !c.removed) {
        n = c.count || splitAllLines(c.value).length;
        for (k = 0; k < n; k++) {
          rows.push({
            kind: 'same',
            leftNum: li + 1, rightNum: ri + 1,
            left: leftLines[li], right: rightLines[ri],
            parts: null
          });
          li++; ri++;
        }
      } else if (c.removed) {
        var removedCount = c.count || splitAllLines(c.value).length;
        var addedCount = 0;
        if (i + 1 < changes.length && changes[i + 1].added) {
          addedCount = changes[i + 1].count || splitAllLines(changes[i + 1].value).length;
          i++; // consume paired "added" change
        }
        stats.changedBlocks++;
        n = Math.max(removedCount, addedCount);
        for (k = 0; k < n; k++) {
          var hasLeft = k < removedCount;
          var hasRight = k < addedCount;
          if (hasLeft && hasRight) {
            var parts = DTB.charDiff(leftLines[li], rightLines[ri], opts);
            var hasChange = false;
            var p;
            for (p = 0; p < parts.length; p++) {
              if (parts[p].added) { hasChange = true; stats.addedChars += DTB.graphemeCount(parts[p].value); }
              if (parts[p].removed) { hasChange = true; stats.removedChars += DTB.graphemeCount(parts[p].value); }
            }
            rows.push({
              kind: hasChange ? 'modified' : 'same',
              leftNum: li + 1, rightNum: ri + 1,
              left: leftLines[li], right: rightLines[ri],
              parts: hasChange ? parts : null
            });
            if (hasChange) { stats.changedLines++; }
            li++; ri++;
          } else if (hasLeft) {
            stats.removedChars += DTB.graphemeCount(leftLines[li]);
            rows.push({
              kind: 'removed',
              leftNum: li + 1, rightNum: null,
              left: leftLines[li], right: null,
              parts: null
            });
            stats.changedLines++;
            li++;
          } else {
            stats.addedChars += DTB.graphemeCount(rightLines[ri]);
            rows.push({
              kind: 'added',
              leftNum: null, rightNum: ri + 1,
              left: null, right: rightLines[ri],
              parts: null
            });
            stats.changedLines++;
            ri++;
          }
        }
      } else { // added-only block
        stats.changedBlocks++;
        n = c.count || splitAllLines(c.value).length;
        for (k = 0; k < n; k++) {
          stats.addedChars += DTB.graphemeCount(rightLines[ri]);
          rows.push({
            kind: 'added',
            leftNum: null, rightNum: ri + 1,
            left: null, right: rightLines[ri],
            parts: null
          });
          stats.changedLines++;
          ri++;
        }
      }
    }

    var identical = true;
    for (i = 0; i < rows.length; i++) {
      if (rows[i].kind !== 'same') { identical = false; break; }
    }

    return { identical: identical, rows: rows, stats: stats };
  };

  /* ---------------- JSON ---------------- */

  // Locate line/column of a JSON.parse error across browsers.
  // V8: "... at position 42" (newer builds also add "(line 2 column 7)")
  // SpiderMonkey: "... at line 2 column 7 of the JSON data"
  function jsonErrorPosition(text, err) {
    var msg = String((err && err.message) || err);
    var m = msg.match(/line (\d+) column (\d+)/i);
    if (m) {
      return { line: parseInt(m[1], 10), column: parseInt(m[2], 10) };
    }
    m = msg.match(/position (\d+)/i);
    if (m) {
      var pos = Math.min(parseInt(m[1], 10), text.length);
      var before = text.slice(0, pos).split('\n');
      return { line: before.length, column: before[before.length - 1].length + 1 };
    }
    return { line: null, column: null };
  }

  // Strict JSON validation. Success: { ok: true, value }.
  // Failure: { ok: false, message, line, column, previewLine }.
  DTB.validateJson = function (text) {
    if (String(text).trim() === '') {
      return { ok: false, message: 'The document is empty.', line: null, column: null, previewLine: null };
    }
    try {
      var value = JSON.parse(text);
      return { ok: true, value: value };
    } catch (err) {
      var posInfo = jsonErrorPosition(text, err);
      var previewLine = null;
      if (posInfo.line !== null) {
        var lines = DTB.normalizeNewlines(text).split('\n');
        previewLine = lines[posInfo.line - 1] !== undefined ? lines[posInfo.line - 1] : null;
      }
      return {
        ok: false,
        message: String((err && err.message) || err),
        line: posInfo.line,
        column: posInfo.column,
        previewLine: previewLine
      };
    }
  };

  function indentValue(indentChoice) {
    if (indentChoice === 'tab') { return '\t'; }
    var num = parseInt(indentChoice, 10);
    return isNaN(num) ? 2 : num;
  }

  DTB.formatJson = function (text, indentChoice) {
    var v = DTB.validateJson(text);
    if (!v.ok) { return v; }
    return { ok: true, text: JSON.stringify(v.value, null, indentValue(indentChoice)) };
  };

  DTB.minifyJson = function (text) {
    var v = DTB.validateJson(text);
    if (!v.ok) { return v; }
    return { ok: true, text: JSON.stringify(v.value) };
  };

  DTB.textStats = function (text) {
    var s = String(text);
    var bytes = 0;
    if (typeof TextEncoder !== 'undefined') {
      bytes = new TextEncoder().encode(s).length;
    } else {
      bytes = s.length;
    }
    return {
      lines: s === '' ? 0 : s.split('\n').length,
      chars: s.length,
      bytes: bytes
    };
  };

  /* ---------------- JSON <-> YAML ---------------- */

  // Replace values that have no direct JSON equivalent, collecting
  // human-readable warnings (shown in the UI).
  function toJsonSafe(value, path, warnings) {
    if (value === undefined) {
      warnings.push('The value at "' + path + '" is undefined and was converted to null.');
      return null;
    }
    if (typeof value === 'number' && !isFinite(value)) {
      warnings.push('The value "' + String(value) + '" at "' + path + '" (infinity or NaN) does not exist in JSON and was converted to null.');
      return null;
    }
    if (typeof value === 'bigint') {
      warnings.push('The very large number at "' + path + '" was converted to a string to avoid losing precision.');
      return String(value);
    }
    if (value instanceof Date) {
      warnings.push('The date at "' + path + '" was converted to an ISO-format string, since JSON has no date type.');
      return value.toISOString();
    }
    if (Array.isArray(value)) {
      var arr = [];
      for (var i = 0; i < value.length; i++) {
        arr.push(toJsonSafe(value[i], path + '[' + i + ']', warnings));
      }
      return arr;
    }
    if (value !== null && typeof value === 'object') {
      var obj = {};
      var keys = Object.keys(value);
      for (var k = 0; k < keys.length; k++) {
        obj[keys[k]] = toJsonSafe(value[keys[k]], path + '.' + keys[k], warnings);
      }
      return obj;
    }
    if (typeof value === 'function') {
      warnings.push('The value at "' + path + '" cannot be represented in JSON and was converted to null.');
      return null;
    }
    return value;
  }

  // JSON text -> YAML text.
  // Success: { ok: true, text }. Failure: same shape as validateJson.
  DTB.jsonToYaml = function (jsonText) {
    var v = DTB.validateJson(jsonText);
    if (!v.ok) { return v; }
    try {
      var yamlText = jsyaml.dump(v.value, {
        indent: 2,
        noRefs: true,      // no anchors/aliases in the output
        sortKeys: false,   // keep original key order
        lineWidth: 120
      });
      return { ok: true, text: yamlText };
    } catch (err) {
      return { ok: false, message: String((err && err.message) || err), line: null, column: null, previewLine: null };
    }
  };

  // YAML text -> JSON text.
  // Uses the CORE schema (YAML 1.2): only null/bool/int/float/string are
  // resolved, so timestamps stay strings and no custom tags are executed.
  // Success: { ok: true, text, warnings: [...] }.
  // Failure: { ok: false, message, line, column, previewLine }.
  DTB.yamlToJson = function (yamlText, indentChoice) {
    if (String(yamlText).trim() === '') {
      return { ok: false, message: 'The document is empty.', line: null, column: null, previewLine: null };
    }
    var value;
    try {
      value = jsyaml.load(yamlText, { schema: jsyaml.CORE_SCHEMA });
    } catch (err) {
      var line = null, column = null, previewLine = null;
      if (err && err.mark) {
        line = (typeof err.mark.line === 'number') ? err.mark.line + 1 : null;
        column = (typeof err.mark.column === 'number') ? err.mark.column + 1 : null;
        if (line !== null) {
          var lines = DTB.normalizeNewlines(yamlText).split('\n');
          previewLine = lines[line - 1] !== undefined ? lines[line - 1] : null;
        }
      }
      var reason = (err && err.reason) ? err.reason : String((err && err.message) || err);
      return { ok: false, message: reason, line: line, column: column, previewLine: previewLine };
    }
    var warnings = [];
    var safe = toJsonSafe(value, '$', warnings);
    return {
      ok: true,
      text: JSON.stringify(safe, null, indentValue(indentChoice)),
      warnings: warnings
    };
  };

  // YAML validation only (no conversion).
  DTB.validateYaml = function (yamlText) {
    var r = DTB.yamlToJson(yamlText, '2');
    if (r.ok) { return { ok: true, warnings: r.warnings }; }
    return r;
  };

  global.DTB = DTB;
})(typeof window !== 'undefined' ? window : this);
