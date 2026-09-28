/**
 * excavation-tracker.js — powers excavation-tracker.html.
 *
 * Unlike Block Production, this tracker doesn't auto-post a cost — real
 * excavation costs (labour, materials, equipment hire) vary too much
 * day to day for a clean formula, and get logged normally through Add
 * Expense under "Excavation of Trenches," "Excavation Equipment Hire,"
 * or any Concrete Works category. This page just tracks the progress dimension
 * (columns achieved) and reads the matching cost total from Expenses to
 * show a cost-per-column efficiency figure alongside it.
 *
 * Admin (any site) and Site Manager (own site) can log progress. Boss
 * gets a read-only view.
 */
(function () {
  let currentUser = null;
  let trendChart;

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

    Layout.build('excavation-tracker.html', currentUser);
    Layout.mainMount().innerHTML = document.getElementById('pageContent').innerHTML;
    document.getElementById('menuBtn')?.addEventListener('click', Layout.toggleSidebar);

    if (currentUser.role === 'Admin' || currentUser.role === 'Site Manager') {
      document.getElementById('addEntryBtn').style.display = 'inline-flex';
      await wireAddEntry();
    }

    await loadData();
  }

  async function wireAddEntry() {
    document.getElementById('entryDate').valueAsDate = new Date();

    const siteField = document.getElementById('entrySiteField');
    if (currentUser.role === 'Admin') {
      try {
        const data = await Api.getSites();
        const select = document.getElementById('entrySite');
        (data.sites || []).map(s => s['Site Name']).filter(Boolean).sort().forEach(name => {
          const opt = document.createElement('option');
          opt.value = name; opt.textContent = name;
          select.appendChild(opt);
        });
      } catch (err) {
        showToast(err.message, 'error');
      }
    } else {
      siteField.innerHTML = `<label>Site</label><input type="text" value="${currentUser.site}" disabled>`;
    }

    document.getElementById('addEntryBtn').addEventListener('click', () => {
      document.getElementById('addEntryForm').style.display = 'block';
    });
    document.getElementById('cancelAddEntry').addEventListener('click', () => {
      document.getElementById('addEntryForm').style.display = 'none';
    });
    document.getElementById('saveEntryBtn').addEventListener('click', onSave);
  }

  async function onSave() {
    const date = document.getElementById('entryDate').value;
    const site = currentUser.role === 'Admin'
      ? document.getElementById('entrySite').value
      : currentUser.site;
    const columnsAchieved = Number(document.getElementById('entryColumns').value) || 0;
    const notes = document.getElementById('entryNotes').value.trim();

    if (!date || !site || !columnsAchieved) {
      showToast('Date, site, and columns achieved are required', 'error');
      return;
    }

    const btn = document.getElementById('saveEntryBtn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await Api.addColumnProgress({ date, site, columnsAchieved, notes });
      showToast('Progress logged — ' + columnsAchieved + ' columns', 'success');
      document.getElementById('addEntryForm').style.display = 'none';
      document.getElementById('entryColumns').value = '';
      document.getElementById('entryNotes').value = '';
      await loadData();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Save Entry';
    }
  }

  async function loadData() {
    try {
      const data = await Api.getColumnProgress();
      renderStats(data.totals);
      await renderTrend(data.trend);
      renderRows(data.entries || []);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function renderStats(t) {
    document.getElementById('statColumns').textContent = (t.columnsAchieved || 0).toLocaleString();
    document.getElementById('statCost').textContent = money(t.excavationCost);
    document.getElementById('statCostPerColumn').textContent = t.costPerColumn ? money(t.costPerColumn) : '—';
  }

  async function renderTrend(trend) {
    const el = document.getElementById('trendChart');
    const chartsOk = await window.chartJsReady;
    if (!chartsOk) { chartUnavailable(el); return; }
    if (!trend || !trend.length) { chartUnavailable(el, 'No progress logged yet to chart.'); return; }

    const labels = trend.map(t => fmtDate(t.date));
    const ctx = el.getContext('2d');
    if (trendChart) trendChart.destroy();
    trendChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Columns This Entry', data: trend.map(t => t.columnsAchieved),
            borderColor: '#0D9488', backgroundColor: 'rgba(13,148,136,0.10)',
            yAxisID: 'y', tension: 0.35, fill: true, borderWidth: 2.5,
            pointRadius: 3, pointBackgroundColor: '#0D9488', pointBorderColor: '#fff', pointBorderWidth: 1.5
          },
          {
            label: 'Cumulative Columns', data: trend.map(t => t.cumulative),
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
          y: { beginAtZero: true, position: 'left', grid: { color: '#EEF0F4' }, border: { display: false }, title: { display: true, text: 'Columns / entry', font: { size: 11 } } },
          y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, border: { display: false }, title: { display: true, text: 'Cumulative', font: { size: 11 } } },
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

  function renderRows(entries) {
    const rows = document.getElementById('entryRows');
    const empty = document.getElementById('emptyState');
    rows.innerHTML = '';
    if (!entries.length) { empty.style.display = 'block'; return; }
    empty.style.display = 'none';

    // entries arrive newest-first; compute each row's running total by
    // walking oldest-first, then render back in the original (newest-first) order.
    const oldestFirst = entries.slice().reverse();
    let cumulative = 0;
    const withRunningTotal = oldestFirst.map(e => {
      cumulative += Number(e['Columns Achieved']) || 0;
      return { ...e, __running: cumulative };
    });
    withRunningTotal.reverse().forEach(e => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${fmtDate(e.Date)}</td>
        <td>${e.Site || ''}</td>
        <td>${e['Columns Achieved'] || 0}</td>
        <td><strong>${e.__running}</strong></td>
        <td>${e.Notes || '—'}</td>
        <td>${e['Submitted By'] || ''}</td>
      `;
      rows.appendChild(tr);
    });
  }

  init();
})();
