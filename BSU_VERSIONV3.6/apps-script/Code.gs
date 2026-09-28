/**
 * SITE EXPENSE MANAGEMENT SYSTEM — Backend (Google Apps Script)
 * ----------------------------------------------------------------
 * Deploy as a Web App:
 *   Deploy > New deployment > Type: Web app
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * This script is the ONLY thing that ever touches the Spreadsheet.
 * The frontend never sees the Sheet directly — every read/write goes
 * through doGet / doPost below, gated by a session token.
 */

// ====================== CONFIG ======================
const SHEET_USERS = 'Users';
const SHEET_EXPENSES = 'Expenses';
const SHEET_AUDIT = 'AuditLog';
const SHEET_SITES = 'Sites';
const SHEET_PROJECTS = 'Projects';
const SHEET_BLOCK_PRODUCTION = 'BlockProduction';
const SHEET_COLUMN_PROGRESS = 'ColumnProgress';
const SHEET_CASH_BOOK = 'CashBook';
const SESSION_DURATION_SECONDS = 6 * 60 * 60; // 6 hours

// Budget-health thresholds — tweak these two numbers to change sensitivity.
const HEALTH_OVER_BUDGET_PCT = 100;   // spend / budget >= this  -> Over Budget
const HEALTH_AT_RISK_MARGIN = 15;     // spend% ahead of time% by this many points -> At Risk
const HEALTH_AT_RISK_SPEND_PCT = 85;  // spend / budget >= this (even on schedule) -> At Risk

// ====================== ENTRY POINTS ======================

function doGet(e) {
  try {
    const action = e.parameter.action;
    const token = e.parameter.token;

    switch (action) {
      case 'ping':
        return jsonOut({ ok: true, message: 'Site Expense API is live' });

      case 'verifySession':
        return jsonOut(verifySession(token));

      case 'getExpenses':
        return jsonOut(getExpenses(requireSession(token)));

      case 'getDashboardStats':
        return jsonOut(getDashboardStats(requireSession(token)));

      case 'getUsers':
        return jsonOut(getUsers(requireSession(token)));

      case 'getSites':
        return jsonOut(getSites(requireSession(token)));

      case 'getAuditLog':
        return jsonOut(getAuditLog(requireSession(token)));

      case 'getProjectHealth':
        return jsonOut(getProjectHealth(requireSession(token)));

      case 'getBlockProduction':
        return jsonOut(getBlockProduction(requireSession(token)));

      case 'getColumnProgress':
        return jsonOut(getColumnProgress(requireSession(token)));

      case 'getCashBook':
        return jsonOut(getCashBook(requireSession(token)));

      default:
        return jsonOut({ error: 'Unknown action: ' + action });
    }
  } catch (err) {
    return jsonOut({ error: err.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const action = body.action;

    switch (action) {
      case 'login':
        return jsonOut(login(body.username, body.password));

      case 'logout':
        return jsonOut(logout(body.token));

      case 'submitExpense':
        return jsonOut(submitExpense(requireSession(body.token), body.expense));

      case 'submitExpensesBulk':
        return jsonOut(submitExpensesBulk(requireSession(body.token), body.expenses));

      case 'addUser':
        return jsonOut(addUser(requireSession(body.token), body.user));

      case 'addSite':
        return jsonOut(addSite(requireSession(body.token), body.site));

      case 'addProject':
        return jsonOut(addProject(requireSession(body.token), body.project));

      case 'addBlockProduction':
        return jsonOut(addBlockProduction(requireSession(body.token), body.entry));

      case 'addColumnProgress':
        return jsonOut(addColumnProgress(requireSession(body.token), body.entry));

      case 'autoRecategorize':
        return jsonOut(autoRecategorize(requireSession(body.token), body.fromCategory, body.dryRun !== false));

      case 'addCashBookEntry':
        return jsonOut(addCashBookEntry(requireSession(body.token), body.entry));

      case 'addCashBookEntriesBulk':
        return jsonOut(addCashBookEntriesBulk(requireSession(body.token), body.entries));

      case 'deleteCashBookEntry':
        return jsonOut(deleteCashBookEntry(requireSession(body.token), body.entryId));

      default:
        return jsonOut({ error: 'Unknown action: ' + action });
    }
  } catch (err) {
    return jsonOut({ error: err.message });
  }
}

// ====================== AUTH ======================

function login(username, password) {
  if (!username || !password) throw new Error('Username and password required');

  const sheet = getSheet(SHEET_USERS);
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rUser = String(row[headers.indexOf('Username')]).trim();
    const rPass = String(row[headers.indexOf('Password')]).trim();

    if (rUser.toLowerCase() === String(username).trim().toLowerCase() && rPass === String(password)) {
      const role = row[headers.indexOf('Role')];
      const site = row[headers.indexOf('Site')];

      const token = Utilities.getUuid();
      const session = { username: rUser, role: role, site: site };
      CacheService.getScriptCache().put(token, JSON.stringify(session), SESSION_DURATION_SECONDS);

      logAudit(rUser, 'LOGIN', 'User logged in');

      return { success: true, token: token, username: rUser, role: role, site: site };
    }
  }
  logAudit(username, 'LOGIN_FAILED', 'Invalid credentials attempt');
  throw new Error('Invalid username or password');
}

function logout(token) {
  const session = getSession(token);
  if (session) {
    CacheService.getScriptCache().remove(token);
    logAudit(session.username, 'LOGOUT', 'User logged out');
  }
  return { success: true };
}

function getSession(token) {
  if (!token) return null;
  const raw = CacheService.getScriptCache().get(token);
  return raw ? JSON.parse(raw) : null;
}

function requireSession(token) {
  const session = getSession(token);
  if (!session) throw new Error('Session expired. Please log in again.');
  return session;
}

function verifySession(token) {
  const session = getSession(token);
  if (!session) return { valid: false };
  return { valid: true, username: session.username, role: session.role, site: session.site };
}

// ====================== EXPENSES ======================

function submitExpense(session, expense) {
  if (session.role !== 'Site Manager' && session.role !== 'Admin') {
    throw new Error('Only Site Managers can submit expenses');
  }
  if (!expense || !expense.category || !expense.amount) {
    throw new Error('Missing required expense fields');
  }

  const sheet = getSheet(SHEET_EXPENSES);
  const expenseId = 'EXP-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd-HHmmss');
  const timestamp = new Date();
  const site = session.role === 'Admin' ? (expense.site || 'ALL') : session.site;
  const dateStr = expense.date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  sheet.appendRow([
    expenseId,
    dateStr,
    site,
    expense.category,
    expense.description || '',
    expense.quantity || '',
    expense.unit || '',
    expense.amount,
    expense.vendor || '',
    expense.paymentMethod || '',
    expense.receiptUrl || '',
    session.username,
    timestamp,
    expense.remarks || ''
  ]);
  forcePlainTextDate(sheet, sheet.getLastRow(), 2, dateStr); // column B = Date

  logAudit(session.username, 'EXPENSE_SUBMITTED', 'Submitted ' + expenseId + ' (' + expense.amount + ')');

  return { success: true, expenseId: expenseId };
}

// Bulk version of submitExpense, used by the Excel import feature.
// Writes every row in ONE batched call instead of one appendRow per
// row — much faster for imports of dozens/hundreds of expenses, and
// keeps well within Apps Script's execution time limit.
function submitExpensesBulk(session, expenses) {
  if (session.role !== 'Site Manager' && session.role !== 'Admin') {
    throw new Error('Only Site Managers can submit expenses');
  }
  if (!Array.isArray(expenses) || !expenses.length) {
    throw new Error('No expenses provided');
  }
  if (expenses.length > 500) {
    throw new Error('Please import in batches of 500 or fewer rows');
  }

  const sheet = getSheet(SHEET_EXPENSES);
  const timestamp = new Date();
  const expenseIds = [];
  const rows = expenses.map((expense, i) => {
    if (!expense || !expense.category || !expense.amount) {
      throw new Error('Row ' + (i + 1) + ': category and amount are required');
    }
    const expenseId = 'EXP-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd-HHmmss') + '-' + i;
    const site = session.role === 'Admin' ? (expense.site || 'ALL') : session.site;
    const dateStr = expense.date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    expenseIds.push(expenseId);
    return [
      expenseId, dateStr, site, expense.category, expense.description || '',
      expense.quantity || '', expense.unit || '', expense.amount,
      expense.vendor || '', expense.paymentMethod || '', expense.receiptUrl || '',
      session.username, timestamp, expense.remarks || ''
    ];
  });

  const startRow = sheet.getLastRow() + 1;
  const numCols = 14;
  // Force the whole Date column to plain text BEFORE writing values, so
  // Sheets never gets a chance to auto-convert any of them.
  sheet.getRange(startRow, 2, rows.length, 1).setNumberFormat('@');
  sheet.getRange(startRow, 1, rows.length, numCols).setValues(rows);

  logAudit(session.username, 'BULK_IMPORT', 'Imported ' + rows.length + ' expenses from Excel');
  return { success: true, count: rows.length, expenseIds: expenseIds };
}

function getExpenses(session) {
  const sheet = getSheet(SHEET_EXPENSES);
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return { expenses: [] };

  const headers = rows[0];
  let data = rows.slice(1).map(r => rowToObject(headers, r));

  // Site Managers only ever see their own site's records.
  if (session.role === 'Site Manager') {
    data = data.filter(r => r.Site === session.site);
  }

  data.sort((a, b) => new Date(a.Date) - new Date(b.Date)); // chronological — was sorting by Timestamp (entry order), which scrambled the true expense date order
  return { expenses: data };
}

// ====================== DASHBOARD STATS ======================

function getDashboardStats(session) {
  const sheet = getSheet(SHEET_EXPENSES);
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) {
    return { todayTotal: 0, monthTotal: 0, allTimeTotal: 0, totalTransactions: 0, totalSites: 0, byCategory: {}, byMonth: {}, bySite: {} };
  }

  const headers = rows[0];
  let data = rows.slice(1).map(r => rowToObject(headers, r));

  if (session.role === 'Site Manager') {
    data = data.filter(r => r.Site === session.site);
  }

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const thisMonth = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');

  let todayTotal = 0, monthTotal = 0, allTimeTotal = 0;
  const byCategory = {};
  const byMonth = {};
  const bySite = {};
  const sites = new Set();

  data.forEach(r => {
    const amt = Number(r.Amount) || 0;
    const dateStr = formatCellDate(r.Date);
    sites.add(r.Site);

    if (dateStr === today) todayTotal += amt;
    if (dateStr.indexOf(thisMonth) === 0) monthTotal += amt;
    allTimeTotal += amt;

    byCategory[r.Category] = (byCategory[r.Category] || 0) + amt;
    bySite[r.Site] = (bySite[r.Site] || 0) + amt;

    const monthKey = dateStr.substring(0, 7);
    byMonth[monthKey] = (byMonth[monthKey] || 0) + amt;
  });

  return {
    todayTotal: todayTotal,
    monthTotal: monthTotal,
    allTimeTotal: allTimeTotal,
    totalTransactions: data.length,
    totalSites: sites.size,
    byCategory: byCategory,
    byMonth: byMonth,
    bySite: bySite
  };
}

// ====================== USERS (Admin only) ======================

function getUsers(session) {
  if (session.role !== 'Admin') throw new Error('Access denied');
  const sheet = getSheet(SHEET_USERS);
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  // Never send passwords back to the client.
  const users = rows.slice(1).map(r => {
    const obj = rowToObject(headers, r);
    delete obj.Password;
    return obj;
  });
  return { users: users };
}

function addUser(session, user) {
  if (session.role !== 'Admin') throw new Error('Access denied');
  if (!user || !user.username || !user.password || !user.role) {
    throw new Error('Missing required user fields');
  }
  const sheet = getSheet(SHEET_USERS);
  sheet.appendRow([user.username, user.password, user.role, user.site || 'ALL']);
  logAudit(session.username, 'USER_CREATED', 'Created user ' + user.username + ' (' + user.role + ')');
  return { success: true };
}

// ====================== SITES ======================

function getSites(session) {
  const sheet = getSheet(SHEET_SITES);
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return { sites: [] };
  const headers = rows[0];
  const sites = rows.slice(1).map(r => rowToObject(headers, r));
  return { sites: sites };
}

function addSite(session, site) {
  if (session.role !== 'Admin') throw new Error('Access denied');
  if (!site || !site.name) throw new Error('Site name required');
  const sheet = getSheet(SHEET_SITES);
  sheet.appendRow([site.name, site.location || '', site.status || 'Active']);
  logAudit(session.username, 'SITE_CREATED', 'Created site ' + site.name);
  return { success: true };
}

// ====================== PROJECTS & BUDGET HEALTH ======================
//
// A "project" is a budget attached to a Site. Health is worked out from
// two things compared side by side:
//   spend%  = money spent so far / budget
//   time%   = days elapsed so far / total project duration
// If you're spending noticeably faster than time is passing, that project
// is trending toward a blowout even if it hasn't gone over yet — that's
// "At Risk". Already past the budget is always "Over Budget" regardless
// of schedule. Everything else is "Healthy".

function addProject(session, project) {
  if (session.role !== 'Admin') throw new Error('Access denied');
  if (!project || !project.name || !project.site || !project.budget) {
    throw new Error('Project name, site, and budget are required');
  }
  const sheet = getSheet(SHEET_PROJECTS);
  const projectId = 'PRJ-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd-HHmmss');
  sheet.appendRow([
    projectId,
    project.name,
    project.site,
    Number(project.budget) || 0,
    project.startDate || '',
    project.endDate || '',
    project.status || 'Active',
    project.notes || ''
  ]);
  const projRow = sheet.getLastRow();
  if (project.startDate) forcePlainTextDate(sheet, projRow, 5, project.startDate); // column E = Start Date
  if (project.endDate) forcePlainTextDate(sheet, projRow, 6, project.endDate);     // column F = End Date
  logAudit(session.username, 'PROJECT_CREATED', 'Created project ' + project.name + ' (budget ' + project.budget + ')');
  return { success: true, projectId: projectId };
}

function getProjectHealth(session) {
  if (session.role !== 'Admin' && session.role !== 'Boss') throw new Error('Access denied');

  const projSheet = getSheet(SHEET_PROJECTS);
  const projRows = projSheet.getDataRange().getValues();
  if (projRows.length < 2) return { projects: [], summary: emptyHealthSummary() };

  const projHeaders = projRows[0];
  let projects = projRows.slice(1).map(r => rowToObject(projHeaders, r));

  const expSheet = getSheet(SHEET_EXPENSES);
  const expRows = expSheet.getDataRange().getValues();
  const spendBySite = {};
  if (expRows.length > 1) {
    const expHeaders = expRows[0];
    expRows.slice(1).forEach(r => {
      const obj = rowToObject(expHeaders, r);
      const amt = Number(obj.Amount) || 0;
      spendBySite[obj.Site] = (spendBySite[obj.Site] || 0) + amt;
    });
  }

  const now = new Date();
  const results = projects.map(p => {
    const budget = Number(p.Budget) || 0;
    const spend = spendBySite[p.Site] || 0;
    const spentPct = budget > 0 ? (spend / budget * 100) : null;

    let timePct = null;
    const start = p['Start Date'] ? new Date(p['Start Date']) : null;
    const end = p['End Date'] ? new Date(p['End Date']) : null;
    if (start && end && !isNaN(start) && !isNaN(end) && end > start) {
      const totalDays = (end - start) / 86400000;
      const elapsedDays = Math.min(Math.max((now - start) / 86400000, 0), totalDays);
      timePct = elapsedDays / totalDays * 100;
    }

    const status = computeHealthStatus(budget, spentPct, timePct);

    return {
      'Project ID': p['Project ID'],
      'Project Name': p['Project Name'],
      Site: p.Site,
      Budget: budget,
      Spend: spend,
      Remaining: budget - spend,
      SpentPct: spentPct,
      TimePct: timePct,
      Status: status,
      'Start Date': p['Start Date'] || '',
      'End Date': p['End Date'] || '',
      Notes: p.Notes || ''
    };
  });

  return { projects: results, summary: summarizeHealth(results) };
}

function computeHealthStatus(budget, spentPct, timePct) {
  if (!budget) return 'No Budget Set';
  if (spentPct >= HEALTH_OVER_BUDGET_PCT) return 'Over Budget';
  if (timePct !== null && (spentPct - timePct) > HEALTH_AT_RISK_MARGIN) return 'At Risk';
  if (spentPct >= HEALTH_AT_RISK_SPEND_PCT) return 'At Risk';
  return 'Healthy';
}

function summarizeHealth(results) {
  const summary = emptyHealthSummary();
  results.forEach(r => {
    summary.totalBudget += r.Budget;
    summary.totalSpend += r.Spend;
    if (r.Status === 'Healthy') summary.healthy++;
    else if (r.Status === 'At Risk') summary.atRisk++;
    else if (r.Status === 'Over Budget') summary.overBudget++;
    else summary.noBudget++;
  });
  summary.overallPct = summary.totalBudget > 0 ? (summary.totalSpend / summary.totalBudget * 100) : 0;
  return summary;
}

function emptyHealthSummary() {
  return { totalBudget: 0, totalSpend: 0, overallPct: 0, healthy: 0, atRisk: 0, overBudget: 0, noBudget: 0 };
}

// ====================== BLOCK PRODUCTION TRACKER ======================
//
// Logs daily block-moulding output — cement bags used, blocks produced,
// and the two labour components typical of this work: a rate paid per
// bag of cement mixed, and a rate paid per finished block/piece. Total
// labour cost for the day = (bags × rate/bag) + (pieces × rate/piece).
//
// Every entry with a cost also auto-creates a matching row in Expenses
// (Category: "Block Moulding Labour", under the "Block Production"
// group) so it flows into Reports, the group filter, and Excel/PDF
// exports without being entered twice.

function addBlockProduction(session, entry) {
  if (session.role !== 'Admin' && session.role !== 'Site Manager') throw new Error('Access denied');
  if (!entry || !entry.date || !entry.site || !entry.cementBags) {
    throw new Error('Date, site, and cement bags are required');
  }
  if (session.role === 'Site Manager' && entry.site !== session.site) {
    throw new Error('You can only log production for your own site');
  }

  const cementBags = Number(entry.cementBags) || 0;
  const blocksProduced = Number(entry.blocksProduced) || 0;
  const labourRatePerBag = Number(entry.labourRatePerBag) || 0;
  const ratePerPiece = Number(entry.ratePerPiece) || 0;
  const pieces = entry.pieces !== undefined && entry.pieces !== '' ? Number(entry.pieces) : blocksProduced;

  const avgPerCement = cementBags > 0 ? (blocksProduced / cementBags) : 0;
  const labourCostBagBasis = cementBags * labourRatePerBag;
  const labourCostPieceBasis = pieces * ratePerPiece;
  const totalCost = labourCostBagBasis + labourCostPieceBasis;

  const entryId = 'BP-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd-HHmmss');

  const sheet = getSheet(SHEET_BLOCK_PRODUCTION);
  sheet.appendRow([
    entryId, entry.date, entry.site, cementBags, blocksProduced,
    Math.round(avgPerCement * 100) / 100, labourRatePerBag, labourCostBagBasis,
    ratePerPiece, pieces, labourCostPieceBasis, totalCost,
    entry.notes || '', session.username, new Date().toISOString(), ''
  ]);
  forcePlainTextDate(sheet, sheet.getLastRow(), 2, entry.date); // column B = Date

  // Auto-post the day's labour cost as an expense so it shows up in
  // Reports/exports under Block Production without re-entry.
  let expenseId = '';
  if (totalCost > 0) {
    expenseId = 'EXP-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd-HHmmss');
    const expSheet = getSheet(SHEET_EXPENSES);
    expSheet.appendRow([
      expenseId, entry.date, entry.site, 'Block Moulding Labour',
      'Block production: ' + cementBags + ' bags cement → ' + blocksProduced + ' blocks',
      cementBags, 'bags', totalCost, '', 'Auto (Production Log)', '',
      session.username, new Date().toISOString(), 'Linked to ' + entryId
    ]);
    forcePlainTextDate(expSheet, expSheet.getLastRow(), 2, entry.date); // column B = Date
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 16).setValue(expenseId); // stamp the link back
  }

  logAudit(session.username, 'PRODUCTION_LOGGED', entryId + ' — ' + cementBags + ' bags, ' + blocksProduced + ' blocks, total cost ' + totalCost);
  return { success: true, entryId: entryId, expenseId: expenseId, avgPerCement: avgPerCement, totalCost: totalCost };
}

function getBlockProduction(session) {
  const sheet = getSheet(SHEET_BLOCK_PRODUCTION);
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return { entries: [], totals: emptyProductionTotals(), trend: [] };

  const headers = rows[0];
  let entries = rows.slice(1).map(r => rowToObject(headers, r));

  if (session.role === 'Site Manager') {
    entries = entries.filter(e => e.Site === session.site);
  }
  entries.sort((a, b) => new Date(b.Date) - new Date(a.Date));

  const totals = entries.reduce((acc, e) => {
    acc.cementBags += Number(e['Cement (Bags)']) || 0;
    acc.blocksProduced += Number(e['Blocks Produced']) || 0;
    acc.totalCost += Number(e['Total Cost']) || 0;
    return acc;
  }, emptyProductionTotals());
  totals.avgPerCement = totals.cementBags > 0 ? (totals.blocksProduced / totals.cementBags) : 0;
  totals.costPerBlock = totals.blocksProduced > 0 ? (totals.totalCost / totals.blocksProduced) : 0;

  const trend = entries.slice().reverse().map(e => ({
    date: e.Date,
    blocksProduced: Number(e['Blocks Produced']) || 0,
    avgPerCement: Number(e['Avg per Cement']) || 0,
    totalCost: Number(e['Total Cost']) || 0
  }));

  return { entries: entries, totals: totals, trend: trend };
}

function emptyProductionTotals() {
  return { cementBags: 0, blocksProduced: 0, totalCost: 0, avgPerCement: 0, costPerBlock: 0 };
}

// One-off import of historical block production data — e.g. from an
// uploaded spreadsheet like "BSU Block Production Breakdown". Edit SITE
// and the ROWS array below to match your data, then run this once from
// the function dropdown. Each row becomes both a BlockProduction entry
// and a linked Expense, exactly like using the app's own form.
function importBlockProductionData() {
  const SITE = 'Benue Site'; // <-- change to match an existing site name exactly
  const LABOUR_RATE_PER_BAG = 2900;
  const RATE_PER_PIECE = 100;

  // [date, cementBags, blocksProduced, pieces]
  const ROWS = [
    ['2026-07-09', 20, 600, 600],
    ['2026-07-10', 30, 905, 900],
    ['2026-07-11', 23, 734, 734],
    ['2026-07-13', 32, 1054, 1054],
    ['2026-07-14', 38, 1308, 1309],
    ['2026-07-15', 23, 954, 954],
    ['2026-07-17', 25, 856, 856],
    ['2026-07-18', 13, 445, 445],
    ['2026-07-19', 24, 842, 842],
    ['2026-07-20', 25, 862, 862],
    ['2026-07-21', 20, 700, 700]
  ];

  const importSession = { username: 'import-script', role: 'Admin', site: SITE };
  ROWS.forEach(r => {
    addBlockProduction(importSession, {
      date: r[0], site: SITE, cementBags: r[1], blocksProduced: r[2],
      labourRatePerBag: LABOUR_RATE_PER_BAG, ratePerPiece: RATE_PER_PIECE, pieces: r[3],
      notes: 'Imported from BSU Block Production Breakdown'
    });
  });
  Logger.log('Imported ' + ROWS.length + ' block production entries for ' + SITE + '.');
}

// One-off migration for rows that were created BEFORE the plain-text
// date fix — those still have real Date-object values that depend on
// Session.getScriptTimeZone() being configured correctly to display
// right. This re-stamps every Date/Start Date/End Date cell as plain
// text, using the EXPLICIT timezone below (not the script's own
// setting) so it's correct even if your script and spreadsheet
// timezones don't currently agree with each other.
//
// IMPORTANT: set this to your actual local timezone before running.
const CORRECT_TIMEZONE = 'Africa/Lagos';

function fixExistingDates() {
  let fixedCount = 0;

  const expSheet = getSheet(SHEET_EXPENSES);
  fixedCount += fixDateColumn(expSheet, 2); // Date

  const bpSheet = getSheet(SHEET_BLOCK_PRODUCTION);
  fixedCount += fixDateColumn(bpSheet, 2); // Date

  const projSheet = getSheet(SHEET_PROJECTS);
  fixedCount += fixDateColumn(projSheet, 5); // Start Date
  fixedCount += fixDateColumn(projSheet, 6); // End Date

  Logger.log('Fixed ' + fixedCount + ' date cells using timezone ' + CORRECT_TIMEZONE + '.');
}

function fixDateColumn(sheet, col) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const range = sheet.getRange(2, col, lastRow - 1, 1);
  const values = range.getValues();
  let fixed = 0;
  for (let i = 0; i < values.length; i++) {
    const val = values[i][0];
    if (val instanceof Date) {
      const dateStr = Utilities.formatDate(val, CORRECT_TIMEZONE, 'yyyy-MM-dd');
      const cell = sheet.getRange(2 + i, col);
      cell.setNumberFormat('@');
      cell.setValue(dateStr);
      fixed++;
    }
  }
  return fixed;
}

// ====================== COLUMN PROGRESS TRACKER (Excavation of Trenches) ======================
//
// Tracks physical progress — columns achieved per day — separately from
// cost, since column-base work costs (labour, casting materials, site
// logistics) vary day to day and aren't a clean rate-per-unit formula
// the way Block Production's labour cost is. Cost still lives in the
// normal Expenses sheet under "Excavation of Trenches" / "Excavation
// Equipment Hire" — this tracker just adds the progress dimension
// (columns achieved) and a combined cost-per-column efficiency read.

function addColumnProgress(session, entry) {
  if (session.role !== 'Admin' && session.role !== 'Site Manager') throw new Error('Access denied');
  if (!entry || !entry.date || !entry.site || !entry.columnsAchieved) {
    throw new Error('Date, site, and columns achieved are required');
  }
  if (session.role === 'Site Manager' && entry.site !== session.site) {
    throw new Error('You can only log progress for your own site');
  }

  const columnsAchieved = Number(entry.columnsAchieved) || 0;
  const entryId = 'CP-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd-HHmmss');

  const sheet = getSheet(SHEET_COLUMN_PROGRESS);
  sheet.appendRow([entryId, entry.date, entry.site, columnsAchieved, entry.notes || '', session.username, new Date().toISOString()]);
  forcePlainTextDate(sheet, sheet.getLastRow(), 2, entry.date); // column B = Date

  logAudit(session.username, 'COLUMN_PROGRESS_LOGGED', entryId + ' — ' + columnsAchieved + ' columns achieved');
  return { success: true, entryId: entryId };
}

function getColumnProgress(session) {
  const sheet = getSheet(SHEET_COLUMN_PROGRESS);
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return { entries: [], totals: { columnsAchieved: 0, excavationCost: 0, costPerColumn: 0 }, trend: [] };

  const headers = rows[0];
  let entries = rows.slice(1).map(r => rowToObject(headers, r));
  if (session.role === 'Site Manager') {
    entries = entries.filter(e => e.Site === session.site);
  }
  entries.sort((a, b) => new Date(b.Date) - new Date(a.Date));

  const totalColumns = entries.reduce((s, e) => s + (Number(e['Columns Achieved']) || 0), 0);

  // Pull matching Excavation of Trenches / Excavation Equipment Hire
  // costs from Expenses so the page can show cost alongside progress.
  const expSheet = getSheet(SHEET_EXPENSES);
  const expRows = expSheet.getDataRange().getValues();
  let excavationCost = 0;
  if (expRows.length > 1) {
    const expHeaders = expRows[0];
    expRows.slice(1).forEach(r => {
      const obj = rowToObject(expHeaders, r);
      if (session.role === 'Site Manager' && obj.Site !== session.site) return;
      // Excavation of Trenches + Concrete Works (column base work is
      // folded into Concrete Works, per site team clarification — see
      // categories.js) — both count toward the cost-per-column figure.
      const CONCRETE_WORKS_CATEGORIES = [
        'Column Blinding', 'Column Base', 'Trenches Casting', 'Columns Before Slab', 'Slab',
        'Kickers', 'Column on Slab', 'Lintel', 'Beams & First Floor Slab', 'First Floor Columns',
        'First Floor Lintel', 'Roof Beam', 'Mason/Poker Labour', 'Poker Rental', 'Bentonite'
      ];
      if (obj.Category === 'Excavation of Trenches' || obj.Category === 'Excavation Equipment Hire' || CONCRETE_WORKS_CATEGORIES.indexOf(obj.Category) !== -1) {
        excavationCost += Number(obj.Amount) || 0;
      }
    });
  }

  const costPerColumn = totalColumns > 0 ? (excavationCost / totalColumns) : 0;

  // Cumulative trend, oldest first, for a running-total progress chart.
  let cumulative = 0;
  const trend = entries.slice().reverse().map(e => {
    cumulative += Number(e['Columns Achieved']) || 0;
    return { date: e.Date, columnsAchieved: Number(e['Columns Achieved']) || 0, cumulative: cumulative };
  });

  return {
    entries: entries,
    totals: { columnsAchieved: totalColumns, excavationCost: excavationCost, costPerColumn: costPerColumn },
    trend: trend
  };
}

function logAudit(username, action, details) {
  const sheet = getSheet(SHEET_AUDIT);
  sheet.appendRow([new Date(), username, action, details]);
}

function getAuditLog(session) {
  if (session.role !== 'Admin') throw new Error('Access denied');
  const sheet = getSheet(SHEET_AUDIT);
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return { logs: [] };
  const headers = rows[0];
  let logs = rows.slice(1).map(r => rowToObject(headers, r));
  logs.reverse();
  return { logs: logs.slice(0, 500) };
}

// ====================== BULK AUTO RE-CATEGORIZATION ======================
//
// One-time cleanup tool: historical expenses were imported with a single
// blanket Category ("Excavation of Trenches") covering everything from
// real trench digging to column casting to mason labour. Now that
// categories.js has specific leaf categories for each, this re-runs
// guessCategory() (see Categories.gs) against every expense still sitting
// under a given "from" category and proposes moving it to whatever
// specific category its Description actually matches.
//
// Always preview (dryRun) before applying — this touches every row in
// Expenses that matches, and there's no automatic undo.

function autoRecategorize(session, fromCategory, dryRun) {
  if (session.role !== 'Admin') throw new Error('Access denied');
  if (!fromCategory) throw new Error('fromCategory is required');

  const sheet = getSheet(SHEET_EXPENSES);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const catCol = headers.indexOf('Category');
  const descCol = headers.indexOf('Description');
  const idCol = headers.indexOf('Expense ID');
  const amountCol = headers.indexOf('Amount');

  if (catCol === -1 || descCol === -1) {
    throw new Error('Expenses sheet is missing a Category or Description column');
  }

  const matches = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[catCol] !== fromCategory) continue;

    const guess = guessCategory(row[descCol]);
    // Only act on confident keyword matches that actually move the
    // expense somewhere new — never touch rows guessCategory can't
    // place, and never "match" a row into the category it's already in.
    if (guess.confidence !== 'keyword' || guess.category === fromCategory) continue;

    matches.push({
      rowIndex: i + 1,
      expenseId: row[idCol],
      description: row[descCol],
      amount: row[amountCol],
      oldCategory: row[catCol],
      newCategory: guess.category
    });

    if (!dryRun) {
      sheet.getRange(i + 1, catCol + 1).setValue(guess.category);
    }
  }

  if (!dryRun && matches.length) {
    logAudit(session.username, 'autoRecategorize', `Moved ${matches.length} expenses out of "${fromCategory}" (${matches.map(m => m.newCategory).filter((v, i, a) => a.indexOf(v) === i).join(', ')})`);
  }

  // Summary grouped by destination category, so the preview reads like
  // "12 items -> Column Base (₦840,000)" rather than a flat list.
  const byNewCategory = {};
  matches.forEach(m => {
    if (!byNewCategory[m.newCategory]) byNewCategory[m.newCategory] = { count: 0, total: 0 };
    byNewCategory[m.newCategory].count++;
    byNewCategory[m.newCategory].total += Number(m.amount) || 0;
  });

  return {
    dryRun: !!dryRun,
    fromCategory: fromCategory,
    totalMatches: matches.length,
    byNewCategory: byNewCategory,
    matches: matches
  };
}

// ====================== CASH BOOK ======================
//
// A running-balance ledger, matching your existing Cash Book template:
// Date, Description, Money Out (Debit), Money In (Credit), Balance.
//
// IMPORTANT — this is intentionally NOT sorted by date like Expenses is.
// Your source reports list several undated rows after one dated row
// (all part of that day's batch of spending), and the running balance
// only makes sense read top-to-bottom in the order they were entered.
// Re-sorting this by date would silently corrupt every balance below
// the first out-of-order row. Balance is always recomputed fresh from
// row order, never stored, so it's never at risk of drifting out of
// sync with the entries themselves.
//
// Every Money Out (debit) line is auto-categorized via guessCategory()
// and posted as a linked Expense — same auto-post pattern as Block
// Production labour — so it flows into Reports/Final Report without
// re-entry. Money In (credit) lines stay in the Cash Book only, since
// they're not a cost.

function addCashBookEntry(session, entry) {
  if (session.role !== 'Admin') throw new Error('Only Admin can enter Cash Book transactions');
  if (!entry || !entry.description) throw new Error('Description is required');

  const moneyOut = Number(entry.moneyOut) || 0;
  const moneyIn = Number(entry.moneyIn) || 0;
  if (!moneyOut && !moneyIn) throw new Error('Enter an amount in Money Out or Money In');

  const site = entry.site || 'ALL';
  const dateStr = entry.date || '';
  const entryId = 'CB-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd-HHmmss');

  let category = entry.category || '';
  let expenseId = '';

  if (moneyOut > 0) {
    if (!category) {
      const guess = guessCategory(entry.description);
      category = guess.category;
    }
    expenseId = 'EXP-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd-HHmmss');
    const expSheet = getSheet(SHEET_EXPENSES);
    expSheet.appendRow([
      expenseId, dateStr || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      site, category, entry.description, '', '', moneyOut, '', 'Cash Book Entry', '',
      session.username, new Date(), 'Linked to ' + entryId
    ]);
    if (dateStr) forcePlainTextDate(expSheet, expSheet.getLastRow(), 2, dateStr);
  }

  const sheet = getSheet(SHEET_CASH_BOOK);
  sheet.appendRow([entryId, dateStr, entry.description, moneyOut, moneyIn, category, site, expenseId, session.username, new Date().toISOString()]);
  if (dateStr) forcePlainTextDate(sheet, sheet.getLastRow(), 2, dateStr);

  logAudit(session.username, 'CASHBOOK_ENTRY', entryId + ' — ' + entry.description + (moneyOut ? ' (out ' + moneyOut + ')' : '') + (moneyIn ? ' (in ' + moneyIn + ')' : ''));

  return { success: true, entryId: entryId, expenseId: expenseId, category: category };
}

// Bulk version for importing a historical Cash Book (like your uploaded
// template) in one pass. Rows are written in the EXACT order given —
// that order is what the running balance is computed from, so pass
// rows in the same top-to-bottom order they appear in your source file.
function addCashBookEntriesBulk(session, entries) {
  if (session.role !== 'Admin') throw new Error('Only Admin can enter Cash Book transactions');
  if (!Array.isArray(entries) || !entries.length) throw new Error('No entries provided');
  if (entries.length > 500) throw new Error('Please import in batches of 500 or fewer rows');

  const results = entries.map(entry => addCashBookEntry(session, entry));
  logAudit(session.username, 'CASHBOOK_BULK_IMPORT', 'Imported ' + entries.length + ' Cash Book entries');
  return { success: true, count: results.length, results: results };
}

function deleteCashBookEntry(session, entryId) {
  if (session.role !== 'Admin') throw new Error('Only Admin can delete Cash Book transactions');
  if (!entryId) throw new Error('entryId is required');

  const sheet = getSheet(SHEET_CASH_BOOK);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('Entry ID');
  const linkedCol = headers.indexOf('Linked Expense ID');

  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === entryId) {
      const linkedExpenseId = data[i][linkedCol];
      sheet.deleteRow(i + 1);

      // Keep the linked Expense in sync — deleting a Cash Book line
      // without removing its auto-posted Expense would leave a
      // dangling cost that no longer has a Cash Book source.
      if (linkedExpenseId) {
        const expSheet = getSheet(SHEET_EXPENSES);
        const expData = expSheet.getDataRange().getValues();
        const expIdCol = expData[0].indexOf('Expense ID');
        for (let j = 1; j < expData.length; j++) {
          if (expData[j][expIdCol] === linkedExpenseId) {
            expSheet.deleteRow(j + 1);
            break;
          }
        }
      }

      logAudit(session.username, 'CASHBOOK_DELETE', 'Deleted ' + entryId + (linkedExpenseId ? ' (and linked ' + linkedExpenseId + ')' : ''));
      return { success: true };
    }
  }
  throw new Error('Entry not found: ' + entryId);
}

function getCashBook(session) {
  if (session.role !== 'Admin') throw new Error('Access denied');

  const sheet = getSheet(SHEET_CASH_BOOK);
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return { entries: [], totalOut: 0, totalIn: 0, finalBalance: 0 };

  const headers = rows[0];
  const entries = rows.slice(1).map(r => rowToObject(headers, r));

  // Running balance computed fresh, in sheet row order — see note above
  // on why this must NOT be sorted by date.
  let running = 0, totalOut = 0, totalIn = 0;
  entries.forEach(e => {
    const out = Number(e['Money Out']) || 0;
    const inn = Number(e['Money In']) || 0;
    running += (inn - out);
    totalOut += out;
    totalIn += inn;
    e.Balance = running;
  });

  return { entries: entries, totalOut: totalOut, totalIn: totalIn, finalBalance: running };
}

// ====================== HELPERS ======================

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Sheet not found: ' + name + '. Run setupSheets() first.');
  return sheet;
}

// Forces a specific cell to store its value as literal plain text,
// bypassing Google Sheets' automatic "this looks like a date, let me
// convert it" behavior entirely. Without this, a written string like
// "2026-07-24" gets silently turned into a real Date value using
// whatever timezone the SHEET happens to be set to — which may not
// match the Apps Script project's own timezone setting used when
// reading it back out. Two different timezones touching the same date
// is exactly what causes the "off by one day" bug. Storing as plain
// text sidesteps the whole problem: what you type is what's stored,
// and what's stored is exactly what gets sent to the frontend.
function forcePlainTextDate(sheet, row, col, dateStr) {
  const cell = sheet.getRange(row, col);
  cell.setNumberFormat('@');
  cell.setValue(dateStr);
}

function rowToObject(headers, row) {
  const tz = Session.getScriptTimeZone();
  const obj = {};
  headers.forEach((h, i) => {
    let val = row[i];
    // Google Sheets returns date/datetime cells as JS Date objects. If we
    // let those pass through to JSON.stringify as-is, they serialize to a
    // UTC timestamp — and if the browser's timezone differs from this
    // script's timezone (Session.getScriptTimeZone()), the date can shift
    // by a day when the frontend displays it. Converting to a plain string
    // here, in this script's own timezone, removes that ambiguity entirely.
    if (val instanceof Date) {
      const isTimestamp = /timestamp/i.test(h);
      val = Utilities.formatDate(val, tz, isTimestamp ? 'yyyy-MM-dd HH:mm:ss' : 'yyyy-MM-dd');
    }
    obj[h] = val;
  });
  return obj;
}

function formatCellDate(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(val);
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ====================== ONE-TIME SETUP ======================
// Run this once from the Apps Script editor (select setupSheets, click Run)
// to create all sheets with correct headers and a starter admin user.

// One-off migration for spreadsheets that were set up before the Projects
// feature existed — adds just the Projects sheet without touching your
// existing Users/Expenses/Sites data. Safe to run any time; it does
// nothing if the sheet already exists.
function addProjectsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(SHEET_PROJECTS)) {
    Logger.log('Projects sheet already exists — nothing to do.');
    return;
  }
  const projectsSheet = ss.insertSheet(SHEET_PROJECTS);
  projectsSheet.appendRow(['Project ID', 'Project Name', 'Site', 'Budget', 'Start Date', 'End Date', 'Status', 'Notes']);
  projectsSheet.setFrozenRows(1);
  Logger.log('Projects sheet created.');
}

// One-off migration for spreadsheets that were set up before the Block
// Production tracker existed — adds just the BlockProduction sheet
// without touching your existing data. Safe to run any time.
function addBlockProductionSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(SHEET_BLOCK_PRODUCTION)) {
    Logger.log('BlockProduction sheet already exists — nothing to do.');
    return;
  }
  const bpSheet = ss.insertSheet(SHEET_BLOCK_PRODUCTION);
  bpSheet.appendRow(['Entry ID', 'Date', 'Site', 'Cement (Bags)', 'Blocks Produced', 'Avg per Cement', 'Labour Rate/Bag', 'Labour Cost (Bag Basis)', 'Rate/Piece', 'Pieces', 'Labour Cost (Piece Basis)', 'Total Cost', 'Notes', 'Submitted By', 'Timestamp', 'Linked Expense ID']);
  bpSheet.setFrozenRows(1);
  Logger.log('BlockProduction sheet created.');
}

// One-off migration for spreadsheets that were set up before the Column
// Progress tracker existed — adds just the ColumnProgress sheet without
// touching your existing data. Safe to run any time.
function addColumnProgressSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(SHEET_COLUMN_PROGRESS)) {
    Logger.log('ColumnProgress sheet already exists — nothing to do.');
    return;
  }
  const cpSheet = ss.insertSheet(SHEET_COLUMN_PROGRESS);
  cpSheet.appendRow(['Entry ID', 'Date', 'Site', 'Columns Achieved', 'Notes', 'Submitted By', 'Timestamp']);
  cpSheet.setFrozenRows(1);
  Logger.log('ColumnProgress sheet created.');
}

// One-off migration for spreadsheets that were set up before the Cash
// Book existed — adds just the CashBook sheet without touching your
// existing data. Safe to run any time.
function addCashBookSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(SHEET_CASH_BOOK)) {
    Logger.log('CashBook sheet already exists — nothing to do.');
    return;
  }
  const sheet = ss.insertSheet(SHEET_CASH_BOOK);
  sheet.appendRow(['Entry ID', 'Date', 'Description', 'Money Out', 'Money In', 'Category', 'Site', 'Linked Expense ID', 'Submitted By', 'Timestamp']);
  sheet.setFrozenRows(1);
  Logger.log('CashBook sheet created.');
}

function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const usersSheet = ss.getSheetByName(SHEET_USERS) || ss.insertSheet(SHEET_USERS);
  usersSheet.clear();
  usersSheet.appendRow(['Username', 'Password', 'Role', 'Site']);
  usersSheet.appendRow(['king', 'ChangeMe123!', 'Admin', 'ALL']);
  usersSheet.appendRow(['boss', 'ChangeMe123!', 'Boss', 'ALL']);
  usersSheet.appendRow(['john', 'ChangeMe123!', 'Site Manager', 'Lekki']);
  usersSheet.setFrozenRows(1);

  const expensesSheet = ss.getSheetByName(SHEET_EXPENSES) || ss.insertSheet(SHEET_EXPENSES);
  expensesSheet.clear();
  expensesSheet.appendRow(['Expense ID', 'Date', 'Site', 'Category', 'Description', 'Quantity', 'Unit', 'Amount', 'Vendor', 'Payment Method', 'Receipt', 'Submitted By', 'Timestamp', 'Remarks']);
  expensesSheet.setFrozenRows(1);

  const auditSheet = ss.getSheetByName(SHEET_AUDIT) || ss.insertSheet(SHEET_AUDIT);
  auditSheet.clear();
  auditSheet.appendRow(['Timestamp', 'Username', 'Action', 'Details']);
  auditSheet.setFrozenRows(1);

  const sitesSheet = ss.getSheetByName(SHEET_SITES) || ss.insertSheet(SHEET_SITES);
  sitesSheet.clear();
  sitesSheet.appendRow(['Site Name', 'Location', 'Status']);
  sitesSheet.appendRow(['Lekki', 'Lagos', 'Active']);
  sitesSheet.setFrozenRows(1);

  const projectsSheet = ss.getSheetByName(SHEET_PROJECTS) || ss.insertSheet(SHEET_PROJECTS);
  projectsSheet.clear();
  projectsSheet.appendRow(['Project ID', 'Project Name', 'Site', 'Budget', 'Start Date', 'End Date', 'Status', 'Notes']);
  projectsSheet.setFrozenRows(1);

  const bpSheet = ss.getSheetByName(SHEET_BLOCK_PRODUCTION) || ss.insertSheet(SHEET_BLOCK_PRODUCTION);
  bpSheet.clear();
  bpSheet.appendRow(['Entry ID', 'Date', 'Site', 'Cement (Bags)', 'Blocks Produced', 'Avg per Cement', 'Labour Rate/Bag', 'Labour Cost (Bag Basis)', 'Rate/Piece', 'Pieces', 'Labour Cost (Piece Basis)', 'Total Cost', 'Notes', 'Submitted By', 'Timestamp', 'Linked Expense ID']);
  bpSheet.setFrozenRows(1);

  const cpSheet = ss.getSheetByName(SHEET_COLUMN_PROGRESS) || ss.insertSheet(SHEET_COLUMN_PROGRESS);
  cpSheet.clear();
  cpSheet.appendRow(['Entry ID', 'Date', 'Site', 'Columns Achieved', 'Notes', 'Submitted By', 'Timestamp']);
  cpSheet.setFrozenRows(1);

  const cbSheet = ss.getSheetByName(SHEET_CASH_BOOK) || ss.insertSheet(SHEET_CASH_BOOK);
  cbSheet.clear();
  cbSheet.appendRow(['Entry ID', 'Date', 'Description', 'Money Out', 'Money In', 'Category', 'Site', 'Linked Expense ID', 'Submitted By', 'Timestamp']);
  cbSheet.setFrozenRows(1);

  Logger.log('Setup complete. Default logins (CHANGE THESE PASSWORDS): king / boss / john, password: ChangeMe123!');
}
