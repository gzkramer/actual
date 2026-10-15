import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

import { MAX_CONCURRENT_RUNS } from '#limits';

import { ProviderError } from './provider';
import type { Provider } from './provider';

const CLAUDE_BINARY = 'claude';
const CLAUDE_MODEL = 'claude-opus-5-5';
const CLAUDE_EFFORT = 'medium';
const READY_CHECK_TIMEOUT_MS = 10 * 1000;

// Errors the CLI reports when it has no usable credentials. Retrying won't
// help, so they're surfaced as `unavailable`.
const AUTH_ERROR_PATTERN = /\/login|api key|authenticat|oauth token/i;

let activeRuns = 0;
const waiting: Array<() => void> = [];

async function acquireSlot() {
  if (activeRuns < MAX_CONCURRENT_RUNS) {
    activeRuns++;
    return;
  }
  await new Promise<void>(resolve => waiting.push(resolve));
  activeRuns++;
}

function releaseSlot() {
  activeRuns--;
  const next = waiting.shift();
  if (next) {
    next();
  }
}

function extractResult(stdout: string) {
  // `--output-format json` wraps the model's reply in an envelope; the
  // classification JSON is the `result` string inside it.
  let envelope: unknown;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new ProviderError('error', 'claude returned non-JSON output');
  }

  if (
    typeof envelope !== 'object' ||
    envelope === null ||
    !('result' in envelope) ||
    typeof envelope.result !== 'string'
  ) {
    throw new ProviderError('error', 'claude output had no result');
  }

  if ('is_error' in envelope && envelope.is_error === true) {
    throw new ProviderError(
      AUTH_ERROR_PATTERN.test(envelope.result) ? 'unavailable' : 'error',
      envelope.result,
    );
  }

  return envelope.result;
}

/**
 * The child's environment. The caller's token goes to this one process only,
 * never into `process.env`, so concurrent runs can use different tokens.
 */
function childEnv(authToken: string | undefined) {
  if (!authToken) {
    return process.env;
  }
  return { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: authToken };
}

function runClaude(prompt: string, timeoutMs: number, authToken?: string) {
  return new Promise<string>((resolve, reject) => {
    // No shell: the prompt goes over stdin so it never needs escaping.
    const child = spawn(
      CLAUDE_BINARY,
      [
        '-p',
        '--output-format',
        'json',
        '--model',
        CLAUDE_MODEL,
        '--effort',
        CLAUDE_EFFORT,
        '--tools',
        '',
        '--strict-mcp-config',
        '--no-session-persistence',
      ],
      {
        cwd: tmpdir(),
        env: childEnv(authToken),
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        reject(new ProviderError('timeout', 'claude timed out'));
      }
    }, timeoutMs);

    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(
        err.code === 'ENOENT'
          ? new ProviderError('unavailable', 'claude CLI is not installed')
          : new ProviderError('error', err.message),
      );
    });

    child.on('close', code => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        // A non-zero exit still prints the JSON envelope when the CLI itself
        // ran, which is how auth failures are reported.
        const result = extractResult(stdout);
        if (code !== 0) {
          throw new ProviderError('error', `claude exited with ${code}`);
        }
        resolve(result);
      } catch (err) {
        if (code !== 0 && AUTH_ERROR_PATTERN.test(stderr)) {
          reject(new ProviderError('unavailable', 'claude is not logged in'));
          return;
        }
        reject(err);
      }
    });

    child.stdin.on('error', () => {
      // Handled by the 'error'/'close' listeners above.
    });
    child.stdin.end(prompt);
  });
}

async function isClaudeInstalled() {
  return new Promise<boolean>(resolve => {
    const child = spawn(CLAUDE_BINARY, ['--version'], {
      cwd: tmpdir(),
      stdio: 'ignore',
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(false);
    }, READY_CHECK_TIMEOUT_MS);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

export function createClaudeCliProvider(): Provider {
  let installed: boolean | null = null;

  return {
    name: 'claude-cli',
    model: CLAUDE_MODEL,
    async complete(prompt, timeoutMs, authToken) {
      await acquireSlot();
      try {
        return await runClaude(prompt, timeoutMs, authToken);
      } finally {
        releaseSlot();
      }
    },
    async isReady() {
      // Cache a positive answer; keep re-checking while it's missing so a
      // later install is picked up without a restart.
      if (!installed) {
        installed = await isClaudeInstalled();
      }
      return installed;
    },
  };
}
