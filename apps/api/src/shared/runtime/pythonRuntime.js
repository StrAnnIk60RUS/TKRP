import { spawn } from 'child_process';
import { logger } from '../logging/logger.js';

const DEFAULT_PYTHON_BIN = process.env.PYTHON_BIN || 'python';

function toErrorMessage(stderr, stdout, description, exitCode) {
  const stderrText = typeof stderr === 'string' ? stderr.trim() : '';
  const stdoutText = typeof stdout === 'string' ? stdout.trim() : '';
  const details = stderrText || stdoutText || 'no output';
  return `${description} failed (exit_code=${exitCode}): ${details}`;
}

export function runPythonProcess({
  scriptPath,
  args = [],
  cwd,
  input = null,
  env = {},
  timeoutMs = 120000,
  description = 'python process'
}) {
  return new Promise((resolve, reject) => {
    const pythonBin = process.env.PYTHON_BIN || DEFAULT_PYTHON_BIN;
    const startTime = Date.now();
    logger.debug(`Spawning python process: ${description}`, {
      module: 'pythonRuntime',
      scriptPath,
      args
    });

    const child = spawn(pythonBin, ['-u', scriptPath, ...args], {
      cwd,
      env: {
        ...process.env,
        ...env
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const cleanupTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      const err = new Error(`${description} timed out after ${timeoutMs} ms`);
      logger.error(`Python process timed out: ${description}`, {
        module: 'pythonRuntime',
        scriptPath,
        timeoutMs
      });
      reject(err);
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(cleanupTimer);
      logger.error(`Python process error: ${description}`, {
        module: 'pythonRuntime',
        scriptPath,
        error
      });
      reject(error);
    });

    child.on('close', (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(cleanupTimer);

      const durationMs = Date.now() - startTime;
      if (exitCode !== 0) {
        logger.warn(`Python process exited with code ${exitCode}: ${description} (${durationMs}ms)`, {
          module: 'pythonRuntime',
          scriptPath,
          exitCode,
          duration_ms: durationMs,
          stderr: (stderr || '').slice(0, 1000)
        });
      } else {
        logger.debug(`Python process finished successfully: ${description} (${durationMs}ms)`, {
          module: 'pythonRuntime',
          scriptPath,
          duration_ms: durationMs
        });
      }

      resolve({
        exitCode,
        stdout,
        stderr
      });
    });

    if (typeof input === 'string' && input.length > 0) {
      child.stdin.write(input);
    } else if (input && typeof input === 'object') {
      child.stdin.write(JSON.stringify(input));
    }
    child.stdin.end();
  });
}

export async function runPythonJsonProcess(options) {
  const result = await runPythonProcess(options);
  if (result.exitCode !== 0) {
    const error = new Error(
      toErrorMessage(result.stderr, result.stdout, options.description || 'python process', result.exitCode)
    );
    error.exitCode = result.exitCode;
    error.stderr = result.stderr;
    error.stdout = result.stdout;
    throw error;
  }

  try {
    return {
      ...result,
      parsed: JSON.parse(result.stdout || '{}')
    };
  } catch (error) {
    const parseError = new Error(
      `${options.description || 'python process'} returned invalid JSON: ${error.message}`
    );
    parseError.stderr = result.stderr;
    parseError.stdout = result.stdout;
    throw parseError;
  }
}
