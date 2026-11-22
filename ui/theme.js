// Follow the computer's light or dark setting (ICAIRE's dark tokens hang on data-theme). Loaded first, in the
// page's head, so the page never flashes the wrong colours.
(function () {
  var m = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
  var set = function () { document.documentElement.dataset.theme = m && m.matches ? 'dark' : 'light'; };
  set();
  if (m && m.addEventListener) m.addEventListener('change', set);
})();
