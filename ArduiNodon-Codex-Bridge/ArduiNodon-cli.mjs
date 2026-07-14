#!/usr/bin/env node
import fs from 'node:fs';
import { createEngine, jsonSafe } from './ArduiNodon-engine.mjs';

function usage() {
  console.log(`ArduiNodon headless simulator

Usage:
  node ArduiNodon-cli.mjs --program program.ndnx [options]
  echo "createConstantNodon(...);" | node ArduiNodon-cli.mjs --stdin [options]

Options:
  --frames N             Run N complete 16-tick frames (default: 1)
  --subframes N          Run N individual simulation ticks instead
  --input X,Y:P=VALUE    Override an input/source Nodon output; repeatable
  --observe X,Y          Return only selected Nodons; repeatable
  --seed N               Seed Random Nodon output (default: 1)
  --pretty               Pretty-print JSON output
  --help                 Show this help
`);
}

function optionValues(args, name) {
  return args.flatMap((value, index) => value === name && index + 1 < args.length ? [args[index + 1]] : []);
}

function parseInput(value) {
  const match = String(value).match(/^(\d+),(\d+):(\d+)=(.*)$/);
  if (!match) throw new Error(`Invalid --input value: ${value}`);
  const number = Number(match[4]);
  if (Number.isNaN(number)) throw new Error(`Input value is not numeric: ${value}`);
  return { nid: `${match[1]},${match[2]}`, port: Number(match[3]), value: number };
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.length === 0) {
  usage();
  process.exit(args.length === 0 ? 1 : 0);
}

try {
  const programPath = optionValues(args, '--program')[0];
  const source = args.includes('--stdin')
    ? fs.readFileSync(0, 'utf8')
    : programPath
      ? fs.readFileSync(programPath, 'utf8')
      : null;
  if (source === null) throw new Error('Specify --program PATH or --stdin.');

  const engine = createEngine({ seed: Number(optionValues(args, '--seed')[0] ?? 1) });
  engine.loadProgram(source);

  for (const input of optionValues(args, '--input').map(parseInput)) {
    engine.setOverride(input.nid, input.port, input.value);
  }

  const observe = optionValues(args, '--observe');
  const result = args.includes('--subframes')
    ? engine.stepSubframe(Number(optionValues(args, '--subframes')[0] ?? 1), observe.length ? observe : undefined)
    : engine.runFrames(Number(optionValues(args, '--frames')[0] ?? 1), observe.length ? observe : undefined);

  const indent = args.includes('--pretty') ? 2 : 0;
  console.log(JSON.stringify(jsonSafe(result), null, indent));
} catch (error) {
  console.error(`ArduiNodon CLI error: ${error.message}`);
  process.exitCode = 1;
}
