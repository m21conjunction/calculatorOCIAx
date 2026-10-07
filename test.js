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
  'egress-profile': 'typical', 'egress-gb': '150', 'egress-destination': 'europe', 'oci-free-gb': '10000',
  'cpu-family': 'same', 'match-type': 'all', region: 'europe-west3',
})) nodes[`#${id}`] = makeNode(value);
for (const id of ['match-list', 'validation', 'source-cpu', 'memory-help', 'oci-price', 'result-summary', 'ocpu-help', 'custom-note', 'oci-shape-name', 'oci-size-summary', 'egress-bandwidth']) {
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
assert.match(nodes['#oci-price'].innerHTML, /12\.4% savings/);
assert.match(nodes['#oci-price'].innerHTML, /vs GCP standard closest fit · c4d-standard-32/);
assert.match(nodes['#oci-price'].innerHTML, /30\.6% savings/);
assert.match(results(), /Custom shapes/);
assert.match(results(), /Standard shapes/);
assert.match(results(), /PER MONTH · 730 HOURS/);
assert.match(results(), /\$1,053\.26/);
assert.match(results(), /internet egress \$16\.64 \/ month/);
assert.match(nodes['#egress-bandwidth'].textContent, /0\.46 Mbps/);
assert.equal(vm.runInContext("ociEgressMonthly(12000, 10000, 'europe-west3')", context), 17);
assert.equal(vm.runInContext("ociEgressMonthly(12000, 10000, 'me-central2')", context), 100);
assert.equal(vm.runInContext("gcpEgressMonthly(1.073741824, 'europe')", context), 0);
assert.equal(Number(vm.runInContext("gcpEgressMonthly(150, 'europe')", context).toFixed(2)), 16.64);
assert.ok(vm.runInContext("gcpEgressMonthly(150, 'saudi')", context) > vm.runInContext("gcpEgressMonthly(150, 'mea')", context));
const tenTiBInGb = 10240 / vm.runInContext('GB_TO_GIB', context);
const tenTiBCost = vm.runInContext(`gcpEgressMonthly(${tenTiBInGb}, 'europe')`, context);
assert.ok(Math.abs(tenTiBCost - (1023 * 0.12 + 9216 * 0.11)) < 1e-6);
const twentyTiBCost = vm.runInContext(`gcpEgressMonthly(${tenTiBInGb * 2}, 'europe')`, context);
assert.ok(Math.abs(twentyTiBCost - (tenTiBCost + 10240 * 0.085)) < 1e-6);
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
assert.match(results(), /C4 CPU platform · Depends on zone/);
assert.match(results(), /Region alone cannot identify this C4 processor/);
assert.match(results(), /Google does not list a zone in Frankfurt/);
assert.match(results(), /a same-generation match requires Granite Rapids on C4/);
nodes['#region'].value = 'europe-north1';
render();
assert.match(results(), /europe-north1-b or europe-north1-c/);
nodes['#region'].value = 'europe-west8';
render();
assert.match(results(), /europe-west8-c/);
nodes['#region'].value = 'europe-west3';
render();
assert.match(nodes['#oci-price'].innerHTML, /vs GCP standard closest fit · c4-standard-32/);
assert.doesNotMatch(nodes['#oci-price'].innerHTML, /vs GCP custom exact capacity/);
assert.equal(vm.runInContext("intelGenerationWarning('x12ax', { series: 'c4', vcpu: 144 })", context), '');
assert.equal(vm.runInContext("intelGenerationWarning('x12ax', { series: 'c4', vcpu: 288 })", context), '');
assert.equal(vm.runInContext("intelGenerationWarning('e6ax', { series: 'n4', vcpu: 32 })", context), '');
assert.match(vm.runInContext("c4PlatformGuidance({ series: 'c4', vcpu: 32 }, 'europe-north1', 'x12ax')", context), /europe-north1-b or europe-north1-c/);
assert.match(vm.runInContext("c4PlatformGuidance({ series: 'c4', vcpu: 32 }, 'europe-west8', 'x12ax')", context), /europe-west8-c/);
assert.match(vm.runInContext("c4PlatformGuidance({ series: 'c4', vcpu: 32 }, 'europe-west4', 'x12ax')", context), /De Kooy AI zone/);
assert.match(vm.runInContext("c4PlatformGuidance({ series: 'c4', vcpu: 144 }, 'europe-west3', 'x12ax')", context), /Granite Rapids guaranteed/);
assert.match(vm.runInContext("c4PlatformGuidance({ series: 'c4', vcpu: 288 }, 'europe-west3', 'x12ax')", context), /Granite Rapids guaranteed/);
assert.equal(vm.runInContext("c4PlatformGuidance({ series: 'c4d', vcpu: 32 }, 'europe-west3', 'x12ax')", context), '');
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
nodes['#egress-profile'].value = 'heavy';
nodes['#egress-profile'].listeners.input();
assert.equal(nodes['#egress-gb'].value, 27500);
assert.match(nodes['#oci-price'].innerHTML, /Internet egress · 27,500 GB\/month<\/span><span>\$148\.75 \/ month/);
nodes['#egress-profile'].value = 'web';
nodes['#egress-profile'].listeners.input();
assert.equal(nodes['#egress-gb'].value, 3000);
nodes['#egress-gb'].value = '400';
nodes['#egress-gb'].listeners.input();
assert.equal(nodes['#egress-profile'].value, 'custom');
nodes['#egress-gb'].value = '12000';
nodes['#oci-free-gb'].value = '10000';
render();
assert.match(nodes['#oci-price'].innerHTML, /Internet egress · 12,000 GB\/month<\/span><span>\$17\.00 \/ month/);
nodes['#oci-free-gb'].value = '0';
render();
assert.match(nodes['#oci-price'].innerHTML, /Internet egress · 12,000 GB\/month<\/span><span>\$102\.00 \/ month/);
nodes['#egress-gb'].value = '-1';
render();
assert.match(nodes['#validation'].textContent, /monthly internet egress/);
assert.equal(nodes['#oci-price'].innerHTML, '');
console.log('Custom sizing, internet egress, monthly savings, CPU generation warnings, pricing, filters, and regions passed.');
