/**
 * import-cash-book.js — powers import-cash-book.html.
 *
 * One-off tool for bringing a historical Cash Book (e.g. the 424-row
 * template) into the app without re-typing every line through
 * cash-book.html's single-entry form.
 *
 * Flow: upload a file -> parse rows client-side with SheetJS, in file
 * order -> guess a category for every Money Out line (same
 * guessCategory used live on cash-book.html) -> render an editable
 * review table, including a running balance computed the same way the
 * backend computes it -> on confirm, submit through
 * Api.addCashBookEntriesBulk in small sequential batches (NOT all 424
 * at once) so a single slow Apps Script execution can't time out and
 * silently drop the back half of the file.
 *
 * ORDER IS EVERYTHING. Cash Book balance is a running total computed
 * top-to-bottom from row order, not sorted by date (see the note in
 * cash-book.js / Code.gs — several undated rows can follow one dated
 * row as part of that day's batch). This file:
 *   - never sorts parsedRows,
 *   - submits batches strictly in sequence (awaiting each one before
 *     starting the next), and
 *   - if a batch fails partway through, stops immediately rather than
 *     continuing on to later rows out of order, and offers a "Resume"
 *     button that continues from exactly the next row instead of
 *     restarting (restarting would duplicate every row already
 *     successfully posted).
 *
 * Nothing is saved until "Import All Rows in Order" is clicked —
 * parsing, category-guessing and the balance preview are entirely
 * client-side and non-destructive.
 */
(function () {
  const BATCH_SIZE = 40; // small enough that one Apps Script call finishes comfortably inside its execution limit

  let currentUser = null;
  let parsedRows = [];   // working copy of rows currently in the review table, in file order — never reordered
  let nextIndex = 0;      // how many rows (from the start of parsedRows) have been successfully submitted so far

  const HEADER_CANDIDATES = {
    date: ['date'],
    description: ['description', 'desc', 'particular', 'narration', 'detail', 'item'],
    moneyOut: ['money out', 'moneyout', 'debit', 'withdrawal', 'out', 'expense', 'payment'],
    moneyIn: ['money in', 'moneyin', 'credit', 'deposit', 'in', 'receipt'],
    site: ['site', 'location']
  };

  function showToast(msg, type) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show' + (type ? ' ' + type : '');
    setTimeout(() => t.classList.remove('show'), 3200);
  }

  function money(n) {
    return '\u20a6' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  async function init() {
    currentUser = await Auth.requireRole(['Admin']);
    if (!currentUser) return;

    Layout.build('import-cash-book.html', currentUser);
    Layout.mainMount().innerHTML = document.getElementById('pageContent').innerHTML;
    document.getElementById('menuBtn')?.addEventListener('click', Layout.toggleSidebar);

    await populateSiteField();
    document.getElementById('fileInput').addEventListener('change', onFileSelected);
    document.getElementById('downloadTemplateBtn').addEventListener('click', downloadTemplate);
    document.getElementById('cancelImportBtn').addEventListener('click', resetToUpload);
    document.getElementById('confirmImportBtn').addEventListener('click', () => submitFrom(0));
  }

  async function populateSiteField() {
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
  }

  function downloadTemplate() {
    const wb = XLSX.utils.book_new();
    const aoa = [
      ['Date', 'Description', 'Money Out', 'Money In', 'Site'],
      ['2026-07-24', 'Opening balance from Ilesanmi', '', 500000, 'ALL'],
      ['2026-07-24', 'Fuel for generator', 5000, '', 'ALL'],
      ['', 'Mason weekly wages', 60000, '', 'ALL']
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws, 'CashBook');
    XLSX.writeFile(wb, 'cash-book-import-template.xlsx');
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
        const ws = wb.Sheets[wb.SheetNames[0]];
        // sheet_to_json with header:1 preserves the file's row order exactly — critical, see file header note.
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
        if (!aoa.length) { showToast('That file looks empty', 'error'); return; }

        const headers = aoa[0].map(h => String(h || '').trim());
        const colMap = detectColumns(headers);

        if (colMap.description === -1 || (colMap.moneyOut === -1 && colMap.moneyIn === -1)) {
          showToast("Couldn't find a Description column and a Money Out/Money In column — check your headers", 'error');
          return;
        }

        const dataRows = aoa.slice(1).filter(r => r.some(c => c !== '' && c !== null && c !== undefined));
        parsedRows = dataRows.map(r => buildRow(r, colMap));
        nextIndex = 0;
        renderReview();
      } catch (err) {
        showToast('Could not read that file: ' + err.message, 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function detectColumns(headers) {
    const lower = headers.map(h => h.toLowerCase());
    const map = {};
    Object.keys(HEADER_CANDIDATES).forEach(field => {
      map[field] = -1;
      for (const candidate of HEADER_CANDIDATES[field]) {
        const idx = lower.findIndex(h => h.indexOf(candidate) !== -1);
        if (idx !== -1) { map[field] = idx; break; }
      }
    });
    return map;
  }

  function buildRow(r, colMap) {
    const get = (field) => (colMap[field] !== -1 ? r[colMap[field]] : '');

    const rawDate = get('date');
    const rawDescription = String(get('description') || '').trim();
    const moneyOut = Number(get('moneyOut')) || 0;
    const moneyIn = Number(get('moneyIn')) || 0;
    const rawSite = String(get('site') || '').trim();

    let category = '', confidence = 'n/a';
    if (moneyOut > 0) {
      const guess = guessCategory(rawDescription);
      category = guess.category;
      confidence = guess.confidence;
    }

    return {
      date: normalizeDate(rawDate),
      site: rawSite,
      description: rawDescription,
      moneyOut: moneyOut,
      moneyIn: moneyIn,
      category: category,
      confidence: confidence
    };
  }

  function normalizeDate(val) {
    const pad = (n) => String(n).padStart(2, '0');

    if (val instanceof Date && !isNaN(val)) {
      // cellDates:true gives a JS Date anchored to the right calendar day —
      // read its UTC parts back out (SheetJS builds these from the serial
      // number in UTC), same approach as import-expenses.js, to avoid an
      // off-by-one shift.
      return `${val.getUTCFullYear()}-${pad(val.getUTCMonth() + 1)}-${pad(val.getUTCDate())}`;
    }
    if (typeof val === 'string' && val.trim()) {
      const m = val.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      const d = new Date(val);
      if (!isNaN(d)) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
    // Cash Book intentionally allows a blank date — several undated rows
    // can follow one dated row as part of that day's batch (see file
    // header note). Leave it blank rather than defaulting to today, which
    // would misrepresent when the spend actually happened.
    return '';
  }

  // ---------------------------------------------------------------
  // Review table
  // ---------------------------------------------------------------

  function renderReview() {
    document.getElementById('uploadCard').style.display = 'none';
    document.getElementById('progressCard').style.display = 'none';
    document.getElementById('reviewCard').style.display = 'block';

    const flaggedCount = parsedRows.filter(r => r.moneyOut > 0 && r.confidence !== 'keyword').length;
    const matchedCount = parsedRows.filter(r => r.moneyOut > 0).length - flaggedCount;

    let running = 0;
    parsedRows.forEach(r => { running += (r.moneyIn - r.moneyOut); r._runningBalance = running; });

    document.getElementById('statRows').textContent = parsedRows.length;
    document.getElementById('statMatched').textContent = matchedCount;
    document.getElementById('statFlagged').textContent = flaggedCount;
    document.getElementById('statBalance').textContent = money(running);

    const tbody = document.getElementById('reviewRows');
    tbody.innerHTML = '';

    parsedRows.forEach((row, i) => {
      const tr = document.createElement('tr');
      const needsReview = row.moneyOut > 0 && row.confidence !== 'keyword';
      if (needsReview) tr.style.background = '#FFF8EC';

      const catCell = document.createElement('td');
      if (row.moneyOut > 0) {
        catCell.appendChild(buildCategorySelect(row.category, i));
      } else {
        catCell.textContent = '\u2014';
      }

      tr.innerHTML = `
        <td>${!needsReview
          ? '<svg class="ico" style="color:#0A7A48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
          : '<svg class="ico" style="color:#DD9827" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 2 21h20L12 2z"/><path d="M12 9v5M12 17h.01"/></svg>'}
        </td>
        <td>${i + 1}</td>
        <td><input type="date" data-field="date" data-idx="${i}" value="${row.date}" style="min-width:130px;"></td>
        <td><input type="text" data-field="site" data-idx="${i}" value="${escapeAttr(row.site)}" style="min-width:90px;" placeholder="Site"></td>
        <td><input type="text" data-field="description" data-idx="${i}" value="${escapeAttr(row.description)}" style="min-width:200px;"></td>
        <td class="cat-cell"></td>
        <td><input type="number" data-field="moneyOut" data-idx="${i}" value="${row.moneyOut || ''}" style="min-width:100px;"></td>
        <td><input type="number" data-field="moneyIn" data-idx="${i}" value="${row.moneyIn || ''}" style="min-width:100px;"></td>
        <td style="white-space:nowrap;"><strong>${money(row._runningBalance)}</strong></td>
      `;
      tr.querySelector('.cat-cell').replaceWith(catCell);
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

    if (field === 'moneyOut' || field === 'moneyIn') {
      parsedRows[idx][field] = Number(e.target.value) || 0;
    } else {
      parsedRows[idx][field] = e.target.value;
    }
    if (field === 'category') parsedRows[idx].confidence = 'manual';
    // Amounts changed — recompute the running balance column and re-render.
    if (field === 'moneyOut' || field === 'moneyIn') renderReview();
  }

  function buildCategorySelect(selected, idx) {
    const select = document.createElement('select');
    select.dataset.field = 'category';
    select.dataset.idx = String(idx);
    select.style.minWidth = '170px';
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

  function escapeAttr(s) {
    return String(s || '').replace(/"/g, '&quot;');
  }

  function resetToUpload() {
    parsedRows = [];
    nextIndex = 0;
    document.getElementById('fileInput').value = '';
    document.getElementById('reviewCard').style.display = 'none';
    document.getElementById('progressCard').style.display = 'none';
    document.getElementById('uploadCard').style.display = 'block';
  }

  // ---------------------------------------------------------------
  // Submit — small sequential batches, resumable on failure
  // ---------------------------------------------------------------

  function rowToEntry(r) {
    return {
      date: r.date,
      description: r.description,
      moneyOut: r.moneyOut,
      moneyIn: r.moneyIn,
      category: r.category,
      site: r.site || 'ALL'
    };
  }

  async function submitFrom(startIndex) {
    if (!parsedRows.length) return;

    if (startIndex === 0) {
      const badRow = parsedRows.findIndex(r => !r.description || (!r.moneyOut && !r.moneyIn));
      if (badRow !== -1) {
        showToast(`Row ${badRow + 1} needs a description and an amount in Money Out or Money In`, 'error');
        return;
      }
    }

    document.getElementById('reviewCard').style.display = 'none';
    document.getElementById('progressCard').style.display = 'block';
    document.getElementById('confirmImportBtn').disabled = true;

    const bar = document.getElementById('progressBar');
    const text = document.getElementById('progressText');
    const total = parsedRows.length;

    let i = startIndex;
    try {
      while (i < total) {
        const batch = parsedRows.slice(i, i + BATCH_SIZE).map(rowToEntry);
        text.textContent = `Importing rows ${i + 1}\u2013${i + batch.length} of ${total} (in file order)\u2026`;
        await Api.addCashBookEntriesBulk(batch);
        i += batch.length;
        nextIndex = i;
        bar.style.width = Math.round((i / total) * 100) + '%';
      }
      text.textContent = `Done — ${total} rows imported.`;
      showToast(`Imported ${total} Cash Book entries`, 'success');
      setTimeout(resetToUpload, 1500);
    } catch (err) {
      // Stop immediately — do NOT continue to later batches out of order.
      // The rows before index i are already posted; retrying from 0 would
      // duplicate them. Offer a Resume button that continues from exactly
      // where this stopped.
      text.innerHTML = `Stopped at row ${i + 1} of ${total}: ${err.message}<br><br>
        Rows 1\u2013${i} were already imported successfully — do not re-run from the start, or they'll be duplicated.`;
      document.getElementById('confirmImportBtn').disabled = false;

      let resumeBtn = document.getElementById('resumeImportBtn');
      if (!resumeBtn) {
        resumeBtn = document.createElement('button');
        resumeBtn.id = 'resumeImportBtn';
        resumeBtn.className = 'btn btn-primary';
        resumeBtn.style.marginTop = '14px';
        document.getElementById('progressCard').appendChild(resumeBtn);
      }
      resumeBtn.textContent = `Resume from row ${i + 1}`;
      resumeBtn.onclick = () => submitFrom(i);
    }
  }

  init();
})();
