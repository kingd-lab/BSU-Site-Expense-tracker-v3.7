/**
 * login.js
 */
(function () {
  // Already signed in? go straight to the right dashboard.
  const existing = Auth.getUser();
  if (existing) {
    window.location.href = Auth.homeFor(existing.role);
    return;
  }

  const form = document.getElementById('loginForm');
  const errorBox = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    errorBox.classList.remove('show');

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    btn.disabled = true;
    btn.textContent = 'Signing in…';

    try {
      const data = await Api.login(username, password);
      Auth.saveSession(data);
      window.location.href = Auth.homeFor(data.role);
    } catch (err) {
      errorBox.textContent = err.message || 'Could not sign in. Please try again.';
      errorBox.classList.add('show');
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });
})();
