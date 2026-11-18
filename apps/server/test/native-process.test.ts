import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { NativeTerminal, definedEnvironment } from '../src/native-terminal.ts';

async function until(check: () => boolean, message: string) {
  const deadline = Date.now() + 8000;
  while (!check()) {
    assert.ok(Date.now() < deadline, message);
    await delay(25);
  }
}

for (const naturalExit of [false, true]) {
  test(
    `a real POSIX terminal cleans descendants after ${naturalExit ? 'natural exit' : 'forced close'}`,
    {
      skip: !['darwin', 'linux'].includes(process.platform),
      timeout: 15000,
    },
    async (t) => {
      const directory = mkdtempSync(join(tmpdir(), 'ccdt-process-'));
      const marker = join(directory, 'child-pid');
      const childCode = `
      process.on('SIGTERM', () => {});
      process.on('SIGHUP', () => {});
      require('fs').writeFileSync(process.argv[1], String(process.pid));
      setInterval(() => {}, 1000);
    `;
      const parentCode = `
      const { spawn } = require('child_process');
      const fs = require('fs');
      process.on('SIGTERM', () => {});
      process.on('SIGHUP', () => {});
      spawn(process.execPath, ['-e', ${JSON.stringify(childCode)}, ${JSON.stringify(marker)}], { stdio: 'ignore' }).unref();
      const timer = setInterval(() => {
        if (${naturalExit} && fs.existsSync(${JSON.stringify(marker)})) process.exit(0);
      }, 30);
    `;
      let output = '';
      const terminal = new NativeTerminal(
        process.execPath,
        ['-e', parentCode],
        {
          cwd: directory,
          cols: 80,
          rows: 24,
          env: definedEnvironment(process.env),
        },
        (text) => (output += text),
        () => {},
      );
      let child = 0;
      t.after(async () => {
        try {
          if (child) process.kill(child, 'SIGKILL');
        } catch {}
        await terminal.close();
        rmSync(directory, { recursive: true, force: true });
      });
      await until(() => existsSync(marker), `child did not start: ${output}`);
      child = Number(readFileSync(marker, 'utf8'));
      if (naturalExit) await terminal.closed;
      else await terminal.close();
      await until(() => {
        try {
          process.kill(child, 0);
          return false;
        } catch {
          return true;
        }
      }, 'terminal left a descendant running');
      assert.equal(terminal.exited, true);
    },
  );
}
