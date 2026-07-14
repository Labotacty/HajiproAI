import fs from 'node:fs';
import vm from 'node:vm';

const DEFAULT_HTML = new URL('./ArduiNodon-UI_v1-5.html', import.meta.url);

function matchingBrace(text, openIndex) {
  let depth = 0;
  let quote = null;
  for (let i = openIndex; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];

    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && n === '/') {
      const eol = text.indexOf('\n', i + 2);
      i = eol < 0 ? text.length : eol;
      continue;
    }
    if (c === '/' && n === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return i;
  }
  throw new Error(`Could not find matching brace at ${openIndex}.`);
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Function not found in HTML: ${name}`);
  const open = source.indexOf('{', start);
  const close = matchingBrace(source, open);
  return source.slice(start, close + 1);
}

function extractObjectDeclaration(source, name) {
  const start = source.indexOf(`const ${name} =`);
  if (start < 0) throw new Error(`Declaration not found in HTML: ${name}`);
  const open = source.indexOf('{', start);
  const close = matchingBrace(source, open);
  return `${source.slice(start, close + 1)};`;
}

function evaluateDeclaration(declaration, name) {
  const box = {};
  vm.createContext(box);
  vm.runInContext(`${declaration}\nthis.value = ${name};`, box);
  return JSON.parse(JSON.stringify(box.value));
}

function readTables(html) {
  const exportMap = evaluateDeclaration(
    extractObjectDeclaration(html, 'NODON_EXPORT_MAP'),
    'NODON_EXPORT_MAP',
  );
  const ports = evaluateDeclaration(
    extractObjectDeclaration(html, 'NODON_PORTS'),
    'NODON_PORTS',
  );
  const objectPortConfig = evaluateDeclaration(
    extractObjectDeclaration(html, 'OBJ_PORT_CONFIG'),
    'OBJ_PORT_CONFIG',
  );
  return { exportMap, ports, objectPortConfig };
}

function readCatalog(html, tables) {
  const start = html.indexOf('const OPT = {');
  const end = html.indexOf('const NODON_EXPORT_MAP =', start);
  if (start < 0 || end < 0) throw new Error('Nodon definition block not found.');

  const box = {};
  vm.createContext(box);
  vm.runInContext(`${html.slice(start, end)}\nthis.value = NODON_TYPES;`, box);

  const catalog = Object.entries(box.value).map(([type, definition]) => {
    const [functionName, exportParams] = tables.exportMap[type] ?? [null, []];
    const portCounts = tables.ports[type] ?? [0, 0];
    const params = (definition.params ?? []).map(param => ({
      key: param.key,
      label: param.lbl,
      kind: param.type,
      default: param.df,
      min: param.mn,
      max: param.mx,
      step: param.st,
      integerOnly: type === 'counter'
        && ['startVal', 'lowerRange', 'upperRange'].includes(param.key)
        ? true : undefined,
      maxDecimals: (type === 'constant' || type === 'map') && param.type === 'n'
        ? 6 : undefined,
      note: param.note || undefined,
      options: Array.isArray(param.opts)
        ? param.opts.map(option => ({ value: option[0], label: option[1] }))
        : undefined,
    }));
    return {
      type,
      name: definition.name,
      abbreviation: definition.abbr,
      category: definition.cat,
      functionName,
      ports: { inputs: portCounts[0], outputs: portCounts[1] },
      objectPort: tables.objectPortConfig[type] ?? null,
      parameterKeys: exportParams,
      params,
    };
  });
  return catalog;
}

function filterCatalog(catalog, { type, category, query, detail = 'summary' } = {}) {
  const q = query ? String(query).toLowerCase() : '';
  const filtered = catalog.filter(item => {
    if (type && item.type !== type) return false;
    if (category && item.category !== category) return false;
    if (q && !`${item.type} ${item.name} ${item.abbreviation} ${item.functionName}`.toLowerCase().includes(q)) return false;
    return true;
  });
  if (detail === 'full' || type) return filtered;
  return filtered.map(({ params, ...summary }) => summary);
}

function parseArguments(text) {
  const result = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
    if (i >= text.length) break;

    if (text[i] === '"') {
      let value = '';
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length) i++;
        value += text[i++];
      }
      if (text[i] === '"') i++;
      result.push({ string: true, value });
    } else {
      const start = i;
      while (i < text.length && text[i] !== ',') i++;
      result.push({ string: false, value: text.slice(start, i).trim() });
    }
    while (i < text.length && (text[i] === ',' || text[i] === ' ' || text[i] === '\t')) i++;
  }
  return result;
}

function argumentValue(arg) {
  if (!arg) return 0;
  if (arg.string) return arg.value;
  const value = Number(arg.value);
  return Number.isNaN(value) ? 0 : value;
}

function nodeId(x, y) {
  return `${Number(x)},${Number(y)}`;
}

function visualPort(ardui, total) {
  const p = Number(ardui) || 0;
  if (total <= 1) return 0;
  if (total === 2) return Math.max(p - 1, 0);
  if (total === 3) return [1, 0, 2][p] ?? 0;
  if (total === 4) return [1, 0, 2, 3][p] ?? 0;
  return p;
}

function arduinoPort(visual, total) {
  const p = Number(visual) || 0;
  if (total <= 1) return 0;
  if (total === 2) return p + 1;
  if (total === 3) return [1, 0, 2][p] ?? 0;
  if (total === 4) return [1, 0, 2, 3][p] ?? 0;
  return p;
}

function formatProgramValue(value) {
  if (typeof value === 'string') return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'NaN';
    if (value === Infinity) return 'Infinity';
    if (value === -Infinity) return '-Infinity';
    return String(value);
  }
  return String(value ?? 0);
}

export function exportProgram(graph, tables) {
  const { exportMap, ports } = tables;
  const lines = [];
  const entries = Object.entries(graph.nodes ?? {})
    .filter(([, nd]) => nd?.type && exportMap[nd.type])
    .sort(([a], [b]) => {
      const [ax, ay] = a.split(',').map(Number);
      const [bx, by] = b.split(',').map(Number);
      return ay - by || ax - bx;
    });

  for (const [nid, nd] of entries) {
    const [x, y] = nid.split(',').map(Number);
    const [fn, keys] = exportMap[nd.type];
    const args = [x, y, ...keys.map(key => formatProgramValue(nd.params?.[key] ?? 0))];
    lines.push(`${fn}(${args.join(',')});`);
  }

  if (graph.wires?.length) {
    lines.push('');
    for (const wire of graph.wires) {
      const fromType = graph.nodes?.[wire.from]?.type;
      const toType = graph.nodes?.[wire.to]?.type;
      const outTotal = ports[fromType]?.[1] ?? 1;
      const inTotal = ports[toType]?.[0] ?? 1;
      const [x1, y1] = wire.from.split(',').map(Number);
      const [x2, y2] = wire.to.split(',').map(Number);
      lines.push(`createConnection(${x1},${y1},${x2},${y2},${arduinoPort(wire.inPort ?? 0, inTotal)},${arduinoPort(wire.outPort ?? 0, outTotal)});`);
    }
  }

  if (graph.objectWires?.length) {
    lines.push('');
    for (const wire of graph.objectWires) {
      const [x1, y1] = wire.from.split(',').map(Number);
      const [x2, y2] = wire.to.split(',').map(Number);
      lines.push(`createObjectConnection(${x1},${y1},${x2},${y2});`);
    }
  }

  const editFields = [
    ['sizeX', 0], ['sizeY', 0], ['sizeZ', 0],
    ['rotX', 0], ['rotY', 0], ['rotZ', 0],
    ['posX', 404], ['posY', 404], ['posZ', 404],
    ['fancyAppearance', 0], ['screenViewpoint', 0],
  ];
  const editNodes = entries.filter(([, nd]) => editFields.some(([key]) => Object.hasOwn(nd.params ?? {}, key)));
  if (editNodes.length) {
    lines.push('');
    for (const [nid, nd] of editNodes) {
      const [x, y] = nid.split(',').map(Number);
      const values = editFields.map(([key, fallback]) => formatProgramValue(nd.params?.[key] ?? fallback));
      lines.push(`editObject(${x},${y},${values.join(',')});`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export function parseProgram(source, tables = readTables(source)) {
  const { exportMap, ports } = tables;
  const fnToType = Object.fromEntries(
    Object.entries(exportMap).map(([type, [fn]]) => [fn, type]),
  );
  const nodes = {};
  const pendingConnections = [];
  const objectWires = [];
  const edits = [];

  for (const rawLine of String(source).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;
    const match = line.match(/^([A-Za-z_]\w*)\s*\(([^]*?)\)\s*;?$/);
    if (!match) continue;

    const fn = match[1];
    const args = parseArguments(match[2]);
    if (fn === 'createConnection') {
      if (args.length < 4) continue;
      pendingConnections.push({
        x1: argumentValue(args[0]), y1: argumentValue(args[1]),
        x2: argumentValue(args[2]), y2: argumentValue(args[3]),
        inPort: argumentValue(args[4]), outPort: argumentValue(args[5]),
      });
      continue;
    }
    if (fn === 'createObjectConnection') {
      if (args.length >= 4) objectWires.push({
        from: nodeId(argumentValue(args[0]), argumentValue(args[1])),
        to: nodeId(argumentValue(args[2]), argumentValue(args[3])),
      });
      continue;
    }
    if (fn === 'editObject') {
      if (args.length >= 2) edits.push(args);
      continue;
    }

    const type = fnToType[fn];
    if (!type || args.length < 2) continue;
    const x = argumentValue(args[0]);
    const y = argumentValue(args[1]);
    const nid = nodeId(x, y);
    const paramKeys = exportMap[type]?.[1] ?? [];
    const params = {};
    for (let i = 0; i < paramKeys.length; i++) {
      params[paramKeys[i]] = argumentValue(args[i + 2]);
    }
    nodes[nid] = { type, params, comment: '' };
  }

  const wires = pendingConnections.flatMap((w) => {
    const from = nodeId(w.x1, w.y1);
    const to = nodeId(w.x2, w.y2);
    const fromType = nodes[from]?.type;
    const toType = nodes[to]?.type;
    if (!fromType || !toType) return [];
    const outTotal = ports[fromType]?.[1] ?? 1;
    const inTotal = ports[toType]?.[0] ?? 1;
    const outPort = visualPort(w.outPort, outTotal);
    const inPort = visualPort(w.inPort, inTotal);
    if (outPort >= outTotal || inPort >= inTotal) return [];
    return [{ from, to, outPort, inPort }];
  });

  // Preserve the editObject fields used by the simulator's configured sensors.
  for (const args of edits) {
    const nid = nodeId(argumentValue(args[0]), argumentValue(args[1]));
    const nd = nodes[nid];
    if (!nd) continue;
    const fields = [
      'sizeX','sizeY','sizeZ','rotX','rotY','rotZ',
      'posX','posY','posZ','fancyAppearance','screenViewpoint',
    ];
    for (let i = 2; i < args.length && i - 2 < fields.length; i++) {
      nd.params[fields[i - 2]] = argumentValue(args[i]);
    }
  }

  return { nodes, wires, objectWires };
}

const COUNTER_INTEGER_PARAMS = new Set(['startVal', 'lowerRange', 'upperRange']);
const MAP_DECIMAL_PARAMS = new Set(['lowerIn', 'upperIn', 'lowerOut', 'upperOut']);

function hasAtMostSixDecimals(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return false;
  return Math.abs(numeric - Math.round(numeric * 1e6) / 1e6) <= 1e-10;
}

function validateParameter(type, key, value) {
  if (type === 'counter' && COUNTER_INTEGER_PARAMS.has(key)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
      throw new Error(`Counter parameter ${key} must be an integer; received ${value}.`);
    }
  }
  if ((type === 'constant' && key === 'value')
      || (type === 'map' && MAP_DECIMAL_PARAMS.has(key))) {
    if (!hasAtMostSixDecimals(value)) {
      throw new Error(`${type} parameter ${key} supports at most 6 decimal places; received ${value}.`);
    }
  }
}

function validateGraphConfig(graph) {
  for (const [nid, node] of Object.entries(graph?.nodes ?? {})) {
    const [x, y] = nid.split(',').map(Number);
    if (!Number.isInteger(x) || !Number.isInteger(y)
        || x < 0 || x > 18 || y < 0 || y > 10) {
      throw new Error(`Nodon position (${nid}) is out of range [0-18, 0-10].`);
    }
    if (y === 0 && (x === 17 || x === 18)) {
      throw new Error(`Nodon position (${nid}) is disabled.`);
    }
    for (const key of [...COUNTER_INTEGER_PARAMS, ...(node?.type === 'map' ? MAP_DECIMAL_PARAMS : []), ...(node?.type === 'constant' ? ['value'] : [])]) {
      if (node?.params && Object.hasOwn(node.params, key)) {
        validateParameter(node.type, key, node.params[key]);
      }
    }
  }
  return graph;
}

function seededRandom(seed) {
  let state = (Number(seed) >>> 0) || 0x6d2b79f5;
  return () => {
    state = (Math.imul(state ^ (state >>> 15), state | 1) + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 7), state | 61);
    t = (t ^ (t >>> 14)) >>> 0;
    return t / 4294967296;
  };
}

function buildRuntime(html, seed) {
  const { ports } = readTables(html);
  const stateStart = html.indexOf('const _fround = Math.fround;');
  const stateEnd = html.indexOf('// IDs of topbar elements', stateStart);
  if (stateStart < 0 || stateEnd < 0) throw new Error('Simulation state block not found.');
  const stateCode = html.slice(stateStart, stateEnd);

  const functions = [
    '_resetSimState',
    '_runOneSimTick',
    '_preApplyInputNodons',
    'runOneTick',
    '_simInput',
    '_sampleFrameInputs',
    '_counterRound',
    '_counterApplyMode',
    '_applyFrameSamples',
  ].map((name) => extractFunction(html, name)).join('\n\n');

  const random = seededRandom(seed);
  const math = Object.create(Math);
  math.random = random;
  const sandbox = { Math: math, console };
  vm.createContext(sandbox);

  const prelude = `
const nodes = {};
const wires = [];
const objectWires = [];
let simGlobalTick = 0;
let simRunning = true;
let simPaused = true;
let simLastTime = null;
let simManualAdvancing = false;
const TICKS_PER_FRAME = 16;
const NODON_PORTS = ${JSON.stringify(ports)};
function updateSimPauseBtn() {}
`;
  const api = `
function _headlessTime() {
  const tick = simGlobalTick;
  if (tick === 15) return { tick, frame: 0, subframe: 0, elapsedSubframes: 0 };
  return {
    tick,
    frame: Math.floor((tick - 16) / TICKS_PER_FRAME) + 1,
    subframe: (tick % TICKS_PER_FRAME) + 1,
    elapsedSubframes: Math.max(0, tick - 15),
  };
}
function _headlessClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}
function _headlessReadNode(nid) {
  const nd = nodes[nid];
  if (!nd?.type) return null;
  const [numIn, numOut] = NODON_PORTS[nd.type] ?? [0, 0];
  const [x, y] = nid.split(',').map(Number);
  const inputs = Array.from({length:numIn}, (_, i) => _simInput(nid, i));
  const outputs = Array.from({length:numOut}, (_, i) => simPrev[nid + ':' + i] ?? F(0));
  return {
    id: nid, x, y, type: nd.type,
    params: _headlessClone(nd.params), inputs, outputs,
    internal: _headlessClone({
      nodeState: nodeState[nid],
      frameSampled: frameSampled[nid],
      frameOutputLatch: frameOutputLatch[nid],
      simNodeCfg: simNodeCfg[nid],
    }),
  };
}
function _headlessReadNodes(refs) {
  const ids = refs === undefined ? Object.keys(nodes).filter(nid => nodes[nid]?.type) : refs;
  const result = {};
  for (const nid of ids) {
    const nd = _headlessReadNode(nid);
    if (nd) result[nid] = nd;
  }
  return result;
}
function _headlessSnapshot(refs) {
  return { time: _headlessTime(), nodes: _headlessReadNodes(refs) };
}
function _headlessReset() {
  simRunning = true;
  simPaused = true;
  simGlobalTick = 15;
  for (const key in simOverrideVal) delete simOverrideVal[key];
  _resetSimState();
  for (const [nid, nd] of Object.entries(nodes)) {
    if (nd.type === 'constant') simPrev[nid + ':0'] = F(nd.params.value ?? 1);
  }
}
function _headlessLoadGraph(graph) {
  for (const key in nodes) delete nodes[key];
  wires.length = 0;
  objectWires.length = 0;
  for (const [nid, nd] of Object.entries(graph.nodes ?? {})) {
    nodes[nid] = { type: nd.type, params: {...(nd.params ?? {})}, comment: nd.comment ?? '' };
  }
  for (const wire of graph.wires ?? []) wires.push({...wire});
  for (const wire of graph.objectWires ?? []) objectWires.push({...wire});
  _headlessReset();
  return _headlessSnapshot();
}
function _headlessSetOverride(nid, port, value) {
  if (!nodes[nid]?.type) throw new Error('No Nodon at ' + nid + '.');
  simOverrideVal[nid + ':' + Math.max(0, Math.floor(Number(port) || 0))] = F(Number(value));
  return _headlessReadNode(nid);
}
function _headlessSetParameter(nid, key, value, resetState = false) {
  if (!nodes[nid]?.type) throw new Error('No Nodon at ' + nid + '.');
  if (!key || typeof key !== 'string') throw new Error('Parameter key must be a string.');
  nodes[nid].params[key] = typeof value === 'number' ? F(value) : value;
  if (resetState) _headlessReset();
  return _headlessReadNode(nid);
}
function _headlessClearOverride(nid, port) {
  delete simOverrideVal[nid + ':' + Math.max(0, Math.floor(Number(port) || 0))];
}
function _headlessStepTicks(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  simManualAdvancing = true;
  try { for (let i = 0; i < n; i++) _runOneSimTick(); }
  finally { simManualAdvancing = false; }
}
function _headlessStepFrame() {
  do { _headlessStepTicks(1); }
  while (simGlobalTick % TICKS_PER_FRAME !== 15);
}
this.__headless = {
  loadGraph: _headlessLoadGraph,
  reset: _headlessReset,
  setOverride: _headlessSetOverride,
  setParameter: _headlessSetParameter,
  clearOverride: _headlessClearOverride,
  readNode: _headlessReadNode,
  readNodes: _headlessReadNodes,
  readState: _headlessSnapshot,
  readGraph: () => ({ nodes: _headlessClone(nodes), wires: _headlessClone(wires), objectWires: _headlessClone(objectWires), time: _headlessTime() }),
  stepTicks(count = 1, observe) { _headlessStepTicks(count); return _headlessSnapshot(observe); },
  stepFrame(count = 1, observe) {
    for (let i = 0; i < Math.max(0, Math.floor(Number(count) || 0)); i++) _headlessStepFrame();
    return _headlessSnapshot(observe);
  },
  runFrames(count = 1, observe) {
    const samples = [];
    for (let i = 0; i < Math.max(0, Math.floor(Number(count) || 0)); i++) {
      _headlessStepFrame();
      samples.push(_headlessSnapshot(observe));
    }
    return { samples, final: _headlessSnapshot(observe) };
  },
};
`;

  vm.runInContext(`${prelude}\n${stateCode}\n${functions}\n${api}`, sandbox, {
    filename: 'ArduiNodon-embedded-simulator.js',
  });
  return sandbox.__headless;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function applyParameterPatches(graph, patches) {
  if (!patches) return;
  const list = Array.isArray(patches)
    ? patches
    : Object.entries(patches).flatMap(([key, value]) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          return Object.entries(value).map(([param, v]) => ({ node: key, key: param, value: v }));
        }
        const split = key.lastIndexOf('.');
        return split > 0
          ? [{ node: key.slice(0, split), key: key.slice(split + 1), value }]
          : [];
      });
  for (const patch of list) {
    const nid = typeof patch.node === 'string'
      ? patch.node
      : `${Number(patch.node?.x)},${Number(patch.node?.y)}`;
    if (!graph.nodes?.[nid]) throw new Error(`No Nodon at ${nid}.`);
    if (!patch.key) throw new Error(`Missing parameter key for ${nid}.`);
    graph.nodes[nid].params[patch.key] = patch.value;
  }
}

function observedValue(node) {
  if (!node) return null;
  if (node.outputs?.length) return node.outputs[0];
  if (node.inputs?.length) return node.inputs[0];
  return null;
}

function compareExpected(actual, expected, epsilon) {
  if (typeof actual === 'number' && typeof expected === 'number') {
    if (Number.isNaN(actual) || Number.isNaN(expected)) return Number.isNaN(actual) && Number.isNaN(expected);
    return Math.abs(actual - expected) <= epsilon;
  }
  return Object.is(actual, expected);
}

export function createEngine({ htmlPath = DEFAULT_HTML, seed = 1 } = {}) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const tables = readTables(html);
  const catalog = readCatalog(html, tables);
  const runtime = buildRuntime(html, seed);
  return {
    getCatalog(options = {}) { return { count: filterCatalog(catalog, options).length, types: filterCatalog(catalog, options) }; },
    parse(source) { return validateGraphConfig(parseProgram(source, tables)); },
    loadProgram(source) { return runtime.loadGraph(validateGraphConfig(parseProgram(source, tables))); },
    loadGraph(graph) { return runtime.loadGraph(validateGraphConfig(graph)); },
    reset() { return runtime.reset(); },
    setInput(node, port, value) { return runtime.setOverride(`${Number(node.x)},${Number(node.y)}`, port, value); },
    setOverride(nid, port, value) { return runtime.setOverride(nid, port, value); },
    setParameter(nid, key, value, resetState = false) {
      const node = runtime.readGraph().nodes?.[nid];
      validateParameter(node?.type, key, value);
      return runtime.setParameter(nid, key, value, resetState);
    },
    clearOverride(nid, port) { return runtime.clearOverride(nid, port); },
    readNode(nid) { return runtime.readNode(nid); },
    readNodes(refs) { return runtime.readNodes(refs); },
    readState(refs) { return runtime.readState(refs); },
    readGraph() { return runtime.readGraph(); },
    exportProgram() { return exportProgram(runtime.readGraph(), tables); },
    stepTicks(count, observe) { return runtime.stepTicks(count, observe); },
    stepSubframe(count, observe) { return runtime.stepTicks(count, observe); },
    stepFrame(count, observe) { return runtime.stepFrame(count, observe); },
    runFrames(count, observe) { return runtime.runFrames(count, observe); },
    runTests({ cases = [], frames = 1, subframes = 0, observe, epsilon = 0, leaveLastCase = false } = {}) {
      if (!Array.isArray(cases) || cases.length === 0) throw new Error('At least one test case is required.');
      const initial = runtime.readGraph();
      const baseGraph = { nodes: initial.nodes, wires: initial.wires, objectWires: initial.objectWires };
      const results = [];

      for (let index = 0; index < cases.length; index++) {
        const testCase = cases[index] ?? {};
        const graph = cloneJson(baseGraph);
        applyParameterPatches(graph, testCase.parameters);
        validateGraphConfig(graph);
        runtime.loadGraph(graph);
        for (const input of testCase.inputs ?? []) {
          const nid = typeof input.node === 'string'
            ? input.node
            : `${Number(input.node?.x)},${Number(input.node?.y)}`;
          runtime.setOverride(nid, input.port ?? 0, input.value ?? 0);
        }

        const expected = testCase.expected ?? {};
        const selected = testCase.observe ?? observe ?? Object.keys(expected);
        const runResult = subframes > 0 || testCase.subframes > 0
          ? runtime.stepTicks(testCase.subframes ?? subframes, selected)
          : runtime.runFrames(testCase.frames ?? frames, selected);
        const finalState = runResult.final ?? runResult;
        const actual = {};
        for (const nid of selected) actual[nid] = observedValue(finalState.nodes?.[nid]);

        const mismatches = {};
        for (const [nid, expectedValue] of Object.entries(expected)) {
          if (!compareExpected(actual[nid], expectedValue, Number(epsilon) || 0)) {
            mismatches[nid] = { expected: expectedValue, actual: actual[nid] ?? null };
          }
        }
        results.push({
          index,
          passed: Object.keys(mismatches).length === 0,
          parameters: testCase.parameters ?? null,
          inputs: testCase.inputs ?? null,
          expected,
          actual,
          mismatches,
          time: finalState.time,
        });
      }

      if (!leaveLastCase) runtime.loadGraph(baseGraph);
      const failed = results.filter(result => !result.passed).length;
      return { passed: failed === 0, total: results.length, failed, cases: results };
    },
  };
}

export function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => {
    if (typeof item === 'number' && Number.isNaN(item)) return 'NaN';
    if (item === Infinity) return 'Infinity';
    if (item === -Infinity) return '-Infinity';
    return item;
  }));
}
