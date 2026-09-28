/**
 * report.js — powers report.html (Boss read-only view, also linked from Admin)
 */
(function () {
  let currentUser = null;
  let allExpenses = [];
  let filtered = [];
  let monthChart, categoryChart, siteChart;

  // A muted, BI-dashboard-style palette — avoids pure primary colors in
  // favor of tones that read well together on a chart with many segments.
  const PALETTE = ['#2563EB', '#0D9488', '#D97706', '#DC2626', '#7C3AED', '#0891B2', '#DB2777', '#65A30D', '#4B5563', '#9333EA'];

  function showToast(msg, type) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show' + (type ? ' ' + type : '');
    setTimeout(() => t.classList.remove('show'), 3200);
  }

  function money(n) {
    return '₦' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function moneyShort(n) {
    n = Number(n) || 0;
    if (Math.abs(n) >= 1e6) return '₦' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (Math.abs(n) >= 1e3) return '₦' + (n / 1e3).toFixed(0) + 'K';
    return '₦' + n.toLocaleString();
  }

  function fmtDate(v) {
    const d = parseLocalDate(v);
    if (isNaN(d)) return String(v || '—');
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function isoDate(v) {
    const d = parseLocalDate(v);
    if (isNaN(d)) return String(v);
    // Format from local Y/M/D components — NOT toISOString(), which
    // converts to UTC and can shift the date by a day depending on the
    // browser's timezone offset. This keeps date-range filtering exact.
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // Shared "BI dashboard" look for every chart on this page: light
  // gridlines, no axis border, consistent font, ₦-formatted tooltips.
  function applyChartDefaults() {
    if (typeof Chart === 'undefined') return;
    Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = '#555555';
    Chart.defaults.plugins.tooltip.backgroundColor = '#1F2937';
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 6;
    Chart.defaults.plugins.tooltip.titleFont = { weight: '600' };
  }

  async function init() {
    currentUser = await Auth.requireRole(['Boss', 'Admin']);
    if (!currentUser) return;

    Layout.build('report.html', currentUser);
    Layout.mainMount().innerHTML = document.getElementById('pageContent').innerHTML;
    document.getElementById('menuBtn')?.addEventListener('click', Layout.toggleSidebar);

    populateCategorySelect(document.getElementById('categoryFilter'), true);
    populateGroupFilter(document.getElementById('groupFilter'));

    await Promise.all([loadStats(), loadExpenses(), loadSiteFilter()]);
    wireFilters();
    wireExport();
  }

  async function loadStats() {
    try {
      const stats = await Api.getDashboardStats();
      document.getElementById('statAllTime').textContent = money(stats.allTimeTotal);
      document.getElementById('statToday').textContent = money(stats.todayTotal);
      document.getElementById('statMonth').textContent = money(stats.monthTotal);
      document.getElementById('statSites').textContent = stats.totalSites;
      document.getElementById('statCount').textContent = stats.totalTransactions;

      const chartsOk = await window.chartJsReady;
      const monthEl = document.getElementById('monthChart');
      const catEl = document.getElementById('categoryChart');
      const siteEl = document.getElementById('siteChart');

      if (chartsOk) {
        applyChartDefaults();
        renderMonthChart(stats.byMonth);
        renderCategoryChart(stats.byCategory);
        renderSiteChart(stats.bySite);
      } else {
        chartUnavailable(monthEl);
        chartUnavailable(catEl);
        chartUnavailable(siteEl);
        renderCategoryLegend(Object.keys(stats.byCategory), Object.values(stats.byCategory),
          Object.keys(stats.byCategory).map((_, i) => PALETTE[i % PALETTE.length]), stats.byCategory);
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function renderMonthChart(byMonth) {
    const labels = Object.keys(byMonth).sort();
    const values = labels.map(l => byMonth[l]);
    const el = document.getElementById('monthChart');
    const ctx = el.getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, 0, 260);
    gradient.addColorStop(0, 'rgba(37, 99, 235, 0.28)');
    gradient.addColorStop(1, 'rgba(37, 99, 235, 0.02)');

    if (monthChart) monthChart.destroy();
    monthChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels.map(formatMonthLabel),
        datasets: [{
          label: 'Total Spend', data: values,
          borderColor: '#2563EB', backgroundColor: gradient, fill: true,
          tension: 0.35, borderWidth: 2.5,
          pointRadius: 3.5, pointBackgroundColor: '#2563EB', pointBorderColor: '#fff', pointBorderWidth: 1.5,
          pointHoverRadius: 5
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => money(ctx.parsed.y) } }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: '#EEF0F4' },
            border: { display: false },
            ticks: { callback: v => moneyShort(v) }
          },
          x: {
            grid: { display: false },
            border: { display: false }
          }
        }
      }
    });
  }

  function formatMonthLabel(ym) {
    const [y, m] = ym.split('-');
    const d = new Date(Number(y), Number(m) - 1, 1);
    return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  }

  function chartUnavailable(canvasEl) {
    const wrap = canvasEl?.closest('.card');
    if (!wrap) return;
    if (wrap.querySelector('.chart-offline-note')) return;
    const note = document.createElement('div');
    note.className = 'chart-offline-note';
    note.style.cssText = 'padding:24px;text-align:center;color:var(--color-ink-muted);font-size:13px;';
    note.textContent = 'Charts need an internet connection to load (they come from a CDN). Everything else on this page still works offline.';
    canvasEl.style.display = 'none';
    wrap.appendChild(note);
  }

  function renderCategoryChart(byCategory) {
    const labels = Object.keys(byCategory);
    const values = labels.map(l => byCategory[l]);
    const colors = labels.map((_, i) => PALETTE[i % PALETTE.length]);
    const el = document.getElementById('categoryChart');
    const ctx = el.getContext('2d');
    if (categoryChart) categoryChart.destroy();
    categoryChart = new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${money(ctx.parsed)}` } }
        }
      }
    });
    renderCategoryLegend(labels, values, colors, byCategory);
  }

  function renderSiteChart(bySite) {
    const entries = Object.entries(bySite).sort((a, b) => b[1] - a[1]);
    const labels = entries.map(e => e[0]);
    const values = entries.map(e => e[1]);
    const colors = labels.map((_, i) => PALETTE[i % PALETTE.length]);
    const el = document.getElementById('siteChart');
    const ctx = el.getContext('2d');
    if (siteChart) siteChart.destroy();
    siteChart = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 5, maxBarThickness: 30 }] },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => money(ctx.parsed.x) } }
        },
        scales: {
          x: {
            beginAtZero: true,
            grid: { color: '#EEF0F4' },
            border: { display: false },
            ticks: { callback: v => moneyShort(v) }
          },
          y: {
            grid: { display: false },
            border: { display: false }
          }
        }
      }
    });
  }

  function renderCategoryLegend(labels, values, colors, byCategory) {
    const total = values.reduce((a, b) => a + b, 0) || 1;
    document.getElementById('categoryLegend').innerHTML = labels.map((l, i) => `
      <div class="legend-row">
        <span class="dot" style="background:${colors[i]}"></span>
        <span>${l}</span>
        <span class="amt">${money(byCategory[l])} · ${Math.round(byCategory[l] / total * 100)}%</span>
      </div>
    `).join('');
  }

  function populateGroupFilter(selectEl) {
    CATEGORY_GROUP_ORDER.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g;
      opt.textContent = g;
      selectEl.appendChild(opt);
    });
  }

  async function loadSiteFilter() {
    try {
      const data = await Api.getSites();
      const names = (data.sites || []).map(s => s['Site Name']).filter(Boolean).sort();
      const siteFilter = document.getElementById('siteFilter');
      names.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s; opt.textContent = s;
        siteFilter.appendChild(opt);
      });
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function loadExpenses() {
    try {
      const data = await Api.getExpenses();
      allExpenses = data.expenses || [];
      filtered = allExpenses;
      render(allExpenses);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function renderGroupSummary(list) {
    const el = document.getElementById('groupSummary');
    if (!el) return;
    if (!list.length) { el.innerHTML = '<div class="legend-row"><span>No expenses match your filters.</span></div>'; return; }

    const byGroup = {};
    list.forEach(e => {
      const g = CATEGORY_GROUP_OF[e.Category] || 'Other Expenses';
      byGroup[g] = byGroup[g] || { total: 0, count: 0 };
      byGroup[g].total += Number(e.Amount) || 0;
      byGroup[g].count += 1;
    });
    const groupOrder = CATEGORY_GROUP_ORDER.filter(g => byGroup[g]);
    const grandTotal = groupOrder.reduce((s, g) => s + byGroup[g].total, 0);

    el.innerHTML = groupOrder.map((g, i) => `
      <div class="legend-row">
        <span class="dot" style="background:${PALETTE[i % PALETTE.length]}"></span>
        <span>${g}</span>
        <span class="amt">${money(byGroup[g].total)} · ${byGroup[g].count} txn${byGroup[g].count === 1 ? '' : 's'}</span>
      </div>
    `).join('') + `
      <div class="legend-row" style="font-weight:700;border-top:1px solid var(--color-border,#e5e7eb);margin-top:6px;padding-top:8px;">
        <span></span>
        <span>Grand Total</span>
        <span class="amt">${money(grandTotal)}</span>
      </div>
    `;
  }

  function render(list) {
    renderGroupSummary(list);
    const rows = document.getElementById('expenseRows');
    const empty = document.getElementById('emptyState');
    rows.innerHTML = '';
    if (!list.length) { empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    list.forEach(e => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="badge gray">${e['Expense ID']}</span></td>
        <td>${fmtDate(e.Date)}</td>
        <td>${e.Site || ''}</td>
        <td><span class="badge">${e.Category}</span></td>
        <td>${e.Description || ''}</td>
        <td><strong>${money(e.Amount)}</strong></td>
        <td>${e.Vendor || '—'}</td>
        <td>${e['Payment Method'] || '—'}</td>
        <td>${e['Submitted By'] || ''}</td>
      `;
      rows.appendChild(tr);
    });
  }

  function applyFilters() {
    const q = (document.getElementById('searchBox').value || '').toLowerCase();
    const site = document.getElementById('siteFilter').value;
    const cat = document.getElementById('categoryFilter').value;
    const group = document.getElementById('groupFilter').value;
    const from = document.getElementById('fromDate').value;
    const to = document.getElementById('toDate').value;

    filtered = allExpenses.filter(e => {
      if (q) {
        const hay = [e.Description, e.Vendor, e.Category, e['Expense ID']].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      if (site && e.Site !== site) return false;
      if (cat && e.Category !== cat) return false;
      if (group && (CATEGORY_GROUP_OF[e.Category] || 'Other Expenses') !== group) return false;
      const d = isoDate(e.Date);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
    render(filtered);
  }

  function wireFilters() {
    document.getElementById('searchBox').addEventListener('input', applyFilters);
    ['siteFilter', 'categoryFilter', 'groupFilter', 'fromDate', 'toDate'].forEach(id => {
      document.getElementById(id).addEventListener('input', applyFilters);
      document.getElementById(id).addEventListener('change', applyFilters);
    });
  }

  function wireExport() {
    document.getElementById('exportExcelBtn').addEventListener('click', async () => {
      if (!filtered.length) { showToast('No expenses to export for the current filters', 'error'); return; }

      const NGN = '"₦"#,##0';

      function sheetSafeName(name) {
        // Excel sheet names: max 31 chars, no : \ / ? * [ ]
        return name.replace(/[:\\/?*\[\]]/g, '').slice(0, 31);
      }

      // Fetch the underlying block production log (bags, blocks, rates)
      // once up front, scoped to the same site/date filters as the page,
      // so the "Block Production" tab can show both the itemized
      // expenses (Cement, Store Construction, Burnt Bricks, Sharp Sand)
      // AND the production numbers (blocks made, bags used, average)
      // together in one sheet.
      let bpEntries = [];
      try {
        const site = document.getElementById('siteFilter').value;
        const from = document.getElementById('fromDate').value;
        const to = document.getElementById('toDate').value;
        const bp = await Api.getBlockProduction();
        bpEntries = bp.entries || [];
        if (site) bpEntries = bpEntries.filter(e => e.Site === site);
        if (from || to) {
          bpEntries = bpEntries.filter(e => {
            const d = isoDate(e.Date);
            if (from && d < from) return false;
            if (to && d > to) return false;
            return true;
          });
        }
      } catch (err) {
        // Non-fatal — expense sheets still export fine either way.
      }

      function buildDetailSheet(title, rows, productionEntries) {
        // Report sheets read best chronologically (oldest first), regardless
        // of the on-screen table's most-recent-first order.
        rows = rows.slice().sort((a, b) => parseLocalDate(a.Date) - parseLocalDate(b.Date));
        const aoa = [];
        const currencyCells = [];
        const total = rows.reduce((s, e) => s + (Number(e.Amount) || 0), 0);
        aoa.push([title.toUpperCase()]);
        aoa.push(['Generated ' + new Date().toLocaleString() + '  ·  ' + rows.length + ' transactions']);
        aoa.push([]);
        aoa.push(['EXPENSE ITEMS']);
        aoa.push(['Expense ID', 'Date', 'Site', 'Category', 'Description', 'Amount', 'Vendor', 'Payment Method', 'Submitted By']);
        rows.forEach(e => {
          aoa.push([
            e['Expense ID'], fmtDate(e.Date), e.Site, e.Category, e.Description,
            Number(e.Amount) || 0, e.Vendor || '', e['Payment Method'] || '', e['Submitted By'] || ''
          ]);
          currencyCells.push([aoa.length, 6]);
        });
        aoa.push([]);
        aoa.push(['', '', '', '', 'EXPENSE TOTAL', total, '', '', '']);
        currencyCells.push([aoa.length, 6]);

        // ---- Extra section, Block Production tab only: the production
        // log itself — cement bags used, blocks produced, average per
        // bag, and the labour rates behind the "Block Production" labor
        // expense line above.
        if (productionEntries && productionEntries.length) {
          aoa.push([]);
          aoa.push([]);
          aoa.push(['PRODUCTION LOG (Cement, Blocks, Rates)']);
          aoa.push(['Entry ID', 'Date', 'Site', 'Cement (Bags)', 'Blocks Produced', 'Avg per Cement', 'Labour Rate/Bag', 'Labour Cost (Bag Basis)', 'Rate/Piece', 'Pieces', 'Labour Cost (Piece Basis)', 'Total Cost', 'Notes', 'Submitted By']);
          let bpBags = 0, bpBlocks = 0, bpCost = 0;
          productionEntries.slice().sort((a, b) => parseLocalDate(a.Date) - parseLocalDate(b.Date)).forEach(e => {
            bpBags += Number(e['Cement (Bags)']) || 0;
            bpBlocks += Number(e['Blocks Produced']) || 0;
            bpCost += Number(e['Total Cost']) || 0;
            aoa.push([
              e['Entry ID'], fmtDate(e.Date), e.Site,
              Number(e['Cement (Bags)']) || 0, Number(e['Blocks Produced']) || 0,
              Number(e['Avg per Cement']) || 0, Number(e['Labour Rate/Bag']) || 0,
              Number(e['Labour Cost (Bag Basis)']) || 0, Number(e['Rate/Piece']) || 0,
              Number(e['Pieces']) || 0, Number(e['Labour Cost (Piece Basis)']) || 0,
              Number(e['Total Cost']) || 0, e.Notes || '', e['Submitted By'] || ''
            ]);
            currencyCells.push([aoa.length, 7], [aoa.length, 8], [aoa.length, 11], [aoa.length, 12]);
          });
          aoa.push([]);
          aoa.push(['TOTAL', '', '', bpBags, bpBlocks, bpBags > 0 ? Math.round((bpBlocks / bpBags) * 100) / 100 : 0, '', '', '', '', '', bpCost, '', '']);
          currencyCells.push([aoa.length, 12]);
        }

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = [{ wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 18 }, { wch: 30 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 18 }, { wch: 14 }, { wch: 24 }, { wch: 14 }];
        currencyCells.forEach(([r, c]) => {
          const ref = XLSX.utils.encode_cell({ r: r - 1, c: c - 1 });
          if (ws[ref]) ws[ref].z = NGN;
        });
        return ws;
      }

      // File each expense into its category group (Accommodation, Block
      // Production, Main Work, Excavation of Trenches, Transportation of
      // Tools, Ach Shittu Materials, Workmanship, Other Expenses) — same
      // grouping the dropdown uses.
      const byGroup = {};
      filtered.forEach(e => {
        const g = CATEGORY_GROUP_OF[e.Category] || 'Other Expenses';
        (byGroup[g] = byGroup[g] || []).push(e);
      });
      const groupOrder = CATEGORY_GROUP_ORDER.filter(g => byGroup[g] && byGroup[g].length);

      const wb = XLSX.utils.book_new();

      // ---- Sheet 1: Summary — one row per group, so you can see every
      // group's total at a glance before diving into its own tab.
      const sumAoa = [];
      const sumCurrencyCells = [];
      sumAoa.push(['SITE EXPENSE REPORT — SUMMARY']);
      sumAoa.push(['Generated ' + new Date().toLocaleString() + '  ·  ' + filtered.length + ' transactions']);
      sumAoa.push([]);
      sumAoa.push(['Category Group', 'Transactions', 'Total (₦)']);
      let grandTotal = 0, grandCount = 0;
      groupOrder.forEach(g => {
        const rows = byGroup[g];
        const total = rows.reduce((s, e) => s + (Number(e.Amount) || 0), 0);
        grandTotal += total; grandCount += rows.length;
        sumAoa.push([g, rows.length, total]);
        sumCurrencyCells.push([sumAoa.length, 3]);
      });
      sumAoa.push(['GRAND TOTAL', grandCount, grandTotal]);
      sumCurrencyCells.push([sumAoa.length, 3]);
      const sumWs = XLSX.utils.aoa_to_sheet(sumAoa);
      sumWs['!cols'] = [{ wch: 24 }, { wch: 14 }, { wch: 16 }];
      sumCurrencyCells.forEach(([r, c]) => {
        const ref = XLSX.utils.encode_cell({ r: r - 1, c: c - 1 });
        if (sumWs[ref]) sumWs[ref].z = NGN;
      });
      XLSX.utils.book_append_sheet(wb, sumWs, 'Summary');

      // ---- One sheet per group (Block Production, Accommodation, Main
      // Work, etc.) — each downloadable/viewable on its own tab. The
      // "Block Production" tab also gets the production log (bags,
      // blocks, rates) appended below its expense items.
      groupOrder.forEach(g => {
        const productionEntries = g === 'Block Production' ? bpEntries : null;
        XLSX.utils.book_append_sheet(wb, buildDetailSheet(g, byGroup[g], productionEntries), sheetSafeName(g));
      });

      // ---- Final sheet: everything combined in one place, grouped with
      // subtotals — the "all expenses as one" view.
      const aoa = [];
      const currencyCells = [];
      aoa.push(['ALL EXPENSES COMBINED']);
      aoa.push(['Generated ' + new Date().toLocaleString() + '  ·  ' + filtered.length + ' transactions']);
      aoa.push([]);
      const detailCols = ['Expense ID', 'Date', 'Site', 'Category Group', 'Category', 'Description', 'Amount', 'Vendor', 'Payment Method', 'Submitted By'];
      aoa.push(detailCols);
      groupOrder.forEach(g => {
        const rows = byGroup[g].slice().sort((a, b) => parseLocalDate(a.Date) - parseLocalDate(b.Date));
        const total = rows.reduce((s, e) => s + (Number(e.Amount) || 0), 0);
        rows.forEach(e => {
          aoa.push([
            e['Expense ID'], fmtDate(e.Date), e.Site, g, e.Category, e.Description,
            Number(e.Amount) || 0, e.Vendor || '', e['Payment Method'] || '', e['Submitted By'] || ''
          ]);
          currencyCells.push([aoa.length, 7]);
        });
        aoa.push(['', '', '', '', '', g + ' — TOTAL', total, '', '', '']);
        currencyCells.push([aoa.length, 7]);
        aoa.push([]);
      });
      aoa.push(['', '', '', '', '', 'GRAND TOTAL', grandTotal, '', '', '']);
      currencyCells.push([aoa.length, 7]);

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 20 }, { wch: 18 }, { wch: 30 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 14 }];
      currencyCells.forEach(([r, c]) => {
        const ref = XLSX.utils.encode_cell({ r: r - 1, c: c - 1 });
        if (ws[ref]) ws[ref].z = NGN;
      });
      XLSX.utils.book_append_sheet(wb, ws, 'All Combined');

      XLSX.writeFile(wb, 'site-expenses-' + new Date().toISOString().slice(0, 10) + '.xlsx');
    });

    document.getElementById('exportPdfBtn').addEventListener('click', () => {
      if (!filtered.length) { showToast('No expenses to export for the current filters', 'error'); return; }

      const grandTotal = filtered.reduce((s, e) => s + (Number(e.Amount) || 0), 0);

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'landscape' });
      doc.setFontSize(14);
      doc.text('Site Expense Report', 14, 16);
      doc.setFontSize(9);
      doc.text('Generated ' + new Date().toLocaleString() + '  ·  ' + filtered.length + ' transactions  ·  Total: ' + money(grandTotal), 14, 22);
      doc.autoTable({
        startY: 28,
        head: [['ID', 'Date', 'Site', 'Category', 'Description', 'Amount', 'Vendor', 'Payment', 'By']],
        body: filtered.map(e => [
          e['Expense ID'], fmtDate(e.Date), e.Site, e.Category, e.Description,
          money(e.Amount), e.Vendor || '—', e['Payment Method'] || '—', e['Submitted By'] || ''
        ]),
        foot: [['', '', '', '', 'TOTAL', money(grandTotal), '', '', '']],
        styles: { fontSize: 8 },
        headStyles: { fillColor: [22, 86, 245] },
        footStyles: { fillColor: [240, 242, 247], textColor: [20, 20, 20], fontStyle: 'bold' }
      });
      doc.save('site-expenses-' + new Date().toISOString().slice(0, 10) + '.pdf');
    });
  }

  init();
})();
