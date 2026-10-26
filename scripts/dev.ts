import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { platform } from 'node:os';

const isWindows = platform() === 'win32';
const runtimeExe = process.execPath;

let apiProcess: ChildProcess | null = null;
let webProcess: ChildProcess | null = null;
let isShuttingDown = false;

/**
 * Frees any process listening on the specified port.
 */
function freePort(port: number) {
  if (isWindows) {
    try {
      const output = execSync('netstat -ano -p tcp', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const lines = output.split('\r\n');
      for (const line of lines) {
        if (line.includes(`:${port}`) && line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && pid !== '0' && pid !== process.pid.toString()) {
            console.log(`\x1b[33m[kaaj] Freeing port ${port} (terminating lingering PID ${pid})...\x1b[0m`);
            execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
          }
        }
      }
    } catch {
      // ignore
    }
  } else {
    try {
      execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' });
    } catch {
      // ignore
    }
  }
}

/**
 * Forcefully terminates a child process and its entire descendant tree.
 */
function killTree(proc: ChildProcess | null) {
  if (!proc || !proc.pid) return;
  if (isWindows) {
    try {
      execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: 'ignore' });
    } catch {
      // ignore if already exited
    }
  } else {
    try {
      process.kill(-proc.pid, 'SIGINT');
    } catch {
      try {
        proc.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
  }
}

function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('\n\x1b[33m[kaaj] Shutting down backend and UI services...\x1b[0m');

  killTree(apiProcess);
  killTree(webProcess);

  // Guarantee ports 3000 and 3001 are completely clear
  freePort(3000);
  freePort(3001);

  console.log('\x1b[32m[kaaj] All services stopped cleanly.\x1b[0m');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);
process.on('exit', () => {
  if (!isShuttingDown) {
    shutdown();
  }
});

// 1. Proactively free ports before starting servers
freePort(3000);
freePort(3001);

console.log('\x1b[36m[kaaj]\x1b[0m Starting API (http://localhost:3001) and Web UI (http://localhost:3000)...');
console.log('\x1b[90m[kaaj] Press Ctrl+C at any time to shut down both services cleanly.\x1b[0m\n');

// 2. Start API (Backend)
apiProcess = spawn(runtimeExe, ['run', '--filter', '@kaaj/api', 'dev'], {
  stdio: 'inherit',
  shell: isWindows,
  detached: !isWindows,
});

apiProcess.on('exit', (code) => {
  if (!isShuttingDown && code !== 0) {
    console.error(`\x1b[31m[api] Backend exited with code ${code}\x1b[0m`);
    shutdown();
  }
});

// 3. Start Web (UI)
webProcess = spawn(runtimeExe, ['run', '--filter', '@kaaj/web', 'dev'], {
  stdio: 'inherit',
  shell: isWindows,
  detached: !isWindows,
});

webProcess.on('exit', (code) => {
  if (!isShuttingDown && code !== 0) {
    console.error(`\x1b[31m[web] UI exited with code ${code}\x1b[0m`);
    shutdown();
  }
});
