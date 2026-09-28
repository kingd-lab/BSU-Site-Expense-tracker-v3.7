/**
 * import-excavation.js — powers import-excavation.html.
 *
 * "Excavation" here means the same thing it means everywhere else in the
 * app (see categories.js): Excavation of Trenches (pure digging) PLUS
 * Concrete Works (casting — column base, trenches casting, slab, etc.).
 * Both groups still land as normal rows in the Expenses sheet; this page
 * is just a faster way to get a day's worth of them in at once from the
 * site team's own daily log format instead of typing each line into Add
 * Expense.
 *
 * That daily log format repeats a small block per day:
 *   Date | Description | Qty (or Cubic/Bags) | Rate (N) | Amount (N)
 *   ... one or more rows ...
 *   DAY TOTAL | | | | <sum>
 *   <blank row>
 * ...and every tab in the workbook (Trenches, Column Base, etc.) is
 * scanned for as many of those blocks as it contains. A plain flat
 * table (Date/Description/Amount columns, one row per line item) is
 * also accepted, so a simpler sheet still imports fine.
 *
 * Flow mirrors import-expenses.js: parse client-side -> guess each
 * row's category with categories.js's guessCategory -> editable review
 * table -> bulk submit through Api.submitExpensesBulk. Nothing is saved
 * until "Import All Rows" is clicked.
 */
(function () {
  let currentUser = null;
  let parsedRows = []; // working copy of rows currently in the review table

  function showToast(msg, type) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show' + (type ? ' ' + type : '');
    setTimeout(() => t.classList.remove('show'), 3200);
  }

  function money(n) {
    return '₦' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  async function init() {
    currentUser = await Auth.requireRole(['Admin', 'Site Manager']);
    if (!currentUser) return;

    Layout.build('import-excavation.html', currentUser);
    Layout.mainMount().innerHTML = document.getElementById('pageContent').innerHTML;
    document.getElementById('menuBtn')?.addEventListener('click', Layout.toggleSidebar);

    await populateSiteField();
    document.getElementById('fileInput').addEventListener('change', onFileSelected);
    document.getElementById('downloadTemplateBtn').addEventListener('click', downloadTemplate);
    document.getElementById('cancelImportBtn').addEventListener('click', resetToUpload);
    document.getElementById('confirmImportBtn').addEventListener('click', onConfirmImport);
  }

  async function populateSiteField() {
    const field = document.getElementById('importSiteField');
    if (currentUser.role === 'Admin') {
      try {
        const data = await Api.getSites();
        const select = document.getElementById('importSite');
        (data.sites || []).map(s => s['Site Name']).filter(Boolean).sort().forEach(name => {
          const opt = document.createElement('option');
          opt.value = name; opt.textContent = name;
          select.appendChild(opt);
        });
      } catch (err) {
        showToast(err.message, 'error');
      }
    } else {
      field.innerHTML = `<label>Site</label><input type="text" value="${currentUser.site}" disabled>`;
    }
  }

  function downloadTemplate() {
    const wb = XLSX.utils.book_new();
    const trenches = [
      ['TRENCHES CONCRETE — DAILY LOG', '', '', '', ''],
      ['', '', '', '', ''],
      ['', 'EXCAVATION OF TRENCHES', '', '', ''],
      ['', 'Date', 'Description', 'Qty', 'Rate (N)', 'Amount (N)'],
      ['', '2026-07-24', 'Trenches excavation', 56, 3500, 196000],
      ['', 'DAY TOTAL', '', '', '', 196000],
      ['', '', '', '', ''],
      ['', 'Date', 'Description', 'Qty', 'Rate (N)', 'Amount (N)'],
      ['', '2026-07-24', 'Trenches casting (4.1cum)', 23, 2000, 46000],
      ['', 'DAY TOTAL', '', '', '', 46000]
    ];
    const ws = XLSX.utils.aoa_to_sheet(trenches);
    ws['!cols'] = [{ wch: 4 }, { wch: 24 }, { wch: 26 }, { wch: 10 }, { wch: 10 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Trenches');
    XLSX.writeFile(wb, 'excavation-import-template.xlsx');
  }

  // ---------------------------------------------------------------
  // File parsing
  // ---------------------------------------------------------------

  function onFileSelected(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const wb = XLSX.read(data, { type: 'array', cellDates: true });

        // If the workbook has several tabs (e.g. the full daily & monthly
        // report), only scan the ones that are plausibly excavation/concrete
        // work — otherwise a Salary, Materials, or Block Setting tab would
        // get pulled in as excavation expenses too. A single-sheet file is
        // always scanned, since that's clearly the one meant for this import.
        const SHEET_NAME_HINT = /trench|column|concrete|excavat/i;
        let rows = [];
        wb.SheetNames.forEach(sheetName => {
          if (wb.SheetNames.length > 1 && !SHEET_NAME_HINT.test(sheetName)) return;
          const ws = wb.Sheets[sheetName];
          const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
          rows = rows.concat(parseSheet(aoa, sheetName));
        });

        if (!rows.length) {
          showToast("Couldn't find any day-log blocks or a Date/Description/Amount table in that file", 'error');
          return;
        }

        parsedRows = rows;
        renderReview();
      } catch (err) {
        showToast('Could not read that file: ' + err.message, 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  /**
   * Scans one sheet (as an array-of-arrays) for repeating
   * Date/Description/.../Rate/Amount day-blocks, and falls back to
   * treating the whole sheet as one flat table if no block header is
   * found anywhere in it.
   */
  function parseSheet(aoa, sheetName) {
    const results = [];
    let foundAnyBlock = false;

    for (let i = 0; i < aoa.length; i++) {
      const header = detectBlockHeader(aoa[i]);
      if (!header) continue;
      foundAnyBlock = true;

      let j = i + 1;
      while (j < aoa.length) {
        const row = aoa[j];
        if (isBlankRow(row)) { j++; continue; }
        if (detectBlockHeader(row)) break; // next block starts immediately, no trailing blank

        const descRaw = String(row[header.descCol] ?? '').trim();
        if (/^day total$/i.test(descRaw)) { j++; continue; }

        const dateVal = row[header.dateCol];
        // Amount cells are often formulas (=Qty*Rate). If the file was saved
        // by a tool that doesn't store calculated results, the cell reads as
        // empty here, so rebuild the amount from Qty x Rate instead of 0.
        let amount = toNumber(row[header.amountCol]);
        if (!amount && header.rateCol !== -1) {
          const rate = toNumber(row[header.rateCol]);
          const qtyRaw = header.qtyCol !== -1 ? toNumber(row[header.qtyCol]) : 0;
          amount = rate * (qtyRaw || 1);
        }
        if (dateVal !== '' && dateVal !== null && dateVal !== undefined && descRaw) {
          const specParts = [];
          header.specCols.forEach(sc => {
            const v = row[sc.col];
            if (v !== '' && v !== null && v !== undefined) specParts.push(`${sc.label}: ${v}`);
          });
          const description = specParts.length ? `${descRaw} (${specParts.join(', ')})` : descRaw;
          results.push(buildRow(dateVal, description, amount, sheetName));
        }
        j++;
      }
      i = j - 1; // resume scanning right after this block
    }

    if (!foundAnyBlock) {
      results.push(...parseFlatTable(aoa, sheetName));
    }

    return results;
  }

  /**
   * A block header row has a "Date" cell and an "Amount"-ish cell, with
   * a "Description"-ish cell in between (any number of Qty/Cubic/Bags
   * style spec columns are allowed between description and rate).
   */
  function detectBlockHeader(row) {
    if (!row || !row.length) return null;
    const lower = row.map(c => String(c || '').trim().toLowerCase());
    const dateCol = lower.findIndex(c => c === 'date');
    if (dateCol === -1) return null;
    const descCol = lower.findIndex((c, idx) => idx > dateCol && c.indexOf('description') !== -1);
    if (descCol === -1) return null;
    const amountCol = lower.findIndex((c, idx) => idx > descCol && c.indexOf('amount') !== -1);
    if (amountCol === -1) return null;
    const rateCol = lower.findIndex((c, idx) => idx > descCol && idx < amountCol && c.indexOf('rate') !== -1);

    const specCols = [];
    for (let c = descCol + 1; c < amountCol; c++) {
      if (c === rateCol) continue;
      if (!lower[c]) continue;
      specCols.push({ col: c, label: row[c] });
    }
    const qtyCol = lower.findIndex((c, idx) => idx > descCol && idx < amountCol && /^(qty|quantity)/.test(c));
    return { dateCol, descCol, amountCol, rateCol, qtyCol, specCols };
  }

  function toNumber(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const n = Number(String(v ?? '').replace(/[₦,\s]/g, ''));
    return isFinite(n) ? n : 0;
  }

  function isBlankRow(row) {
    return !row || row.every(c => c === '' || c === null || c === undefined);
  }

  /** Fallback for a sheet with no recognizable day-block: treat row 1 as headers, like Import Expenses. */
  function parseFlatTable(aoa, sheetName) {
    if (!aoa.length) return [];
    const headers = aoa[0].map(h => String(h || '').trim().toLowerCase());
    const dateCol = headers.findIndex(h => h.indexOf('date') !== -1);
    const descCol = headers.findIndex(h => h.indexOf('description') !== -1 || h.indexOf('particular') !== -1 || h.indexOf('item') !== -1);
    const amountCol = headers.findIndex(h => h.indexOf('amount') !== -1 || h.indexOf('cost') !== -1 || h.indexOf('total') !== -1);
    if (dateCol === -1 || descCol === -1 || amountCol === -1) return [];

    const out = [];
    aoa.slice(1).forEach(row => {
      if (isBlankRow(row)) return;
      const descRaw = String(row[descCol] ?? '').trim();
      if (/^day total$/i.test(descRaw) || !descRaw) return;
      const amount = Number(row[amountCol]) || 0;
      const dateVal = row[dateCol];
      if (dateVal === '' || dateVal === null || dateVal === undefined) return;
      out.push(buildRow(dateVal, descRaw, amount, sheetName));
    });
    return out;
  }

  function buildRow(dateVal, description, amount, sheetName) {
    const guess = guessForRow(description, sheetName);
    const date = normalizeDate(dateVal);
    // A mistyped date like "9/25/206" parses as year 206 — flag the row
    // amber so it gets fixed in the review table instead of importing.
    const year = Number(date.slice(0, 4));
    const badDate = year < 2020 || year > 2100;
    return {
      date,
      site: '',
      category: guess.category,
      confidence: badDate ? 'none' : guess.confidence,
      description,
      amount
    };
  }

  function guessForRow(descriptionText, sheetName) {
    const guess = guessCategory(descriptionText);
    if (guess.confidence !== 'none') return guess;
    // No hit on the description alone — try the sheet/tab name as a
    // last resort (e.g. a "Column Base" tab with terse row text).
    return guessCategory(sheetName);
  }

  function normalizeDate(val) {
    const today = new Date();
    const pad = (n) => String(n).padStart(2, '0');

    if (val instanceof Date && !isNaN(val)) {
      return `${val.getUTCFullYear()}-${pad(val.getUTCMonth() + 1)}-${pad(val.getUTCDate())}`;
    }
    if (typeof val === 'string' && val.trim()) {
      const m = val.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      const d = new Date(val);
      if (!isNaN(d)) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
    return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  }

  // ---------------------------------------------------------------
  // Review table
  // ---------------------------------------------------------------

  function renderReview() {
    document.getElementById('uploadCard').style.display = 'none';
    document.getElementById('reviewCard').style.display = 'block';

    const flaggedCount = parsedRows.filter(r => r.confidence !== 'exact' && r.confidence !== 'keyword').length;
    const matchedCount = parsedRows.length - flaggedCount;
    const total = parsedRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

    document.getElementById('statRows').textContent = parsedRows.length;
    document.getElementById('statMatched').textContent = matchedCount;
    document.getElementById('statFlagged').textContent = flaggedCount;
    document.getElementById('statTotal').textContent = money(total);

    const tbody = document.getElementById('reviewRows');
    tbody.innerHTML = '';

    parsedRows.forEach((row, i) => {
      const tr = document.createElement('tr');
      if (row.confidence !== 'exact' && row.confidence !== 'keyword') {
        tr.style.background = '#FFF8EC';
      }

      const catSelect = buildCategorySelect(row.category);

      tr.innerHTML = `
        <td>${row.confidence === 'exact' || row.confidence === 'keyword'
          ? '<svg class="ico" style="color:#0A7A48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
          : '<svg class="ico" style="color:#DD9827" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 2 21h20L12 2z"/><path d="M12 9v5M12 17h.01"/></svg>'}
        </td>
        <td><input type="date" data-field="date" data-idx="${i}" value="${row.date}" style="min-width:130px;"></td>
        <td><input type="text" data-field="site" data-idx="${i}" value="${row.site || currentSiteDefault()}" style="min-width:100px;" placeholder="Site"></td>
        <td class="cat-cell"></td>
        <td><input type="text" data-field="description" data-idx="${i}" value="${escapeAttr(row.description)}" style="min-width:220px;"></td>
        <td><input type="number" data-field="amount" data-idx="${i}" value="${row.amount}" style="min-width:100px;"></td>
      `;
      tr.querySelector('.cat-cell').appendChild(catSelect);
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('input, select').forEach(el => {
      el.addEventListener('input', onCellEdit);
      el.addEventListener('change', onCellEdit);
    });
  }

  function onCellEdit(e) {
    const idx = Number(e.target.dataset.idx);
    const field = e.target.dataset.field;
    if (Number.isNaN(idx) || !field) return;
    parsedRows[idx][field] = e.target.value;
    if (field === 'category') parsedRows[idx].confidence = 'manual';
  }

  function buildCategorySelect(selected) {
    const select = document.createElement('select');
    select.dataset.field = 'category';
    select.style.minWidth = '190px';
    let html = '';
    Object.keys(CATEGORY_GROUPS).forEach(group => {
      html += `<optgroup label="${group}">`;
      CATEGORY_GROUPS[group].forEach(c => {
        html += `<option value="${c}"${c === selected ? ' selected' : ''}>${c}</option>`;
      });
      html += `</optgroup>`;
    });
    select.innerHTML = html;
    return select;
  }

  function currentSiteDefault() {
    return currentUser.role === 'Admin'
      ? (document.getElementById('importSite').value || '')
      : currentUser.site;
  }

  function escapeAttr(s) {
    return String(s || '').replace(/"/g, '&quot;');
  }

  function resetToUpload() {
    parsedRows = [];
    document.getElementById('fileInput').value = '';
    document.getElementById('reviewCard').style.display = 'none';
    document.getElementById('uploadCard').style.display = 'block';
  }

  // ---------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------

  async function onConfirmImport() {
    const tbody = document.getElementById('reviewRows');
    tbody.querySelectorAll('select[data-field="category"]').forEach((sel, i) => {
      parsedRows[i].category = sel.value;
    });

    const defaultSite = currentUser.role === 'Admin' ? document.getElementById('importSite').value : currentUser.site;
    if (currentUser.role === 'Admin' && !defaultSite && parsedRows.some(r => !r.site)) {
      showToast('Select a site above, or make sure every row has its own Site value', 'error');
      return;
    }

    const expenses = parsedRows.map(r => ({
      date: r.date,
      site: r.site || defaultSite,
      category: r.category,
      description: r.description,
      quantity: '',
      unit: '',
      amount: Number(r.amount) || 0,
      vendor: '',
      paymentMethod: 'Cash'
    })).filter(e => e.amount > 0);

    if (!expenses.length) {
      showToast('Every row needs a non-zero amount', 'error');
      return;
    }

    // Sent in chunks, same reasoning as Import Expenses: a write action
    // goes through as a GET with the whole JSON body in one URL query
    // parameter, and the Apps Script redirect has a hard size limit on
    // that URL, so batches keep well under it.
    const CHUNK_SIZE = 30;
    const btn = document.getElementById('confirmImportBtn');
    btn.disabled = true;
    let imported = 0;
    try {
      for (let i = 0; i < expenses.length; i += CHUNK_SIZE) {
        const chunk = expenses.slice(i, i + CHUNK_SIZE);
        btn.textContent = `Importing ${Math.min(i + CHUNK_SIZE, expenses.length)}/${expenses.length}…`;
        const result = await Api.submitExpensesBulk(chunk);
        imported += result.count;
      }
      showToast(`Imported ${imported} excavation/concrete works expenses successfully`, 'success');
      resetToUpload();
    } catch (err) {
      showToast(
        imported > 0
          ? `Imported ${imported} of ${expenses.length} before failing: ${err.message}`
          : err.message,
        'error'
      );
    } finally {
      btn.disabled = false; btn.textContent = 'Import All Rows';
    }
  }

  init();
})();
