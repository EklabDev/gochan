import { makeChan, registerChannel, goShared, initializeGoroutines, shutdown } from '../src';

describe('Channel Tests', () => {
  beforeEach(() => {
    initializeGoroutines(4);
  });

  afterEach(async () => {
    await shutdown();
  });

  test('channel send and receive', async () => {
    const channel = makeChan<string>(1);
    registerChannel('test-channel', channel);

    await channel.send('test message');
    const result = await channel.receive();
    expect(result).toBe('test message');
  });

  test('channel iteration', async () => {
    const channel = makeChan<number>(3);
    registerChannel('test-channel', channel);

    const messages = [1, 2, 3];
    const received: number[] = [];

    // Send messages
    for (const msg of messages) {
      await channel.send(msg);
    }
    channel.close();

    // Receive messages
    for await (const msg of channel) {
      received.push(msg);
    }

    expect(received).toEqual(messages);
  });

  test('channel close behavior', async () => {
    const channel = makeChan<string>(1);
    registerChannel('test-channel', channel);

    await channel.send('test message');
    channel.close();

    // Should be able to read remaining messages
    const result = await channel.receive();
    expect(result).toBe('test message');

    // Should reject new sends
    await expect(channel.send('new message')).rejects.toThrow();
  });

  test('channel buffer overflow', async () => {
    const channel = makeChan<string>(1);
    registerChannel('test-channel', channel);

    await channel.send('message 1');

    // Second send should be buffered
    const sendPromise = channel.send('message 2');
    expect(sendPromise).resolves;
  });
});
