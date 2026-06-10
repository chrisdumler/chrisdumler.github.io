/* ============================================================
   main.js — interactions + the generative "taste filter"
   ============================================================ */
(function () {
  'use strict';

  /* ---------- seeded PRNG ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ============================================================
     THE GENERATIVE MARK
     Code proposes; taste disposes. Every output is constrained
     to a grid, a 3-color palette, a fixed stroke weight, and a
     deliberately low fill density — so it always looks composed.
     ============================================================ */
  const NS = 'http://www.w3.org/2000/svg';
  const SIZE = 600;

  function pick(rnd, arr) { return arr[Math.floor(rnd() * arr.length)]; }

  // a motif draws inside a cell box {x,y,s}. color is a CSS var ref.
  const MOTIFS = [
    function ring(rnd, b, col, sw) {
      const r = b.s * (0.30 + rnd() * 0.08);
      return `<circle cx="${b.x + b.s / 2}" cy="${b.y + b.s / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="${sw}"/>`;
    },
    function disk(rnd, b, col) {
      const r = b.s * (0.26 + rnd() * 0.10);
      return `<circle cx="${b.x + b.s / 2}" cy="${b.y + b.s / 2}" r="${r}" fill="${col}"/>`;
    },
    function dot(rnd, b, col) {
      const r = b.s * 0.10;
      return `<circle cx="${b.x + b.s / 2}" cy="${b.y + b.s / 2}" r="${r}" fill="${col}"/>`;
    },
    function quarter(rnd, b, col, sw) {
      const cx = b.x + b.s / 2, cy = b.y + b.s / 2, r = b.s * 0.36;
      const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
      const c = pick(rnd, corners);
      const ox = cx + c[0] * r, oy = cy;
      const ex = cx, ey = cy + c[1] * r;
      return `<path d="M ${ox} ${oy} A ${r} ${r} 0 0 ${c[0] * c[1] > 0 ? 1 : 0} ${ex} ${ey}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"/>`;
    },
    function halfdisk(rnd, b, col) {
      const cx = b.x + b.s / 2, cy = b.y + b.s / 2, r = b.s * 0.34;
      const dir = pick(rnd, [0, 1, 2, 3]);
      let d;
      if (dir === 0) d = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy} Z`;
      else if (dir === 1) d = `M ${cx + r} ${cy} A ${r} ${r} 0 0 1 ${cx - r} ${cy} Z`;
      else if (dir === 2) d = `M ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx} ${cy + r} Z`;
      else d = `M ${cx} ${cy + r} A ${r} ${r} 0 0 1 ${cx} ${cy - r} Z`;
      return `<path d="${d}" fill="${col}"/>`;
    },
    function cross(rnd, b, col, sw) {
      const cx = b.x + b.s / 2, cy = b.y + b.s / 2, r = b.s * 0.30;
      return `<line x1="${cx - r}" y1="${cy}" x2="${cx + r}" y2="${cy}" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"/>` +
        `<line x1="${cx}" y1="${cy - r}" x2="${cx}" y2="${cy + r}" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"/>`;
    },
    function diagonal(rnd, b, col, sw) {
      const p = b.s * 0.18;
      const flip = rnd() > 0.5;
      const x1 = b.x + p, y1 = flip ? b.y + p : b.y + b.s - p;
      const x2 = b.x + b.s - p, y2 = flip ? b.y + b.s - p : b.y + p;
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"/>`;
    },
    function bars(rnd, b, col, sw) {
      const n = 3, gap = b.s * 0.62 / (n - 1), x0 = b.x + b.s * 0.19;
      let s = '';
      for (let i = 0; i < n; i++) {
        const x = x0 + i * gap;
        s += `<line x1="${x}" y1="${b.y + b.s * 0.22}" x2="${x}" y2="${b.y + b.s * 0.78}" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"/>`;
      }
      return s;
    },
    function concentric(rnd, b, col, sw) {
      const cx = b.x + b.s / 2, cy = b.y + b.s / 2;
      let s = '';
      for (let i = 1; i <= 2; i++) {
        s += `<circle cx="${cx}" cy="${cy}" r="${b.s * 0.16 * i + b.s * 0.04}" fill="none" stroke="${col}" stroke-width="${sw}"/>`;
      }
      return s;
    },
    function diamond(rnd, b, col, sw) {
      const cx = b.x + b.s / 2, cy = b.y + b.s / 2, r = b.s * 0.32;
      const pts = `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`;
      const filled = rnd() > 0.5;
      return `<polygon points="${pts}" fill="${filled ? col : 'none'}" stroke="${col}" stroke-width="${sw}"/>`;
    },
  ];

  function buildMark(seed) {
    const rnd = mulberry32(seed);
    const grid = pick(rnd, [4, 5]);          // taste: only two grid sizes
    const cell = SIZE / grid;
    const inkVar = 'var(--ink)';
    const accentVar = 'var(--accent)';
    const ghostVar = 'var(--ink-faint)';
    const sw = Math.max(2, cell * 0.035);

    // taste: low, balanced fill density + at most ~1 accent per row's worth
    const density = 0.42 + rnd() * 0.12;
    let accentBudget = grid <= 4 ? 2 : 3;

    const occupied = [];
    for (let i = 0; i < grid * grid; i++) occupied.push(false);

    let cells = '';
    let idx = 0;

    // optional single feature cell (2x2) for composition weight
    let feature = null;
    if (rnd() > 0.45 && grid >= 4) {
      const fr = Math.floor(rnd() * (grid - 1));
      const fc = Math.floor(rnd() * (grid - 1));
      feature = { r: fr, c: fc };
      for (const [dr, dc] of [[0, 0], [0, 1], [1, 0], [1, 1]]) occupied[(fr + dr) * grid + (fc + dc)] = true;
      const b = { x: fc * cell, y: fr * cell, s: cell * 2 };
      const useAccent = rnd() > 0.5 && accentBudget > 0;
      if (useAccent) accentBudget--;
      const col = useAccent ? accentVar : inkVar;
      const big = pick(rnd, [MOTIFS[0], MOTIFS[1], MOTIFS[4], MOTIFS[8]]);
      cells += `<g class="cell" style="--d:${idx++}">${big(rnd, b, col, sw)}</g>`;
    }

    for (let r = 0; r < grid; r++) {
      for (let c = 0; c < grid; c++) {
        const id = r * grid + c;
        if (occupied[id]) continue;
        if (rnd() > density) continue;
        const b = { x: c * cell, y: r * cell, s: cell };
        let col = inkVar;
        const roll = rnd();
        if (roll > 0.86 && accentBudget > 0) { col = accentVar; accentBudget--; }
        else if (roll < 0.16) { col = ghostVar; }
        const motif = pick(rnd, MOTIFS);
        cells += `<g class="cell" style="--d:${idx++}">${motif(rnd, b, col, sw)}</g>`;
      }
    }

    // faint registration grid (the "system" behind the taste)
    let guide = '';
    for (let i = 1; i < grid; i++) {
      const p = i * cell;
      guide += `<line x1="${p}" y1="0" x2="${p}" y2="${SIZE}" stroke="var(--line-soft)" stroke-width="1"/>`;
      guide += `<line x1="0" y1="${p}" x2="${SIZE}" y2="${p}" stroke="var(--line-soft)" stroke-width="1"/>`;
    }

    return `<svg class="gen-svg" viewBox="0 0 ${SIZE} ${SIZE}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g class="gen-guide">${guide}</g>
      ${cells}
    </svg>`;
  }

  function newSeed() { return Math.floor(Math.random() * 9000) + 1000; }

  function renderMark(seed, animate) {
    const canvas = document.getElementById('genCanvas');
    if (!canvas) return;
    canvas.innerHTML = buildMark(seed);
    const seedEl = document.getElementById('genSeed');
    if (seedEl) seedEl.textContent = String(seed).padStart(4, '0');
    if (animate) {
      canvas.querySelectorAll('.cell').forEach((g) => {
        g.style.animation = 'none';
        // force reflow
        void g.offsetWidth;
        g.style.animation = '';
      });
    }
    try { localStorage.setItem('gen_seed', String(seed)); } catch (e) {}
  }

  function initMark() {
    let seed;
    try { seed = parseInt(localStorage.getItem('gen_seed'), 10); } catch (e) {}
    if (!seed || isNaN(seed)) seed = newSeed();
    renderMark(seed, true);

    const btn = document.getElementById('genRegen');
    if (btn) btn.addEventListener('click', function () {
      renderMark(newSeed(), true);
    });
  }

  /* ---------- topbar scrolled ---------- */
  function initTopbar() {
    const bar = document.querySelector('.topbar');
    if (!bar) return;
    const onScroll = () => bar.classList.toggle('scrolled', window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------- scroll reveal (rAF + scroll, robust across envs) ---------- */
  function initReveal() {
    const els = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
    if (!els.length) return;
    const check = () => {
      const vh = window.innerHeight || document.documentElement.clientHeight;
      for (let i = els.length - 1; i >= 0; i--) {
        const el = els[i];
        const top = el.getBoundingClientRect().top;
        if (top < vh * 0.92) {
          el.classList.add('in');
          els.splice(i, 1);
        }
      }
      if (!els.length) {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
      }
    };
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { ticking = false; check(); });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    // initial passes (cover late layout/font shifts)
    check();
    requestAnimationFrame(check);
    setTimeout(check, 250);
  }

  /* ---------- year ---------- */
  function initYear() {
    document.querySelectorAll('#year').forEach((y) => { y.textContent = new Date().getFullYear(); });
  }

  /* ---------- work index filters ---------- */
  function initFilters() {
    const bar = document.getElementById('filters');
    const list = document.getElementById('workList');
    if (!bar || !list) return;
    const projects = Array.prototype.slice.call(list.querySelectorAll('.proj'));
    bar.addEventListener('click', function (e) {
      const btn = e.target.closest('.filter');
      if (!btn) return;
      const f = btn.getAttribute('data-filter');
      bar.querySelectorAll('.filter').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      projects.forEach((p) => {
        const show = (f === 'all') || (p.getAttribute('data-type') === f);
        p.classList.toggle('is-hidden', !show);
      });
    });
  }

  /* ---------- apply saved theme (set by Tweaks panel, shared across pages) ---------- */
  function applySavedTheme() {
    try {
      const t = JSON.parse(localStorage.getItem('site_theme') || '{}');
      const root = document.documentElement;
      if (t.dark) root.setAttribute('data-surface', 'dark');
      else root.removeAttribute('data-surface');
      if (t.accent) {
        root.style.setProperty('--accent', t.accent);
        root.style.setProperty('--accent-ink', t.accentInk || t.accent);
      } else {
        root.style.removeProperty('--accent');
        root.style.removeProperty('--accent-ink');
      }
    } catch (e) {}
  }

  /* ---------- dark-mode toggle (nav) ---------- */
  function initThemeToggle() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    const SUN = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.1 5.1l1.8 1.8M17.1 17.1l1.8 1.8M18.9 5.1l-1.8 1.8M6.9 17.1l-1.8 1.8"/></svg>';
    const MOON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.6A8 8 0 1 1 9.4 4 6.5 6.5 0 0 0 20 14.6Z"/></svg>';
    const sync = () => {
      const isDark = document.documentElement.getAttribute('data-surface') === 'dark';
      btn.innerHTML = isDark ? MOON : SUN;
      btn.setAttribute('aria-pressed', String(isDark));
    };
    window.__syncThemeToggle = sync;
    sync();
    btn.addEventListener('click', function () {
      let t = {};
      try { t = JSON.parse(localStorage.getItem('site_theme') || '{}'); } catch (e) {}
      t.dark = document.documentElement.getAttribute('data-surface') !== 'dark';
      try { localStorage.setItem('site_theme', JSON.stringify(t)); } catch (e) {}
      applySavedTheme();
      sync();
    });
  }

  function init() {
    applySavedTheme();
    initMark();
    initTopbar();
    initReveal();
    initYear();
    initFilters();
    initThemeToggle();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // expose for tweaks panel
  window.__regenMark = () => renderMark(newSeed(), true);
})();
