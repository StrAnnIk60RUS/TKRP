import { spawn } from 'child_process';

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
      reject(new Error(`${description} timed out after ${timeoutMs} ms`));
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
      reject(error);
    });

    child.on('close', (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(cleanupTimer);

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
