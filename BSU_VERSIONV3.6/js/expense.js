/**
 * expense.js — powers add-expense.html
 */
(function () {
  let currentUser = null;

  function showToast(msg, type) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show' + (type ? ' ' + type : '');
    setTimeout(() => t.classList.remove('show'), 3200);
  }

  async function init() {
    currentUser = await Auth.requireRole(['Site Manager', 'Admin']);
    if (!currentUser) return;

    Layout.build('add-expense.html', currentUser);
    Layout.mainMount().innerHTML = document.getElementById('pageContent').innerHTML;

    document.getElementById('menuBtn')?.addEventListener('click', Layout.toggleSidebar);

    document.getElementById('siteSub').textContent =
      currentUser.role === 'Admin' ? 'Log a new expense (Admin can assign any site)' : `Log a new expense for ${currentUser.site}`;

    document.getElementById('date').valueAsDate = new Date();
    populateCategorySelect(document.getElementById('category'), false);

    // Admins can log for any site — populate a dropdown instead of free text.
    if (currentUser.role === 'Admin') {
      const grid = document.querySelector('.form-grid');
      const siteField = document.createElement('div');
      siteField.className = 'field';
      siteField.innerHTML = `<label for="siteInput">Site</label><select id="siteInput" required><option value="">Select a site…</option></select>`;
      grid.insertBefore(siteField, grid.firstChild);
      try {
        const data = await Api.getSites();
        const select = document.getElementById('siteInput');
        (data.sites || []).map(s => s['Site Name']).filter(Boolean).sort().forEach(name => {
          const opt = document.createElement('option');
          opt.value = name; opt.textContent = name;
          select.appendChild(opt);
        });
      } catch (err) {
        showToast(err.message, 'error');
      }
    }

    document.getElementById('expenseForm').addEventListener('submit', onSubmit);
  }

  async function onSubmit(e) {
    e.preventDefault();
    const errorBox = document.getElementById('formError');
    errorBox.classList.remove('show');

    const amount = parseFloat(document.getElementById('amount').value);
    if (!amount || amount <= 0) {
      errorBox.textContent = 'Please enter a valid amount.';
      errorBox.classList.add('show');
      return;
    }

    const expense = {
      date: document.getElementById('date').value,
      category: document.getElementById('category').value,
      description: document.getElementById('description').value.trim(),
      quantity: document.getElementById('quantity').value,
      unit: document.getElementById('unit').value.trim(),
      amount: amount,
      vendor: document.getElementById('vendor').value.trim(),
      paymentMethod: document.getElementById('paymentMethod').value,
      receiptUrl: document.getElementById('receiptUrl').value.trim(),
      remarks: document.getElementById('remarks').value.trim()
    };

    const siteInput = document.getElementById('siteInput');
    if (siteInput) expense.site = siteInput.value.trim();

    const btn = document.getElementById('submitBtn');
    btn.disabled = true;
    btn.textContent = 'Submitting…';

    try {
      const res = await Api.submitExpense(expense);
      showToast('Expense ' + res.expenseId + ' submitted successfully', 'success');
      setTimeout(() => { window.location.href = Auth.homeFor(currentUser.role); }, 900);
    } catch (err) {
      errorBox.textContent = err.message || 'Could not submit expense.';
      errorBox.classList.add('show');
      btn.disabled = false;
      btn.textContent = 'Submit Expense';
    }
  }

  init();
})();
