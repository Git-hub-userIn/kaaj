import { spawn, type ChildProcess } from 'node:child_process';
import { platform } from 'node:os';

const isWindows = platform() === 'win32';
const runtimeExe = process.execPath;

let apiProcess: ChildProcess | null = null;
let webProcess: ChildProcess | null = null;
let isShuttingDown = false;

function killTree(proc: ChildProcess | null) {
  if (!proc || !proc.pid) return;
  if (isWindows) {
    try {
      spawn('taskkill', ['/F', '/T', '/PID', proc.pid.toString()], { stdio: 'ignore' });
    } catch {
      // ignore
    }
  } else {
    try {
      process.kill(-proc.pid, 'SIGINT');
    } catch {
      try {
        proc.kill('SIGINT');
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

  setTimeout(() => {
    console.log('\x1b[32m[kaaj] All services stopped cleanly.\x1b[0m');
    process.exit(0);
  }, 400);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', shutdown);

console.log('\x1b[36m[kaaj]\x1b[0m Starting API (http://localhost:3001) and Web UI (http://localhost:3000)...');
console.log('\x1b[90m[kaaj] Press Ctrl+C at any time to shut down both services cleanly.\x1b[0m\n');

// Start API (Backend)
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

// Start Web (UI)
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
