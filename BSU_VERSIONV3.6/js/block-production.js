/**
 * block-production.js — powers block-production.html.
 *
 * Two sections, one page (mirrors the client's own tracker spreadsheet):
 *   Section A — daily production log (cement used, blocks moulded,
 *               labour cost). Auto-posts to Expenses as "Block Moulding
 *               Labour" via Api.addBlockProduction.
 *   Section B — other block production expenses (Store Construction,
 *               Cement, Burnt Bricks, Water Supply, Sharp Sand), logged
 *               straight through the normal Expenses pipeline via
 *               Api.submitExpense — just scoped to these categories.
 *
 * Admin (any site) and Site Manager (own site) get both forms. Boss gets
 * a read-only combined view.
 */
(function () {
  let currentUser = null;
  let trendChart;

  const OTHER_CATEGORIES = ['Store Construction', 'Cement', 'Burnt Bricks', 'Water Supply','Plaster Sand', 'Sharp Sand',];

  function showToast(msg, type) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show' + (type ? ' ' + type : '');
    setTimeout(() => t.classList.remove('show'), 3200);
  }

  function money(n) {
    return '₦' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  function fmtDate(v) {
    if (!v) return '—';
    const d = parseLocalDate(v);
    if (isNaN(d)) return String(v);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  async function init() {
    currentUser = await Auth.requireRole(['Admin', 'Site Manager', 'Boss']);
    if (!currentUser) return;

    Layout.build('block-production.html', currentUser);
    Layout.mainMount().innerHTML = document.getElementById('pageContent').innerHTML;
    document.getElementById('menuBtn')?.addEventListener('click', Layout.toggleSidebar);

    const canEdit = currentUser.role === 'Admin' || currentUser.role === 'Site Manager';
    if (canEdit) {
      document.getElementById('addEntryBtn').style.display = 'inline-flex';
      document.getElementById('addOtherBtn').style.display = 'inline-flex';
      await wireAddEntry();
      await wireAddOther();
    }

    await loadAll();
  }

  // ---------------------------------------------------------------
  // Section A — Production Log
  // ---------------------------------------------------------------

  async function wireAddEntry() {
    document.getElementById('entryDate').valueAsDate = new Date();
    await populateSiteField('entrySiteField', 'entrySite');

    document.getElementById('addEntryBtn').addEventListener('click', () => {
      document.getElementById('addEntryForm').style.display = 'block';
      updatePreview();
    });
    document.getElementById('cancelAddEntry').addEventListener('click', () => {
      document.getElementById('addEntryForm').style.display = 'none';
    });
    ['entryCement', 'entryBlocks', 'entryRateBag', 'entryRatePiece', 'entryPieces'].forEach(id => {
      document.getElementById(id).addEventListener('input', updatePreview);
    });
    document.getElementById('saveEntryBtn').addEventListener('click', onSaveEntry);
  }

  function readEntryForm() {
    const cementBags = Number(document.getElementById('entryCement').value) || 0;
    const blocksProduced = Number(document.getElementById('entryBlocks').value) || 0;
    const labourRatePerBag = Number(document.getElementById('entryRateBag').value) || 0;
    const ratePerPiece = Number(document.getElementById('entryRatePiece').value) || 0;
    const piecesRaw = document.getElementById('entryPieces').value;
    const pieces = piecesRaw !== '' ? Number(piecesRaw) : blocksProduced;

    const avgPerCement = cementBags > 0 ? (blocksProduced / cementBags) : 0;
    const bagCost = cementBags * labourRatePerBag;
    const pieceCost = pieces * ratePerPiece;
    const total = bagCost + pieceCost;

    return { cementBags, blocksProduced, labourRatePerBag, ratePerPiece, pieces, avgPerCement, bagCost, pieceCost, total };
  }

  function updatePreview() {
    const v = readEntryForm();
    document.getElementById('prevAvg').textContent = v.avgPerCement ? v.avgPerCement.toFixed(2) + ' blocks/bag' : '—';
    document.getElementById('prevTotal').textContent = money(v.total);
  }

  async function onSaveEntry() {
    const v = readEntryForm();
    const date = document.getElementById('entryDate').value;
    const site = currentUser.role === 'Admin'
      ? document.getElementById('entrySite').value
      : currentUser.site;
    const notes = document.getElementById('entryNotes').value.trim();

    if (!date || !site || !v.cementBags) {
      showToast('Date, site, and cement bags are required', 'error');
      return;
    }

    const btn = document.getElementById('saveEntryBtn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await Api.addBlockProduction({
        date, site, cementBags: v.cementBags, blocksProduced: v.blocksProduced,
        labourRatePerBag: v.labourRatePerBag, ratePerPiece: v.ratePerPiece,
        pieces: v.pieces, notes
      });
      showToast('Production logged — ' + money(v.total) + ' posted to Expenses', 'success');
      document.getElementById('addEntryForm').style.display = 'none';
      ['entryCement', 'entryBlocks', 'entryPieces', 'entryNotes'].forEach(id => { document.getElementById(id).value = ''; });
      updatePreview();
      await loadAll();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Save Entry';
    }
  }

  // ---------------------------------------------------------------
  // Section B — Other Block Production Expenses
  // ---------------------------------------------------------------

  async function wireAddOther() {
    document.getElementById('otherDate').valueAsDate = new Date();
    await populateSiteField('otherSiteField', 'otherSite');

    document.getElementById('addOtherBtn').addEventListener('click', () => {
      document.getElementById('addOtherForm').style.display = 'block';
    });
    document.getElementById('cancelAddOther').addEventListener('click', () => {
      document.getElementById('addOtherForm').style.display = 'none';
    });

    // Auto-fill Amount from Quantity × Unit Price, but let the person
    // override it by typing directly into Amount afterward.
    ['otherQuantity', 'otherUnitPrice'].forEach(id => {
      document.getElementById(id).addEventListener('input', () => {
        const qty = Number(document.getElementById('otherQuantity').value) || 0;
        const price = Number(document.getElementById('otherUnitPrice').value) || 0;
        if (qty && price) document.getElementById('otherAmount').value = qty * price;
      });
    });

    document.getElementById('saveOtherBtn').addEventListener('click', onSaveOther);
  }

  async function onSaveOther() {
    const date = document.getElementById('otherDate').value;
    const site = currentUser.role === 'Admin'
      ? document.getElementById('otherSite').value
      : currentUser.site;
    const category = document.getElementById('otherCategory').value;
    const description = document.getElementById('otherDescription').value.trim();
    const quantity = document.getElementById('otherQuantity').value;
    const unit = document.getElementById('otherUnit').value.trim();
    const amount = Number(document.getElementById('otherAmount').value) || 0;
    const vendor = document.getElementById('otherVendor').value.trim();
    const paymentMethod = document.getElementById('otherPayment').value;

    if (!date || !site || !amount) {
      showToast('Date, site, and amount are required', 'error');
      return;
    }

    const btn = document.getElementById('saveOtherBtn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await Api.submitExpense({ date, site, category, description, quantity, unit, amount, vendor, paymentMethod });
      showToast(category + ' expense logged — ' + money(amount), 'success');
      document.getElementById('addOtherForm').style.display = 'none';
      ['otherDescription', 'otherQuantity', 'otherUnit', 'otherUnitPrice', 'otherAmount', 'otherVendor'].forEach(id => {
        document.getElementById(id).value = '';
      });
      await loadAll();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Save Expense';
    }
  }

  // ---------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------

  async function populateSiteField(fieldId, selectId) {
    if (currentUser.role === 'Admin') {
      try {
        const data = await Api.getSites();
        const select = document.getElementById(selectId);
        (data.sites || []).map(s => s['Site Name']).filter(Boolean).sort().forEach(name => {
          const opt = document.createElement('option');
          opt.value = name; opt.textContent = name;
          select.appendChild(opt);
        });
      } catch (err) {
        showToast(err.message, 'error');
      }
    } else {
      document.getElementById(fieldId).innerHTML = `<label>Site</label><input type="text" value="${currentUser.site}" disabled>`;
    }
  }

  async function loadAll() {
    try {
      const [production, expenseData] = await Promise.all([
        Api.getBlockProduction(),
        Api.getExpenses()
      ]);

      const otherExpenses = (expenseData.expenses || []).filter(e => OTHER_CATEGORIES.includes(e.Category));

      renderStats(production.totals, otherExpenses);
      await renderTrend(production.trend);
      renderProductionRows(production.entries || []);
      renderOtherRows(otherExpenses);
      renderOtherCategoryTotals(otherExpenses);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function renderStats(t, otherExpenses) {
    const otherTotal = otherExpenses.reduce((s, e) => s + (Number(e.Amount) || 0), 0);
    const labourTotal = t.totalCost || 0;

    document.getElementById('statCement').textContent = (t.cementBags || 0).toLocaleString() + ' bags';
    document.getElementById('statBlocks').textContent = (t.blocksProduced || 0).toLocaleString();
    document.getElementById('statAvg').textContent = t.avgPerCement ? t.avgPerCement.toFixed(1) : '—';
    document.getElementById('statCost').textContent = money(labourTotal);
    document.getElementById('statOther').textContent = money(otherTotal);
    document.getElementById('statGrandTotal').textContent = money(labourTotal + otherTotal);
  }

  async function renderTrend(trend) {
    const el = document.getElementById('trendChart');
    const chartsOk = await window.chartJsReady;
    if (!chartsOk) { chartUnavailable(el); return; }
    if (!trend || !trend.length) { chartUnavailable(el, 'No production data yet to chart.'); return; }

    const labels = trend.map(t => fmtDate(t.date));
    const ctx = el.getContext('2d');
    if (trendChart) trendChart.destroy();
    trendChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Blocks Produced', data: trend.map(t => t.blocksProduced),
            borderColor: '#2563EB', backgroundColor: 'rgba(37,99,235,0.10)',
            yAxisID: 'y', tension: 0.35, fill: true, borderWidth: 2.5,
            pointRadius: 3, pointBackgroundColor: '#2563EB', pointBorderColor: '#fff', pointBorderWidth: 1.5
          },
          {
            label: 'Avg Blocks / Bag', data: trend.map(t => t.avgPerCement),
            borderColor: '#D97706', backgroundColor: 'transparent',
            yAxisID: 'y1', tension: 0.35, borderDash: [5, 4], borderWidth: 2,
            pointRadius: 2.5, pointBackgroundColor: '#D97706'
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'top', align: 'end', labels: { boxWidth: 10, usePointStyle: true, font: { size: 11 } } }
        },
        scales: {
          y: { beginAtZero: true, position: 'left', grid: { color: '#EEF0F4' }, border: { display: false }, title: { display: true, text: 'Blocks / day', font: { size: 11 } } },
          y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, border: { display: false }, title: { display: true, text: 'Blocks / bag', font: { size: 11 } } },
          x: { grid: { display: false }, border: { display: false } }
        }
      }
    });
  }

  function chartUnavailable(canvasEl, msg) {
    const wrap = canvasEl?.closest('.card');
    if (!wrap) return;
    if (wrap.querySelector('.chart-offline-note')) return;
    const note = document.createElement('div');
    note.className = 'chart-offline-note';
    note.style.cssText = 'padding:24px;text-align:center;color:var(--color-ink-muted);font-size:13px;';
    note.textContent = msg || 'Charts need an internet connection to load (they come from a CDN). Everything else on this page still works offline.';
    canvasEl.style.display = 'none';
    wrap.appendChild(note);
  }

  function renderProductionRows(entries) {
    const rows = document.getElementById('entryRows');
    const empty = document.getElementById('emptyState');
    rows.innerHTML = '';
    if (!entries.length) { empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    entries.forEach(e => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${fmtDate(e.Date)}</td>
        <td>${e.Site || ''}</td>
        <td>${e['Cement (Bags)'] || 0}</td>
        <td>${e['Blocks Produced'] || 0}</td>
        <td>${Number(e['Avg per Cement'] || 0).toFixed(1)}</td>
        <td><strong>${money(e['Total Cost'])}</strong></td>
        <td>${e['Submitted By'] || ''}</td>
      `;
      rows.appendChild(tr);
    });
  }

  function renderOtherRows(expenses) {
    const rows = document.getElementById('otherRows');
    const empty = document.getElementById('otherEmptyState');
    rows.innerHTML = '';
    if (!expenses.length) { empty.style.display = 'block'; return; }
    empty.style.display = 'none';

    const sorted = expenses.slice().sort((a, b) => parseLocalDate(b.Date) - parseLocalDate(a.Date));
    sorted.forEach(e => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${fmtDate(e.Date)}</td>
        <td>${e.Site || ''}</td>
        <td><span class="badge">${e.Category}</span></td>
        <td>${e.Description || ''}</td>
        <td><strong>${money(e.Amount)}</strong></td>
        <td>${e.Vendor || '—'}</td>
        <td>${e['Payment Method'] || '—'}</td>
      `;
      rows.appendChild(tr);
    });
  }

  function renderOtherCategoryTotals(expenses) {
    const totals = {};
    OTHER_CATEGORIES.forEach(c => { totals[c] = 0; });
    expenses.forEach(e => { totals[e.Category] = (totals[e.Category] || 0) + (Number(e.Amount) || 0); });

    document.getElementById('otherCategoryTotals').innerHTML = OTHER_CATEGORIES.map(c => `
      <div class="legend-row">
        <span>${c}</span>
        <span class="amt">${money(totals[c])}</span>
      </div>
    `).join('');
  }

  init();
})();
