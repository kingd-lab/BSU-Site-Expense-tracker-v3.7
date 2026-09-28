/**
 * final-report.js — powers final-report.html (Admin & Boss only).
 *
 * Mirrors the "Benue University Project Final Report" Excel template:
 * Summary (category % + foundation-work control subtotal), By Period,
 * Block Production cost breakdown (Production of Blocks vs. Block
 * Production Expenses), and one detail sheet per category group.
 * The Excel export button builds the exact same multi-sheet workbook,
 * so the in-app view and the downloaded file always agree.
 */
(function () {
  let currentUser = null;
  let allExpenses = [];
  let bpEntries = [];
  let byGroup = {};

  function showToast(msg, type) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show' + (type ? ' ' + type : '');
    setTimeout(() => t.classList.remove('show'), 3200);
  }

  function money(n) {
    return '\u20a6' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function fmtDate(v) {
    const d = parseLocalDate(v);
    if (isNaN(d)) return String(v || '\u2014');
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function periodKey(v) {
    const d = parseLocalDate(v);
    if (isNaN(d)) return 'Unknown';
    return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  }

  async function init() {
    currentUser = await Auth.requireRole(['Boss', 'Admin']);
    if (!currentUser) return;

    Layout.build('final-report.html', currentUser);
    Layout.mainMount().innerHTML = document.getElementById('pageContent').innerHTML;
    document.getElementById('menuBtn')?.addEventListener('click', Layout.toggleSidebar);

    try {
      const [expData, bpData] = await Promise.all([Api.getExpenses(), Api.getBlockProduction()]);
      allExpenses = expData.expenses || [];
      bpEntries = bpData.entries || [];
      groupExpenses();
      renderSummary();
      renderByPeriod();
      renderBlockProductionBreakdown();
      populateDetailSelect();
      wireDetailSelect();
      wireDownload();
      if (currentUser.role === 'Admin') initRecategorizeCard();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function groupExpenses() {
    byGroup = {};
    allExpenses.forEach(e => {
      const g = CATEGORY_GROUP_OF[e.Category] || 'Other Expenses';
      (byGroup[g] = byGroup[g] || []).push(e);
    });
    // chronological within each group — this report reads like a ledger
    Object.values(byGroup).forEach(rows => rows.sort((a, b) => parseLocalDate(a.Date) - parseLocalDate(b.Date)));
  }

  function blockProductionSplit() {
    const rows = byGroup['Block Production'] || [];
    const autoLog = rows.filter(e => e['Payment Method'] === 'Auto (Production Log)');
    const manual = rows.filter(e => e['Payment Method'] !== 'Auto (Production Log)');
    return { autoLog, manual };
  }

  function renderSummary() {
    let grandTotal = 0, grandCount = 0;
    CATEGORY_GROUP_ORDER.forEach(g => {
      const rows = byGroup[g] || [];
      grandTotal += rows.reduce((s, e) => s + (Number(e.Amount) || 0), 0);
      grandCount += rows.length;
    });

    const excavationTotal = (byGroup['Excavation of Trenches'] || []).reduce((s, e) => s + (Number(e.Amount) || 0), 0);
    const concreteTotal = (byGroup['Concrete Works'] || []).reduce((s, e) => s + (Number(e.Amount) || 0), 0);

    document.getElementById('summaryRows').innerHTML = CATEGORY_GROUP_ORDER.map(g => {
      const rows = byGroup[g] || [];
      const total = rows.reduce((s, e) => s + (Number(e.Amount) || 0), 0);
      const pct = grandTotal > 0 ? (total / grandTotal * 100) : 0;
      return `<tr><td>${g}</td><td><strong>${money(total)}</strong></td><td>${pct.toFixed(1)}%</td></tr>`;
    }).join('');

    document.getElementById('foundationSubtotal').textContent =
      `${money(excavationTotal + concreteTotal)} (Excavation of Trenches + Concrete Works)`;
    document.getElementById('grandTotal').textContent = money(grandTotal);

    let latestDate = null;
    allExpenses.forEach(e => {
      const d = parseLocalDate(e.Date);
      if (!isNaN(d) && (!latestDate || d > latestDate)) latestDate = d;
    });
    document.getElementById('reportMeta').textContent =
      `${grandCount} transactions \u00b7 data through ${latestDate ? fmtDate(latestDate) : '\u2014'} \u00b7 generated ${new Date().toLocaleDateString()}`;
  }

  function renderByPeriod() {
    const periods = {}; // { 'Sep 2026': { group: total } }
    CATEGORY_GROUP_ORDER.forEach(g => {
      (byGroup[g] || []).forEach(e => {
        const key = periodKey(e.Date);
        periods[key] = periods[key] || {};
        periods[key][g] = (periods[key][g] || 0) + (Number(e.Amount) || 0);
      });
    });

    const sortedKeys = Object.keys(periods).sort((a, b) => new Date('1 ' + a) - new Date('1 ' + b));

    document.getElementById('byPeriodHead').innerHTML =
      ['Period', ...CATEGORY_GROUP_ORDER, 'Total'].map(h => `<th>${h}</th>`).join('');

    const totals = {};
    let grand = 0;
    const rowsHtml = sortedKeys.map(key => {
      let rowTotal = 0;
      const cells = CATEGORY_GROUP_ORDER.map(g => {
        const v = (periods[key] && periods[key][g]) || 0;
        rowTotal += v;
        totals[g] = (totals[g] || 0) + v;
        return `<td>${money(v)}</td>`;
      }).join('');
      grand += rowTotal;
      return `<tr><td><strong>${key}</strong></td>${cells}<td><strong>${money(rowTotal)}</strong></td></tr>`;
    }).join('');

    const totalRow = `<tr style="font-weight:700;border-top:2px solid var(--color-border);">
      <td>TOTAL</td>
      ${CATEGORY_GROUP_ORDER.map(g => `<td>${money(totals[g] || 0)}</td>`).join('')}
      <td>${money(grand)}</td>
    </tr>`;

    document.getElementById('byPeriodRows').innerHTML = rowsHtml + totalRow;
  }

  function renderBlockProductionBreakdown() {
    const { autoLog, manual } = blockProductionSplit();
    const autoTotal = autoLog.reduce((s, e) => s + (Number(e.Amount) || 0), 0);
    const manualTotal = manual.reduce((s, e) => s + (Number(e.Amount) || 0), 0);

    document.getElementById('blockProdRows').innerHTML = `
      <tr><td>Production of Blocks (auto-logged)</td><td>${autoLog.length}</td><td>${money(autoTotal)}</td></tr>
      <tr><td>Block Production Expenses (manual)</td><td>${manual.length}</td><td>${money(manualTotal)}</td></tr>
      <tr style="font-weight:700;border-top:2px solid var(--color-border);"><td>TOTAL</td><td>${autoLog.length + manual.length}</td><td>${money(autoTotal + manualTotal)}</td></tr>
    `;
  }

  function populateDetailSelect() {
    const sel = document.getElementById('detailGroupSelect');
    sel.innerHTML = CATEGORY_GROUP_ORDER.map(g => `<option value="${g}">${g}</option>`).join('');
    renderDetail(sel.value);
  }

  function renderDetail(group) {
    const rows = byGroup[group] || [];
    const tbody = document.getElementById('detailRows');
    const empty = document.getElementById('detailEmpty');
    if (!rows.length) {
      tbody.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    tbody.innerHTML = rows.map(e => `
      <tr>
        <td>${fmtDate(e.Date)}</td>
        <td><span class="badge">${e.Category}</span></td>
        <td>${e.Description || ''}</td>
        <td>${e.Vendor || '\u2014'}</td>
        <td><strong>${money(e.Amount)}</strong></td>
        <td>${e['Payment Method'] || '\u2014'}</td>
      </tr>
    `).join('') + `
      <tr style="font-weight:700;border-top:2px solid var(--color-border);">
        <td colspan="4">TOTAL</td>
        <td>${money(rows.reduce((s, e) => s + (Number(e.Amount) || 0), 0))}</td>
        <td></td>
      </tr>
    `;
  }

  function wireDetailSelect() {
    document.getElementById('detailGroupSelect').addEventListener('change', (e) => renderDetail(e.target.value));
  }

  // ---------------------------------------------------------------
  // Excel export — builds the exact same multi-sheet workbook as the
  // Benue University Project Final Report template.
  // ---------------------------------------------------------------
  function wireDownload() {
    document.getElementById('downloadExcelBtn').addEventListener('click', () => {
      try {
        buildAndDownloadWorkbook();
        showToast('Report downloaded', 'success');
      } catch (err) {
        showToast('Export failed: ' + err.message, 'error');
      }
    });
  }

  function sheetSafeName(name) {
    return name.replace(/[:\\/?*\[\]]/g, '').slice(0, 31);
  }

  const NGN = '"\u20a6"#,##0';

  function setCurrency(ws, refs) {
    refs.forEach(([r, c]) => {
      const ref = XLSX.utils.encode_cell({ r: r - 1, c: c - 1 });
      if (ws[ref]) ws[ref].z = NGN;
    });
  }

  function buildDetailSheetAoa(title, subtitle, rows) {
    const aoa = [];
    const currency = [];
    aoa.push([title]);
    aoa.push([subtitle]);
    aoa.push([]);
    aoa.push(['Date', 'Detail Category', 'Description', 'Vendor', 'Amount (\u20a6)', 'Payment Method']);
    rows.forEach(e => {
      aoa.push([fmtDate(e.Date), e.Category, e.Description || '', e.Vendor || '', Number(e.Amount) || 0, e['Payment Method'] || '']);
      currency.push([aoa.length, 5]);
    });
    const total = rows.reduce((s, e) => s + (Number(e.Amount) || 0), 0);
    aoa.push(['', '', '', 'TOTAL', total, '']);
    currency.push([aoa.length, 5]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 16 }, { wch: 24 }, { wch: 55 }, { wch: 24 }, { wch: 16 }, { wch: 18 }];
    setCurrency(ws, currency);
    return ws;
  }

  function buildAndDownloadWorkbook() {
    const wb = XLSX.utils.book_new();
    const reportDate = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

    let latestDate = null;
    allExpenses.forEach(e => {
      const d = parseLocalDate(e.Date);
      if (!isNaN(d) && (!latestDate || d > latestDate)) latestDate = d;
    });
    const latestStr = latestDate ? fmtDate(latestDate) : 'unknown';

    let grandTotal = 0, grandCount = 0;
    CATEGORY_GROUP_ORDER.forEach(g => {
      const rows = byGroup[g] || [];
      grandTotal += rows.reduce((s, e) => s + (Number(e.Amount) || 0), 0);
      grandCount += rows.length;
    });
    const excavationTotal = (byGroup['Excavation of Trenches'] || []).reduce((s, e) => s + (Number(e.Amount) || 0), 0);
    const concreteTotal = (byGroup['Concrete Works'] || []).reduce((s, e) => s + (Number(e.Amount) || 0), 0);

    // ---- Summary ----
    const sumAoa = [];
    const sumCur = [];
    sumAoa.push(['SITE EXPENSE REPORT \u2014 SUMMARY']);
    sumAoa.push([`Site Expense Manager | Report date: ${reportDate} | ${grandCount} transactions | Data recorded through ${latestStr}`]);
    sumAoa.push(['Controlling source: live app database. Categories assigned at entry via categories.js \u2014 no re-derivation performed in this report.']);
    sumAoa.push([]);
    sumAoa.push(['Category', 'Total Amount (\u20a6)', '% of Total']);
    CATEGORY_GROUP_ORDER.forEach(g => {
      const total = (byGroup[g] || []).reduce((s, e) => s + (Number(e.Amount) || 0), 0);
      sumAoa.push([g, total, grandTotal > 0 ? total / grandTotal : 0]);
      sumCur.push([sumAoa.length, 2]);
    });
    sumAoa.push([]);
    sumAoa.push(['EXCAVATION / FOUNDATION SUBTOTAL (CONTROL)']);
    sumAoa.push(['Excavation of Trenches + Concrete Works (includes column base work & materials)', '', excavationTotal + concreteTotal]);
    sumCur.push([sumAoa.length, 3]);
    sumAoa.push([]);
    sumAoa.push(['GRAND TOTAL', grandTotal]);
    sumCur.push([sumAoa.length, 2]);
    const sumWs = XLSX.utils.aoa_to_sheet(sumAoa);
    sumWs['!cols'] = [{ wch: 45 }, { wch: 18 }, { wch: 12 }];
    setCurrency(sumWs, sumCur);
    // percentage column formatting
    for (let i = 5; i <= 4 + CATEGORY_GROUP_ORDER.length; i++) {
      const ref = XLSX.utils.encode_cell({ r: i - 1, c: 2 });
      if (sumWs[ref]) sumWs[ref].z = '0.0%';
    }
    XLSX.utils.book_append_sheet(wb, sumWs, 'Summary');

    // ---- By Period ----
    const periods = {};
    CATEGORY_GROUP_ORDER.forEach(g => {
      (byGroup[g] || []).forEach(e => {
        const key = periodKey(e.Date);
        periods[key] = periods[key] || {};
        periods[key][g] = (periods[key][g] || 0) + (Number(e.Amount) || 0);
      });
    });
    const sortedKeys = Object.keys(periods).sort((a, b) => new Date('1 ' + a) - new Date('1 ' + b));
    const bpAoa = [];
    const bpCur = [];
    bpAoa.push(['SITE EXPENSES \u2014 BY PERIOD']);
    bpAoa.push([]);
    bpAoa.push(['Period', ...CATEGORY_GROUP_ORDER, 'Total']);
    const periodTotals = {};
    let grand = 0;
    sortedKeys.forEach(key => {
      let rowTotal = 0;
      const row = [key];
      CATEGORY_GROUP_ORDER.forEach(g => {
        const v = (periods[key] && periods[key][g]) || 0;
        row.push(v);
        rowTotal += v;
        periodTotals[g] = (periodTotals[g] || 0) + v;
      });
      row.push(rowTotal);
      grand += rowTotal;
      bpAoa.push(row);
      for (let c = 2; c <= CATEGORY_GROUP_ORDER.length + 2; c++) bpCur.push([bpAoa.length, c]);
    });
    const totalRow = ['TOTAL', ...CATEGORY_GROUP_ORDER.map(g => periodTotals[g] || 0), grand];
    bpAoa.push(totalRow);
    for (let c = 2; c <= CATEGORY_GROUP_ORDER.length + 2; c++) bpCur.push([bpAoa.length, c]);
    const bpWs = XLSX.utils.aoa_to_sheet(bpAoa);
    bpWs['!cols'] = [{ wch: 15 }, ...CATEGORY_GROUP_ORDER.map(() => ({ wch: 19 })), { wch: 19 }];
    setCurrency(bpWs, bpCur);
    XLSX.utils.book_append_sheet(wb, bpWs, 'By Period');

    // ---- Block Production Log (from BlockProduction sheet entries) ----
    const logAoa = [];
    logAoa.push(['BLOCK PRODUCTION LOG']);
    logAoa.push([`Production records in source ledger | Report date: ${reportDate}`]);
    logAoa.push(['S/N', 'Date', 'Cement Bags', 'Blocks Produced']);
    bpEntries.slice().sort((a, b) => parseLocalDate(a.Date) - parseLocalDate(b.Date)).forEach((e, i) => {
      logAoa.push([i + 1, fmtDate(e.Date), Number(e['Cement (Bags)']) || 0, Number(e['Blocks Produced']) || 0]);
    });
    const logWs = XLSX.utils.aoa_to_sheet(logAoa);
    logWs['!cols'] = [{ wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, logWs, 'Block Production Log');

    // ---- Block Production Summary ----
    const totalBags = bpEntries.reduce((s, e) => s + (Number(e['Cement (Bags)']) || 0), 0);
    const totalBlocks = bpEntries.reduce((s, e) => s + (Number(e['Blocks Produced']) || 0), 0);
    const avgPerBag = totalBags > 0 ? totalBlocks / totalBags : 0;
    const bpsAoa = [
      ['BLOCK PRODUCTION SUMMARY'],
      [`Production analysis from recorded Block Production transactions | Report date: ${reportDate}`],
      ['Metric', 'Value', 'Unit', 'Remarks'],
      ['Production Batches', bpEntries.length, 'Batches', 'Recorded production entries'],
      ['Total Cement Used', totalBags, 'Bags', 'From production log'],
      ['Total Blocks Produced', totalBlocks, 'Blocks', 'From production log'],
      ['Average Blocks per Bag', Math.round(avgPerBag * 100) / 100, 'Blocks/Bag', 'Weighted average']
    ];
    const bpsWs = XLSX.utils.aoa_to_sheet(bpsAoa);
    bpsWs['!cols'] = [{ wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, bpsWs, 'Block Production Summary');

    // ---- Sand Purchase Detail (Sharp Sand / plaster Sand leaf categories only) ----
    const sandRows = (byGroup['Block Production'] || []).filter(e => e.Category === 'Sharp Sand' || e.Category === 'plaster Sand');
    const spAoa = [
      ['SAND PURCHASE DETAIL \u2014 BLOCK PRODUCTION'],
      ['All entries below are taken from the Sharp Sand / plaster Sand transactions in Block Production.'],
      ['Date', 'Sand Type', 'No. of Trips', 'Original Description', 'Amount (\u20a6)', 'Payment Method']
    ];
    const spCur = [];
    sandRows.forEach(e => {
      const desc = e.Description || '';
      const tripMatch = desc.match(/(\d+)\s*trip/i);
      const trips = tripMatch ? Number(tripMatch[1]) : 1;
      const sandType = /plaster/i.test(desc) || e.Category === 'plaster Sand' ? 'Plaster Sand' : 'Sharp Sand';
      spAoa.push([fmtDate(e.Date), sandType, trips, desc, Number(e.Amount) || 0, e['Payment Method'] || '']);
      spCur.push([spAoa.length, 5]);
    });
    const spWs = XLSX.utils.aoa_to_sheet(spAoa);
    spWs['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 32 }, { wch: 14 }, { wch: 16 }];
    setCurrency(spWs, spCur);
    XLSX.utils.book_append_sheet(wb, spWs, 'Sand Purchase Detail');

    // ---- One detail sheet per category group ----
    CATEGORY_GROUP_ORDER.forEach(g => {
      const rows = byGroup[g] || [];
      const subtitle = `Site Expense Manager | Detailed expense record | Report date: ${reportDate} | Data through ${latestStr}`;
      const ws = buildDetailSheetAoa(g.toUpperCase(), subtitle, rows);
      XLSX.utils.book_append_sheet(wb, ws, sheetSafeName(g));
    });

    // ---- Production of Blocks / Block Production Expenses split ----
    const { autoLog, manual } = blockProductionSplit();
    const pobWs = buildDetailSheetAoa(
      'PRODUCTION OF BLOCKS',
      'Actual block production records, including Block Moulding Labour. This is one component of the total Block Production cost.',
      autoLog
    );
    XLSX.utils.book_append_sheet(wb, pobWs, 'Production of Blocks');

    const bpeWs = buildDetailSheetAoa(
      'BLOCK PRODUCTION EXPENSES',
      'Supporting block-production expenses from the app export. This is the second component of the total Block Production cost.',
      manual
    );
    XLSX.utils.book_append_sheet(wb, bpeWs, 'Block Production Expenses');

    // ---- Excavation Breakdown Summary ----
    const excCount = (byGroup['Excavation of Trenches'] || []).length;
    const concCount = (byGroup['Concrete Works'] || []).length;
    const ebsAoa = [
      ['EXCAVATION / FOUNDATION WORK BREAKDOWN SUMMARY'],
      [],
      ['Detailed Sheet', 'Transactions', 'Amount (\u20a6)'],
      ['Excavation of Trenches', excCount, excavationTotal],
      ['Concrete Works (incl. column base work & materials)', concCount, concreteTotal],
      ['TOTAL', excCount + concCount, excavationTotal + concreteTotal]
    ];
    const ebsWs = XLSX.utils.aoa_to_sheet(ebsAoa);
    ebsWs['!cols'] = [{ wch: 50 }, { wch: 14 }, { wch: 16 }];
    setCurrency(ebsWs, [[4, 3], [5, 3], [6, 3]]);
    XLSX.utils.book_append_sheet(wb, ebsWs, 'Excavation Breakdown Summary');

    XLSX.writeFile(wb, 'Site_Expense_Final_Report_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  }

  // ---------------------------------------------------------------
  // Fix Historical Categories (Admin only) — preview/apply flow for
  // autoRecategorize on the backend.
  // ---------------------------------------------------------------
  function initRecategorizeCard() {
    const card = document.getElementById('recategorizeCard');
    card.style.display = 'block';

    // Offer every category that actually has expenses in it as a
    // possible "from" bucket — not just "Excavation of Trenches" —
    // since the same historical-blanket-category problem could exist
    // elsewhere (e.g. everything once dumped under "Other Expenses").
    const sel = document.getElementById('recatFromCategory');
    const candidateCategories = CATEGORY_FLAT.filter(c => allExpenses.some(e => e.Category === c));
    sel.innerHTML = candidateCategories.map(c => `<option value="${c}">${c}</option>`).join('');
    if (candidateCategories.includes('Excavation of Trenches')) sel.value = 'Excavation of Trenches';

    let lastPreview = null;

    document.getElementById('recatPreviewBtn').addEventListener('click', async () => {
      const btn = document.getElementById('recatPreviewBtn');
      const applyBtn = document.getElementById('recatApplyBtn');
      const box = document.getElementById('recatPreviewBox');
      btn.disabled = true;
      btn.textContent = 'Checking\u2026';
      applyBtn.style.display = 'none';
      try {
        const result = await Api.autoRecategorize(sel.value, true);
        lastPreview = result;
        if (!result.totalMatches) {
          box.innerHTML = `<p style="color:var(--color-ink-muted);">No expenses under "${result.fromCategory}" matched a more specific category. Nothing to change.</p>`;
        } else {
          const rows = Object.entries(result.byNewCategory).map(([cat, info]) =>
            `<tr><td>${cat}</td><td>${info.count}</td><td>${money(info.total)}</td></tr>`
          ).join('');
          box.innerHTML = `
            <p style="margin-bottom:10px;"><strong>${result.totalMatches}</strong> expense(s) under "${result.fromCategory}" would move:</p>
            <div class="table-wrap">
              <table><thead><tr><th>New Category</th><th>Count</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
            </div>
            <details style="margin-top:12px;">
              <summary style="cursor:pointer;font-size:12.5px;color:var(--color-ink-muted);">Show individual line items</summary>
              <div class="table-wrap" style="margin-top:8px;">
                <table><thead><tr><th>Description</th><th>Amount</th><th>New Category</th></tr></thead><tbody>
                  ${result.matches.map(m => `<tr><td>${m.description}</td><td>${money(m.amount)}</td><td>${m.newCategory}</td></tr>`).join('')}
                </tbody></table>
              </div>
            </details>
          `;
          applyBtn.style.display = 'inline-flex';
        }
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Preview Changes';
      }
    });

    document.getElementById('recatApplyBtn').addEventListener('click', async () => {
      if (!lastPreview || !lastPreview.totalMatches) return;
      const ok = confirm(`This will update the Category on ${lastPreview.totalMatches} expense(s). This can't be undone automatically. Continue?`);
      if (!ok) return;

      const applyBtn = document.getElementById('recatApplyBtn');
      applyBtn.disabled = true;
      applyBtn.textContent = 'Applying\u2026';
      try {
        const result = await Api.autoRecategorize(lastPreview.fromCategory, false);
        showToast(`${result.totalMatches} expense(s) re-categorized`, 'success');
        document.getElementById('recatPreviewBox').innerHTML = '<p style="color:var(--color-accent);">Changes applied. Reloading report\u2026</p>';
        applyBtn.style.display = 'none';
        // Reload everything so the Summary/By Period/detail views reflect the change immediately.
        const [expData] = await Promise.all([Api.getExpenses()]);
        allExpenses = expData.expenses || [];
        groupExpenses();
        renderSummary();
        renderByPeriod();
        renderBlockProductionBreakdown();
        populateDetailSelect();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Apply Changes';
      }
    });
  }

  init();
})();
