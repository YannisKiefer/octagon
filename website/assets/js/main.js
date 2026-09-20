/* Octagon site: copy buttons + graceful screenshot fallbacks. No dependencies. */
(function () {
  'use strict';

  // Copy buttons
  document.querySelectorAll('.copy-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var code = btn.parentElement.querySelector('code');
      if (!code) return;
      var text = code.textContent;
      var done = function () {
        btn.classList.add('copied');
        btn.textContent = 'Copied';
        window.setTimeout(function () {
          btn.classList.remove('copied');
          btn.textContent = 'Copy';
        }, 1600);
      };
      var fallback = function () {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { /* noop */ }
        document.body.removeChild(ta);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fallback);
      } else {
        fallback();
      }
    });
  });

  // Screenshot placeholders: hide the <img> if the file is missing,
  // so the labeled frame behind it shows through.
  document.querySelectorAll('img[data-fallback]').forEach(function (img) {
    var hide = function () { img.classList.add('img-broken'); };
    img.addEventListener('error', hide);
    if (img.complete && img.naturalWidth === 0) hide();
  });
})();
