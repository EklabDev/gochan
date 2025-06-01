import {
  go,
  goShared,
  makeChan,
  registerChannel,
  WaitGroup,
  initializeGoroutines,
  shutdown,
  SharedChannel,
} from '../src';

// Initialize goroutines system
initializeGoroutines(36); // 4 worker threads

// Example 1: Basic Goroutine Usage
async function basicGoroutineExample() {
  console.log('=== Basic Goroutine Example ===');

  // Simple parallel execution
  const task1 = go(
    async (name: string, delay: number) => {
      await new Promise(resolve => setTimeout(resolve, delay));
      return `Task ${name} completed after ${delay}ms`;
    },
    'A',
    1000
  );

  const task2 = go(
    async (name: string, delay: number) => {
      await new Promise(resolve => setTimeout(resolve, delay));
      return `Task ${name} completed after ${delay}ms`;
    },
    'B',
    500
  );

  const results = await Promise.all([task1, task2]);
  console.log('Results:', results);
}

// Example 2: Channel Communication
async function channelExample() {
  console.log('\n=== Channel Communication Example ===');

  // Create channels
  const messageChannel = makeChan<string>(5); // Buffered channel
  const resultChannel = makeChan<string>(5);

  // Register channels for worker access
  registerChannel('messages', messageChannel);
  registerChannel('results', resultChannel);

  // Producer goroutine
  const producer = goShared(async sharedChan => {
    const msgChan = sharedChan('messages');

    for (let i = 1; i <= 5; i++) {
      await msgChan.send(`Message ${i}`);
      console.log(`Sent: Message ${i}`);
    }
    msgChan.close();
  });

  // Consumer goroutine
  const consumer = goShared(async sharedChan => {
    const msgChan = sharedChan('messages');
    const resChan = sharedChan('results');

    try {
      for await (const message of msgChan) {
        const processed = `Processed: ${message}`;
        await resChan.send(processed);
        console.log(processed);
      }
    } catch (error) {
      console.log('Consumer finished');
    }
    resChan.close();
  });

  //join back to main thread
  await Promise.all([producer, consumer]);
}

// Example 3: Pipeline Processing
async function pipelineExample() {
  // initialize pipeline
  const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const wg = new WaitGroup();
  const step1Input = makeChan<number>(numbers.length);
  const step1Output = makeChan<number>(numbers.length);
  const step2Output = makeChan<number>(numbers.length);
  const step3Output = makeChan<number>(numbers.length);

  registerChannel('step1Input', step1Input);
  registerChannel('step1Output', step1Output);
  registerChannel('step2Output', step2Output);
  registerChannel('step3Output', step3Output);

  //setting up pipeline workflow
  const step1 = goShared(async sharedChan => {
    const inputChan = sharedChan('step1Input');
    const outputChan = sharedChan('step1Output');
    while (!inputChan.isClosed() || inputChan.hasData()) {
      const item = await inputChan.receive();
      console.log('step1', item);
      await outputChan.send(item * 2);
    }
    outputChan.close();
  });
  wg.add(step1);
  const step2 = goShared(async sharedChan => {
    const inputChan = sharedChan('step1Output');
    const outputChan = sharedChan('step2Output');
    while (!inputChan.isClosed() || inputChan.hasData()) {
      const item = await inputChan.receive();
      console.log('step2', item);
      await outputChan.send(item * 3);
    }
    outputChan.close();
  });
  wg.add(step2);
  const step3 = goShared(async sharedChan => {
    const inputChan = sharedChan('step2Output');
    const outputChan = sharedChan('step3Output');
    while (!inputChan.isClosed() || inputChan.hasData()) {
      const item = await inputChan.receive();
      console.log('step3', item);
      await outputChan.send(item * 4);
    }
    outputChan.close();
  });
  wg.add(step3);

  //fill input channel
  for (const item of numbers) {
    await step1Input.send(item);
  }
  step1Input.close();
  await wg.wait();
  const result: number[] = [];
  // collecting result from step3Output
  while (!step3Output.isClosed() || step3Output.hasData()) {
    const item = await step3Output.receive();
    result.push(item);
  }

  console.log('Pipeline result:', result); // Should be "20"
}

// Example 4: WaitGroup for Coordinated Goroutines
async function waitGroupExample() {
  console.log('\n=== WaitGroup Example ===');

  const wg = new WaitGroup();

  // Add multiple goroutines to wait group
  for (let i = 1; i <= 3; i++) {
    const task = go(async (id: number) => {
      const delay = Math.random() * 1000 + 500;
      await new Promise(resolve => setTimeout(resolve, delay));
      console.log(`Goroutine ${id} completed after ${delay.toFixed(0)}ms`);
      return `Result from goroutine ${id}`;
    }, i);

    wg.add(task);
  }

  console.log('Waiting for all goroutines to complete...');
  const results = await wg.wait();
  console.log('All goroutines completed:', results);
}

// Example 5: Fan-out Pattern (Parallel Processing)
async function fanOutExample() {
  console.log('\n=== Fan-out Pattern Example ===');

  // Process numbers in parallel
  const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const workers: Promise<void>[] = [];

  const inputChannel = makeChan<number>(numbers.length);
  const outputChannel = makeChan<number>(numbers.length);

  registerChannel('fanout-input', inputChannel);
  registerChannel('fanout-output', outputChannel);
  const wg = new WaitGroup();
  for (let i = 0; i < 3; i++) {
    let work = goShared(async sharedChan => {
      const inputChan = sharedChan('fanout-input');
      const outputChan = sharedChan('fanout-output');
      try {
        while (!inputChan.isClosed() || inputChan.hasData()) {
          const item = await inputChan.receive();
          console.log('take', item);
          let result = item * item;
          console.log('result', result);
          await outputChan.send(result);
        }
      } catch (error) {
        console.error('Worker error:', error);
      }
    });
    wg.add(work);
  }
  for (const item of numbers) {
    console.log('fill', item);
    await inputChannel.send(item);
  }
  inputChannel.close();
  await wg.wait();

  const collected: number[] = [];
  try {
    for (let i = 0; i < numbers.length; i++) {
      const result = await outputChannel.receive();
      console.log('collecting result:', result);
      collected.push(result);
    }
  } catch (error) {
    console.error('Collection error:', error);
  }

  // Wait for all workers to complete
  await Promise.all(workers);
  outputChannel.close();

  console.log('Fan-out results:', collected);
}

// Example 6: Fan-in Pattern (Collecting from Multiple Sources)
async function fanInExample() {
  console.log('\n=== Fan-in Pattern Example ===');

  // Create multiple input channels
  const chan1 = makeChan<string>(3);
  const chan2 = makeChan<string>(3);
  const chan3 = makeChan<string>(3);
  const output = makeChan<string>(20);

  registerChannel('input1', chan1);
  registerChannel('input2', chan2);
  registerChannel('input3', chan3);
  registerChannel('output', output);
  // Fan-in operation
  const fanInChan: [SharedChannel<string>, string][] = [
    [chan1, 'input1'],
    [chan2, 'input2'],
    [chan3, 'input3'],
  ];
  const fanInTasks = fanInChan.map(chan =>
    goShared(
      async (sharedChan, { inChanKey, outChanKey, expected }) => {
        const inputChan = sharedChan(inChanKey);
        const outputChan = sharedChan(outChanKey);
        for (let i = 0; i < expected; i++) {
          const data = await inputChan.receive();
          console.log('fanIn', data);
          await outputChan.send(data);
        }
      },
      { inChanKey: chan[1], outChanKey: 'output', expected: 3 }
    )
  );

  // Fill input channels with different data
  const filler1 = goShared(async sharedChan => {
    const chan = sharedChan('input1');
    for (let i = 1; i <= 3; i++) {
      await chan.send(`Source1-${i}`);
      console.log('filler1', i);
    }
  });

  const filler2 = goShared(async sharedChan => {
    const chan = sharedChan('input2');
    for (let i = 1; i <= 3; i++) {
      await chan.send(`Source2-${i}`);
      console.log('filler2', i);
    }
  });

  const filler3 = goShared(async sharedChan => {
    const chan = sharedChan('input3');
    for (let i = 1; i <= 3; i++) {
      await chan.send(`Source3-${i}`);
      console.log('filler3', i);
    }
  });

  // Collect results
  const collector = goShared(
    async (sharedChan, { expected }) => {
      const outChan = sharedChan('output');
      const collected: string[] = [];

      for (let i = 0; i < expected; i++) {
        const data = await outChan.receive();
        collected.push(data);
        console.log(`Collected: ${data}`);
      }
      return collected;
    },
    { expected: 3 * 3 }
  );

  await Promise.all([filler1, filler2, filler3]);
  await Promise.all(fanInTasks);
  const results = await collector;
  output.close();
  console.log('Fan-in results:', results);
}

// Example 7: Select-like Channel Operations

// Example 8: Worker Pool with Shared Channels
async function workerPoolExample() {
  console.log('\n=== Worker Pool Example ===');

  // Create a job queue channel
  const jobQueue = makeChan<{ id: number; data: string }>(10);
  const resultQueue = makeChan<{ id: number; result: string }>(10);

  registerChannel('jobs', jobQueue);
  registerChannel('results', resultQueue);

  // Start workers
  const numWorkers = 3;
  const wg = new WaitGroup();
  // Send jobs
  const jobSender = goShared(async sharedChan => {
    const jobs = sharedChan('jobs');

    for (let i = 1; i <= 10; i++) {
      await jobs.send({
        id: i,
        data: `task-${i}`,
      });
    }
  });

  for (let i = 0; i < numWorkers; i++) {
    const worker = goShared(async (sharedChan, workerId: number) => {
      const jobs = sharedChan('jobs');
      const results = sharedChan('results');
      console.log(`Worker ${workerId} started`);

      try {
        while (!jobs.isClosed() || jobs.hasData()) {
          const job = await jobs.receive();
          // Simulate work
          await new Promise(resolve => setTimeout(resolve, 200));
          const result = `Worker ${workerId} processed job ${job.id}: ${job.data.toUpperCase()}`;

          await results.send({
            id: job.id,
            result: result,
          });

          console.log(`Worker ${workerId} completed job ${job.id}`);
        }
      } catch (error) {
        console.log(`Worker ${workerId} finished`);
      }
    }, i + 1);

    wg.add(worker);
  }

  // Collect results
  const resultCollector = goShared(async sharedChan => {
    const results = sharedChan('results');
    const collected: any[] = [];

    while (!results.isClosed() || results.hasData()) {
      try {
        const result = await results.receive();
        collected.push(result);
        console.log(`Result: ${result.result}`);
      } catch (error) {
        break;
      }
    }

    return collected;
  });

  // Wait for everything to complete
  await jobSender;
  jobQueue.close();
  await wg.wait();
  resultQueue.close();
  const results = await resultCollector;

  console.log(`Processed ${results.length} jobs`);
}

// Run all examples
async function runExamples() {
  try {
    await basicGoroutineExample();
    await channelExample();
    await pipelineExample();
    await waitGroupExample();
    await fanOutExample();
    await fanInExample();
    await workerPoolExample();

    console.log('\n=== All examples completed! ===');
  } catch (error) {
    console.error('Error running examples:', error);
  } finally {
    // Clean shutdown
    await shutdown();
  }
}

// Export the examples runner
export { runExamples };

// If running directly
if (require.main === module) {
  runExamples();
}
