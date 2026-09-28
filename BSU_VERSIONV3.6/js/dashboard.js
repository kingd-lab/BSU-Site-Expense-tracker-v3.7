/**
 * dashboard.js — powers manager.html (Site Manager) and dashboard.html (Admin)
 */
(function () {
  const isAdminPage = /dashboard\.html$/.test(location.pathname);
  let currentUser = null;
  let allExpenses = [];

  function showToast(msg, type) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show' + (type ? ' ' + type : '');
    setTimeout(() => t.classList.remove('show'), 3200);
  }

  function money(n) {
    return '₦' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function fmtDate(v) {
    if (!v) return '—';
    const d = parseLocalDate(v);
    if (isNaN(d)) return String(v);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function fmtDateTime(v) {
    if (!v) return '—';
    const d = parseLocalDate(v);
    if (isNaN(d)) return String(v);
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  async function init() {
    currentUser = await Auth.requireRole(isAdminPage ? ['Admin'] : ['Site Manager']);
    if (!currentUser) return;

    Layout.build(isAdminPage ? 'dashboard.html' : 'manager.html', currentUser);
    Layout.mainMount().innerHTML = document.getElementById('pageContent').innerHTML;
    document.getElementById('menuBtn')?.addEventListener('click', Layout.toggleSidebar);

    if (isAdminPage) {
      document.getElementById('siteFilter') && populateCategorySelect(document.getElementById('categoryFilter'), true);
    }

    // Deep-link support: manager.html#expenses / dashboard.html#users etc.
    if (location.hash) {
      setTimeout(() => document.querySelector(location.hash)?.scrollIntoView({ behavior: 'smooth' }), 300);
    }

    await Promise.all([loadStats(), loadExpenses()]);
    if (isAdminPage) {
      wireAdminExtras();
      await Promise.all([loadUsers(), loadSites(), loadAuditLog(), loadSiteFilter(), loadLastImportedTracker()]);
    } else {
      wireSearch();
    }
  }

  // Answers "what's already in the app, so what do I need to pull from
  // the next file Ilesanmi/I send?" — shown right at the top of the
  // Admin dashboard since that's the first thing seen before opening
  // any new report to import.
  async function loadLastImportedTracker() {
    const card = document.getElementById('lastImportCard');
    try {
      let latestExpenseDate = null;
      allExpenses.forEach(e => {
        const d = parseLocalDate(e.Date);
        if (!isNaN(d) && (!latestExpenseDate || d > latestExpenseDate)) latestExpenseDate = d;
      });

      let latestCashBookDate = null;
      try {
        const cbData = await Api.getCashBook();
        (cbData.entries || []).forEach(e => {
          const d = parseLocalDate(e.Date);
          if (!isNaN(d) && (!latestCashBookDate || d > latestCashBookDate)) latestCashBookDate = d;
        });
      } catch (err) {
        // Cash Book may not exist yet (sheet not created) — that's fine,
        // just show a dash for it rather than failing the whole tracker.
      }

      document.getElementById('lastExpenseDate').textContent = latestExpenseDate ? fmtDate(latestExpenseDate) : '\u2014 (no expenses yet)';
      document.getElementById('lastCashBookDate').textContent = latestCashBookDate ? fmtDate(latestCashBookDate) : '\u2014 (no Cash Book entries yet)';
      card.style.display = 'block';
    } catch (err) {
      // Non-critical — don't block the rest of the dashboard on this.
    }
  }

  async function loadStats() {
    try {
      const stats = await Api.getDashboardStats();
      document.getElementById('statAllTime').textContent = money(stats.allTimeTotal);
      document.getElementById('statToday').textContent = money(stats.todayTotal);
      document.getElementById('statMonth').textContent = money(stats.monthTotal);
      document.getElementById('statCount').textContent = stats.totalTransactions;
      if (isAdminPage) document.getElementById('statSites').textContent = stats.totalSites;
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function loadSiteFilter() {
    try {
      const data = await Api.getSites();
      const names = (data.sites || []).map(s => s['Site Name']).filter(Boolean).sort();
      const siteFilter = document.getElementById('siteFilter');
      if (!siteFilter) return;
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
      renderExpenses(allExpenses);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function renderExpenses(list) {
    const rows = document.getElementById('expenseRows');
    const empty = document.getElementById('emptyState');
    rows.innerHTML = '';

    if (!list.length) {
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    list.forEach(e => {
      const tr = document.createElement('tr');
      const siteCell = isAdminPage ? `<td>${e.Site || ''}</td>` : '';
      tr.innerHTML = `
        <td><span class="badge gray">${e['Expense ID']}</span></td>
        <td>${fmtDate(e.Date)}</td>
        ${siteCell}
        <td><span class="badge">${e.Category}</span></td>
        <td>${e.Description || ''}</td>
        <td><strong>${money(e.Amount)}</strong></td>
        <td>${e.Vendor || '—'}</td>
        <td>${e['Payment Method'] || '—'}</td>
        <td>${isAdminPage ? (e['Submitted By'] || '') : fmtDateTime(e.Timestamp)}</td>
      `;
      rows.appendChild(tr);
    });
  }

  function applyFilters() {
    const q = (document.getElementById('searchBox').value || '').toLowerCase();
    const site = isAdminPage ? document.getElementById('siteFilter').value : '';
    const cat = isAdminPage ? document.getElementById('categoryFilter').value : '';
    const from = isAdminPage ? document.getElementById('fromDate').value : '';
    const to = isAdminPage ? document.getElementById('toDate').value : '';

    const filtered = allExpenses.filter(e => {
      if (q) {
        const hay = [e.Description, e.Vendor, e.Category, e['Expense ID']].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      if (site && e.Site !== site) return false;
      if (cat && e.Category !== cat) return false;
      const d = fmtCellDateISO(e.Date);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
    renderExpenses(filtered);
  }

  function fmtCellDateISO(v) {
    const d = parseLocalDate(v);
    if (isNaN(d)) return String(v);
    // Local Y/M/D — NOT toISOString(), which converts to UTC and can
    // shift the date by a day depending on the browser's timezone.
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function wireSearch() {
    document.getElementById('searchBox').addEventListener('input', applyFilters);
  }

  function wireAdminExtras() {
    wireSearch();
    ['siteFilter', 'categoryFilter', 'fromDate', 'toDate'].forEach(id => {
      document.getElementById(id).addEventListener('input', applyFilters);
      document.getElementById(id).addEventListener('change', applyFilters);
    });

    document.getElementById('addUserBtn').addEventListener('click', () => {
      document.getElementById('addUserForm').style.display = 'block';
    });
    document.getElementById('cancelAddUser').addEventListener('click', () => {
      document.getElementById('addUserForm').style.display = 'none';
    });
    document.getElementById('saveUserBtn').addEventListener('click', async () => {
      const user = {
        username: document.getElementById('newUsername').value.trim(),
        password: document.getElementById('newPassword').value.trim(),
        role: document.getElementById('newRole').value,
        site: document.getElementById('newSite').value.trim() || 'ALL'
      };
      if (!user.username || !user.password) { showToast('Username and password required', 'error'); return; }
      try {
        await Api.addUser(user);
        showToast('User created', 'success');
        document.getElementById('addUserForm').style.display = 'none';
        await loadUsers();
      } catch (err) { showToast(err.message, 'error'); }
    });

    document.getElementById('addSiteBtn').addEventListener('click', () => {
      document.getElementById('addSiteForm').style.display = 'block';
    });
    document.getElementById('cancelAddSite').addEventListener('click', () => {
      document.getElementById('addSiteForm').style.display = 'none';
    });
    document.getElementById('saveSiteBtn').addEventListener('click', async () => {
      const site = {
        name: document.getElementById('newSiteName').value.trim(),
        location: document.getElementById('newSiteLocation').value.trim()
      };
      if (!site.name) { showToast('Site name required', 'error'); return; }
      try {
        await Api.addSite(site);
        showToast('Site created', 'success');
        document.getElementById('addSiteForm').style.display = 'none';
        await loadSites();
      } catch (err) { showToast(err.message, 'error'); }
    });
  }

  async function loadUsers() {
    try {
      const data = await Api.getUsers();
      const rows = document.getElementById('userRows');
      rows.innerHTML = (data.users || []).map(u => `
        <tr><td>${u.Username}</td><td><span class="badge">${u.Role}</span></td><td>${u.Site}</td></tr>
      `).join('') || '<tr><td colspan="3">No users found.</td></tr>';
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function loadSites() {
    try {
      const data = await Api.getSites();
      const rows = document.getElementById('siteRows');
      rows.innerHTML = (data.sites || []).map(s => `
        <tr><td>${s['Site Name']}</td><td>${s.Location || '—'}</td><td><span class="badge green">${s.Status || 'Active'}</span></td></tr>
      `).join('') || '<tr><td colspan="3">No sites found.</td></tr>';
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function loadAuditLog() {
    try {
      const data = await Api.getAuditLog();
      const rows = document.getElementById('auditRows');
      rows.innerHTML = (data.logs || []).map(l => `
        <tr><td>${fmtDateTime(l.Timestamp)}</td><td>${l.Username}</td><td><span class="badge gray">${l.Action}</span></td><td>${l.Details}</td></tr>
      `).join('') || '<tr><td colspan="4">No audit entries yet.</td></tr>';
    } catch (err) { showToast(err.message, 'error'); }
  }

  init();
})();
