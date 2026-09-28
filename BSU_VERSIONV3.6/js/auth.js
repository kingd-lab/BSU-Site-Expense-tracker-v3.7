/**
 * auth.js — session storage + route guarding.
 */
const Auth = (function () {
  function saveSession(data) {
    localStorage.setItem('sems_token', data.token);
    localStorage.setItem('sems_username', data.username);
    localStorage.setItem('sems_role', data.role);
    localStorage.setItem('sems_site', data.site);
  }

  function clearSession() {
    localStorage.removeItem('sems_token');
    localStorage.removeItem('sems_username');
    localStorage.removeItem('sems_role');
    localStorage.removeItem('sems_site');
  }

  function getUser() {
    const token = localStorage.getItem('sems_token');
    if (!token) return null;
    return {
      token: token,
      username: localStorage.getItem('sems_username'),
      role: localStorage.getItem('sems_role'),
      site: localStorage.getItem('sems_site')
    };
  }

  // Call at the top of every protected page. Redirects to login if
  // there's no session, and enforces which roles may view this page.
  async function requireRole(allowedRoles) {
    const user = getUser();
    if (!user) {
      window.location.href = 'index.html';
      return null;
    }
    if (allowedRoles && allowedRoles.indexOf(user.role) === -1) {
      window.location.href = homeFor(user.role);
      return null;
    }
    try {
      const check = await Api.verifySession();
      if (!check.valid) {
        clearSession();
        window.location.href = 'index.html';
        return null;
      }
    } catch (e) {
      clearSession();
      window.location.href = 'index.html';
      return null;
    }
    return user;
  }

  function homeFor(role) {
    if (role === 'Site Manager') return 'manager.html';
    if (role === 'Admin') return 'dashboard.html';
    if (role === 'Boss') return 'report.html';
    return 'index.html';
  }

  async function logout() {
    try { await Api.logout(); } catch (e) { /* ignore */ }
    clearSession();
    window.location.href = 'index.html';
  }

  return { saveSession, clearSession, getUser, requireRole, homeFor, logout };
})();
