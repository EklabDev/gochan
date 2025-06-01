import { initializeGoroutines, shutdown } from '../src';
import { runGoroutineBenchmark } from './scenarios/goroutine';

async function runBenchmarks() {
  console.log('Starting benchmarks...\n');

  try {
    initializeGoroutines(4);

    // Run all benchmarks
    await runGoroutineBenchmark();
  } finally {
    await shutdown();
  }
}

runBenchmarks().catch(console.error);
