/* Octagon site: LED-dot bitmap type, gauge ticks, entrance control,
   copy buttons, screenshot fallbacks. No dependencies. */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- LED dot type ---------- */

  // 7-row bitmap glyphs (strings of 0/1), per the design spec.
  var GLYPHS = {
    '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
    '1': ['010', '110', '010', '010', '010', '010', '111'],
    '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
    '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
    '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
    '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
    '.': ['0', '0', '0', '0', '0', '0', '1'],
    'I': ['111', '010', '010', '010', '010', '010', '111'],
    'a': ['00000', '00000', '01110', '00001', '01111', '10001', '01111'],
    'e': ['00000', '00000', '01110', '10001', '11111', '10000', '01110'],
    'g': ['00000', '00000', '01111', '10001', '01111', '00001', '01110'],
    'i': ['1', '0', '1', '1', '1', '1', '1'],
    'l': ['10', '10', '10', '10', '10', '10', '01'],
    'n': ['00000', '00000', '11110', '10001', '10001', '10001', '10001'],
    't': ['010', '010', '111', '010', '010', '010', '001'],
    'r': ['00000', '00000', '10110', '11001', '10000', '10000', '10000']
  };

  function renderDots(el) {
    var text = el.getAttribute('data-dots');
    if (!text) return;

    var isWord = el.classList.contains('dot-word');
    var inContext = !isWord && el.closest && el.closest('.metric--context');
    var pitchX = isWord ? 4 : 5;
    var pitchY = 4;
    var radius = isWord ? 1.8 : (inContext ? 2.32 : 1.55);

    var width = 0;
    var circles = [];
    for (var c = 0; c < text.length; c++) {
      var glyph = GLYPHS[text[c]];
      if (!glyph) continue; // unknown character: skip
      var cols = 0;
      for (var y = 0; y < 7; y++) {
        var row = glyph[y] || '';
        if (row.length > cols) cols = row.length;
        for (var x = 0; x < row.length; x++) {
          if (row[x] === '1') {
            circles.push([width + x * pitchX + 1.55, y * pitchY + 1.55]);
          }
        }
      }
      width += (cols + 1) * pitchX; // glyph advance + one column gap
    }
    width = Math.max(width - pitchX, 1); // trim trailing gap

    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + width + ' 28');
    svg.setAttribute('class', 'dot-svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('preserveAspectRatio', isWord ? 'xMidYMid meet' : 'xMinYMin meet');
    for (var d = 0; d < circles.length; d++) {
      var circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', circles[d][0].toFixed(2));
      circle.setAttribute('cy', circles[d][1].toFixed(2));
      circle.setAttribute('r', radius);
      svg.appendChild(circle);
    }
    while (el.firstChild) el.removeChild(el.firstChild);
    el.appendChild(svg);
  }

  document.querySelectorAll('[data-dots]').forEach(renderDots);

  /* ---------- Gauge ticks (card 1) ---------- */

  var ticks = document.getElementById('gaugeTicks');
  if (ticks) {
    for (var i = 0; i <= 22; i++) {
      var angle = (190 + i * 5) * Math.PI / 180;
      var outer = 142;
      var inner = i % 5 === 0 ? 129 : 133;
      var cx = 163, cy = 163;
      var line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', (cx + inner * Math.cos(angle)).toFixed(2));
      line.setAttribute('y1', (cy + inner * Math.sin(angle)).toFixed(2));
      line.setAttribute('x2', (cx + outer * Math.cos(angle)).toFixed(2));
      line.setAttribute('y2', (cy + outer * Math.sin(angle)).toFixed(2));
      line.setAttribute('stroke', 'rgba(255,188,210,.34)');
      line.setAttribute('stroke-width', i % 5 === 0 ? '1.5' : '1');
      ticks.appendChild(line);
    }
  }

  /* ---------- Entrance control (one-shot) ---------- */

  var root = document.documentElement;
  if (reduceMotion.matches) {
    root.classList.remove('entrance-active');
  } else {
    var finished = false;
    var finish = function () {
      if (finished) return;
      finished = true;
      window.clearTimeout(window.__entranceFailsafe);
      root.classList.remove('entrance-active');
    };
    var isMobile = window.matchMedia('(max-width: 767px)').matches;
    var target = document.querySelector(
      isMobile ? '.card--speed .learn-more' : '.card--connections .learn-more'
    );
    if (target) {
      target.addEventListener('animationend', finish, { once: true });
    }
    // If no target is found, the head-script failsafe still clears the class.
  }

  /* ---------- Copy buttons ---------- */

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

  /* ---------- Screenshot fallbacks ---------- */

  document.querySelectorAll('img[data-fallback]').forEach(function (img) {
    var hide = function () { img.classList.add('img-broken'); };
    img.addEventListener('error', hide);
    if (img.complete && img.naturalWidth === 0) hide();
  });
})();
