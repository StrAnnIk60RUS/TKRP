import { spawn } from 'child_process';
import readline from 'readline';

const DEFAULT_PYTHON_BIN = process.env.PYTHON_BIN || 'python';

function toError(error, fallbackMessage) {
  if (error instanceof Error) return error;
  return new Error(fallbackMessage || String(error));
}

export function createPythonJsonWorker({
  scriptPath,
  args = [],
  cwd,
  env = {},
  description = 'python json worker',
  startupTimeoutMs = 10000
}) {
  let child = null;
  let nextRequestId = 1;
  let running = false;
  const pending = new Map();
  let startupPromise = null;
  let startupResolve = null;
  let startupReject = null;

  function rejectAllPending(error) {
    for (const [, handlers] of pending) {
      handlers.reject(error);
    }
    pending.clear();
  }

  function stopWorker(error) {
    running = false;
    if (child) {
      child.removeAllListeners();
      if (!child.killed) child.kill('SIGTERM');
    }
    child = null;
    if (error) {
      rejectAllPending(error);
    }
  }

  function ensureStarted() {
    if (running && child) return Promise.resolve();
    if (startupPromise) return startupPromise;

    startupPromise = new Promise((resolve, reject) => {
      startupResolve = resolve;
      startupReject = reject;
    });

    const pythonBin = process.env.PYTHON_BIN || DEFAULT_PYTHON_BIN;
    child = spawn(pythonBin, ['-u', scriptPath, ...args], {
      cwd,
      env: {
        ...process.env,
        ...env
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const timeout = setTimeout(() => {
      const error = new Error(`${description} startup timed out after ${startupTimeoutMs} ms`);
      if (startupReject) startupReject(error);
      startupPromise = null;
      startupResolve = null;
      startupReject = null;
      stopWorker(error);
    }, startupTimeoutMs);

    let stderrBuffer = '';
    const lineReader = readline.createInterface({ input: child.stdout });
    lineReader.on('line', (line) => {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        const malformed = new Error(`${description} produced invalid JSON line: ${line}`);
        stopWorker(malformed);
        return;
      }

      if (parsed?.type === 'ready') {
        running = true;
        clearTimeout(timeout);
        if (startupResolve) startupResolve();
        startupPromise = null;
        startupResolve = null;
        startupReject = null;
        return;
      }

      const requestId = parsed?.id;
      if (!requestId || !pending.has(requestId)) return;
      const handlers = pending.get(requestId);
      pending.delete(requestId);

      if (parsed?.success) {
        handlers.resolve(parsed.result);
      } else {
        handlers.reject(new Error(parsed?.error || `${description} request failed`));
      }
    });

    child.stderr.on('data', (data) => {
      stderrBuffer += data.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      const startupError = toError(error, `${description} failed to start`);
      if (startupReject) startupReject(startupError);
      startupPromise = null;
      startupResolve = null;
      startupReject = null;
      stopWorker(startupError);
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      const details = stderrBuffer.trim();
      const closeError = new Error(
        `${description} exited (code=${code ?? 'unknown'})${details ? `: ${details}` : ''}`
      );
      if (!running && startupReject) {
        startupReject(closeError);
      }
      startupPromise = null;
      startupResolve = null;
      startupReject = null;
      stopWorker(closeError);
    });

    return startupPromise;
  }

  async function request(payload) {
    await ensureStarted();
    if (!child || !running) {
      throw new Error(`${description} is not running`);
    }

    const id = String(nextRequestId++);
    const envelope = { id, ...payload };
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify(envelope)}\n`, 'utf-8', (error) => {
        if (error) {
          pending.delete(id);
          reject(toError(error, `${description} failed to write request`));
        }
      });
    });
  }

  function dispose() {
    stopWorker();
  }

  return {
    request,
    dispose
  };
}

