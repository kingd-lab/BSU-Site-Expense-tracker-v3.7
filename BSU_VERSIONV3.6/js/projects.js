/**
 * projects.js — powers projects.html (Project Health).
 * Visible to Admin (full CRUD), Boss (read-only), and Site Manager
 * (read-only, scoped to their own site by the backend).
 */
(function () {
  let currentUser = null;

  const STATUS_CLASS = {
    'Healthy': 'green',
    'At Risk': 'amber',
    'Over Budget': 'red',
    'No Budget Set': 'gray'
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

  function pct(n) {
    return n === null || n === undefined ? '—' : Math.round(n) + '%';
  }

  function fmtDate(v) {
    if (!v) return '—';
    const d = parseLocalDate(v);
    if (isNaN(d)) return String(v);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  async function init() {
    currentUser = await Auth.requireRole(['Admin', 'Boss']);
    if (!currentUser) return;

    Layout.build('projects.html', currentUser);
    Layout.mainMount().innerHTML = document.getElementById('pageContent').innerHTML;
    document.getElementById('menuBtn')?.addEventListener('click', Layout.toggleSidebar);

    if (currentUser.role === 'Admin') {
      document.getElementById('addProjectBtn').style.display = 'inline-flex';
      wireAddProject();
    }

    await loadHealth();
  }

  function wireAddProject() {
    document.getElementById('addProjectBtn').addEventListener('click', () => {
      document.getElementById('addProjectForm').style.display = 'block';
    });
    document.getElementById('cancelAddProject').addEventListener('click', () => {
      document.getElementById('addProjectForm').style.display = 'none';
    });
    document.getElementById('saveProjectBtn').addEventListener('click', async () => {
      const project = {
        name: document.getElementById('newProjName').value.trim(),
        site: document.getElementById('newProjSite').value.trim(),
        budget: document.getElementById('newProjBudget').value,
        status: document.getElementById('newProjStatus').value,
        startDate: document.getElementById('newProjStart').value,
        endDate: document.getElementById('newProjEnd').value,
        notes: document.getElementById('newProjNotes').value.trim()
      };
      if (!project.name || !project.site || !project.budget) {
        showToast('Project name, site, and budget are required', 'error');
        return;
      }
      try {
        await Api.addProject(project);
        showToast('Project created', 'success');
        document.getElementById('addProjectForm').style.display = 'none';
        ['newProjName', 'newProjSite', 'newProjBudget', 'newProjStart', 'newProjEnd', 'newProjNotes'].forEach(id => {
          document.getElementById(id).value = '';
        });
        await loadHealth();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  async function loadHealth() {
    try {
      const data = await Api.getProjectHealth();
      renderSummary(data.summary);
      renderProjects(data.projects || []);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function renderSummary(s) {
    document.getElementById('statBudget').textContent = money(s.totalBudget);
    document.getElementById('statSpent').textContent = money(s.totalSpend);
    document.getElementById('statUtilisation').textContent = pct(s.overallPct);
    const bits = [];
    if (s.healthy) bits.push(`<span style="color:#0A7A48">${s.healthy} Healthy</span>`);
    if (s.atRisk) bits.push(`<span style="color:#8A6416">${s.atRisk} At Risk</span>`);
    if (s.overBudget) bits.push(`<span style="color:var(--color-danger)">${s.overBudget} Over</span>`);
    if (s.noBudget) bits.push(`<span style="color:var(--color-ink-muted)">${s.noBudget} No Budget</span>`);
    document.getElementById('statMix').innerHTML = bits.join(' · ') || '—';
  }

  function renderProjects(list) {
    const wrap = document.getElementById('projectList');
    const empty = document.getElementById('emptyState');
    wrap.innerHTML = '';

    if (!list.length) {
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    list.forEach(p => {
      const badgeClass = STATUS_CLASS[p.Status] || 'gray';
      const barPct = p.SpentPct === null ? 0 : Math.min(p.SpentPct, 100);
      const overshoot = p.SpentPct !== null && p.SpentPct > 100;
      const timelineNote = p.TimePct !== null
        ? `<span class="kv-row-inline">Time elapsed: <strong>${pct(p.TimePct)}</strong></span>`
        : `<span class="kv-row-inline field-hint">No start/end date — budget-only read</span>`;

      const el = document.createElement('div');
      el.className = 'project-card';
      el.innerHTML = `
        <div class="project-card-head">
          <div>
            <div class="project-name">${p['Project Name']}</div>
            <div class="project-site">${p.Site} · ${fmtDate(p['Start Date'])} → ${fmtDate(p['End Date'])}</div>
          </div>
          <span class="badge ${badgeClass}">${p.Status}</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill ${badgeClass}" style="width:${barPct}%"></div>
        </div>
        <div class="project-card-foot">
          <span><strong>${money(p.Spend)}</strong> spent of ${money(p.Budget)} (${pct(p.SpentPct)})</span>
          <span class="${overshoot ? 'over-amount' : ''}">${overshoot ? money(Math.abs(p.Remaining)) + ' over' : money(p.Remaining) + ' remaining'}</span>
        </div>
        <div class="project-card-foot" style="margin-top:2px;">
          ${timelineNote}
          ${p.Notes ? `<span class="field-hint">${p.Notes}</span>` : ''}
        </div>
      `;
      wrap.appendChild(el);
    });
  }

  init();
})();
