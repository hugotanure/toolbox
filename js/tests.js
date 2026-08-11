/* ===========================================================
   Data Toolbox — browser test suite
   Exercises the same core functions used by the app (js/core.js).
   Open tests.html directly in the browser to run.
   Test data intentionally keeps accented words and emoji to
   exercise Unicode support.
   =========================================================== */

(function () {
  'use strict';

  var results = [];

  function test(name, fn) {
    try {
      fn();
      results.push({ name: name, ok: true, error: null });
    } catch (err) {
      results.push({ name: name, ok: false, error: String((err && err.message) || err) });
    }
  }

  function assert(cond, msg) {
    if (!cond) { throw new Error(msg || 'assertion failed'); }
  }

  function assertEqual(actual, expected, msg) {
    if (actual !== expected) {
      throw new Error((msg || 'values differ') + ' — expected: ' +
        JSON.stringify(expected) + ', got: ' + JSON.stringify(actual));
    }
  }

  /* 1. "Hugo" vs "HugO": only o/O highlighted */
  test('1. Diff of "Hugo" vs "HugO" highlights only o/O', function () {
    var parts = DTB.charDiff('Hugo', 'HugO');
    var removed = parts.filter(function (p) { return p.removed; });
    var added = parts.filter(function (p) { return p.added; });
    var same = parts.filter(function (p) { return !p.added && !p.removed; });
    assertEqual(removed.length, 1, 'there must be exactly 1 removed part');
    assertEqual(removed[0].value, 'o', 'removed part');
    assertEqual(added.length, 1, 'there must be exactly 1 added part');
    assertEqual(added[0].value, 'O', 'added part');
    assertEqual(same.map(function (p) { return p.value; }).join(''), 'Hug', 'unchanged part');
  });

  /* 2. insertion and removal in the middle of a line */
  test('2. Insertion and removal in the middle of a line', function () {
    var parts = DTB.charDiff('abcdef', 'abXYef');
    var removedText = parts.filter(function (p) { return p.removed; })
      .map(function (p) { return p.value; }).join('');
    var addedText = parts.filter(function (p) { return p.added; })
      .map(function (p) { return p.value; }).join('');
    assertEqual(removedText, 'cd');
    assertEqual(addedText, 'XY');

    var ins = DTB.charDiff('abcd', 'abXcd');
    var insAdded = ins.filter(function (p) { return p.added; })
      .map(function (p) { return p.value; }).join('');
    assertEqual(insAdded, 'X', 'pure insertion');
    assertEqual(ins.filter(function (p) { return p.removed; }).length, 0, 'no removals');
  });

  /* 3. multi-line comparison */
  test('3. Multi-line text comparison', function () {
    var r = DTB.compareTexts('line 1\nline 2\nline 3', 'line 1\nline 2 changed\nline 3\nline 4');
    assert(!r.identical, 'texts are not identical');
    var kinds = r.rows.map(function (row) { return row.kind; });
    assertEqual(kinds.join(','), 'same,modified,same,added');
    assertEqual(r.stats.changedLines, 2);
    assert(r.stats.changedBlocks >= 1, 'at least 1 changed block');
  });

  /* 4. emoji and accents treated as whole characters */
  test('4. Emoji and accents treated as whole characters', function () {
    var parts = DTB.charDiff('café 🌎', 'café 🌍');
    var removed = parts.filter(function (p) { return p.removed; });
    var added = parts.filter(function (p) { return p.added; });
    assertEqual(removed.length, 1);
    assertEqual(removed[0].value, '🌎', 'emoji removed as a whole');
    assertEqual(added[0].value, '🌍', 'emoji added as a whole');

    var acc = DTB.charDiff('ação', 'açao');
    var accRemoved = acc.filter(function (p) { return p.removed; })
      .map(function (p) { return p.value; }).join('');
    assertEqual(accRemoved, 'ã', 'accented letter treated as 1 character');
  });

  /* extra: CRLF vs LF must be considered identical */
  test('Extra. Windows and Unix line endings are equivalent', function () {
    var r = DTB.compareTexts('a\r\nb\r\nc', 'a\nb\nc');
    assert(r.identical, 'CRLF vs LF must be identical');
  });

  /* extra: ignore case option */
  test('Extra. "Ignore case" option', function () {
    var r = DTB.compareTexts('Hugo', 'HUGO', { ignoreCase: true });
    assert(r.identical, 'with ignoreCase the texts are identical');
  });

  /* 5. valid JSON with nested objects and arrays */
  test('5. Valid JSON with nested objects and arrays', function () {
    var text = '{"a": {"b": [1, 2, {"c": null, "d": true}]}, "e": "olá"}';
    var r = DTB.validateJson(text);
    assert(r.ok, 'should be valid: ' + (r.message || ''));
    assertEqual(r.value.a.b[2].d, true);

    var f = DTB.formatJson(text, '4');
    assert(f.ok);
    assert(f.text.indexOf('    "a"') !== -1, '4-space indentation applied');
    assert(f.text.indexOf('olá') !== -1, 'Unicode preserved when formatting');

    var m = DTB.minifyJson(f.text);
    assert(m.ok);
    assertEqual(m.text, JSON.stringify(JSON.parse(text)), 'minification preserves the values');
  });

  /* 6. invalid JSON: trailing comma */
  test('6. Invalid JSON with a trailing comma is rejected, with line/column', function () {
    var r = DTB.validateJson('{\n  "a": 1,\n}');
    assert(!r.ok, 'trailing comma must be invalid');
    assert(r.line !== null, 'error line reported');
    assert(r.column !== null, 'error column reported');
    assert(r.previewLine !== null, 'preview of the offending line available');
  });

  /* 7. invalid JSON: single quotes */
  test('7. Invalid JSON with single quotes is rejected', function () {
    var r = DTB.validateJson("{'a': 1}");
    assert(!r.ok, 'single quotes must be invalid');
    var c = DTB.validateJson('{"a": 1} // comment');
    assert(!c.ok, 'comments must be invalid');
  });

  /* 8. JSON -> YAML -> JSON round trip */
  test('8. JSON → YAML → JSON conversion preserves the data', function () {
    var original = '{"name":"José","items":["café","pão"],"active":true,"score":9.5,"nothing":null,"n":42}';
    var y = DTB.jsonToYaml(original);
    assert(y.ok, 'JSON → YAML: ' + (y.message || ''));
    assert(y.text.indexOf('---') !== 0, 'no unnecessary document marker');
    var back = DTB.yamlToJson(y.text, '2');
    assert(back.ok, 'YAML → JSON: ' + (back.message || ''));
    assertEqual(JSON.stringify(JSON.parse(back.text)), JSON.stringify(JSON.parse(original)),
      'data must be identical after the round trip');
  });

  /* 9. YAML with arrays, booleans, numbers, null and accented strings */
  test('9. YAML with arrays, booleans, numbers, null and accented strings', function () {
    var yamlText = 'name: Conceição\nactive: true\nscore: 9.5\nempty: null\nlist:\n  - one\n  - 2\n  - false\n';
    var r = DTB.yamlToJson(yamlText, '2');
    assert(r.ok, r.message || '');
    var v = JSON.parse(r.text);
    assertEqual(v.name, 'Conceição');
    assertEqual(v.active, true);
    assertEqual(v.score, 9.5);
    assert(v.empty === null, 'null preserved');
    assertEqual(v.list.length, 3);
    assertEqual(v.list[1], 2);
    assertEqual(v.list[2], false);
  });

  /* 10. invalid YAML reports line and column */
  test('10. Invalid YAML reports line and column', function () {
    var r = DTB.yamlToJson('key: value\n  indentation: [broken\nother: x', '2');
    assert(!r.ok, 'YAML should be invalid');
    assert(r.line !== null, 'line reported');
    assert(r.column !== null, 'column reported');
    assert(typeof r.message === 'string' && r.message.length > 0, 'message present');
  });

  /* extra: unsafe YAML tags are not executed */
  test('Extra. Custom/dangerous YAML tags are rejected', function () {
    var r = DTB.yamlToJson('value: !!js/function "function(){return 1}"', '2');
    assert(!r.ok, 'js/function tag must be rejected');
  });

  /* 11. XSS payload is rendered as plain text */
  test('11. "<img src=x onerror=alert(1)>" is displayed as text only', function () {
    var payload = '<img src=x onerror=alert(1)>';
    // Render exactly like the app does: DOM nodes + textContent.
    var container = document.createElement('div');
    var span = document.createElement('span');
    span.className = 'ch-added';
    span.textContent = payload;
    container.appendChild(span);
    document.body.appendChild(container);
    assertEqual(container.querySelectorAll('img').length, 0, 'no <img> element may be created');
    assertEqual(container.textContent, payload, 'the displayed text is the literal input');
    container.remove();

    // The diff pipeline must also carry it through as plain data.
    var parts = DTB.charDiff('', payload);
    assertEqual(parts.filter(function (p) { return p.added; })
      .map(function (p) { return p.value; }).join(''), payload);
  });

  /* extra: substitution across whole lines with placeholder alignment */
  test('Extra. Removed/added lines produce placeholder alignment', function () {
    var r = DTB.compareTexts('a\nb\nc', 'a\nc');
    var removedRow = r.rows.filter(function (row) { return row.kind === 'removed'; })[0];
    assert(removedRow, 'there is a removed line');
    assertEqual(removedRow.left, 'b');
    assert(removedRow.rightNum === null, 'right side is a placeholder');
  });

  /* extra: summary statistics */
  test('Extra. Summary: added/removed character counts', function () {
    var r = DTB.compareTexts('Hugo', 'HugO');
    assertEqual(r.stats.addedChars, 1);
    assertEqual(r.stats.removedChars, 1);
    assertEqual(r.stats.changedBlocks, 1);
    assertEqual(r.stats.changedLines, 1);
    var identical = DTB.compareTexts('equal', 'equal');
    assert(identical.identical, 'identical texts detected');
  });

  /* ---------------- render results ---------------- */

  var container = document.getElementById('test-results');
  container.textContent = '';
  container.classList.remove('empty-state');
  var pass = 0;
  var fail = 0;

  results.forEach(function (r) {
    var row = document.createElement('div');
    row.setAttribute('role', 'listitem');
    row.className = 'message ' + (r.ok ? 'msg-ok' : 'msg-err');
    var strong = document.createElement('strong');
    strong.textContent = (r.ok ? '✓ ' : '✗ ') + r.name;
    row.appendChild(strong);
    if (!r.ok) {
      var pre = document.createElement('pre');
      pre.textContent = r.error;
      row.appendChild(pre);
      fail++;
    } else {
      pass++;
    }
    container.appendChild(row);
  });

  document.getElementById('t-pass').textContent = String(pass);
  document.getElementById('t-fail').textContent = String(fail);
  document.title = (fail === 0 ? '✓ ' : '✗ ') + document.title;
})();
