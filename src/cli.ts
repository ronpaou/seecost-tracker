#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';

const program = new Command();

program
  .name('seecost')
  .description('Initialize SeeCost tracker integration in an app')
  .version('0.1.0');

program
  .command('init <framework>')
  .description('Set up SeeCost Tracker in an app (nextjs | express | hono | node)')
  .option('-d, --dir <path>', 'Target project directory', process.cwd())
  .option('--force', 'Append or inject SeeCost initialization into existing setup files', false)
  .action(async (framework: string, opts: { dir: string; force: boolean }) => {
    try {
      await initCommand(framework as "nextjs" | "express" | "hono" | "node", {
        dir: opts.dir,
        force: opts.force,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\nError: ${msg}`);
      process.exit(1);
    }
  });

program.parse(process.argv);
