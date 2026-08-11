/* ===========================================================
   Data Toolbox — UI layer
   All user content is rendered with textContent / createTextNode.
   localStorage is used ONLY for preferences (theme, last tab).
   =========================================================== */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var PREF_THEME = 'dtb-pref-theme';
  var PREF_TAB = 'dtb-pref-tab';
  var LARGE_INPUT_THRESHOLD = 200000; // chars; warn before diffing more than this

  /* ---------------- notifications ---------------- */

  var liveRegion = $('live-region');
  var toastContainer = $('toast-container');

  function announce(message) {
    liveRegion.textContent = '';
    // small delay so repeated messages are re-announced by screen readers
    window.setTimeout(function () { liveRegion.textContent = message; }, 30);
  }

  function toast(message) {
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    toastContainer.appendChild(el);
    window.requestAnimationFrame(function () { el.classList.add('show'); });
    window.setTimeout(function () {
      el.classList.remove('show');
      window.setTimeout(function () { el.remove(); }, 250);
    }, 2200);
    announce(message);
  }

  function copyText(text, successMessage) {
    if (!text) {
      toast('Nothing to copy.');
      return;
    }
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.className = 'sr-only';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      toast(ok ? successMessage : 'Could not copy automatically.');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast(successMessage);
      }, fallback);
    } else {
      fallback();
    }
  }

  function confirmClear(hasContent, what) {
    if (!hasContent) { return true; }
    return window.confirm('Clear ' + what + '? The current content will be lost.');
  }

  function downloadText(text, filename, mime) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function openFileInto(fileInput, textarea, onLoaded) {
    fileInput.value = '';
    fileInput.onchange = function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) { return; }
      var reader = new FileReader();
      reader.onload = function () {
        textarea.value = String(reader.result);
        textarea.dispatchEvent(new Event('input'));
        toast('File "' + file.name + '" loaded.');
        if (onLoaded) { onLoaded(); }
      };
      reader.onerror = function () {
        toast('Could not read the file.');
      };
      reader.readAsText(file);
    };
    fileInput.click();
  }

  /* ---------------- theme ---------------- */

  var btnTheme = $('btn-theme');
  var themeIcon = $('theme-icon');
  var themeLabel = $('theme-label');

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var dark = theme === 'dark';
    btnTheme.setAttribute('aria-pressed', dark ? 'true' : 'false');
    themeIcon.textContent = dark ? '☀️' : '🌙';
    themeLabel.textContent = dark ? 'Light theme' : 'Dark theme';
  }

  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(PREF_THEME); } catch (e) { saved = null; }
    var theme = saved === 'dark' || saved === 'light'
      ? saved
      : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    applyTheme(theme);
  }

  btnTheme.addEventListener('click', function () {
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(PREF_THEME, next); } catch (e) { /* preferences only; ignore */ }
  });

  initTheme();

  /* ---------------- tabs ---------------- */

  var tabIds = ['tab-diff', 'tab-json', 'tab-convert'];
  var tabs = tabIds.map(function (id) { return $(id); });

  function selectTab(tab, focusIt) {
    tabs.forEach(function (t) {
      var selected = t === tab;
      t.setAttribute('aria-selected', selected ? 'true' : 'false');
      t.tabIndex = selected ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !selected;
    });
    if (focusIt) { tab.focus(); }
    try { localStorage.setItem(PREF_TAB, tab.id); } catch (e) { /* ignore */ }
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () { selectTab(tab, false); });
  });

  document.querySelector('.tabs').addEventListener('keydown', function (e) {
    var idx = tabs.indexOf(document.activeElement);
    if (idx === -1) { return; }
    var next = null;
    if (e.key === 'ArrowRight') { next = tabs[(idx + 1) % tabs.length]; }
    else if (e.key === 'ArrowLeft') { next = tabs[(idx - 1 + tabs.length) % tabs.length]; }
    else if (e.key === 'Home') { next = tabs[0]; }
    else if (e.key === 'End') { next = tabs[tabs.length - 1]; }
    if (next) {
      e.preventDefault();
      selectTab(next, true);
    }
  });

  (function initTab() {
    var saved = null;
    try { saved = localStorage.getItem(PREF_TAB); } catch (e) { saved = null; }
    var tab = tabs.filter(function (t) { return t.id === saved; })[0];
    if (tab) { selectTab(tab, false); }
  })();

  function activeTabId() {
    return tabs.filter(function (t) { return t.getAttribute('aria-selected') === 'true'; })[0].id;
  }

  /* ===========================================================
     TAB 1 — text diff
     =========================================================== */

  var diffOriginal = $('diff-original');
  var diffAltered = $('diff-altered');
  var diffSummary = $('diff-summary');
  var diffEmpty = $('diff-empty');
  var diffSide = $('diff-side');
  var diffInlineWrap = $('diff-inline-wrap');
  var paneLeft = $('diff-pane-left');
  var paneRight = $('diff-pane-right');
  var paneInline = $('diff-inline');
  var lastDiff = null;

  function diffOptions() {
    return {
      ignoreCase: $('opt-ignore-case').checked,
      ignoreWhitespace: $('opt-ignore-space').checked
    };
  }

  function currentViewMode() {
    return $('view-inline').checked ? 'inline' : 'side';
  }

  // Build one rendered line: [gutter number][code content]
  function buildLine(num, kindClass, codeNodes) {
    var line = document.createElement('div');
    line.className = 'line' + (kindClass ? ' ' + kindClass : '');
    var ln = document.createElement('span');
    ln.className = 'ln';
    ln.textContent = num === null ? '' : String(num);
    var code = document.createElement('span');
    code.className = 'code';
    var i;
    for (i = 0; i < codeNodes.length; i++) { code.appendChild(codeNodes[i]); }
    if (!code.firstChild) { code.appendChild(document.createTextNode(' ')); }
    line.appendChild(ln);
    line.appendChild(code);
    return line;
  }

  function markSpan(tagName, className, text) {
    var el = document.createElement(tagName);
    el.className = className;
    el.textContent = text;
    return el;
  }

  function renderSideBySide(result) {
    paneLeft.textContent = '';
    paneRight.textContent = '';
    var fragL = document.createDocumentFragment();
    var fragR = document.createDocumentFragment();

    result.rows.forEach(function (row) {
      var leftNodes = [];
      var rightNodes = [];
      var leftClass = '';
      var rightClass = '';

      if (row.kind === 'same') {
        leftNodes.push(document.createTextNode(row.left));
        rightNodes.push(document.createTextNode(row.right));
      } else if (row.kind === 'modified') {
        leftClass = 'line-removed';
        rightClass = 'line-added';
        row.parts.forEach(function (part) {
          if (part.removed) {
            leftNodes.push(markSpan('span', 'ch-removed side', part.value));
          } else if (part.added) {
            rightNodes.push(markSpan('span', 'ch-added', part.value));
          } else {
            leftNodes.push(document.createTextNode(part.value));
            rightNodes.push(document.createTextNode(part.value));
          }
        });
      } else if (row.kind === 'removed') {
        leftClass = 'line-removed';
        leftNodes.push(markSpan('span', 'ch-removed side', row.left));
        rightClass = 'line-placeholder';
      } else { // added
        rightClass = 'line-added';
        rightNodes.push(markSpan('span', 'ch-added', row.right));
        leftClass = 'line-placeholder';
      }

      fragL.appendChild(buildLine(row.leftNum, leftClass, leftNodes));
      fragR.appendChild(buildLine(row.rightNum, rightClass, rightNodes));
    });

    paneLeft.appendChild(fragL);
    paneRight.appendChild(fragR);
  }

  function renderInline(result) {
    paneInline.textContent = '';
    var frag = document.createDocumentFragment();

    result.rows.forEach(function (row) {
      var nodes = [];
      var cls = '';
      var num = row.leftNum !== null ? row.leftNum : row.rightNum;

      if (row.kind === 'same') {
        nodes.push(document.createTextNode(row.left));
      } else if (row.kind === 'modified') {
        row.parts.forEach(function (part) {
          if (part.removed) {
            nodes.push(markSpan('del', 'ch-removed', part.value));
          } else if (part.added) {
            nodes.push(markSpan('ins', 'ch-added', part.value));
          } else {
            nodes.push(document.createTextNode(part.value));
          }
        });
      } else if (row.kind === 'removed') {
        cls = 'line-removed';
        nodes.push(markSpan('del', 'ch-removed', row.left));
      } else {
        cls = 'line-added';
        nodes.push(markSpan('ins', 'ch-added', row.right));
      }

      frag.appendChild(buildLine(num, cls, nodes));
    });

    paneInline.appendChild(frag);
  }

  function applyWrapPreference() {
    var wrap = $('opt-wrap').checked;
    [paneLeft, paneRight, paneInline].forEach(function (pane) {
      pane.classList.toggle('nowrap', !wrap);
    });
  }

  function renderDiff() {
    if (!lastDiff) { return; }
    applyWrapPreference();

    $('sum-added').textContent = String(lastDiff.stats.addedChars);
    $('sum-removed').textContent = String(lastDiff.stats.removedChars);
    $('sum-blocks').textContent = String(lastDiff.stats.changedBlocks);
    $('sum-lines').textContent = String(lastDiff.stats.changedLines);
    $('sum-identical').hidden = !lastDiff.identical;
    diffSummary.hidden = false;
    diffEmpty.hidden = true;

    var mode = currentViewMode();
    if (mode === 'side') {
      renderSideBySide(lastDiff);
      diffSide.hidden = false;
      diffInlineWrap.hidden = true;
    } else {
      renderInline(lastDiff);
      diffSide.hidden = true;
      diffInlineWrap.hidden = false;
    }
  }

  function runCompare() {
    var a = diffOriginal.value;
    var b = diffAltered.value;
    if (a === '' && b === '') {
      toast('Fill in the editors before comparing.');
      return;
    }
    if (a.length + b.length > LARGE_INPUT_THRESHOLD) {
      var proceed = window.confirm(
        'The texts are very large (' + (a.length + b.length).toLocaleString('en-US') +
        ' characters in total). Comparing may take a few seconds. Continue?'
      );
      if (!proceed) { return; }
    }
    var btn = $('btn-compare');
    btn.disabled = true;
    btn.textContent = 'Comparing…';
    // Yield to the browser so the button state is painted before the
    // (potentially heavy) diff runs; the UI is never blocked permanently.
    window.setTimeout(function () {
      try {
        lastDiff = DTB.compareTexts(a, b, diffOptions());
        renderDiff();
        announce(lastDiff.identical
          ? 'Comparison finished. The texts are identical.'
          : 'Comparison finished. ' + lastDiff.stats.changedLines + ' lines changed.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Compare';
      }
    }, 20);
  }

  $('btn-compare').addEventListener('click', runCompare);

  $('btn-swap').addEventListener('click', function () {
    var tmp = diffOriginal.value;
    diffOriginal.value = diffAltered.value;
    diffAltered.value = tmp;
    toast('Contents swapped.');
  });

  $('btn-clear-diff').addEventListener('click', function () {
    if (!confirmClear(diffOriginal.value !== '' || diffAltered.value !== '', 'both editors')) { return; }
    diffOriginal.value = '';
    diffAltered.value = '';
    lastDiff = null;
    diffSummary.hidden = true;
    diffSide.hidden = true;
    diffInlineWrap.hidden = true;
    diffEmpty.hidden = false;
    announce('Editors cleared.');
  });

  $('btn-example-diff').addEventListener('click', function () {
    if (!confirmClear(diffOriginal.value !== '' || diffAltered.value !== '', 'both editors')) { return; }
    diffOriginal.value = 'Hello, world! 🌎\nThis line stays the same.\nThe client is named Hugo.\nThis line will be removed.\nPrice: R$ 1.234,56';
    diffAltered.value = 'Hello, world! 🌍\nThis line stays the same.\nThe client is named HugO.\nPrice: R$ 1.234,99\nNew line added at the end.';
    toast('Example loaded. Click Compare.');
  });

  $('btn-copy-original').addEventListener('click', function () {
    copyText(diffOriginal.value, 'Original text copied.');
  });

  $('btn-copy-altered').addEventListener('click', function () {
    copyText(diffAltered.value, 'Changed text copied.');
  });

  ['view-side', 'view-inline'].forEach(function (id) {
    $(id).addEventListener('change', renderDiff);
  });

  $('opt-wrap').addEventListener('change', applyWrapPreference);

  // synchronized scrolling between the two side-by-side panes
  (function () {
    var syncing = false;
    function sync(from, to) {
      from.addEventListener('scroll', function () {
        if (!$('opt-sync-scroll').checked || syncing) { return; }
        syncing = true;
        to.scrollTop = from.scrollTop;
        to.scrollLeft = from.scrollLeft;
        window.requestAnimationFrame(function () { syncing = false; });
      });
    }
    sync(paneLeft, paneRight);
    sync(paneRight, paneLeft);
  })();

  /* ===========================================================
     TAB 2 — JSON
     =========================================================== */

  var jsonInput = $('json-input');
  var jsonMessage = $('json-message');
  var jsonStatus = $('json-status');
  var statsTimer = null;

  function setBadge(el, state, text) {
    el.className = 'badge ' + (state === 'ok' ? 'badge-ok' : state === 'err' ? 'badge-err' : 'badge-neutral');
    el.textContent = text;
  }

  function showMessage(container, type, title, detailLines, previewLine, column) {
    container.textContent = '';
    container.className = 'message ' + (type === 'ok' ? 'msg-ok' : type === 'warn' ? 'msg-warn' : 'msg-err');
    var strong = document.createElement('strong');
    strong.textContent = title;
    container.appendChild(strong);
    if (detailLines && detailLines.length) {
      var ul = document.createElement('ul');
      detailLines.forEach(function (d) {
        var li = document.createElement('li');
        li.textContent = d;
        ul.appendChild(li);
      });
      container.appendChild(ul);
    }
    if (previewLine !== null && previewLine !== undefined) {
      var pre = document.createElement('pre');
      var text = previewLine;
      var caretCol = column || 1;
      // keep the preview short around the error column
      var start = 0;
      if (text.length > 120) {
        start = Math.max(0, caretCol - 60);
        text = (start > 0 ? '…' : '') + text.slice(start, start + 120);
        caretCol = caretCol - start + (start > 0 ? 1 : 0);
      }
      var caret = new Array(Math.max(1, caretCol)).join(' ') + '^';
      pre.appendChild(document.createTextNode(text + '\n' + caret));
      container.appendChild(pre);
    }
    container.hidden = false;
    announce(title);
  }

  function hideMessage(container) {
    container.hidden = true;
    container.textContent = '';
  }

  function updateJsonStats() {
    var s = DTB.textStats(jsonInput.value);
    $('json-stat-lines').textContent = String(s.lines);
    $('json-stat-chars').textContent = String(s.chars);
    $('json-stat-bytes').textContent = String(s.bytes);
  }

  jsonInput.addEventListener('input', function () {
    if (statsTimer) { window.clearTimeout(statsTimer); }
    statsTimer = window.setTimeout(updateJsonStats, 200);
    setBadge(jsonStatus, 'neutral', 'Awaiting validation');
  });

  function jsonErrorDetails(result) {
    var details = [];
    if (result.line !== null) {
      details.push('Line ' + result.line + (result.column !== null ? ', column ' + result.column : '') + '.');
    }
    details.push('Technical detail: ' + result.message);
    details.push('Remember: JSON does not allow comments, single quotes, unquoted keys or trailing commas.');
    return details;
  }

  function validateJsonUi() {
    var result = DTB.validateJson(jsonInput.value);
    updateJsonStats();
    if (result.ok) {
      setBadge(jsonStatus, 'ok', 'Valid JSON');
      showMessage(jsonMessage, 'ok', 'Valid JSON. No problems found.', null, null, null);
    } else {
      setBadge(jsonStatus, 'err', 'Invalid JSON');
      showMessage(jsonMessage, 'err', 'Invalid JSON.', jsonErrorDetails(result), result.previewLine, result.column);
    }
    return result.ok;
  }

  $('btn-json-validate').addEventListener('click', validateJsonUi);

  function formatJsonUi() {
    var result = DTB.formatJson(jsonInput.value, $('json-indent').value);
    if (result.ok) {
      jsonInput.value = result.text;
      updateJsonStats();
      setBadge(jsonStatus, 'ok', 'Valid JSON');
      hideMessage(jsonMessage);
      toast('JSON formatted.');
    } else {
      setBadge(jsonStatus, 'err', 'Invalid JSON');
      showMessage(jsonMessage, 'err', 'Could not format: the JSON is invalid. The content was not changed.',
        jsonErrorDetails(result), result.previewLine, result.column);
    }
  }

  $('btn-json-format').addEventListener('click', formatJsonUi);

  $('btn-json-minify').addEventListener('click', function () {
    var result = DTB.minifyJson(jsonInput.value);
    if (result.ok) {
      jsonInput.value = result.text;
      updateJsonStats();
      setBadge(jsonStatus, 'ok', 'Valid JSON');
      hideMessage(jsonMessage);
      toast('JSON minified.');
    } else {
      setBadge(jsonStatus, 'err', 'Invalid JSON');
      showMessage(jsonMessage, 'err', 'Could not minify: the JSON is invalid. The content was not changed.',
        jsonErrorDetails(result), result.previewLine, result.column);
    }
  });

  $('btn-json-copy').addEventListener('click', function () {
    copyText(jsonInput.value, 'JSON copied.');
  });

  $('btn-json-clear').addEventListener('click', function () {
    if (!confirmClear(jsonInput.value !== '', 'the JSON editor')) { return; }
    jsonInput.value = '';
    updateJsonStats();
    setBadge(jsonStatus, 'neutral', 'Awaiting validation');
    hideMessage(jsonMessage);
    announce('Editor cleared.');
  });

  $('btn-json-example').addEventListener('click', function () {
    if (!confirmClear(jsonInput.value !== '', 'the JSON editor')) { return; }
    jsonInput.value = JSON.stringify({
      customer: { name: 'João Antônio', age: 34, active: true, balance: 1234.56, note: null },
      orders: [
        { id: 1, items: ['café ☕', 'bread'], total: 18.9 },
        { id: 2, items: ['açaí'], total: 12.5 }
      ],
      address: { city: 'São Paulo', country: 'Brazil' }
    }, null, 2);
    updateJsonStats();
    setBadge(jsonStatus, 'neutral', 'Awaiting validation');
    hideMessage(jsonMessage);
    toast('Example loaded.');
  });

  $('btn-json-open').addEventListener('click', function () {
    openFileInto($('json-file'), jsonInput, function () {
      setBadge(jsonStatus, 'neutral', 'Awaiting validation');
      hideMessage(jsonMessage);
    });
  });

  $('btn-json-download').addEventListener('click', function () {
    if (jsonInput.value === '') {
      toast('Nothing to download.');
      return;
    }
    downloadText(jsonInput.value, 'document.json', 'application/json');
    toast('Download started.');
  });

  /* ===========================================================
     TAB 3 — JSON <-> YAML
     =========================================================== */

  var convJson = $('conv-json');
  var convYaml = $('conv-yaml');
  var convMessage = $('conv-message');

  function updateConvStats() {
    var sj = DTB.textStats(convJson.value);
    var sy = DTB.textStats(convYaml.value);
    $('conv-json-lines').textContent = String(sj.lines);
    $('conv-json-chars').textContent = String(sj.chars);
    $('conv-yaml-lines').textContent = String(sy.lines);
    $('conv-yaml-chars').textContent = String(sy.chars);
  }

  var convTimer = null;
  [convJson, convYaml].forEach(function (ta) {
    ta.addEventListener('input', function () {
      if (convTimer) { window.clearTimeout(convTimer); }
      convTimer = window.setTimeout(updateConvStats, 200);
    });
  });

  $('btn-j2y').addEventListener('click', function () {
    var result = DTB.jsonToYaml(convJson.value);
    if (result.ok) {
      convYaml.value = result.text;
      updateConvStats();
      showMessage(convMessage, 'ok', 'JSON → YAML conversion finished.', null, null, null);
    } else {
      // conversion failed: existing YAML is preserved
      showMessage(convMessage, 'err', 'The JSON is invalid — the existing YAML was not changed.',
        jsonErrorDetails(result), result.previewLine, result.column);
    }
  });

  function yamlErrorDetails(result) {
    var details = [];
    if (result.line !== null) {
      details.push('Line ' + result.line + (result.column !== null ? ', column ' + result.column : '') + '.');
    }
    details.push('Technical detail: ' + result.message);
    return details;
  }

  $('btn-y2j').addEventListener('click', function () {
    var result = DTB.yamlToJson(convYaml.value, $('conv-json-indent').value);
    if (result.ok) {
      convJson.value = result.text;
      updateConvStats();
      var warnings = result.warnings || [];
      if (warnings.length) {
        showMessage(convMessage, 'warn',
          'YAML → JSON conversion finished, with adaptations (YAML features with no direct JSON equivalent):',
          warnings, null, null);
      } else {
        showMessage(convMessage, 'ok', 'YAML → JSON conversion finished. YAML comments, if any, are not preserved.', null, null, null);
      }
    } else {
      // conversion failed: existing JSON is preserved
      showMessage(convMessage, 'err', 'The YAML is invalid — the existing JSON was not changed.',
        yamlErrorDetails(result), result.previewLine, result.column);
    }
  });

  $('btn-conv-swap').addEventListener('click', function () {
    var tmp = convJson.value;
    convJson.value = convYaml.value;
    convYaml.value = tmp;
    updateConvStats();
    toast('Contents swapped.');
  });

  $('btn-conv-clear').addEventListener('click', function () {
    if (!confirmClear(convJson.value !== '' || convYaml.value !== '', 'both panels')) { return; }
    convJson.value = '';
    convYaml.value = '';
    updateConvStats();
    hideMessage(convMessage);
    announce('Panels cleared.');
  });

  $('btn-conv-json-validate').addEventListener('click', function () {
    var result = DTB.validateJson(convJson.value);
    if (result.ok) {
      showMessage(convMessage, 'ok', 'The JSON is valid.', null, null, null);
    } else {
      showMessage(convMessage, 'err', 'The JSON is invalid.', jsonErrorDetails(result), result.previewLine, result.column);
    }
  });

  $('btn-conv-yaml-validate').addEventListener('click', function () {
    var result = DTB.validateYaml(convYaml.value);
    if (result.ok) {
      var warnings = result.warnings || [];
      if (warnings.length) {
        showMessage(convMessage, 'warn', 'The YAML is valid, but contains features with no direct JSON equivalent:', warnings, null, null);
      } else {
        showMessage(convMessage, 'ok', 'The YAML is valid.', null, null, null);
      }
    } else {
      showMessage(convMessage, 'err', 'The YAML is invalid.', yamlErrorDetails(result), result.previewLine, result.column);
    }
  });

  $('btn-conv-json-copy').addEventListener('click', function () {
    copyText(convJson.value, 'JSON copied.');
  });

  $('btn-conv-yaml-copy').addEventListener('click', function () {
    copyText(convYaml.value, 'YAML copied.');
  });

  $('btn-conv-json-open').addEventListener('click', function () {
    openFileInto($('conv-json-file'), convJson, updateConvStats);
  });

  $('btn-conv-yaml-open').addEventListener('click', function () {
    openFileInto($('conv-yaml-file'), convYaml, updateConvStats);
  });

  $('btn-conv-json-download').addEventListener('click', function () {
    if (convJson.value === '') { toast('Nothing to download.'); return; }
    downloadText(convJson.value, 'document.json', 'application/json');
    toast('Download started.');
  });

  $('btn-conv-yaml-download').addEventListener('click', function () {
    if (convYaml.value === '') { toast('Nothing to download.'); return; }
    downloadText(convYaml.value, 'document.yaml', 'application/yaml');
    toast('Download started.');
  });

  /* ===========================================================
     keyboard shortcuts
     =========================================================== */

  document.addEventListener('keydown', function (e) {
    var mod = e.ctrlKey || e.metaKey;
    if (!mod) { return; }

    if (e.key === 'Enter') {
      e.preventDefault();
      var tab = activeTabId();
      if (tab === 'tab-diff') {
        runCompare();
      } else if (tab === 'tab-json') {
        validateJsonUi();
      } else {
        // converter: direction follows the focused editor (YAML editor -> YAML→JSON)
        if (document.activeElement === convYaml) {
          $('btn-y2j').click();
        } else {
          $('btn-j2y').click();
        }
      }
    } else if (e.shiftKey && (e.key === 'F' || e.key === 'f')) {
      if (activeTabId() === 'tab-json') {
        e.preventDefault();
        formatJsonUi();
      }
    }
  });

  updateJsonStats();
  updateConvStats();
})();
