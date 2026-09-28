/**
 * import-expenses.js — powers import-expenses.html.
 *
 * Flow: upload a file -> parse rows client-side with SheetJS -> guess
 * each row's category (categories.js's guessCategory) -> render an
 * editable review table (flagging low-confidence guesses) -> on
 * confirm, bulk-submit everything through Api.submitExpensesBulk.
 *
 * Nothing is saved until the person clicks "Import All Rows" — parsing
 * and category-guessing are entirely client-side and non-destructive.
 */
(function () {
  let currentUser = null;
  let parsedRows = []; // working copy of rows currently in the review table

  const HEADER_CANDIDATES = {
    date: ['date'],
    category: ['category', 'title'],
    description: ['description', 'desc', 'particular', 'item', 'expense', 'detail'],
    amount: ['amount', 'amt', 'total', 'cost', 'price', 'value'],
    site: ['site', 'location'],
    vendor: ['vendor', 'supplier', 'payee'],
    payment: ['payment', 'mode of payment', 'pay method'],
    quantity: ['qty', 'quantity'],
    unit: ['unit']
  };

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

    Layout.build('import-expenses.html', currentUser);
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
    const aoa = [
      ['Date', 'Category', 'Description', 'Amount', 'Vendor', 'Payment Method', 'Quantity', 'Unit'],
      ['2026-07-24', 'Cement', '50 bags of cement', 425000, 'Dangote Depot', 'Transfer', 50, 'bags'],
      ['2026-07-24', 'Mason', 'Weekly wages', 60000, '', 'Cash', '', '']
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 12 }, { wch: 18 }, { wch: 28 }, { wch: 12 }, { wch: 18 }, { wch: 16 }, { wch: 10 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Expenses');
    XLSX.writeFile(wb, 'expense-import-template.xlsx');
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
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
        if (!aoa.length) { showToast('That file looks empty', 'error'); return; }

        const headers = aoa[0].map(h => String(h || '').trim());
        const colMap = detectColumns(headers);

        if (colMap.amount === -1 || (colMap.category === -1 && colMap.description === -1)) {
          showToast("Couldn't find an Amount column and a Category/Description column — check your headers", 'error');
          return;
        }

        const dataRows = aoa.slice(1).filter(r => r.some(c => c !== '' && c !== null && c !== undefined));
        parsedRows = dataRows.map(r => buildRow(r, colMap));
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
    const rawCategory = String(get('category') || '').trim();
    const rawDescription = String(get('description') || '').trim();
    const rawAmount = get('amount');
    const rawSite = String(get('site') || '').trim();
    const rawVendor = String(get('vendor') || '').trim();
    const rawPayment = String(get('payment') || '').trim();
    const rawQty = get('quantity');
    const rawUnit = String(get('unit') || '').trim();

    const guess = guessForRow(rawCategory, rawDescription);

    return {
      date: normalizeDate(rawDate),
      site: rawSite,
      category: guess.category,
      confidence: guess.confidence,
      description: rawDescription || rawCategory,
      amount: Number(rawAmount) || 0,
      vendor: rawVendor,
      payment: rawPayment || 'Cash',
      quantity: rawQty || '',
      unit: rawUnit
    };
  }

  function guessForRow(categoryText, descriptionText) {
    if (categoryText) {
      const exact = CATEGORY_FLAT.find(c => c.toLowerCase() === categoryText.trim().toLowerCase());
      if (exact) return { category: exact, confidence: 'exact' };
    }
    const combined = [categoryText, descriptionText].filter(Boolean).join(' ');
    return guessCategory(combined);
  }

  function normalizeDate(val) {
    const today = new Date();
    const pad = (n) => String(n).padStart(2, '0');

    if (val instanceof Date && !isNaN(val)) {
      // cellDates:true gives a JS Date already anchored to the right
      // calendar day — read its UTC parts back out (SheetJS builds
      // these from the serial number in UTC, so UTC getters, not
      // local ones, are what avoid an off-by-one shift here).
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
        <td><input type="text" data-field="description" data-idx="${i}" value="${escapeAttr(row.description)}" style="min-width:180px;"></td>
        <td><input type="number" data-field="amount" data-idx="${i}" value="${row.amount}" style="min-width:100px;"></td>
        <td><input type="text" data-field="vendor" data-idx="${i}" value="${escapeAttr(row.vendor)}" style="min-width:120px;"></td>
        <td>
          <select data-field="payment" data-idx="${i}" style="min-width:110px;">
            <option${row.payment === 'Cash' ? ' selected' : ''}>Cash</option>
            <option${row.payment === 'Bank Transfer' || row.payment === 'Transfer' ? ' selected' : ''}>Bank Transfer</option>
            <option${row.payment === 'POS' ? ' selected' : ''}>POS</option>
            <option${row.payment === 'Cheque' ? ' selected' : ''}>Cheque</option>
            <option${row.payment === 'Other' ? ' selected' : ''}>Other</option>
          </select>
        </td>
      `;
      tr.querySelector('.cat-cell').appendChild(catSelect);
      tbody.appendChild(tr);
    });

    // Wire live edits back into parsedRows so the final submit uses
    // whatever's on screen, including any corrections made here.
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
    // Re-sync from the DOM one more time in case of any last edits
    // that didn't fire a change event (e.g. select left open).
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
      quantity: r.quantity,
      unit: r.unit,
      amount: Number(r.amount) || 0,
      vendor: r.vendor,
      paymentMethod: r.payment
    }));

    if (expenses.some(e => !e.amount)) {
      showToast('Every row needs a non-zero amount', 'error');
      return;
    }

    // Sent in chunks rather than one call for the whole file: a write
    // action is transmitted as a GET with the entire JSON body packed
    // into a single URL query parameter (see api.js), and Apps Script's
    // script.googleusercontent.com/macros/echo redirect has a hard size
    // limit on that URL. A full import of hundreds of rows in one call
    // exceeds it and fails with net::ERR_FAILED 400; batches of
    // CHUNK_SIZE stay comfortably under it.
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
      showToast(`Imported ${imported} expenses successfully`, 'success');
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
