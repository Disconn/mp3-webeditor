import { execSync } from 'child_process';
import process from 'process';

const ports = (process.argv.slice(2).map(Number).filter(Boolean).length
  ? process.argv.slice(2).map(Number).filter(Boolean)
  : [3001, 5173, 5174]);

function killPort(port) {
  if (process.platform === 'win32') {
    try {
      const out = execSync(
        `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique"`,
        { encoding: 'utf8' }
      );
      const pids = [
        ...new Set(
          out
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)
            .map(Number)
            .filter((n) => n > 0)
        ),
      ];
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
          console.log(`freed :${port} (pid ${pid})`);
        } catch {
          /* already gone */
        }
      }
    } catch {
      /* nothing listening */
    }
    return;
  }

  try {
    const out = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf8' });
    const pids = [...new Set(out.split(/\s+/).map(Number).filter((n) => n > 0))];
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`freed :${port} (pid ${pid})`);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* nothing listening */
  }
}

for (const port of ports) killPort(port);
