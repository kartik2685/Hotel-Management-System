/* =====================================================================
 * Frontdesk HMS · pages/housekeeping.js
 * Tick tasks off and watch the shift progress, task types, attendants
 * and floors update. Filter by attendant or hide finished tasks.
 * ===================================================================== */
(function () {
  'use strict';

  const { $, $$ } = HMS.util;

  function initHousekeeping() {
    const tasks = $$('.task');
    if (!tasks.length) return;
    const attendantFilter = $('[data-task-attendant]');
    const hideDone = $('[data-task-hide-done]');
    const openCount = $('[data-task-count]');
    const ring = $('[data-shift-ring]');

    const percent = (done, total) => (total ? Math.round((done / total) * 100) : 0);
    const isDone = (task) => task.classList.contains('is-done');
    // "Classic Twin · 35 min" -> 35
    const minutes = (task) => {
      const match = /(\d+) min/.exec($('.task__what small', task).textContent);
      return match ? Number(match[1]) : 0;
    };
    const setBar = (container, value) => { $('.progress__fill', container).style.width = value + '%'; };

    function update() {
      tasks.forEach((task) => task.classList.toggle('is-done', $('.task__check', task).checked));
      const done = tasks.filter(isDone).length;
      const shift = percent(done, tasks.length);

      if (ring) {
        ring.style.setProperty('--p', shift);
        ring.setAttribute('aria-valuenow', done);
        ring.setAttribute('aria-valuetext', done + ' of ' + tasks.length + ' tasks done');
        $('[data-shift-percent]', ring).textContent = shift + '%';
        $('[data-shift-done]', ring).textContent = done;
      }

      $$('[data-kind-row]').forEach((row) => {
        const ofKind = tasks.filter((t) => t.dataset.kind === row.dataset.kindRow);
        const kindDone = ofKind.filter(isDone).length;
        $('[data-kind-done]', row).textContent = kindDone;
        setBar(row, percent(kindDone, ofKind.length));
      });

      $$('[data-team]').forEach((row) => {
        const assigned = tasks.filter((t) => t.dataset.attendant === row.dataset.team);
        const open = assigned.filter((t) => !isDone(t));
        $('[data-team-done]', row).textContent = assigned.length - open.length;
        $('[data-team-left]', row).textContent = open.reduce((sum, t) => sum + minutes(t), 0);
        setBar(row, percent(assigned.length - open.length, assigned.length));
      });

      $$('[data-task-floor]').forEach((floor) => {
        const onFloor = $$('.task', floor);
        const floorDone = onFloor.filter(isDone).length;
        $('[data-floor-done]', floor).textContent = floorDone;
        const meter = $('[data-floor-meter]', floor);
        meter.setAttribute('aria-valuenow', floorDone);
        meter.firstElementChild.style.width = percent(floorDone, onFloor.length) + '%';
      });

      const left = tasks.length - done;
      if (openCount) openCount.textContent = left + (left === 1 ? ' task open' : ' tasks open');
      applyFilters();
    }

    function applyFilters() {
      const who = attendantFilter ? attendantFilter.value : '';
      const hide = hideDone ? hideDone.checked : false;
      tasks.forEach((task) => {
        task.hidden = Boolean((who && task.dataset.attendant !== who) || (hide && isDone(task)));
      });
      $$('[data-task-floor]').forEach((floor) => {
        const note = $('[data-floor-empty]', floor);
        if (note) note.hidden = $$('.task:not([hidden])', floor).length > 0;
      });
      $$('[data-team]').forEach((row) => row.classList.toggle('is-dimmed', Boolean(who) && row.dataset.team !== who));
    }

    document.addEventListener('change', (event) => {
      if (event.target.classList && event.target.classList.contains('task__check')) update();
    });
    if (attendantFilter) attendantFilter.addEventListener('change', applyFilters);
    if (hideDone) hideDone.addEventListener('change', applyFilters);
    const print = $('[data-print]');
    if (print) print.addEventListener('click', () => window.print());
    update();
  }

  HMS.ready(initHousekeeping);
})();
