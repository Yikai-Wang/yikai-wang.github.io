(() => {
  'use strict';

  // Per-video generation latency in seconds: mean and standard deviation, exactly the numbers in
  // the paper's latency table. Every cell was measured under the same protocol; the 5-GPU
  // streaming rows are marked so they are never read as an equal-device comparison.

  const host = document.querySelector('[data-latency]');
  if (!host) return;

  const LENGTHS = [
    { label: '5 s', latents: 21 },
    { label: '20 s', latents: 81 },
    { label: '35 s', latents: 141 },
    { label: '65 s', latents: 261 },
  ];

  const OURS = 'Ours';
  const REFERENCE = 'Bidirectional'; // not drawn; every bar is reported relative to it
  const SCHEDULES = ['Self-Forcing', 'HiAR', OURS, 'Ours (CP planner)', 'Ours (streaming)'];

  const DATA = {
    '1.3B': {
      '480p': {
        4: {
          Bidirectional: [[1.13, 0.01], [8.95, 0.01], [24.01, 0.02], [75.28, 0.05]],
          'Self-Forcing': [[5.10, 0.05], [20.25, 0.10], [35.40, 0.31], [65.14, 0.55]],
          HiAR: [[2.06, 0.05], [7.67, 0.00], [13.31, 0.01], [24.67, 0.03]],
          Ours: [[2.21, 0.08], [6.32, 0.02], [10.79, 0.22], [21.29, 0.08]],
          'Ours (CP planner)': [[2.34, 0.02], [7.24, 0.06], [12.30, 0.28], [22.07, 0.20]],
          'Ours (streaming)': [[1.85, 0.01], [5.11, 0.01], [8.27, 0.01], [14.53, 0.02]],
        },
      },
      '720p': {
        4: {
          Bidirectional: [[3.74, 0.00], [39.59, 0.06], [115.79, 0.04], [379.17, 0.64]],
          'Self-Forcing': [[6.04, 0.05], [27.17, 0.11], [47.71, 0.27], [97.68, 0.48]],
          HiAR: [[6.49, 0.01], [26.82, 0.02], [46.94, 0.03], [86.85, 0.06]],
          Ours: [[5.71, 0.05], [19.33, 0.27], [35.14, 0.13], [66.53, 0.12]],
          'Ours (CP planner)': [[5.50, 0.03], [18.47, 0.35], [30.90, 0.38], [58.89, 0.18]],
          'Ours (streaming)': [[5.47, 0.00], [16.37, 0.02], [27.05, 0.05], [48.61, 0.07]],
        },
      },
    },
    '14B': {
      '480p': {
        4: {
          Bidirectional: [[3.50, 0.01], [31.83, 0.01], [90.23, 0.01], [295.45, 0.01]],
          'Self-Forcing': [[9.75, 0.09], [41.35, 0.15], [74.56, 0.17], [137.89, 0.37]],
          HiAR: [[5.64, 0.00], [22.79, 0.02], [39.63, 0.02], [73.03, 0.03]],
          Ours: [[4.79, 0.04], [15.67, 0.11], [27.67, 0.22], [53.43, 0.41]],
          'Ours (CP planner)': [[5.23, 0.02], [16.66, 0.12], [28.10, 0.33], [52.18, 0.27]],
          'Ours (streaming)': [[4.72, 0.05], [13.40, 0.02], [22.35, 0.05], [39.43, 0.32]],
        },
      },
      '720p': {
        4: {
          Bidirectional: [[12.79, 0.01], [154.47, 0.01], [454.53, 0.01], [1530.42, 0.03]],
          'Self-Forcing': [[15.84, 0.03], [78.88, 0.07], [142.29, 0.11], [269.41, 0.20]],
          HiAR: [[21.72, 0.00], [93.25, 0.03], [163.66, 0.05], [304.35, 0.08]],
          Ours: [[17.19, 0.09], [61.39, 0.34], [109.89, 0.03], [214.83, 0.54]],
          'Ours (CP planner)': [[16.28, 0.07], [55.66, 0.20], [97.02, 0.50], [181.25, 0.80]],
          'Ours (streaming)': [[17.44, 0.10], [53.17, 0.14], [88.79, 0.01], [160.34, 0.27]],
        },
      },
    },
  };

  const HARDWARE = { '1.3B': 'H100', '14B': 'GB300' };
  const state = { model: '1.3B', res: '480p', gpus: 4 };

  const chart = host.querySelector('[data-lat-chart]');
  const note = host.querySelector('[data-lat-note]');
  const groups = [...host.querySelectorAll('[data-lat-group]')];

  const cell = () => (DATA[state.model][state.res] || {})[state.gpus];
  const fmt = (v) => (v >= 100 ? v.toFixed(0) : v.toFixed(2));

  function syncControls() {
    groups.forEach((group) => {
      const key = group.dataset.latGroup;
      [...group.querySelectorAll('button')].forEach((button) => {
        const value = key === 'gpus' ? Number(button.dataset.value) : button.dataset.value;
        const available = key === 'model'
          ? Boolean(DATA[value][state.res])
          : key === 'res'
            ? Boolean(DATA[state.model][value])
            : Boolean((DATA[state.model][state.res] || {})[value]);
        button.disabled = !available;
        button.setAttribute('aria-pressed', String(state[key] === value && available));
      });
    });
  }

  function render() {
    // fall back to a setting that exists when the reader picks an unmeasured combination
    if (!DATA[state.model][state.res]) state.res = Object.keys(DATA[state.model])[0];
    if (!cell()) state.gpus = Number(Object.keys(DATA[state.model][state.res])[0]);
    syncControls();

    const rows = cell();
    const names = SCHEDULES.filter((name) => rows[name]);
    chart.replaceChildren();

    LENGTHS.forEach((length, li) => {
      const block = document.createElement('div');
      block.className = 'lat-block';
      const head = document.createElement('div');
      head.className = 'lat-block-head';
      head.innerHTML = `<strong>${length.label}</strong><span>${length.latents} latents</span>`;
      block.appendChild(head);

      // Each length is scaled on its own, so a 65 s bar never flattens the 5 s comparison.
      const max = Math.max(...names.map((name) => rows[name][li][0]));
      const reference = rows[REFERENCE] ? rows[REFERENCE][li][0] : 0;
      names.forEach((name) => {
        const [mean, sd] = rows[name][li];
        const row = document.createElement('div');
        const ours = name.startsWith('Ours');
        row.className = `lat-row${ours ? ' is-ours' : ''}${name === OURS ? ' is-main' : ''}`;
        const barW = (mean / max) * 100;
        const ratio = reference ? `${(reference / mean).toFixed(2)}×` : '';
        row.innerHTML = `
          <span class="lat-name">${name}</span>
          <span class="lat-track"><span class="lat-bar" style="width:${barW.toFixed(2)}%"></span></span>
          <span class="lat-value">${fmt(mean)}<small> ± ${sd.toFixed(2)}</small></span>
          <span class="lat-ratio">${ratio}</span>`;
        block.appendChild(row);
      });

      const speed = [];
      ['HiAR', 'Self-Forcing'].forEach((base) => {
        if (!rows[base] || !rows[OURS]) return;
        speed.push(`${(rows[base][li][0] / rows[OURS][li][0]).toFixed(2)}× vs ${base}`);
      });
      if (speed.length) {
        const foot = document.createElement('p');
        foot.className = 'lat-speed';
        foot.textContent = `Ours: ${speed.join(' · ')}`;
        block.appendChild(foot);
      }
      chart.appendChild(block);
    });

    const hasStreaming = Boolean(rows['Ours (streaming)']);
    note.textContent = `${state.model} generator on ${HARDWARE[state.model]}, ${state.res}, four GPUs. `
      + 'Seconds per video, lower is better; ± is the standard deviation over runs. Bars are scaled '
      + 'within each length, and the right-hand column is the speedup over a bidirectional '
      + 'full-sequence sampler at the same setting.'
      + (hasStreaming ? ' The streaming row dedicates a fifth GPU to the planner, so it is not an equal-device comparison.' : '');
  }

  host.addEventListener('click', (event) => {
    const button = event.target.closest('[data-lat-group] button');
    if (!button || button.disabled) return;
    const key = button.parentElement.parentElement.dataset.latGroup;
    state[key] = key === 'gpus' ? Number(button.dataset.value) : button.dataset.value;
    render();
  });

  render();
})();
