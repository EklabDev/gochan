import { go, goShared, makeChan, registerChannel, initializeGoroutines, shutdown } from '../src';

describe('Goroutine Tests', () => {
  beforeEach(() => {
    initializeGoroutines(4);
  });

  afterEach(async () => {
    await shutdown();
  });

  test('basic go function execution', async () => {
    const result = await go(async () => {
      return 'test result';
    });
    expect(result).toBe('test result');
  });

  test('go function with arguments', async () => {
    const result = await go(
      async (a: number, b: number) => {
        return a + b;
      },
      1,
      2
    );
    expect(result).toBe(3);
  });

  test('go function error handling', async () => {
    await expect(
      go(async () => {
        throw new Error('test error');
      })
    ).rejects.toThrow('test error');
  });

  test('goShared with channel communication', async () => {
    const channel = makeChan<string>(1);
    registerChannel('test-channel', channel);

    const result = await goShared(async sharedChan => {
      const ch = sharedChan('test-channel');
      await ch.send('test message');
      return await ch.receive();
    });

    expect(result).toBe('test message');
  });
});
