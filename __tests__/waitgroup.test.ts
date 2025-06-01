import {
  WaitGroup,
  go,
  goShared,
  initializeGoroutines,
  makeChan,
  registerChannel,
  shutdown,
} from '../src';

describe('WaitGroup Tests', () => {
  beforeEach(() => {
    initializeGoroutines(4);
  });

  afterEach(async () => {
    await shutdown();
  });

  test('basic wait group operation', async () => {
    const wg = new WaitGroup();
    const results: number[] = [];
    const sharedChan = makeChan<number>(10);
    registerChannel('sharedChan', sharedChan);
    wg.add(
      goShared(async sharedChan => {
        const chan = sharedChan('sharedChan');
        await new Promise(resolve => setTimeout(resolve, 100));
        await chan.send(1);
      })
    );

    wg.add(
      goShared(async sharedChan => {
        const chan = sharedChan('sharedChan');
        await new Promise(resolve => setTimeout(resolve, 50));
        await chan.send(2);
      })
    );

    await wg.wait();
    while (sharedChan.hasData()) {
      const data = await sharedChan.receive();
      results.push(data);
    }
    sharedChan.close();

    expect(results).toEqual([2, 1]);
  });

  test('wait group with return values', async () => {
    const wg = new WaitGroup();

    wg.add(
      go(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'first';
      })
    );

    wg.add(
      go(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return 'second';
      })
    );

    const results = await wg.wait();
    expect(results).toEqual(['first', 'second']);
  });

  test('wait group error handling', async () => {
    const wg = new WaitGroup();

    wg.add(
      go(async () => {
        throw new Error('test error');
      })
    );

    await expect(wg.wait()).rejects.toThrow('test error');
  });
});
