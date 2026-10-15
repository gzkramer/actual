import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createClaudeCliProvider } from './claude-cli';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

type FakeChild = EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};

function fakeChild({
  stdout = '',
  stderr = '',
  code = 0,
  error,
}: {
  stdout?: string;
  stderr?: string;
  code?: number;
  error?: NodeJS.ErrnoException;
}) {
  const child = new EventEmitter() as FakeChild;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();

  let input = '';
  child.stdin.on('data', chunk => {
    input += chunk;
  });
  child.stdin.on('finish', () => {
    setImmediate(() => {
      if (error) {
        child.emit('error', error);
        return;
      }
      child.stdout.write(stdout);
      child.stderr.write(stderr);
      setImmediate(() => child.emit('close', code));
    });
  });

  return { child, getInput: () => input };
}

describe('claude-cli provider', () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReset();
  });

  it('runs claude with the prompt on stdin and returns the result', async () => {
    const { child, getInput } = fakeChild({
      stdout: JSON.stringify({ type: 'result', result: '[{"a":1}]' }),
    });
    vi.mocked(spawn).mockReturnValue(child as never);

    const result = await createClaudeCliProvider().complete(
      'Classify this',
      1000,
    );

    expect(result).toBe('[{"a":1}]');
    expect(getInput()).toBe('Classify this');

    const [binary, args, options] = vi.mocked(spawn).mock.calls[0];
    expect(binary).toBe('claude');
    expect(args).toEqual(
      expect.arrayContaining([
        '-p',
        '--model',
        'claude-opus-5-5',
        '--effort',
        'medium',
      ]),
    );
    expect(options).not.toHaveProperty('shell');
  });

  it('gives the token to the child process only', async () => {
    const { child } = fakeChild({
      stdout: JSON.stringify({ type: 'result', result: '[]' }),
    });
    vi.mocked(spawn).mockReturnValue(child as never);

    await createClaudeCliProvider().complete('Classify this', 1000, 'tok-123');

    const [, , options] = vi.mocked(spawn).mock.calls[0];
    expect(options?.env).toMatchObject({ CLAUDE_CODE_OAUTH_TOKEN: 'tok-123' });
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).not.toBe('tok-123');
  });

  it('reports a missing CLI as unavailable', async () => {
    const error = Object.assign(new Error('spawn claude ENOENT'), {
      code: 'ENOENT',
    });
    vi.mocked(spawn).mockReturnValue(fakeChild({ error }).child as never);

    await expect(
      createClaudeCliProvider().complete('x', 1000),
    ).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it('reports a missing login as unavailable', async () => {
    vi.mocked(spawn).mockReturnValue(
      fakeChild({
        stdout: JSON.stringify({
          is_error: true,
          result: 'Invalid API key · Please run /login',
        }),
        code: 1,
      }).child as never,
    );

    await expect(
      createClaudeCliProvider().complete('x', 1000),
    ).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it('reports other CLI failures as errors', async () => {
    vi.mocked(spawn).mockReturnValue(
      fakeChild({ stdout: '', code: 1 }).child as never,
    );

    await expect(
      createClaudeCliProvider().complete('x', 1000),
    ).rejects.toMatchObject({ reason: 'error' });
  });

  it('kills the CLI when it times out', async () => {
    const child = new EventEmitter() as FakeChild;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn();
    vi.mocked(spawn).mockReturnValue(child as never);

    await expect(
      createClaudeCliProvider().complete('x', 10),
    ).rejects.toMatchObject({ reason: 'timeout' });
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
});
