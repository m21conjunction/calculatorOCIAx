const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function makeNode(value = '') {
  return {
    value, innerHTML: '', textContent: '', hidden: false, dataset: {}, listeners: {},
    classList: { toggle() {} }, setAttribute() {}, replaceChildren() { this.innerHTML = ''; },
    addEventListener(event, handler) { this.listeners[event] = handler; },
  };
}

const nodes = {};
for (const [id, value] of Object.entries({
  ocpus: '16', memory: '96', boot: '100', 'extra-block': '0',
  'cpu-family': 'same', 'match-type': 'all', region: 'europe-west3',
})) nodes[`#${id}`] = makeNode(value);
for (const id of ['match-list', 'validation', 'source-cpu', 'memory-help', 'equivalent-vcpus', 'oci-price', 'result-summary', 'ocpu-help', 'custom-note', 'oci-shape-name', 'oci-size-summary']) {
  nodes[`#${id}`] = makeNode();
}
const shapes = ['e6ax', 'x12ax'].map(shape => Object.assign(makeNode(), { dataset: { shape } }));
const presets = ['small', 'medium', 'large'].map(preset => Object.assign(makeNode(), { dataset: { preset } }));
const document = {
  querySelector: selector => nodes[selector],
  querySelectorAll: selector => selector === '[data-shape]' ? shapes : selector === '[data-preset]' ? presets : [],
};
const context = vm.createContext({ document });
vm.runInContext(fs.readFileSync('script.js', 'utf8'), context);
const render = () => vm.runInContext('render()', context);
const results = () => nodes['#match-list'].innerHTML;

assert.match(results(), /n4d-custom-32-98304/);
assert.match(results(), /EXACT CAPACITY/);
assert.match(results(), /AMD EPYC 9B45/);
assert.equal(nodes['#source-cpu'].textContent, 'AMD EPYC 9J45');
assert.equal(nodes['#oci-shape-name'].textContent, 'VM.Standard.E6.Ax.Flex');
assert.match(nodes['#oci-price'].innerHTML, /ESTIMATED TOTAL \/ HOUR/);
assert.match(nodes['#oci-price'].innerHTML, /ESTIMATED TOTAL \/ MONTH · 730 HOURS/);
assert.match(nodes['#oci-price'].innerHTML, /\$922\.30/);
assert.match(nodes['#oci-price'].innerHTML, /vs GCP custom exact capacity · n4d-custom-32-98304/);
assert.match(nodes['#oci-price'].innerHTML, /11\.0% savings/);
assert.match(nodes['#oci-price'].innerHTML, /vs GCP standard closest fit · c4d-standard-32/);
assert.match(nodes['#oci-price'].innerHTML, /29\.7% savings/);
assert.match(results(), /Custom shapes/);
assert.match(results(), /Standard shapes/);
assert.match(results(), /PER MONTH · 730 HOURS/);
assert.match(results(), /\$1,036\.62/);
assert.match(nodes['#memory-help'].textContent, /default 6 GB per OCPU/);
for (const preset of presets) {
  preset.listeners.click();
  assert.equal(Number(nodes['#memory'].value), Number(nodes['#ocpus'].value) * 6);
}
nodes['#ocpus'].value = '16';
nodes['#memory'].value = '96';
nodes['#boot'].value = '100';
render();

shapes[1].listeners.click();
assert.match(results(), /n4-custom-32-98304/);
assert.match(results(), /Intel Xeon Platinum 8581C/);
assert.equal(nodes['#source-cpu'].textContent, 'Intel Xeon 6 6987P-C');
assert.equal(nodes['#oci-shape-name'].textContent, 'VM.Standard4.Ax.Flex');
assert.match(results(), /CPU generation warning/);
assert.match(results(), /The CPU generations differ even when vCPU and memory match exactly/);

nodes['#match-type'].value = 'predefined';
nodes['#memory'].value = '120';
render();
assert.match(results(), /c4-standard-32/);
assert.match(results(), /EXACT CAPACITY/);
assert.match(results(), /This C4 size can use/);
assert.match(nodes['#oci-price'].innerHTML, /vs GCP standard closest fit · c4-standard-32/);
assert.doesNotMatch(nodes['#oci-price'].innerHTML, /vs GCP custom exact capacity/);
assert.equal(vm.runInContext("intelGenerationWarning('x12ax', { series: 'c4', vcpu: 144 })", context), '');
assert.equal(vm.runInContext("intelGenerationWarning('x12ax', { series: 'c4', vcpu: 288 })", context), '');
assert.equal(vm.runInContext("intelGenerationWarning('e6ax', { series: 'n4', vcpu: 32 })", context), '');
nodes['#match-type'].value = 'all';
nodes['#memory'].value = '128';

shapes[0].listeners.click();
nodes['#match-type'].value = 'custom';
nodes['#ocpus'].value = '3';
nodes['#memory'].value = '24';
render();
assert.match(results(), /n4d-custom-8-24576/);
assert.doesNotMatch(results(), /n4d-custom-6-/);
assert.doesNotMatch(results(), /EXACT CAPACITY/);
assert.doesNotMatch(results(), /Standard shapes/);
assert.match(nodes['#oci-price'].innerHTML, /Exact match unavailable/);
assert.doesNotMatch(nodes['#oci-price'].innerHTML, /vs GCP standard closest fit/);

nodes['#ocpus'].value = '2';
nodes['#memory'].value = '64';
render();
assert.match(results(), /n4d-custom-4-65536-ext/);
assert.match(results(), /n4d-custom-8-65536/);
assert.match(results(), /Custom VM price: check Google Cloud/);
assert.match(nodes['#oci-price'].innerHTML, /GCP quote required/);
assert.doesNotMatch(nodes['#oci-price'].innerHTML, /% savings/);

nodes['#region'].value = 'europe-west9';
render();
assert.match(results(), /No available machine type/);
assert.match(nodes['#custom-note'].textContent, /N4D custom is not listed in Paris/);

shapes[1].listeners.click();
render();
assert.match(results(), /n4-custom-4-65536-ext/);
assert.match(results(), /\$[0-9]+\.[0-9]{3} \/ hour/);

// Every selectable region has a price factor for each series it offers.
const regionIds = [...fs.readFileSync('index.html', 'utf8').matchAll(/<option value="([^"]+)">[^<]*· (?:europe|me|africa)-/g)].map(match => match[1]);
const configuredRegions = vm.runInContext('REGIONS', context);
assert.equal(regionIds.length, Object.keys(configuredRegions).length);
for (const id of regionIds) {
  assert.ok(configuredRegions[id], `${id} is missing pricing`);
  const region = configuredRegions[id];
  assert.ok(region.disk > 0);
  for (const series of region.series) assert.ok(region[series === 'n4d' ? 'c4d' : series === 'n4' ? 'c4' : series] > 0);
}

nodes['#region'].value = 'me-central2';
nodes['#match-type'].value = 'all';
render();
assert.match(results(), /n4-custom-/);
assert.doesNotMatch(results(), /c4d-|n4d-/);
assert.match(nodes['#result-summary'].textContent, /Dammam, Saudi Arabia/);

shapes[0].listeners.click();
render();
assert.match(results(), /No available machine type/);
assert.match(nodes['#custom-note'].textContent, /C4D and N4D are not listed in Dammam/);

nodes['#region'].value = 'europe-west3';
nodes['#match-type'].value = 'predefined';
render();
assert.doesNotMatch(results(), /-custom-/);
assert.doesNotMatch(results(), /Custom shapes/);
assert.match(results(), /Standard shapes/);
assert.match(results(), /c4d-/);
assert.match(nodes['#oci-price'].innerHTML, /vs GCP standard closest fit/);
assert.doesNotMatch(nodes['#oci-price'].innerHTML, /vs GCP custom exact capacity/);
const higherCost = vm.runInContext("ociSavingsRow('test', { series: 'c4d', className: 'standard', kind: 'predefined', vcpu: 32, memory: 124, name: 'test' }, REGIONS['europe-west3'], 100, 10, 'none')", context);
assert.match(higherCost, /% higher/);
assert.doesNotMatch(higherCost, /% savings/);
console.log('Custom sizing, monthly savings, CPU generation warnings, pricing, filters, and regions passed.');
