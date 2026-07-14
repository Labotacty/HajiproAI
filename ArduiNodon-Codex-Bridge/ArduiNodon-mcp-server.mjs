#!/usr/bin/env node
import fs from 'node:fs';
import readline from 'node:readline';
import { createEngine, jsonSafe } from './ArduiNodon-engine.mjs';

const SERVER_VERSION = '0.1.0';
const PROTOCOL_VERSIONS = new Set([
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
]);
const engine = createEngine({ seed: Number(process.env.ARDUINODON_SEED ?? 1) });
let initialized = false;
let loadedProgram = null;

function nodeId(ref) {
  if (typeof ref === 'string' && /^\d+,\d+$/.test(ref)) return ref;
  if (Array.isArray(ref) && ref.length >= 2) return `${Number(ref[0])},${Number(ref[1])}`;
  if (ref && ref.x !== undefined && ref.y !== undefined) return `${Number(ref.x)},${Number(ref.y)}`;
  throw new Error('node must be "x,y", [x,y], or {x,y}.');
}

function observeList(args) {
  return Array.isArray(args?.observe) ? args.observe.map(nodeId) : undefined;
}

function summary(state) {
  return {
    loaded: true,
    time: state.time,
    nodeCount: Object.keys(state.nodes ?? {}).length,
  };
}

const TOOLS = [
  {
    name: 'load_nodon_program',
    title: 'Load ArduiNodon Program',
    description: 'Load ArduiNodon createXxxNodon/createConnection source into the headless simulator.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Program source text.' },
        path: { type: 'string', description: 'Local .ndnx or source file path.' },
      },
    },
  },
  {
    name: 'get_nodon_catalog',
    title: 'Get Nodon Catalog',
    description: 'Get Nodon types, signatures, ports, parameters, defaults, ranges, and option values without rereading the HTML.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Exact internal type key, such as map or counter.' },
        category: { type: 'string', enum: ['Input', 'Middle', 'Output', 'Object'] },
        query: { type: 'string', description: 'Search type, name, abbreviation, or create function.' },
        detail: { type: 'string', enum: ['summary', 'full'], default: 'summary' },
      },
    },
  },
  {
    name: 'set_nodon_input',
    title: 'Set Nodon Input',
    description: 'Override an input/source Nodon output before running the simulation.',
    inputSchema: {
      type: 'object',
      required: ['node', 'value'],
      properties: {
        node: { type: 'string', description: 'Nodon coordinate such as 5,5.' },
        port: { type: 'integer', minimum: 0, default: 0 },
        value: { type: 'number' },
      },
    },
  },
  {
    name: 'set_nodon_parameter',
    title: 'Set Nodon Parameter',
    description: 'Change a Nodon setting such as Constant value, Map bounds, Counter range, or Calculator method.',
    inputSchema: {
      type: 'object',
      required: ['node', 'key', 'value'],
      properties: {
        node: { type: 'string', description: 'Nodon coordinate such as 4,2.' },
        key: { type: 'string', description: 'Parameter name, such as value or upperRange.' },
        value: {},
        reset: { type: 'boolean', default: false, description: 'Reset simulation time/state after changing the parameter.' },
      },
    },
  },
  {
    name: 'reset_nodon_simulation',
    title: 'Reset Nodon Simulation',
    description: 'Reset time and all stateful Nodons to the initial state.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'step_nodon_simulation',
    title: 'Step Nodon Simulation',
    description: 'Advance by complete frames or individual subframes and read selected nodes.',
    inputSchema: {
      type: 'object',
      properties: {
        unit: { type: 'string', enum: ['frame', 'subframe'], default: 'frame' },
        count: { type: 'integer', minimum: 1, default: 1 },
        observe: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'run_nodon_simulation',
    title: 'Run Nodon Simulation',
    description: 'Set multiple input overrides, run a batch of frames, and return per-frame snapshots.',
    inputSchema: {
      type: 'object',
      properties: {
        frames: { type: 'integer', minimum: 1, default: 1 },
        inputs: {
          type: 'array',
          items: {
            type: 'object',
            required: ['node', 'value'],
            properties: {
              node: { type: 'string' },
              port: { type: 'integer', minimum: 0, default: 0 },
              value: { type: 'number' },
            },
          },
        },
        observe: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'run_nodon_tests',
    title: 'Run Nodon Test Matrix',
    description: 'Run multiple parameter/input cases and compare selected Nodon values with expected results.',
    inputSchema: {
      type: 'object',
      required: ['cases'],
      properties: {
        cases: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              parameters: { type: 'array', items: { type: 'object' } },
              inputs: { type: 'array', items: { type: 'object' } },
              frames: { type: 'integer', minimum: 1 },
              subframes: { type: 'integer', minimum: 1 },
              observe: { type: 'array', items: { type: 'string' } },
              expected: { type: 'object' },
            },
          },
        },
        frames: { type: 'integer', minimum: 1, default: 1 },
        subframes: { type: 'integer', minimum: 0, default: 0 },
        observe: { type: 'array', items: { type: 'string' } },
        epsilon: { type: 'number', minimum: 0, default: 0 },
        leaveLastCase: { type: 'boolean', default: false },
      },
    },
  },
  {
    name: 'read_nodon_state',
    title: 'Read Nodon State',
    description: 'Read current inputs, outputs, timing, and internal state for selected Nodons.',
    inputSchema: {
      type: 'object',
      properties: { nodes: { type: 'array', items: { type: 'string' } } },
    },
  },
  {
    name: 'read_nodon_graph',
    title: 'Read Nodon Graph',
    description: 'Read the loaded Nodon graph, signal wires, object wires, and current time.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'export_nodon_program',
    title: 'Export Nodon Program',
    description: 'Export the currently loaded graph as createXxxNodon/createConnection source.',
    inputSchema: { type: 'object', properties: {} },
  },
];

function callTool(name, args = {}) {
  switch (name) {
    case 'load_nodon_program': {
      const source = args.source !== undefined
        ? String(args.source)
        : args.path !== undefined
          ? fs.readFileSync(String(args.path), 'utf8')
          : null;
      if (source === null) throw new Error('Provide source or path.');
      loadedProgram = source;
      return summary(engine.loadProgram(source));
    }
    case 'get_nodon_catalog':
      return engine.getCatalog(args);
    case 'set_nodon_input':
      return engine.setOverride(nodeId(args.node), args.port ?? 0, args.value ?? 0);
    case 'set_nodon_parameter':
      return engine.setParameter(nodeId(args.node), args.key, args.value, args.reset ?? false);
    case 'reset_nodon_simulation':
      return engine.reset();
    case 'step_nodon_simulation': {
      const observe = observeList(args);
      if ((args.unit ?? 'frame') === 'subframe') {
        return engine.stepSubframe(args.count ?? 1, observe);
      }
      return engine.stepFrame(args.count ?? 1, observe);
    }
    case 'run_nodon_simulation': {
      for (const input of args.inputs ?? []) {
        engine.setOverride(nodeId(input.node), input.port ?? 0, input.value ?? 0);
      }
      return engine.runFrames(args.frames ?? 1, observeList(args));
    }
    case 'run_nodon_tests':
      return engine.runTests({
        cases: args.cases,
        frames: args.frames ?? 1,
        subframes: args.subframes ?? 0,
        observe: observeList(args),
        epsilon: args.epsilon ?? 0,
        leaveLastCase: args.leaveLastCase ?? false,
      });
    case 'read_nodon_state': {
      const nodes = Array.isArray(args.nodes) ? args.nodes.map(nodeId) : undefined;
      return engine.readState(nodes);
    }
    case 'read_nodon_graph':
      return engine.readGraph();
    case 'export_nodon_program':
      return { source: engine.exportProgram() };
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function response(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function toolResult(value, isError = false) {
  const safe = jsonSafe(value);
  return {
    content: [{ type: 'text', text: JSON.stringify(safe) }],
    structuredContent: safe,
    ...(isError ? { isError: true } : {}),
  };
}

function handle(message) {
  const { id, method, params = {} } = message;
  if (method === 'notifications/initialized') {
    initialized = true;
    return null;
  }
  if (method === 'ping') return response(id, {});
  if (method === 'initialize') {
    const requested = String(params.protocolVersion ?? '2025-06-18');
    const protocolVersion = PROTOCOL_VERSIONS.has(requested) ? requested : '2025-06-18';
    return response(id, {
      protocolVersion,
      capabilities: { tools: {} },
      serverInfo: {
        name: 'arduinodon-headless',
        title: 'ArduiNodon Headless Simulator',
        version: SERVER_VERSION,
      },
      instructions: 'Use load_nodon_program before simulation tools. State is kept for this stdio connection.',
    });
  }
  if (method === 'tools/list') return response(id, { tools: TOOLS });
  if (method === 'tools/call') {
    const name = params.name;
    try {
      return response(id, toolResult(callTool(name, params.arguments ?? {})));
    } catch (error) {
      return response(id, toolResult({ error: error.message }, true));
    }
  }
  if (method === 'notifications/cancelled' || method === 'notifications/progress') return null;
  return errorResponse(id, -32601, `Method not found: ${method}`);
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const message = JSON.parse(line);
    const result = handle(message);
    if (result) process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(errorResponse(null, -32700, error.message))}\n`);
  }
});
