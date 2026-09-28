/**
 * api.js — thin wrapper around the Google Apps Script Web App.
 *
 * IMPORTANT: set API_URL to your deployed Apps Script Web App URL,
 * e.g. https://script.google.com/macros/s/AKfycb.../exec
 */
const API_URL = 'https://script.google.com/macros/s/AKfycbyvEl2WHRz8-CTbIBHXIDpSC5zyGYcFjO4SggfQWxPj7ldHK7QneBXrNKD2BB6wPNO0/exec';

/**
 * parseLocalDate — the backend now always sends dates as plain
 * 'yyyy-MM-dd' (or 'yyyy-MM-dd HH:mm:ss' for timestamps) strings, in its
 * own timezone. `new Date("yyyy-MM-dd")` is spec'd to parse that as UTC
 * midnight, not local midnight — so depending on the browser's timezone,
 * displaying it can silently land on the wrong day. This parses the
 * Y/M/D (and H/M/S, if present) pieces directly into a local Date
 * instead, so what you see always matches what's in the sheet.
 */
function parseLocalDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    let m = v.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  return new Date(v);
}

const Api = (function () {
  function getToken() {
    return localStorage.getItem('sems_token');
  }

  async function get(action, params) {
    const url = new URL(API_URL);
    url.searchParams.set('action', action);
    url.searchParams.set('token', getToken() || '');
    if (params) {
      Object.keys(params).forEach(k => url.searchParams.set(k, params[k]));
    }
    const res = await fetch(url.toString(), { method: 'GET' });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }

  async function post(action, payload) {
    const body = Object.assign({ action: action, token: getToken() }, payload || {});
    // Sent as GET with the body packed into a 'payload' param, NOT as a
    // real POST — Apps Script Web Apps redirect every request through
    // script.googleusercontent.com, and browsers silently downgrade a
    // redirected POST to a GET with its body dropped (per the fetch/XHR
    // spec). That made every write action (login included) arrive at
    // the backend with no action and no data, even though the request
    // looked successful here. GET requests were never subject to that
    // downgrade, so routing everything through GET (matched by
    // Code.gs's doGet, which checks for this 'payload' param) sidesteps
    // the issue entirely rather than fighting the redirect.
    const url = new URL(API_URL);
    url.searchParams.set('payload', JSON.stringify(body));
    const res = await fetch(url.toString(), { method: 'GET' });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }

  // Every page that lists expenses (Dashboard, Manager, Reports) was
  // showing them in submission/entry order rather than by the actual
  // expense date, because the backend sorts by Timestamp. Fixing it once
  // here — rather than in every page that calls getExpenses() — means
  // every current and future consumer gets correctly ordered data
  // automatically. Most-recent expense date first, matching how people
  // expect an activity list to read.
  async function getExpenses() {
    const data = await get('getExpenses');
    if (Array.isArray(data.expenses)) {
      data.expenses.sort((a, b) => parseLocalDate(b.Date) - parseLocalDate(a.Date));
    }
    return data;
  }

  return {
    login: (username, password) => post('login', { username, password }),
    logout: () => post('logout', {}),
    verifySession: () => get('verifySession'),
    getExpenses: getExpenses,
    getDashboardStats: () => get('getDashboardStats'),
    getUsers: () => get('getUsers'),
    getSites: () => get('getSites'),
    getAuditLog: () => get('getAuditLog'),
    getProjectHealth: () => get('getProjectHealth'),
    getBlockProduction: () => get('getBlockProduction'),
    getColumnProgress: () => get('getColumnProgress'),
    submitExpense: (expense) => post('submitExpense', { expense }),
    submitExpensesBulk: (expenses) => post('submitExpensesBulk', { expenses }),
    addUser: (user) => post('addUser', { user }),
    addSite: (site) => post('addSite', { site }),
    addProject: (project) => post('addProject', { project }),
    addBlockProduction: (entry) => post('addBlockProduction', { entry }),
    addColumnProgress: (entry) => post('addColumnProgress', { entry }),
    autoRecategorize: (fromCategory, dryRun) => post('autoRecategorize', { fromCategory, dryRun }),
    getCashBook: () => get('getCashBook'),
    addCashBookEntry: (entry) => post('addCashBookEntry', { entry }),
    addCashBookEntriesBulk: (entries) => post('addCashBookEntriesBulk', { entries }),
    deleteCashBookEntry: (entryId) => post('deleteCashBookEntry', { entryId })
  };
})();
