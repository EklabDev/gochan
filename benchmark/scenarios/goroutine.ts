import { go, goShared, makeChan, registerChannel, WaitGroup } from '../../src';

export async function runGoroutineBenchmark() {
  console.log('=== Goroutine vs Single-threaded Benchmark ===');

  // Scenario 1: Basic Parallel Tasks
  console.log('\n1. Basic Parallel Tasks:');
  const iterations = 10;
  const delays = Array.from({ length: iterations }, () => Math.random() * 100 + 50);

  // Single-threaded execution
  const singleStart = performance.now();
  const singleResults: string[] = [];
  for (let i = 0; i < iterations; i++) {
    await new Promise(resolve => setTimeout(resolve, delays[i]));
    singleResults.push(`Task ${i} completed after ${delays[i].toFixed(0)}ms`);
  }
  const singleEnd = performance.now();
  const singleDuration = singleEnd - singleStart;

  // Goroutine execution
  const goroutineStart = performance.now();
  const promises = delays.map((delay, i) =>
    go(
      async (name: string, delay: number) => {
        await new Promise(resolve => setTimeout(resolve, delay));
        return `Task ${name} completed after ${delay.toFixed(0)}ms`;
      },
      i.toString(),
      delay
    )
  );
  const goroutineResults = await Promise.all(promises);
  const goroutineEnd = performance.now();
  const goroutineDuration = goroutineEnd - goroutineStart;

  console.log('Single-threaded execution:');
  console.log(`Total time: ${singleDuration.toFixed(2)}ms`);
  console.log(`Average time per task: ${(singleDuration / iterations).toFixed(2)}ms`);
  console.log('\nGoroutine execution:');
  console.log(`Total time: ${goroutineDuration.toFixed(2)}ms`);
  console.log(`Average time per task: ${(goroutineDuration / iterations).toFixed(2)}ms`);
  console.log(`Speedup factor: ${(singleDuration / goroutineDuration).toFixed(2)}x`);

  // Scenario 2: Producer-Consumer Pattern
  console.log('\n2. Producer-Consumer Pattern:');
  const messageCount = 1000;
  const channel = makeChan<string>(messageCount);
  registerChannel('benchmark-messages', channel);

  // Single-threaded processing
  const singlePCStart = performance.now();
  const singlePCResults: string[] = [];
  for (let i = 1; i <= messageCount; i++) {
    const message = `Message ${i}`;
    await new Promise(resolve => setTimeout(resolve, 1));
    singlePCResults.push(`Processed: ${message}`);
  }
  console.log(singlePCResults);
  const singlePCEnd = performance.now();
  const singlePCDuration = singlePCEnd - singlePCStart;

  // Goroutine processing
  const goroutinePCStart = performance.now();

  // Producer
  const producers: Promise<string[]>[] = [];
  const factor = 10;
  for (let i = 0; i < factor; i++) {
    const start = i * (messageCount / factor) + 1;
    const end = (i + 1) * (messageCount / factor) + 1;
    producers.push(
      go<[number, number], string[]>(
        async (start, end) => {
          const result: string[] = [];
          for (let i = start; i <= end; i++) {
            await new Promise(resolve => setTimeout(resolve, 1));
            result.push(`Processed: ${i}`);
          }
          return result;
        },
        start,
        end
      )
    );
  }

  // Consumer
  const goroutinePCResults: string[] = [];
  const results = await Promise.all(producers);
  console.log(results.flat());
  channel.close();
  while (channel.hasData() || !channel.isClosed()) {
    const message = await channel.receive();
    goroutinePCResults.push(`Processed: ${message}`);
  }
  const goroutinePCEnd = performance.now();
  const goroutinePCDuration = goroutinePCEnd - goroutinePCStart;

  console.log('Single-threaded processing:');
  console.log(`Total time: ${singlePCDuration.toFixed(2)}ms`);
  console.log(`Average time per message: ${(singlePCDuration / messageCount).toFixed(2)}ms`);
  console.log('\nGoroutine processing:');
  console.log(`Total time: ${goroutinePCDuration.toFixed(2)}ms`);
  console.log(`Average time per message: ${(goroutinePCDuration / messageCount).toFixed(2)}ms`);
  console.log(`Speedup factor: ${(singlePCDuration / goroutinePCDuration).toFixed(2)}x`);

  // Scenario 3: Worker Pool Pattern
  console.log('\n3. Worker Pool Pattern:');
  const jobCount = 1000;
  const workerCount = 4;
  const jobs = Array.from({ length: jobCount }, (_, i) => ({
    id: i + 1,
    data: `task-${i + 1}`,
  }));

  // Single-threaded processing
  const singleWPStart = performance.now();
  const singleWPResults: any[] = [];
  for (const job of jobs) {
    await new Promise(resolve => setTimeout(resolve, 1));
    singleWPResults.push({
      id: job.id,
      result: `Processed job ${job.id}: ${job.data.toUpperCase()}`,
    });
  }
  console.log(singleWPResults);
  const singleWPEnd = performance.now();
  const singleWPDuration = singleWPEnd - singleWPStart;

  // Goroutine processing
  const goroutineWPStart = performance.now();
  const jobQueue = makeChan<(typeof jobs)[0]>(jobCount);
  const resultQueue = makeChan<any>(jobCount);
  registerChannel('benchmark-jobs', jobQueue);
  registerChannel('benchmark-results', resultQueue);

  const wg = new WaitGroup();

  // Start workers
  for (let i = 0; i < workerCount; i++) {
    wg.add(
      goShared(async (sharedChan, workerId: number) => {
        const jobs = sharedChan('benchmark-jobs');
        const results = sharedChan('benchmark-results');

        while (!jobs.isClosed() || jobs.hasData()) {
          const job = await jobs.receive();
          await new Promise(resolve => setTimeout(resolve, 1));
          await results.send({
            id: job.id,
            result: `Worker ${workerId} processed job ${job.id}: ${job.data.toUpperCase()}`,
          });
        }
      }, i + 1)
    );
  }

  // Send jobs
  jobs.forEach(async job => await jobQueue.send(job));
  jobQueue.close();

  // Collect results
  const goroutineWPResults: any[] = [];

  await wg.wait();
  resultQueue.close();
  while (!resultQueue.isClosed() || resultQueue.hasData()) {
    const result = await resultQueue.receive();
    goroutineWPResults.push(result);
  }
  console.log(goroutineWPResults);

  const goroutineWPEnd = performance.now();
  const goroutineWPDuration = goroutineWPEnd - goroutineWPStart;

  console.log('Single-threaded processing:');
  console.log(`Total time: ${singleWPDuration.toFixed(2)}ms`);
  console.log(`Average time per job: ${(singleWPDuration / jobCount).toFixed(2)}ms`);
  console.log('\nGoroutine processing:');
  console.log(`Total time: ${goroutineWPDuration.toFixed(2)}ms`);
  console.log(`Average time per job: ${(goroutineWPDuration / jobCount).toFixed(2)}ms`);
  console.log(`Speedup factor: ${(singleWPDuration / goroutineWPDuration).toFixed(2)}x`);
  console.log('\n');
}
