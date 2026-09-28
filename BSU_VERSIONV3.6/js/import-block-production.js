/**
 * import-block-production.js — powers import-block-production.html.
 *
 * Built for the "Project Manager Block Production Sheet" layout: one row
 * per day, with Date / Cement Bags / Blocks Produced / Usman Rate per
 * Block / Labour Rate per Bag / Sharp Sand qty+rate+amount / Plaster
 * Sand qty+rate+amount. That's the same data block-production.html's
 * "Log Today's Production" form and "Other Block Production Expenses"
 * form (Section A/B) collect one day at a time — this page just lets a
 * whole sheet of days go in at once.
 *
 * Each row with cement/blocks becomes a Section A entry through
 * Api.addBlockProduction (which — same as using the form — auto-posts
 * the day's labour cost to Expenses under "Block Moulding Labour").
 * Sharp Sand / Plaster Sand amounts on the same row become their own
 * Expenses rows (Section B) through Api.submitExpensesBulk.
 *
 * Nothing is saved until "Import All Rows" is clicked.
 */
(function () {
  let currentUser = null;
  let parsedRows = [];

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

    Layout.build('import-block-production.html', currentUser);
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
      ['PROJECT MANAGER BLOCK PRODUCTION SHEET'],
      ['Usman labour = Blocks Produced × ₦100. Labour = Cement Bags × ₦2,900. Other costs calculate automatically.'],
      [],
      ['Date', 'Cement Bags', 'Blocks Produced', 'Usman Rate/Block', 'Usman Amount', 'Labour Rate/Bag', 'Labour Amount',
        'Sharp Sand Qty/Trips', 'Sharp Sand Rate', 'Sharp Sand Amount',
        'Plaster Sand Qty/Trips', 'Plaster Sand Rate', 'Plaster Sand Amount', 'Total Cost / Balance'],
      ['2026-07-24', 25, 856, 100, 85600, 2900, 72500, 2, 15000, 30000, 1, 18000, 18000, '']
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = Array(14).fill({ wch: 15 });
    XLSX.utils.book_append_sheet(wb, ws, 'Project Manager');
    XLSX.writeFile(wb, 'block-production-import-template.xlsx');
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

        // Exact-cell match (not indexOf) so a descriptive sentence like
        // "Labour = Cement Bags × ₦2,900" above the real header row —
        // which also happens to contain both phrases — isn't mistaken
        // for the header itself.
        const headerIdx = aoa.findIndex(row => {
          const cells = row.map(c => String(c || '').trim().toLowerCase());
          return cells.some(c => c === 'cement bags') && cells.some(c => c === 'blocks produced');
        });
        if (headerIdx === -1) {
          showToast("Couldn't find the header row — expected columns like Cement Bags and Blocks Produced", 'error');
          return;
        }

        const cols = mapColumns(aoa[headerIdx]);
        const rows = [];
        for (let i = headerIdx + 1; i < aoa.length; i++) {
          const row = aoa[i];
          const dateVal = row[cols.date];
          if (dateVal === '' || dateVal === null || dateVal === undefined) continue;

          const cementBags = Number(row[cols.cement]) || 0;
          const blocksProduced = Number(row[cols.blocks]) || 0;
          const usmanRate = num(row[cols.usmanRate], 100);
          const labourRate = num(row[cols.labourRate], 2900);
          const sharpQty = row[cols.sharpQty] !== '' ? row[cols.sharpQty] : '';
          const sharpRate = Number(row[cols.sharpRate]) || 0;
          const sharpAmount = row[cols.sharpAmount] !== '' && row[cols.sharpAmount] !== null
            ? Number(row[cols.sharpAmount]) || 0
            : (Number(sharpQty) && sharpRate ? Number(sharpQty) * sharpRate : 0);
          const plasterQty = row[cols.plasterQty] !== '' ? row[cols.plasterQty] : '';
          const plasterRate = Number(row[cols.plasterRate]) || 0;
          const plasterAmount = row[cols.plasterAmount] !== '' && row[cols.plasterAmount] !== null
            ? Number(row[cols.plasterAmount]) || 0
            : (Number(plasterQty) && plasterRate ? Number(plasterQty) * plasterRate : 0);

          if (!cementBags && !blocksProduced && !sharpAmount && !plasterAmount) continue;

          rows.push({
            date: normalizeDate(dateVal),
            site: '',
            cementBags, blocksProduced,
            usmanRate, labourRate,
            sharpQty, sharpAmount,
            plasterQty, plasterAmount
          });
        }

        if (!rows.length) {
          showToast('No rows with cement, blocks, or sand amounts were found', 'error');
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

  function mapColumns(headerRow) {
    const lower = headerRow.map(c => String(c || '').trim().toLowerCase());
    const find = (...needles) => lower.findIndex(c => needles.every(n => c.indexOf(n) !== -1));
    return {
      date: find('date'),
      cement: find('cement'),
      blocks: find('blocks produced') !== -1 ? find('blocks produced') : find('blocks'),
      usmanRate: find('usman', 'rate'),
      labourRate: lower.findIndex((c, idx) => c.indexOf('labour rate') !== -1 || (c.indexOf('labour') !== -1 && c.indexOf('rate') !== -1 && c.indexOf('amount') === -1)),
      sharpQty: lower.findIndex(c => c.indexOf('sharp sand') !== -1 && (c.indexOf('qty') !== -1 || c.indexOf('trip') !== -1)),
      sharpRate: find('sharp sand', 'rate'),
      sharpAmount: find('sharp sand', 'amount'),
      plasterQty: lower.findIndex(c => c.indexOf('plaster sand') !== -1 && (c.indexOf('qty') !== -1 || c.indexOf('trip') !== -1)),
      plasterRate: find('plaster sand', 'rate'),
      plasterAmount: find('plaster sand', 'amount')
    };
  }

  function num(v, fallback) {
    const n = Number(v);
    return v !== '' && v !== null && v !== undefined && !isNaN(n) && n !== 0 ? n : fallback;
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

    const totalBlocks = parsedRows.reduce((s, r) => s + r.blocksProduced, 0);
    const totalCement = parsedRows.reduce((s, r) => s + r.cementBags, 0);
    const totalCost = parsedRows.reduce((s, r) =>
      s + (r.cementBags * r.labourRate) + (r.blocksProduced * r.usmanRate) + r.sharpAmount + r.plasterAmount, 0);

    document.getElementById('statRows').textContent = parsedRows.length;
    document.getElementById('statBlocks').textContent = totalBlocks.toLocaleString();
    document.getElementById('statCement').textContent = totalCement.toLocaleString() + ' bags';
    document.getElementById('statTotal').textContent = money(totalCost);

    const tbody = document.getElementById('reviewRows');
    tbody.innerHTML = '';

    parsedRows.forEach((row, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="date" data-field="date" data-idx="${i}" value="${row.date}" style="min-width:130px;"></td>
        <td><input type="text" data-field="site" data-idx="${i}" value="${row.site || currentSiteDefault()}" style="min-width:100px;" placeholder="Site"></td>
        <td><input type="number" data-field="cementBags" data-idx="${i}" value="${row.cementBags}" style="width:90px;"></td>
        <td><input type="number" data-field="blocksProduced" data-idx="${i}" value="${row.blocksProduced}" style="width:100px;"></td>
        <td><input type="number" data-field="usmanRate" data-idx="${i}" value="${row.usmanRate}" style="width:90px;"></td>
        <td><input type="number" data-field="labourRate" data-idx="${i}" value="${row.labourRate}" style="width:90px;"></td>
        <td><input type="number" data-field="sharpAmount" data-idx="${i}" value="${row.sharpAmount}" style="width:100px;"></td>
        <td><input type="number" data-field="plasterAmount" data-idx="${i}" value="${row.plasterAmount}" style="width:100px;"></td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('input').forEach(el => {
      el.addEventListener('input', onCellEdit);
      el.addEventListener('change', onCellEdit);
    });
  }

  function onCellEdit(e) {
    const idx = Number(e.target.dataset.idx);
    const field = e.target.dataset.field;
    if (Number.isNaN(idx) || !field) return;
    const val = e.target.type === 'number' ? Number(e.target.value) || 0 : e.target.value;
    parsedRows[idx][field] = val;
  }

  function currentSiteDefault() {
    return currentUser.role === 'Admin'
      ? (document.getElementById('importSite').value || '')
      : currentUser.site;
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
    const defaultSite = currentUser.role === 'Admin' ? document.getElementById('importSite').value : currentUser.site;
    if (!defaultSite && parsedRows.some(r => !r.site)) {
      showToast('Select a site above, or make sure every row has its own Site value', 'error');
      return;
    }

    const productionRows = parsedRows.filter(r => r.cementBags > 0 || r.blocksProduced > 0);
    const sandExpenses = [];
    parsedRows.forEach(r => {
      const site = r.site || defaultSite;
      if (r.sharpAmount > 0) {
        sandExpenses.push({
          date: r.date, site, category: 'Sharp Sand',
          description: r.sharpQty ? `Sharp sand — ${r.sharpQty} trips` : 'Sharp sand',
          quantity: r.sharpQty || '', unit: 'trips', amount: r.sharpAmount, vendor: '', paymentMethod: 'Cash'
        });
      }
      if (r.plasterAmount > 0) {
        sandExpenses.push({
          date: r.date, site, category: 'plaster Sand',
          description: r.plasterQty ? `Plaster sand — ${r.plasterQty} trips` : 'Plaster sand',
          quantity: r.plasterQty || '', unit: 'trips', amount: r.plasterAmount, vendor: '', paymentMethod: 'Cash'
        });
      }
    });

    if (!productionRows.length && !sandExpenses.length) {
      showToast('Nothing to import — every row is empty', 'error');
      return;
    }

    const btn = document.getElementById('confirmImportBtn');
    btn.disabled = true;
    let productionCount = 0;
    let sandCount = 0;
    try {
      // No bulk endpoint for Block Production — post one day at a time,
      // exactly as if each row had been entered through the form.
      for (let i = 0; i < productionRows.length; i++) {
        const r = productionRows[i];
        btn.textContent = `Importing production ${i + 1}/${productionRows.length}…`;
        await Api.addBlockProduction({
          date: r.date, site: r.site || defaultSite,
          cementBags: r.cementBags, blocksProduced: r.blocksProduced,
          labourRatePerBag: r.labourRate, ratePerPiece: r.usmanRate,
          pieces: r.blocksProduced, notes: 'Imported from Block Production sheet'
        });
        productionCount++;
      }

      // Sand expenses go through the normal bulk expense endpoint, in
      // chunks — same size-limit reasoning as Import Expenses (a write
      // action is a GET with the whole JSON body in one URL parameter).
      const CHUNK_SIZE = 30;
      for (let i = 0; i < sandExpenses.length; i += CHUNK_SIZE) {
        const chunk = sandExpenses.slice(i, i + CHUNK_SIZE);
        btn.textContent = `Importing sand expenses ${Math.min(i + CHUNK_SIZE, sandExpenses.length)}/${sandExpenses.length}…`;
        const result = await Api.submitExpensesBulk(chunk);
        sandCount += result.count;
      }

      showToast(`Imported ${productionCount} production day(s) and ${sandCount} sand expense(s)`, 'success');
      resetToUpload();
    } catch (err) {
      showToast(
        (productionCount > 0 || sandCount > 0)
          ? `Imported ${productionCount} production day(s), ${sandCount} sand expense(s) before failing: ${err.message}`
          : err.message,
        'error'
      );
    } finally {
      btn.disabled = false; btn.textContent = 'Import All Rows';
    }
  }

  init();
})();
