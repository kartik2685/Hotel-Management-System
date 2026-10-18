/* =====================================================================
 * Frontdesk HMS · pages/dashboard.js
 * Sparklines, the weekly revenue chart and today's arrivals list.
 * ===================================================================== */
(function () {
  'use strict';

  const { $, $$, h, svg, icon, clockTime, api, toast } = HMS.util;

  /* -------------------------------------------------------------------
   * Sparklines: <svg data-sparkline="231.4,236.9,..." viewBox="0 0 120 32">
   * ------------------------------------------------------------------- */
  function drawSparklines() {
    $$('svg[data-sparkline]').forEach((chart) => {
      const values = chart.dataset.sparkline.split(',').map(Number);
      if (values.length < 2) return;
      const width = 120;
      const height = 32;
      const pad = 3;
      const min = Math.min(...values);
      const range = Math.max(...values) - min || 1;
      const points = values.map((value, i) => {
        const x = (i * width) / (values.length - 1);
        const y = pad + (height - pad * 2) * (1 - (value - min) / range);
        return x.toFixed(2) + ',' + y.toFixed(2);
      });
      const line = 'M' + points.join('L');
      chart.append(
        svg('path', { d: line + 'L' + width + ',' + height + 'L0,' + height + 'Z', class: 'sparkline__area' }),
        svg('path', { d: line, class: 'sparkline__line' })
      );
    });
  }

  /* -------------------------------------------------------------------
   * Revenue by week: stacked columns drawn from the data table under the
   * chart, so the table stays the single source of truth. Hover a week or
   * use the arrow keys for its breakdown.
   * ------------------------------------------------------------------- */
  function drawRevenueChart() {
    const host = $('[data-revenue-chart]');
    if (!host) return;
    const table = document.getElementById(host.dataset.revenueChart);
    if (!table || !table.tBodies[0]) return;

    const series = Array.from(table.tHead.rows[0].cells)
      .slice(1, 4)
      .map((cell) => cell.textContent.trim());
    const weeks = Array.from(table.tBodies[0].rows).map((row) => ({
      label: row.cells[0].textContent.trim(),
      values: [1, 2, 3].map((i) => Number(row.cells[i].textContent.replace(/[^0-9.]/g, ''))),
    }));
    if (!weeks.length) return;

    const dollars = (n) => '$' + n.toLocaleString('en-US');
    const axisLabel = (n) => (n >= 1000 ? '$' + Math.round(n / 1000) + 'k' : '$' + n);
    const sum = (list) => list.reduce((a, b) => a + b, 0);

    const tooltip = h('div', { class: 'chart-tooltip', hidden: true });
    let focusIndex = 0;

    // Path for a bar with rounded top corners only.
    function roundedTop(x, y, w, hgt, r) {
      r = Math.min(r, hgt, w / 2);
      return 'M' + x + ',' + (y + hgt) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
        'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + hgt) + 'Z';
    }

    function showTooltip(index, column) {
      const week = weeks[index];
      tooltip.replaceChildren(h('p', { class: 'chart-tooltip__title', text: 'Week of ' + week.label }));
      // Top segment first, so the list reads in the same order as the stack.
      [2, 1, 0].forEach((s) => {
        tooltip.append(h('div', { class: 'chart-tooltip__row' }, [
          h('i', { class: 'chart-tooltip__swatch', style: 'background:var(--series-' + (s + 1) + ')' }),
          h('span', { text: series[s] }),
          h('strong', { text: dollars(week.values[s]) }),
        ]));
      });
      tooltip.append(h('div', { class: 'chart-tooltip__row chart-tooltip__row--total' }, [
        h('i', { class: 'chart-tooltip__swatch' }),
        h('span', { text: 'Total' }),
        h('strong', { text: dollars(sum(week.values)) }),
      ]));

      const box = column.querySelector('.bar-chart__stack').getBBox();
      const left = Math.max(100, Math.min(host.clientWidth - 100, box.x + box.width / 2));
      tooltip.style.left = left + 'px';
      tooltip.style.top = Math.max(box.y - 10, 90) + 'px';
      tooltip.hidden = false;
      $$('.bar-chart__col', host).forEach((col, i) => col.classList.toggle('is-hover', i === index));
    }

    function hideTooltip() {
      tooltip.hidden = true;
      $$('.bar-chart__col', host).forEach((col) => col.classList.remove('is-hover'));
    }

    function render() {
      const W = host.clientWidth;
      const H = host.clientHeight;
      if (!W || !H) return;
      const margin = { t: 10, r: 6, b: 28, l: 46 };
      const plotW = W - margin.l - margin.r;
      const plotH = H - margin.t - margin.b;
      const step = 25000;
      const top = Math.ceil(Math.max(...weeks.map((w) => sum(w.values))) / step) * step;
      const band = plotW / weeks.length;
      const barW = Math.min(24, band * 0.56);
      const y = (value) => margin.t + plotH - (value / top) * plotH;

      const chart = svg('svg', {
        viewBox: '0 0 ' + W + ' ' + H,
        role: 'group',
        'aria-label': 'Revenue by week, stacked by outlet. Use the arrow keys to move between weeks.',
      });

      // Horizontal grid lines with dollar labels
      for (let v = 0; v <= top; v += step) {
        chart.append(svg('line', { x1: margin.l, x2: W - margin.r, y1: y(v), y2: y(v), class: 'bar-chart__grid' }));
        const label = svg('text', { x: margin.l - 10, y: y(v) + 4, 'text-anchor': 'end', class: 'bar-chart__axis' });
        label.textContent = axisLabel(v);
        chart.append(label);
      }

      const labelEvery = band < 46 ? 2 : 1; // skip labels when weeks get narrow
      weeks.forEach((week, i) => {
        const cx = margin.l + band * i + band / 2;
        const total = sum(week.values);
        const column = svg('g', {
          class: 'bar-chart__col',
          tabindex: i === focusIndex ? '0' : '-1',
          role: 'img',
          'aria-label': 'Week of ' + week.label + ': ' +
            series.map((name, s) => name + ' ' + dollars(week.values[s])).join(', ') + ', total ' + dollars(total),
        });
        column.append(svg('rect', { x: margin.l + band * i + 1, y: margin.t, width: band - 2, height: plotH, rx: 6, class: 'bar-chart__bg' }));

        const stack = svg('g', { class: 'bar-chart__stack' });
        let running = 0;
        week.values.forEach((value, s) => {
          const y0 = y(running);
          const y1 = y(running + value);
          const gap = s === 0 ? 0 : 2;
          const segH = Math.max(0, y0 - y1 - gap);
          if (s === week.values.length - 1) {
            stack.append(svg('path', { d: roundedTop(cx - barW / 2, y1, barW, segH, 4), class: 'series-' + (s + 1) }));
          } else {
            stack.append(svg('rect', { x: cx - barW / 2, y: y1, width: barW, height: segH, class: 'series-' + (s + 1) }));
          }
          running += value;
        });
        column.append(stack);
        column.append(svg('rect', { x: margin.l + band * i, y: margin.t, width: band, height: plotH, class: 'bar-chart__hit' }));

        if ((weeks.length - 1 - i) % labelEvery === 0) {
          const label = svg('text', { x: cx, y: H - 8, 'text-anchor': 'middle', class: 'bar-chart__axis' });
          label.textContent = week.label;
          column.append(label);
        }

        column.addEventListener('pointerenter', () => showTooltip(i, column));
        column.addEventListener('pointerleave', hideTooltip);
        column.addEventListener('focus', () => { focusIndex = i; showTooltip(i, column); });
        column.addEventListener('blur', hideTooltip);
        column.addEventListener('keydown', (event) => {
          const moves = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: weeks.length - 1 };
          if (!(event.key in moves)) {
            if (event.key === 'Escape') hideTooltip();
            return;
          }
          event.preventDefault();
          const next = Math.max(0, Math.min(weeks.length - 1, moves[event.key]));
          const columns = $$('.bar-chart__col', chart);
          columns[i].setAttribute('tabindex', '-1');
          columns[next].setAttribute('tabindex', '0');
          columns[next].focus();
        });
        chart.append(column);
      });

      const hadFocus = host.contains(document.activeElement);
      host.replaceChildren(chart, tooltip);
      tooltip.hidden = true;
      if (hadFocus) {
        const column = $$('.bar-chart__col', chart)[focusIndex];
        if (column) column.focus();
      }
    }

    render();
    if ('ResizeObserver' in window) {
      let lastWidth = host.clientWidth;
      new ResizeObserver(() => {
        if (host.clientWidth !== lastWidth) {
          lastWidth = host.clientWidth;
          render();
        }
      }).observe(host);
    }
  }

  /* -------------------------------------------------------------------
   * Today's arrivals: filter buttons and one-click check-in.
   * ------------------------------------------------------------------- */
  function initArrivals() {
    const list = $('[data-arrival-list]');
    if (!list) return;
    const buttons = $$('[data-arrival-filter]');
    const empty = $('[data-arrivals-empty]');
    let filter = 'all';

    function applyFilter() {
      let shown = 0;
      $$('.arrival', list).forEach((item) => {
        const match =
          filter === 'all' ||
          (filter === 'vip' ? item.hasAttribute('data-vip') : item.dataset.state === filter);
        item.hidden = !match;
        if (match) shown += 1;
      });
      if (empty) empty.hidden = shown > 0;
    }

    function updateCounts() {
      const total = $$('.arrival', list).length;
      const checkedIn = $$('.arrival[data-state="in"]', list).length;
      $$('[data-arrivals-in], [data-metric-checked-in]').forEach((el) => { el.textContent = checkedIn; });
      const meter = $('[data-metric-checked-in-meter]');
      if (meter) {
        meter.firstElementChild.style.width = ((checkedIn / total) * 100).toFixed(1) + '%';
        meter.setAttribute('aria-label', checkedIn + ' of ' + total + ' arrivals checked in');
      }
    }

    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        filter = button.dataset.arrivalFilter;
        buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
        applyFilter();
      });
    });

    list.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-check-in]');
      if (!button || button.disabled) return;
      const item = button.closest('.arrival');
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      let reply;
      try {
        reply = await api('/api/reservations/' + encodeURIComponent(item.dataset.confirmation) + '/check-in');
      } catch (error) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        toast(error.message);
        return;
      }
      const time = reply.time || clockTime();
      item.dataset.state = 'in';
      const etaLabel = $('.arrival__eta small', item);
      const etaTime = $('.arrival__eta strong', item);
      if (etaLabel) etaLabel.textContent = 'Arrived';
      if (etaTime) etaTime.textContent = time;

      const badge = h('span', { class: 'room-state room-state--in', tabindex: '-1' }, [icon('check'), 'Checked in ' + time]);
      $('[data-arrival-action]', item).replaceChildren(badge);
      badge.focus();
      updateCounts();
      applyFilter();
    });

    updateCounts();
  }

  HMS.ready(() => {
    drawSparklines();
    drawRevenueChart();
    initArrivals();
  });
})();
