/* =====================================================================
 * Frontdesk HMS · core.js
 * ---------------------------------------------------------------------
 * Loaded on every page. Provides:
 *   - HMS.util   small DOM and formatting helpers used by page scripts
 *   - HMS.ready  run code once the page has loaded
 *   - the app shell: theme switch, sidebar drawer, dropdown menus,
 *     hotel switcher, notifications and the "/" search shortcut
 * No libraries. Every feature checks for its markup first, so the same
 * file is safe on every page.
 * ===================================================================== */
(function () {
  'use strict';

  const HMS = (window.HMS = window.HMS || {});

  /* -------------------------------------------------------------------
   * Helpers
   * ------------------------------------------------------------------- */
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  /**
   * Create an element. Content is always set as text (never parsed as
   * HTML), so data from users or files can't inject markup.
   *   h('span', { class: 'chip', text: 'VIP' })
   *   h('li', {}, [h('strong', { text: name }), ' arrives today'])
   */
  function h(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([key, value]) => {
      if (value === null || value === undefined || value === false) return;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'style') node.style.cssText = value;
      else node.setAttribute(key, value === true ? '' : value);
    });
    [].concat(children).forEach((child) => {
      if (child !== null && child !== undefined && child !== false) node.append(child);
    });
    return node;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /** Create an SVG element with attributes. */
  function svg(tag, attrs = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  }

  /** An icon from the page's SVG sprite, e.g. icon('check'). */
  function icon(name) {
    const node = svg('svg', { class: 'icon', 'aria-hidden': 'true' });
    node.append(svg('use', { href: '#icon-' + name }));
    return node;
  }

  const DAY_MS = 864e5;
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** 1234.5 -> "$1,234.50" */
  // Currency comes from the hotel settings (set on <html> by the server).
  const CURRENCY = document.documentElement.dataset.currency || '$';
  const LOCALE = document.documentElement.dataset.locale || 'en-US';
  const money = (amount) =>
    CURRENCY + amount.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /** "2026-09-24" -> Date at midnight UTC (avoids time-zone drift). */
  const parseDate = (iso) => new Date(iso + 'T00:00:00Z');

  /** Date -> "Thu 24 Sep" */
  const formatDay = (date) =>
    WEEKDAYS[date.getUTCDay()] + ' ' + date.getUTCDate() + ' ' + MONTHS[date.getUTCMonth()];

  /** Current local time as "HH:MM". */
  const clockTime = () => {
    const now = new Date();
    return String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  };

  /** plural(2, 'night', 'nights') -> "2 nights" */
  const plural = (count, one, many) => count + ' ' + (count === 1 ? one : many);

  /** Simple email shape check used by the forms. */
  const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

  const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Run callback once el's CSS transition has finished (or straight away if it has none). */
  function afterTransition(el, callback) {
    const style = getComputedStyle(el);
    const seconds = parseFloat(style.transitionDuration) + parseFloat(style.transitionDelay);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.removeEventListener('transitionend', onEnd);
      callback();
    };
    const onEnd = (event) => { if (event.target === el) finish(); };
    el.addEventListener('transitionend', onEnd);
    window.setTimeout(finish, (seconds || 0) * 1000 + 5);
  }

  /** Show a field's error message (or clear it with an empty message). */
  function setFieldError(field, message) {
    field.classList.toggle('is-invalid', Boolean(message));
    field.setAttribute('aria-invalid', message ? 'true' : 'false');
    const holder = document.getElementById(field.id + '-err');
    if (holder) holder.textContent = message || '';
  }

  /**
   * POST JSON to the server with the page's CSRF token.
   * Resolves with the reply; rejects with an Error whose message can be shown to staff.
   */
  async function api(url, body) {
    const token = document.querySelector('meta[name="csrf-token"]');
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': token ? token.content : '' },
        body: JSON.stringify(body || {}),
      });
    } catch (error) {
      throw new Error('No connection to the server. Check the network and try again.');
    }
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname);
    }
    if (!response.ok) {
      const error = new Error(data.error || 'That did not work. Please try again.');
      error.field = data.field;
      error.status = response.status;
      throw error;
    }
    return data;
  }

  /** Short message at the bottom of the screen (errors from the server, mostly). */
  function toast(message, tone) {
    let box = document.querySelector('.toast');
    if (!box) {
      box = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
      document.body.append(box);
    }
    box.textContent = message;
    box.dataset.tone = tone || 'error';
    box.hidden = false;
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => { box.hidden = true; }, 6000);
  }

  HMS.util = {
    $, $$, h, svg, icon, money, parseDate, formatDay, clockTime, plural, isEmail,
    prefersReducedMotion, afterTransition, setFieldError, api, toast, DAY_MS, WEEKDAYS, MONTHS,
  };

  HMS.ready = (callback) => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback);
    else callback();
  };

  /* -------------------------------------------------------------------
   * Light / dark theme switch. theme-init.js picked the starting theme;
   * this wires the button and remembers the choice.
   * ------------------------------------------------------------------- */
  const THEME_KEY = 'hms-theme';

  function initThemeSwitch() {
    const root = document.documentElement;
    const buttons = $$('[data-theme-toggle]');
    if (!buttons.length) return;
    const themeColor = $('meta[name="theme-color"]');

    const apply = (theme) => {
      root.setAttribute('data-theme', theme);
      buttons.forEach((button) => button.setAttribute('aria-pressed', String(theme === 'dark')));
      if (themeColor) themeColor.setAttribute('content', theme === 'dark' ? '#0e0d0c' : '#1b1a17');
    };

    apply(root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');

    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        apply(next);
        try {
          localStorage.setItem(THEME_KEY, next);
        } catch (err) {
          /* storage unavailable: the choice lasts for this page only */
        }
      });
    });
  }

  /* -------------------------------------------------------------------
   * Sidebar drawer (screens below 992px). The sidebar slides in over a
   * dimmed backdrop, keeps keyboard focus inside while open, and closes
   * on Escape, on the backdrop, or with its close button.
   * ------------------------------------------------------------------- */
  function initDrawer() {
    const drawer = document.getElementById('sidebar');
    const openers = $$('[data-drawer-open]');
    if (!drawer || !openers.length) return;
    const smallScreen = window.matchMedia('(max-width: 991.98px)');
    let isOpen = false;
    let backdrop = null;
    let opener = null;
    let tabBackwards = false;

    const focusableInside = () =>
      $$('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])', drawer)
        .filter((el) => el.offsetParent !== null);

    function lockPageScroll() {
      const scrollbar = window.innerWidth - document.documentElement.clientWidth;
      if (scrollbar > 0) {
        const padding = parseFloat(getComputedStyle(document.body).paddingRight) || 0;
        document.body.style.paddingRight = padding + scrollbar + 'px';
      }
      document.body.style.overflow = 'hidden';
    }

    function unlockPageScroll() {
      document.body.style.removeProperty('overflow');
      document.body.style.removeProperty('padding-right');
    }

    function keepFocusInside(event) {
      if (event.target === document || drawer.contains(event.target)) return;
      const items = focusableInside();
      if (!items.length) drawer.focus();
      else (tabBackwards ? items[items.length - 1] : items[0]).focus();
    }

    function onKeydown(event) {
      if (event.key === 'Tab') tabBackwards = event.shiftKey;
      if (event.key === 'Escape') close();
    }

    function open(trigger) {
      if (isOpen) return;
      isOpen = true;
      opener = trigger || null;

      backdrop = h('div', { class: 'drawer-backdrop' });
      backdrop.addEventListener('click', close);
      document.body.append(backdrop);
      void backdrop.offsetWidth; // apply the start state so the fade runs
      backdrop.classList.add('is-visible');

      lockPageScroll();
      drawer.setAttribute('aria-modal', 'true');
      drawer.setAttribute('role', 'dialog');
      drawer.classList.remove('is-closing');
      drawer.classList.add('is-open');
      document.addEventListener('keydown', onKeydown);
      afterTransition(drawer, () => {
        if (!isOpen) return;
        drawer.focus();
        document.addEventListener('focusin', keepFocusInside);
      });
    }

    function close() {
      if (!isOpen) return;
      isOpen = false;
      document.removeEventListener('focusin', keepFocusInside);
      document.removeEventListener('keydown', onKeydown);
      drawer.blur();
      drawer.classList.add('is-closing');
      drawer.classList.remove('is-open');

      const fading = backdrop;
      backdrop = null;
      fading.classList.remove('is-visible');
      afterTransition(fading, () => fading.remove());

      afterTransition(drawer, () => {
        if (isOpen) return;
        drawer.classList.remove('is-closing');
        drawer.removeAttribute('aria-modal');
        drawer.removeAttribute('role');
        unlockPageScroll();
        if (opener && opener.offsetParent !== null) opener.focus();
      });
    }

    openers.forEach((button) => button.addEventListener('click', () => open(button)));
    $$('[data-drawer-close]', drawer).forEach((button) => button.addEventListener('click', close));
    // Growing the window to desktop width turns the drawer back into a fixed column.
    smallScreen.addEventListener('change', (event) => { if (!event.matches) close(); });
  }

  /* -------------------------------------------------------------------
   * Dropdown menus
   *   <div class="menu">
   *     <button data-menu-toggle aria-expanded="false">…</button>
   *     <ul class="menu__panel [menu__panel--end]">…</ul>
   *   </div>
   * Clicking outside closes a menu. Add data-menu-keep-open to the toggle
   * to keep it open while clicking inside (used by notifications).
   * Keyboard: Arrow keys move through items, Escape closes.
   * ------------------------------------------------------------------- */
  function initMenus() {
    const toggles = $$('[data-menu-toggle]');
    if (!toggles.length) return;
    let current = null; // { toggle, panel }

    const panelFor = (toggle) => toggle.parentElement.querySelector('.menu__panel');
    const itemsIn = (panel) => $$('.menu__item:not(:disabled)', panel).filter((el) => el.offsetParent !== null);

    /* Place the panel 2px under its toggle, aligned to its left edge (or
       right edge for .menu__panel--end), nudged sideways if it would spill
       out of the viewport. Offsets are whole pixels for crisp edges. */
    function place(toggle, panel) {
      const frame = panel.parentElement;
      panel.style.inset = '0 auto auto 0';
      panel.style.transform = 'none';
      const frameBox = frame.getBoundingClientRect();
      const toggleBox = toggle.getBoundingClientRect();
      const panelBox = panel.getBoundingClientRect();
      const alignEnd = panel.classList.contains('menu__panel--end');

      let x = (alignEnd ? toggleBox.right - panelBox.width : toggleBox.left) - frameBox.left;
      const y = toggleBox.bottom - frameBox.top + 2;
      const minX = -frameBox.left;
      const maxX = document.documentElement.clientWidth - frameBox.left - panelBox.width;
      x = Math.max(minX, Math.min(x, maxX));

      if (alignEnd) {
        // Anchor to the right edge so the panel grows leftwards.
        panel.style.inset = '0 0 auto auto';
        x -= frame.clientWidth - panelBox.width;
      }
      panel.style.transform = 'translate(' + Math.round(x) + 'px, ' + Math.round(y) + 'px)';
    }

    function reposition() {
      if (current) place(current.toggle, current.panel);
    }

    function open(toggle) {
      const panel = panelFor(toggle);
      if (!panel) return;
      close();
      current = { toggle, panel };
      panel.classList.add('is-open');
      place(toggle, panel);
      toggle.setAttribute('aria-expanded', 'true');
      toggle.focus();
      window.addEventListener('resize', reposition);
    }

    function close(returnFocus) {
      if (!current) return;
      const { toggle, panel } = current;
      current = null;
      panel.classList.remove('is-open');
      panel.style.removeProperty('inset');
      panel.style.removeProperty('transform');
      toggle.setAttribute('aria-expanded', 'false');
      window.removeEventListener('resize', reposition);
      if (returnFocus) toggle.focus();
    }

    toggles.forEach((toggle) => {
      toggle.addEventListener('click', (event) => {
        event.preventDefault();
        if (current && current.toggle === toggle) close();
        else open(toggle);
      });
    });

    document.addEventListener('click', (event) => {
      if (!current || event.button === 2) return;
      const { toggle, panel } = current;
      if (toggle.contains(event.target)) return;
      if (panel.contains(event.target)) {
        if (toggle.hasAttribute('data-menu-keep-open')) return;
        if (/^(INPUT|SELECT|OPTION|TEXTAREA|FORM)$/.test(event.target.tagName)) return;
      }
      close();
    });

    document.addEventListener('keydown', (event) => {
      const toggle = event.target.closest('[data-menu-toggle]');
      const panel = event.target.closest('.menu__panel');
      if (!toggle && !panel) return;

      if (event.key === 'Escape') {
        if (current) close(true);
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      if (/^(INPUT|TEXTAREA)$/.test(event.target.tagName)) return;
      event.preventDefault();

      const owner = toggle || panel.parentElement.querySelector('[data-menu-toggle]');
      if (!current || current.toggle !== owner) open(owner);
      const items = itemsIn(current.panel);
      if (!items.length) return;
      const down = event.key === 'ArrowDown';
      const index = items.indexOf(event.target);
      if (index === -1) {
        (down ? items[0] : items[items.length - 1]).focus();
      } else {
        items[Math.max(0, Math.min(items.length - 1, index + (down ? 1 : -1)))].focus();
      }
    });

    // Tabbing away from an open menu closes it.
    document.addEventListener('keyup', (event) => {
      if (event.key !== 'Tab' || !current) return;
      if (!current.panel.contains(event.target) && !current.toggle.contains(event.target)) close();
    });
  }

  /* -------------------------------------------------------------------
   * Hotel (property) switcher in the top bar.
   * ------------------------------------------------------------------- */
  function initHotelSwitch() {
    const menu = $('[data-hotel-menu]');
    const button = $('.hotel-switch__button');
    if (!menu || !button) return;

    menu.addEventListener('click', (event) => {
      const choice = event.target.closest('[data-hotel]');
      if (!choice) return;
      $$('[data-hotel]', menu).forEach((option) => {
        const selected = option === choice;
        option.classList.toggle('is-selected', selected);
        if (selected) option.setAttribute('aria-current', 'true');
        else option.removeAttribute('aria-current');
      });
      $$('[data-current-hotel]').forEach((el) => { el.textContent = choice.dataset.hotel; });
      $$('[data-current-hotel-meta]').forEach((el) => { el.textContent = choice.dataset.meta; });
      button.setAttribute('aria-label', 'Property: ' + choice.dataset.hotel + '. Switch property');
    });
  }

  /* -------------------------------------------------------------------
   * Notifications: "Mark all read".
   * ------------------------------------------------------------------- */
  function initAlerts() {
    const clear = $('[data-alerts-clear]');
    if (!clear) return;
    clear.addEventListener('click', () => {
      $$('.alert-item.is-unread').forEach((item) => item.classList.remove('is-unread'));
      const dot = $('[data-alerts-dot]');
      if (dot) dot.hidden = true;
      const button = $('.alerts__button');
      if (button) button.setAttribute('aria-label', 'Notifications, none unread');
      clear.disabled = true;
      HMS.util.api('/api/notifications/read').catch(() => {});
    });
  }

  /* -------------------------------------------------------------------
   * Quick search: press "/" anywhere to jump into the search box.
   * The box also shows the current ?q= search term.
   * ------------------------------------------------------------------- */
  function initQuickSearch() {
    const input = document.getElementById('topbar-q');
    if (!input) return;
    const term = new URLSearchParams(window.location.search).get('q');
    if (term) input.value = term;

    document.addEventListener('keydown', (event) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (!input.offsetParent) return; // hidden on small screens
      event.preventDefault();
      input.focus();
      input.select();
    });
  }

  HMS.ready(() => {
    initThemeSwitch();
    initDrawer();
    initMenus();
    initHotelSwitch();
    initAlerts();
    initQuickSearch();
  });
})();
