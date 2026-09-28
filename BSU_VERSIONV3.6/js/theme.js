/**
 * theme.js — dark/light mode.
 *
 * Applied via a data-theme attribute on <html>. The inline snippet in
 * each page's <head> (see any .html file) sets this BEFORE the page
 * renders, using the same read order as init() below, so there's no
 * flash of the wrong theme on load. This file additionally provides
 * the toggle button behavior used by the sidebar (layout.js) and the
 * login page.
 */
const Theme = (function () {
  const STORAGE_KEY = 'sems_theme'; // 'light' | 'dark'

  function getStored() {
    return localStorage.getItem(STORAGE_KEY);
  }

  function systemPrefersDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function current() {
    return document.documentElement.getAttribute('data-theme')
      || getStored()
      || (systemPrefersDark() ? 'dark' : 'light');
  }

  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }

  // Called once per page load (also safe to call multiple times).
  function init() {
    apply(getStored() || (systemPrefersDark() ? 'dark' : 'light'));
  }

  function toggle() {
    const next = current() === 'dark' ? 'light' : 'dark';
    apply(next);
    localStorage.setItem(STORAGE_KEY, next);
    return next;
  }

  // Renders a toggle button's innerHTML (sun/moon swap is handled by
  // CSS via [data-theme] selectors — see .theme-toggle in style.css).
  function toggleButtonHtml(idAttr) {
    return `<button id="${idAttr}" class="theme-toggle" title="Toggle dark / light mode" aria-label="Toggle dark or light mode">
      <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
      <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
    </button>`;
  }

  function wireButton(id) {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', toggle);
  }

  return { init, apply, toggle, current, toggleButtonHtml, wireButton };
})();
