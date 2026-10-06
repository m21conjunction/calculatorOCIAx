const SHAPES = {
  e6ax: { name: 'VM.Standard.E6.Ax.Flex', vendor: 'amd', cpu: 'AMD EPYC 9J45', maxOcpus: 94, maxMemory: 712 },
  x12ax: { name: 'VM.Standard4.Ax.Flex', vendor: 'intel', cpu: 'Intel Xeon 6 6987P-C', maxOcpus: 39, maxMemory: 360 },
};

// Published non-local-SSD VM configurations from Google Cloud's machine-series tables.
const CATALOG = [
  ...makeSeries('c4d', 'amd', 'highcpu', [[2,3],[4,7],[8,15],[16,30],[32,60],[48,90],[64,120],[96,180],[192,360],[384,720]]),
  ...makeSeries('c4d', 'amd', 'standard', [[2,7],[4,15],[8,31],[16,62],[32,124],[48,186],[64,248],[96,372],[192,744],[384,1488]]),
  ...makeSeries('c4d', 'amd', 'highmem', [[2,15],[4,31],[8,63],[16,126],[32,252],[48,378],[64,504],[96,756],[192,1512],[384,3024]]),
  ...makeSeries('c4', 'intel', 'highcpu', [[2,4],[4,8],[8,16],[16,32],[24,48],[32,64],[48,96],[96,192],[144,288],[192,384],[288,576]]),
  ...makeSeries('c4', 'intel', 'standard', [[2,7],[4,15],[8,30],[16,60],[24,90],[32,120],[48,180],[96,360],[144,540],[192,720],[288,1080]]),
  ...makeSeries('c4', 'intel', 'highmem', [[2,15],[4,31],[8,62],[16,124],[24,186],[32,248],[48,372],[96,744],[144,1116],[192,1488],[288,2232]]),
];

function makeSeries(series, vendor, className, sizes) {
  return sizes.map(([vcpu, memory]) => {
    const cpu = series === 'c4d' ? 'AMD EPYC 9B45 (Turin)' :
      [144, 288].includes(vcpu) ? 'Intel Xeon Platinum 6985P-C (Granite Rapids)' :
      'Intel Xeon Platinum 8581C (Emerald Rapids) or Intel Xeon Platinum 6985P-C (Granite Rapids)';
    return { name: `${series}-${className}-${vcpu}`, series, vendor, className, vcpu, memory, cpu, kind: 'predefined' };
  });
}

const CUSTOM_SERIES = {
  n4: { vendor: 'intel', cpu: 'Intel Xeon Platinum 8581C (Emerald Rapids)', minMemoryPerVcpu: 2, maxMemory: 640, vcpus: Array.from({ length: 40 }, (_, index) => (index + 1) * 2) },
  n4d: { vendor: 'amd', cpu: 'AMD EPYC 9B45 (Turin)', minMemoryPerVcpu: 0.5, maxMemory: 768, vcpus: [2, 4, 8, 16, 32, 48, 64, 80, 96] },
};

function customCandidates(series, targetCpu, targetMemory) {
  const config = CUSTOM_SERIES[series];
  const candidates = [];
  for (const vcpu of config.vcpus) {
    if (vcpu < targetCpu) continue;
    const memory = Math.max(targetMemory, vcpu * config.minMemoryPerVcpu);
    if (memory > config.maxMemory) continue;
    const extended = memory > vcpu * 8;
    const name = `${series}-custom-${vcpu}-${memory * 1024}${extended ? '-ext' : ''}`;
    candidates.push({ name, series, vendor: config.vendor, className: 'custom', vcpu, memory, cpu: config.cpu, kind: 'custom', extended });
  }
  if (!candidates.length) return [];
  const first = candidates[0];
  const pricedAlternative = first.extended ? candidates.find(candidate => !candidate.extended) : undefined;
  return pricedAlternative ? [first, pricedAlternative] : [first];
}

function intelGenerationWarning(shapeKey, machine) {
  if (shapeKey !== 'x12ax') return '';
  if (machine.series === 'n4') return 'OCI X12 uses Intel Xeon 6 6987P-C (Granite Rapids); Google Cloud N4 uses Intel Xeon Platinum 8581C (Emerald Rapids). The CPU generations differ even when vCPU and memory match exactly.';
  if (machine.series === 'c4' && ![144, 288].includes(machine.vcpu)) return 'OCI X12 uses Intel Xeon 6 6987P-C (Granite Rapids). This C4 size can use Intel Xeon Platinum 8581C (Emerald Rapids) or Intel Xeon Platinum 6985P-C (Granite Rapids); check the zone and CPU platform before treating it as a same-generation match.';
  return '';
}

function estimateGcp(machine, region, totalBlock) {
  const regionFactor = region[machine.series === 'n4d' ? 'c4d' : machine.series === 'n4' ? 'c4' : machine.series];
  const rate = PRICES.gcp[machine.series];
  const standardMemory = Math.min(machine.memory, machine.vcpu * 8);
  const extraMemoryCost = machine.extended ? (machine.memory - standardMemory) * (rate.extendedMemory ?? 0) : 0;
  const computeCost = machine.kind === 'custom' ?
    (machine.vcpu * rate.vcpu + standardMemory * rate.memory + extraMemoryCost) * regionFactor :
    machine.vcpu * rate[machine.className] * regionFactor;
  const diskCost = totalBlock * region.disk / PRICES.hoursPerMonth;
  return { computeCost, diskCost, totalCost: computeCost + diskCost, priceKnown: !machine.extended || rate.extendedMemory !== undefined };
}

function ociSavingsRow(label, machine, region, totalBlock, ociTotal, unavailableText) {
  if (!machine) return `<div class="oci-saving"><span>${label}</span><strong>${unavailableText}</strong></div>`;
  const { totalCost, priceKnown } = estimateGcp(machine, region, totalBlock);
  if (!priceKnown) return `<div class="oci-saving"><span>${label} · ${machine.name}</span><strong>GCP quote required</strong></div>`;
  const percent = (totalCost - ociTotal) / totalCost * 100;
  const value = Math.abs(percent) < 0.05 ? 'About the same price' :
    percent > 0 ? `${percent.toFixed(1)}% savings` : `${Math.abs(percent).toFixed(1)}% higher`;
  return `<div class="oci-saving"><span>${label} · ${machine.name}</span><strong class="${percent < -0.05 ? 'saving-higher' : 'saving-lower'}">${value}</strong></div>`;
}

// USD public list rates. OCI is globally priced; GCP VM rates are Iowa references.
// GCP per-vCPU values are extrapolated from published 32-vCPU on-demand types.
const PRICES = {
  oci: { e6ax: { ocpu: 0.0138, memory: 0.0108 }, x12ax: { ocpu: 0.0119, memory: 0.0114 }, balancedDiskPerGbMonth: 0.0425 },
  gcp: { c4d: { highcpu: 1.2702 / 32, standard: 1.511927189 / 32, highmem: 1.992355771 / 32 }, c4: { highcpu: 1.3608 / 32, standard: 1.58136 / 32, highmem: 2.0854 / 32 }, n4: { vcpu: 0.03275, memory: 0.003717, extendedMemory: 0.008745975 }, n4d: { vcpu: 0.027783, memory: 0.003161 } },
  hoursPerMonth: 730,
};
// Selected EMEA hubs. Compute factors use 32-vCPU high-memory list prices
// relative to Iowa; capacity prices are USD per GiB-month for Hyperdisk Balanced.
const REGIONS = {
  'europe-west3': { label: 'Frankfurt', series: ['c4', 'c4d', 'n4', 'n4d'], c4d: 2.3510 / 1.9924, c4: 2.4608 / 2.0854, disk: 0.094 },
  'europe-west2': { label: 'London', series: ['c4', 'c4d', 'n4', 'n4d'], c4d: 2.2713 / 1.9924, c4: 2.3774 / 2.0854, disk: 0.091 },
  'europe-west9': { label: 'Paris', series: ['c4', 'c4d', 'n4'], c4d: 2.3111 / 1.9924, c4: 2.4191 / 2.0854, disk: 0.093 },
  'europe-west4': { label: 'Netherlands', series: ['c4', 'c4d', 'n4', 'n4d'], c4d: 2.0920 / 1.9924, c4: 2.1897 / 2.0854, disk: 0.084 },
  'europe-west1': { label: 'Belgium', series: ['c4', 'c4d', 'n4', 'n4d'], c4d: 2.1938 / 1.9924, c4: 2.2963 / 2.0854, disk: 0.088 },
  'europe-north1': { label: 'Hamina, Finland', series: ['c4', 'n4'], c4: 2.2963 / 2.0854, disk: 0.088 },
  'europe-north2': { label: 'Stockholm, Sweden', series: ['c4', 'n4'], c4: 2.1897 / 2.0854, disk: 0.080 },
  'europe-west8': { label: 'Milan, Italy', series: ['c4', 'n4'], c4: 2.4191 / 2.0854, disk: 0.093 },
  'europe-west12': { label: 'Turin, Italy', series: ['c4', 'n4'], c4: 2.6902 / 2.0854, disk: 0.103 },
  'me-central1': { label: 'Doha, Qatar', series: ['c4', 'n4'], c4: 2.5338 / 2.0854, disk: 0.097 },
  'me-central2': { label: 'Dammam, Saudi Arabia', series: ['c4', 'n4'], c4: 3.3367 / 2.0854, disk: 0.128 },
  'me-west1': { label: 'Tel Aviv, Israel', series: ['c4', 'n4'], c4: 2.2940 / 2.0854, disk: 0.088 },
  'africa-south1': { label: 'Johannesburg', series: ['c4', 'c4d', 'n4'], c4d: 2.1938 / 1.9924, c4: 2.2963 / 2.0854, disk: 0.088 },
};
const PRESETS = { small: { ocpus: 2, memory: 12, boot: 50 }, medium: { ocpus: 8, memory: 48, boot: 100 }, large: { ocpus: 32, memory: 192, boot: 200 } };
const money = value => (value < 0 ? '-$' : '$') + Math.abs(value).toFixed(3);
const monthlyMoney = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const state = { shape: 'e6ax' };
const ocpusInput = document.querySelector('#ocpus');
const memoryInput = document.querySelector('#memory');
const bootInput = document.querySelector('#boot');
const extraBlockInput = document.querySelector('#extra-block');
const familySelect = document.querySelector('#cpu-family');
const matchTypeSelect = document.querySelector('#match-type');
const regionSelect = document.querySelector('#region');
const matchList = document.querySelector('#match-list');
const validation = document.querySelector('#validation');

document.querySelectorAll('[data-shape]').forEach(button => button.addEventListener('click', () => {
  state.shape = button.dataset.shape;
  document.querySelectorAll('[data-shape]').forEach(item => {
    const active = item === button;
    item.classList.toggle('active', active);
    item.setAttribute('aria-pressed', String(active));
  });
  const shape = SHAPES[state.shape];
  ocpusInput.max = shape.maxOcpus;
  memoryInput.max = shape.maxMemory;
  if (+ocpusInput.value > shape.maxOcpus) ocpusInput.value = shape.maxOcpus;
  const allowedMemory = Math.min(shape.maxMemory, +ocpusInput.value * 64);
  if (+memoryInput.value > allowedMemory) memoryInput.value = allowedMemory;
  document.querySelector('#ocpu-help').textContent = `1–${shape.maxOcpus} OCPUs available`;
  render();
}));

document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => {
  const preset = PRESETS[button.dataset.preset];
  ocpusInput.value = preset.ocpus;
  memoryInput.value = preset.memory;
  bootInput.value = preset.boot;
  extraBlockInput.value = 0;
  render();
}));
[ocpusInput, memoryInput, bootInput, extraBlockInput, familySelect, matchTypeSelect, regionSelect].forEach(input => input.addEventListener('input', render));

function render() {
  const shape = SHAPES[state.shape];
  document.querySelector('#source-cpu').textContent = shape.cpu;
  document.querySelector('#oci-shape-name').textContent = shape.name;
  const ocpus = Number(ocpusInput.value);
  const memory = Number(memoryInput.value);
  const boot = Number(bootInput.value);
  const extraBlock = Number(extraBlockInput.value);
  const totalBlock = boot + extraBlock;
  document.querySelector('#oci-size-summary').textContent = `${ocpus} OCPUs · ${memory} GB RAM · ${totalBlock} GB block`;
  const maxMemory = Math.min(shape.maxMemory, ocpus * 64);
  document.querySelector('#memory-help').textContent = `Up to ${Number.isFinite(maxMemory) ? maxMemory : shape.maxMemory} GB at this OCPU count · default 6 GB per OCPU`;
  document.querySelector('#equivalent-vcpus').innerHTML = `${Number.isFinite(ocpus) ? ocpus * 2 : '—'} <span>vCPUs</span>`;
  const issues = [];
  if (!Number.isInteger(ocpus) || ocpus < 1 || ocpus > shape.maxOcpus) issues.push(`Enter 1–${shape.maxOcpus} whole OCPUs.`);
  if (!Number.isInteger(memory) || memory < Math.max(1, ocpus) || memory > maxMemory) issues.push(`Enter ${Math.max(1, ocpus)}–${maxMemory} whole GB of memory.`);
  if (!Number.isInteger(boot) || boot < 50 || boot > 32768) issues.push('Enter 50–32,768 whole GB for the boot volume.');
  if (!Number.isInteger(extraBlock) || (extraBlock !== 0 && extraBlock < 50) || extraBlock > 32768) issues.push('Enter 0 or 50–32,768 whole GB for the extra volume.');
  validation.hidden = issues.length === 0;
  validation.textContent = issues.join(' ');
  if (issues.length) { document.querySelector('#custom-note').hidden = true; matchList.replaceChildren(); document.querySelector('#oci-price').replaceChildren(); document.querySelector('#result-summary').textContent = 'Check the OCI configuration'; return; }
  const ociCompute = ocpus * PRICES.oci[state.shape].ocpu + memory * PRICES.oci[state.shape].memory;
  const ociDisk = totalBlock * PRICES.oci.balancedDiskPerGbMonth / PRICES.hoursPerMonth;
  const ociTotal = ociCompute + ociDisk;
  const targetCpu = ocpus * 2;
  const filter = familySelect.value === 'same' ? shape.vendor : familySelect.value;
  const region = REGIONS[regionSelect.value];
  const customNote = document.querySelector('#custom-note');
  const showCustom = matchTypeSelect.value !== 'predefined';
  const amdUnavailable = !region.series.includes('n4d') && !region.series.includes('c4d');
  const note = amdUnavailable && filter === 'amd' ? `C4D and N4D are not listed in ${region.label}. Choose Any x86 to see Intel matches.` :
    amdUnavailable && filter === 'all' ? `Only Intel N4 and C4 are listed in ${region.label} among the series compared here.` :
    showCustom && !region.series.includes('n4d') && (filter === 'amd' || filter === 'all') ? `N4D custom is not listed in ${region.label}; predefined C4D may still be available.` :
    !showCustom ? '' :
    filter === 'amd' && targetCpu > 96 ? 'N4D custom supports at most 96 vCPUs, so it cannot match this CPU target.' :
    filter === 'intel' && targetCpu > 80 ? 'N4 custom supports at most 80 vCPUs, so it cannot match this CPU target.' : '';
  customNote.hidden = !note;
  customNote.textContent = note;
  const predefined = CATALOG.filter(machine => region.series.includes(machine.series) && (filter === 'all' || machine.vendor === filter) && machine.vcpu >= targetCpu && machine.memory >= memory);
  const custom = ['n4', 'n4d'].filter(series => (filter === 'all' || CUSTOM_SERIES[series].vendor === filter) && region.series.includes(series))
    .flatMap(series => customCandidates(series, targetCpu, memory));
  const sortMatches = candidates => candidates
    .sort((a,b) => (a.vcpu-targetCpu)-(b.vcpu-targetCpu) || (a.memory-memory)-(b.memory-memory) || a.name.localeCompare(b.name))
    .slice(0, matchTypeSelect.value === 'all' ? 3 : 5);
  const groups = [
    ...(matchTypeSelect.value === 'predefined' ? [] : [{ kind: 'custom', title: 'Custom shapes', matches: sortMatches(custom) }]),
    ...(matchTypeSelect.value === 'custom' ? [] : [{ kind: 'predefined', title: 'Standard shapes', matches: sortMatches(predefined) }]),
  ].filter(group => group.matches.length);
  const matchCount = groups.reduce((count, group) => count + group.matches.length, 0);
  const savings = [];
  if (showCustom) {
    const exactCustom = custom.filter(machine => machine.vcpu === targetCpu && machine.memory === memory);
    const pricedExact = exactCustom.filter(machine => estimateGcp(machine, region, totalBlock).priceKnown)
      .sort((a, b) => estimateGcp(a, region, totalBlock).totalCost - estimateGcp(b, region, totalBlock).totalCost)[0];
    savings.push(ociSavingsRow('vs GCP custom exact capacity', pricedExact ?? exactCustom[0], region, totalBlock, ociTotal, 'Exact match unavailable'));
  }
  if (matchTypeSelect.value !== 'custom') {
    const closestStandard = groups.find(group => group.kind === 'predefined')?.matches[0];
    savings.push(ociSavingsRow('vs GCP standard closest fit', closestStandard, region, totalBlock, ociTotal, 'Closest fit unavailable'));
  }
  document.querySelector('#oci-price').innerHTML = `<div class="price-row"><span>ESTIMATED TOTAL / HOUR</span><strong>${money(ociTotal)}</strong></div><div class="price-row"><span>ESTIMATED TOTAL / MONTH · 730 HOURS</span><strong>${monthlyMoney(ociTotal * PRICES.hoursPerMonth)}</strong><div class="oci-savings">${savings.join('')}</div></div><div class="price-breakdown"><div><span>Compute</span><span>${money(ociCompute)} / hour</span></div><div><span>Boot + block · ${totalBlock} GB</span><span>${money(ociDisk)} / hour</span></div></div>`;

  document.querySelector('#result-summary').textContent = `${matchCount ? `${matchCount} options` : 'No matches'} for ${targetCpu} vCPUs · ${memory} GB · ${region.label}`;
  if (!matchCount) { matchList.innerHTML = '<div class="empty">No available machine type in this selection meets both requirements. Try another CPU family, match type, region, or a smaller OCI size.</div>'; return; }
  matchList.innerHTML = groups.map(group => `<section class="match-group" aria-label="${group.title}"><h3 class="match-group-title">${group.title}</h3>${group.matches.map((machine, index) => {
    const extraCpu = machine.vcpu - targetCpu;
    const extraMemory = machine.memory - memory;
    const exact = extraCpu === 0 && extraMemory === 0;
    const label = exact ? '<span class="badge">EXACT CAPACITY</span>' : index === 0 ? '<span class="badge">CLOSEST FIT</span>' : '';
    const { computeCost, diskCost, totalCost, priceKnown } = estimateGcp(machine, region, totalBlock);
    const generationWarning = intelGenerationWarning(state.shape, machine);
    const priceDetail = priceKnown ?
      `VM ${money(computeCost)} / hour + ${totalBlock} GB block ${money(diskCost)} / hour · ${money(totalCost - ociTotal)} / hour and ${monthlyMoney((totalCost - ociTotal) * PRICES.hoursPerMonth)} / month vs OCI` :
      `Custom VM price: check Google Cloud. Block-only estimate ${money(diskCost)} / hour · ${monthlyMoney(diskCost * PRICES.hoursPerMonth)} / month.`;
    return `<article class="match"><div class="match-main"><div class="match-top"><h4>${machine.name}</h4>${label}${machine.kind === 'custom' ? '<span class="badge badge-custom">CUSTOM</span>' : ''}</div><div class="match-meta"><span>${machine.cpu}</span><span>${machine.vcpu} vCPUs</span><span>${machine.memory.toLocaleString()} GB RAM</span></div><div class="match-extra">${exact ? 'Exact vCPU and memory capacity' : `+${extraCpu} vCPUs · +${extraMemory.toLocaleString()} GB vs. target`}${machine.extended ? ' · Extended memory' : ''}</div>${generationWarning ? `<div class="generation-warning" role="note"><strong>CPU generation warning</strong><span>${generationWarning}</span></div>` : ''}<div class="match-price"><div class="price-period"><span>PER HOUR</span><strong>${priceKnown ? money(totalCost) : 'Quote required'}</strong></div><div class="price-period"><span>PER MONTH · 730 HOURS</span><strong>${priceKnown ? monthlyMoney(totalCost * PRICES.hoursPerMonth) : 'Quote required'}</strong></div><small>${priceDetail}</small></div></div><div class="match-score" title="Google Cloud machine class">${machine.kind === 'custom' ? 'FLEX' : machine.className === 'highcpu' ? 'CPU' : machine.className === 'highmem' ? 'MEM' : 'STD'}</div></article>`;
  }).join('')}</section>`).join('');
}

render();
