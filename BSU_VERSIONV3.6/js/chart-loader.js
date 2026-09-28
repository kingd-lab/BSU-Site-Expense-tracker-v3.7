/**
 * chart-loader.js — loads Chart.js with automatic fallback across three
 * CDNs. If one CDN is slow/blocked/down, this tries the next instead of
 * leaving the page with no chart library at all — which is what a single
 * hardcoded <script src="cdnjs..."> tag was doing before.
 *
 * Exposes window.chartJsReady, a Promise that resolves to `true` once
 * Chart.js has loaded successfully from any source, or `false` if every
 * source failed (e.g. no internet at all). Pages should `await` this
 * before calling `new Chart(...)`.
 */
window.chartJsReady = new Promise((resolve) => {
  const CDN_URLS = [
    'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.4/chart.umd.min.js',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js',
    'https://unpkg.com/chart.js@4.4.4/dist/chart.umd.min.js'
  ];

  function tryLoad(i) {
    if (i >= CDN_URLS.length) { resolve(false); return; }
    const script = document.createElement('script');
    script.src = CDN_URLS[i];
    script.onload = () => resolve(true);
    script.onerror = () => tryLoad(i + 1);
    document.head.appendChild(script);
  }

  tryLoad(0);
});
