/**
 * layout.js — builds the sidebar nav for the current role and wires up
 * the mobile menu toggle. Include after auth.js on every dashboard page.
 */
const Layout = (function () {
  const ICONS = {
    home: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg>',
    plus: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    file: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h8M8 9h2"/></svg>',
    bar: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M12 20V4M20 20v-7"/></svg>',
    users: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    shield: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/></svg>',
    pulse: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2-7 4 14 2-7h6"/></svg>',
    layers: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5M3 17l9 5 9-5"/></svg>',
    upload: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4m0 0-4 4m4-4 4 4"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
    excavate: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V10l7-6 7 6v11"/><path d="M10 21v-6h4v6"/></svg>'
  };

  const NAV = {
    'Site Manager': [
      { href: 'manager.html', icon: ICONS.home, label: 'Dashboard' },
      { href: 'add-expense.html', icon: ICONS.plus, label: 'Add Expense' },
      { href: 'import-expenses.html', icon: ICONS.upload, label: 'Import Expenses' },
      { href: 'manager.html#expenses', icon: ICONS.file, label: 'My Expenses' },
      { href: 'block-production.html', icon: ICONS.layers, label: 'Block Production' },
      { href: 'import-block-production.html', icon: ICONS.upload, label: 'Import Block Production' },
      { href: 'excavation-tracker.html', icon: ICONS.excavate, label: 'Excavation of Trenches' },
      { href: 'import-excavation.html', icon: ICONS.upload, label: 'Import Excavation' }
    ],
    'Admin': [
      { href: 'dashboard.html', icon: ICONS.home, label: 'Dashboard' },
      { href: 'add-expense.html', icon: ICONS.plus, label: 'Add Expense' },
      { href: 'import-expenses.html', icon: ICONS.upload, label: 'Import Expenses' },
      { href: 'report.html', icon: ICONS.bar, label: 'Reports' },
      { href: 'final-report.html', icon: ICONS.file, label: 'Final Report' },
      { href: 'cash-book.html', icon: ICONS.bar, label: 'Cash Book' },
      { href: 'import-cash-book.html', icon: ICONS.upload, label: 'Import Cash Book' },
      { href: 'projects.html', icon: ICONS.pulse, label: 'Project Health' },
      { href: 'block-production.html', icon: ICONS.layers, label: 'Block Production' },
      { href: 'import-block-production.html', icon: ICONS.upload, label: 'Import Block Production' },
      { href: 'excavation-tracker.html', icon: ICONS.excavate, label: 'Excavation of Trenches' },
      { href: 'import-excavation.html', icon: ICONS.upload, label: 'Import Excavation' },
      { href: 'dashboard.html#users', icon: ICONS.users, label: 'Users & Sites' },
      { href: 'dashboard.html#audit', icon: ICONS.shield, label: 'Audit Log' }
    ],
    'Boss': [
      { href: 'report.html', icon: ICONS.bar, label: 'Reports' },
      { href: 'final-report.html', icon: ICONS.file, label: 'Final Report' },
      { href: 'projects.html', icon: ICONS.pulse, label: 'Project Health' },
      { href: 'block-production.html', icon: ICONS.layers, label: 'Block Production' },
      { href: 'excavation-tracker.html', icon: ICONS.excavate, label: 'Excavation of Trenches' }
    ]
  };

  function initials(name) {
    return (name || '?').slice(0, 2).toUpperCase();
  }

  function build(activeHref, user) {
    const items = NAV[user.role] || [];
    const navHtml = items.map(item => {
      const isActive = item.href.split('#')[0] === activeHref;
      return `<a href="${item.href}" class="${isActive ? 'active' : ''}">
        <span class="icon">${item.icon}</span><span>${item.label}</span>
      </a>`;
    }).join('');

    const siteLine = user.role === 'Site Manager' ? ` · ${user.site}` : '';

    document.body.insertAdjacentHTML('afterbegin', `
      <div class="sidebar-backdrop" id="sidebarBackdrop"></div>
      <div class="app-shell">
        <aside class="sidebar" id="sidebar">
          <div class="sidebar-toprow">
            <div class="sidebar-brand" style="padding:0;">
              <img src="assets/img/bucyrus-icon.png" alt="Bucyrus Integrated Ltd" class="mark-img">
              <div>
                <div class="name">Bucyrus Integrated</div>
                <div class="tag">Site Expense Management</div>
              </div>
            </div>
          </div>
          <div style="display:flex; justify-content:flex-end; padding: 0 8px 12px;">
            ${Theme.toggleButtonHtml('themeToggleBtn')}
          </div>
          <nav class="sidebar-nav">${navHtml}</nav>
          <div class="sidebar-user">
            <div class="avatar">${initials(user.username)}</div>
            <div>
              <div class="who">${user.username}</div>
              <div class="role">${user.role}${siteLine}</div>
            </div>
            <button id="logoutBtn" class="logout-btn" title="Log out">Log out</button>
          </div>
        </aside>
        <main class="main" id="mainContent"></main>
      </div>
    `);

    document.getElementById('logoutBtn').addEventListener('click', () => Auth.logout());
    Theme.wireButton('themeToggleBtn');

    const backdrop = document.getElementById('sidebarBackdrop');
    backdrop.addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('open');
      backdrop.classList.remove('show');
    });
  }

  function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebarBackdrop').classList.toggle('show');
  }

  function mainMount() {
    return document.getElementById('mainContent');
  }

  return { build, toggleSidebar, mainMount };
})();
