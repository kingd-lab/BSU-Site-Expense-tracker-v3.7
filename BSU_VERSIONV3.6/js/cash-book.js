/**
 * cash-book.js — powers cash-book.html (Admin only).
 *
 * A running-balance ledger matching the site team's existing Cash Book
 * template: Date, Description, Money Out, Money In, Balance. Every
 * Money Out line is auto-categorized (guessCategory, from Categories.gs
 * on the backend / categories.js here for the live preview) and posted
 * as a linked Expense automatically.
 *
 * Entries are NOT re-sorted by date on this page — the running balance
 * only makes sense in the order they were entered, since several
 * undated rows can follow one dated row (a day's batch of spending).
 */
(function () {
  let currentUser = null;
  let sites = [];

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
    if (!v) return '';
    const d = parseLocalDate(v);
    if (isNaN(d)) return String(v);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  async function init() {
    currentUser = await Auth.requireRole(['Admin']);
    if (!currentUser) return;

    Layout.build('cash-book.html', currentUser);
    Layout.mainMount().innerHTML = document.getElementById('pageContent').innerHTML;
    document.getElementById('menuBtn')?.addEventListener('click', Layout.toggleSidebar);

    populateCategorySelect(document.getElementById('cbCategory'), true);

    try {
      const siteData = await Api.getSites();
      sites = siteData.sites || [];
      const siteSel = document.getElementById('cbSite');
      siteSel.innerHTML = '<option value="ALL">ALL</option>' + sites.map(s => `<option value="${s['Site Name']}">${s['Site Name']}</option>`).join('');
    } catch (err) {
      showToast(err.message, 'error');
    }

    wireDescriptionAutoSuggest();
    wireForm();
    await loadLedger();
  }

  // As the person types a description, live-suggest a category from the
  // same keyword logic the backend uses — so they see (and can correct)
  // the guess before submitting, rather than finding out later.
  function wireDescriptionAutoSuggest() {
    const descInput = document.getElementById('cbDescription');
    const catSelect = document.getElementById('cbCategory');
    const hint = document.getElementById('cbHint');
    let userOverrodeCategory = false;

    catSelect.addEventListener('change', () => { userOverrodeCategory = true; });

    descInput.addEventListener('input', () => {
      if (userOverrodeCategory || !descInput.value.trim()) {
        hint.textContent = '';
        return;
      }
      const guess = guessCategory(descInput.value);
      if (guess.confidence === 'keyword') {
        catSelect.value = guess.category;
        hint.textContent = `Suggested: ${guess.category}`;
      } else {
        hint.textContent = 'No confident match — pick a category manually';
      }
    });

    // Reset the override flag whenever the description is cleared for a new entry.
    document.getElementById('cashBookForm').addEventListener('reset', () => { userOverrodeCategory = false; });
  }

  function wireForm() {
    const form = document.getElementById('cashBookForm');
    const dateInput = document.getElementById('cbDate');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('cbSubmitBtn');
      const description = document.getElementById('cbDescription').value.trim();
      const moneyOut = Number(document.getElementById('cbMoneyOut').value) || 0;
      const moneyIn = Number(document.getElementById('cbMoneyIn').value) || 0;

      if (!description) { showToast('Description is required', 'error'); return; }
      if (!moneyOut && !moneyIn) { showToast('Enter an amount in Money Out or Money In', 'error'); return; }

      const entry = {
        date: dateInput.value || '',
        description: description,
        moneyOut: moneyOut,
        moneyIn: moneyIn,
        category: moneyOut > 0 ? document.getElementById('cbCategory').value : '',
        site: document.getElementById('cbSite').value
      };

      btn.disabled = true;
      btn.textContent = 'Adding\u2026';
      try {
        await Api.addCashBookEntry(entry);
        showToast('Entry added', 'success');
        // Keep the date sticky (matches how the source reports batch
        // several lines under one date) but clear everything else.
        const keepDate = dateInput.value;
        document.getElementById('cbDescription').value = '';
        document.getElementById('cbMoneyOut').value = '';
        document.getElementById('cbMoneyIn').value = '';
        document.getElementById('cbHint').textContent = '';
        dateInput.value = keepDate;
        document.getElementById('cbDescription').focus();
        await loadLedger();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Add Entry';
      }
    });
  }

  async function loadLedger() {
    try {
      const data = await Api.getCashBook();
      renderStats(data);
      renderTable(data.entries || []);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function renderStats(data) {
    document.getElementById('statTotalIn').textContent = money(data.totalIn);
    document.getElementById('statTotalOut').textContent = money(data.totalOut);
    document.getElementById('statBalance').textContent = money(data.finalBalance);
    document.getElementById('ledgerMeta').textContent = `${(data.entries || []).length} entries`;
    renderLastEntry(data.entries || []);
  }

  // The whole point of this card: when you open the next report from
  // Ilesanmi, you see exactly where you left off — no scrolling through
  // the ledger or guessing which line you last transcribed.
  function renderLastEntry(entries) {
    const card = document.getElementById('lastEntryCard');
    if (!entries.length) { card.style.display = 'none'; return; }
    const last = entries[entries.length - 1];
    card.style.display = 'block';
    document.getElementById('lastEntryDate').textContent = fmtDate(last.Date) || '(continued from previous date)';
    document.getElementById('lastEntryDesc').textContent = last.Description || '\u2014';
    const out = Number(last['Money Out']) || 0;
    const inn = Number(last['Money In']) || 0;
    document.getElementById('lastEntryAmount').textContent = out ? `${money(out)} (out)` : `${money(inn)} (in)`;
    document.getElementById('lastEntryBalance').textContent = money(last.Balance);
  }

  function renderTable(entries) {
    const tbody = document.getElementById('cashBookRows');
    const empty = document.getElementById('cashBookEmpty');
    if (!entries.length) {
      tbody.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    tbody.innerHTML = entries.map(e => `
      <tr>
        <td>${fmtDate(e.Date)}</td>
        <td>${e.Description || ''}</td>
        <td>${e.Category ? `<span class="badge">${e.Category}</span>` : '\u2014'}</td>
        <td>${e['Money Out'] ? money(e['Money Out']) : '\u2014'}</td>
        <td>${e['Money In'] ? money(e['Money In']) : '\u2014'}</td>
        <td><strong>${money(e.Balance)}</strong></td>
        <td><button class="btn-icon-delete" data-id="${e['Entry ID']}" title="Delete entry">\u2715</button></td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.btn-icon-delete').forEach(btn => {
      btn.addEventListener('click', () => handleDelete(btn.dataset.id));
    });
  }

  async function handleDelete(entryId) {
    if (!confirm('Delete this Cash Book entry? If it auto-posted a linked Expense, that will be removed too. This can\'t be undone.')) return;
    try {
      await Api.deleteCashBookEntry(entryId);
      showToast('Entry deleted', 'success');
      await loadLedger();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  init();
})();
