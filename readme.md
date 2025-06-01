# GoChan

A TypeScript library that brings Go-like concurrency patterns to Node.js, featuring goroutines, channels, and worker pools.

## Requirements

- Node.js >= 22.7.0
- TypeScript >= 5.0.0

## Features

- Go-style goroutines with `go` and `goShared` functions
- Shared channels for inter-thread communication
- Worker pool management
- WaitGroup for goroutine synchronization
- Select-like functionality for channel operations

## Installation

```bash
npm install @eklabdev/gochan
```

or using yarn:

```bash
yarn add @eklabdev/gochan
```

## Quick Start

```typescript
import { go, goShared, makeChan, registerChannel, initializeGoroutines } from 'gochan';

// Initialize the worker pool (optional, defaults to number of CPU cores)
initializeGoroutines(4);

// Simple goroutine example
const result = await go(async () => {
  return "Hello from worker thread!";
});

// Channel communication example
async function channelExample() {
  const messageChannel = makeChan<string>(5); // Buffered channel
  const resultChannel = makeChan<string>(5);
  
  registerChannel('messages', messageChannel);
  registerChannel('results', resultChannel);
  
  // Producer goroutine
  const producer = goShared(async (sharedChan) => {
    const msgChan = sharedChan('messages');
    
    for (let i = 1; i <= 5; i++) {
      await msgChan.send(`Message ${i}`);
    }
    msgChan.close();
  });
  
  // Consumer goroutine
  const consumer = goShared(async (sharedChan) => {
    const msgChan = sharedChan('messages');
    const resChan = sharedChan('results');
    
    for await (const message of msgChan) {
      await resChan.send(`Processed: ${message}`);
    }
    resChan.close();
  });
  
  // Collect results
  const results: string[] = [];
  for await (const result of resultChannel) {
    results.push(result);
  }
  
  await Promise.all([producer, consumer]);
  return results;
}
```

## Core Concepts

### Goroutines

```typescript
// Regular goroutine
const result = await go(async () => {
  // Your code here
});

// Goroutine with shared channel access
const result = await goShared(async (sharedChan) => {
  const channel = sharedChan('channel-name');
  // Your code here
});
```

### Channels

```typescript
// Create a channel
const channel = makeChan<string>(10); // 10 is buffer size

// Register channel for worker access
registerChannel('channel-name', channel);

// Send data
await channel.send('data');

// Receive data
const data = await channel.receive();

// Iterate over channel
for await (const item of channel) {
  // Process item
}

// Close channel
channel.close();
```

### Custom Channel Element Size

When working with complex objects or large data structures, you can specify a custom element size for the channel buffer:

```typescript
import { makeChan, calculateElementSize } from 'gochan';

// Define a complex data structure
interface UserData {
  id: number;
  name: string;
  email: string;
  metadata: {
    lastLogin: Date;
    preferences: Record<string, any>;
  };
}

// Calculate the size needed for each element
const elementSize = calculateElementSize<UserData>({
  id: 8, // number (8 bytes)
  name: 100, // string (max 100 chars)
  email: 100, // string (max 100 chars)
  metadata: {
    lastLogin: 8, // Date (8 bytes)
    preferences: 500 // object (max 500 bytes)
  }
});

// Create a channel with custom element size
const userChannel = makeChan<UserData>(10, elementSize);

// Register the channel
registerChannel('users', userChannel);

// Use the channel
await userChannel.send({
  id: 1,
  name: 'John Doe',
  email: 'john@example.com',
  metadata: {
    lastLogin: new Date(),
    preferences: { theme: 'dark', notifications: true }
  }
});
```

The `calculateElementSize` function helps ensure that the channel buffer has enough space for each element. This is particularly important when:
- Working with large objects
- Handling variable-sized data
- Need to optimize memory usage
- Dealing with complex data structures

### WaitGroup

```typescript
const wg = new WaitGroup();

// Add goroutines to wait group
wg.add(go(async () => { /* ... */ }));
wg.add(go(async () => { /* ... */ }));

// Wait for all goroutines to complete
const results = await wg.wait();
```

## API Reference

### Core Functions

```typescript
// Goroutine functions
go<T extends any[], R>(fn: (...args: T) => R | Promise<R>, ...args: T): Promise<R>
goShared<T extends any[], R>(fn: (sharedChan: (id: string) => SharedChannel<any>, ...args: T) => R | Promise<R>, ...args: T): Promise<R>

// Channel functions
makeChan<T>(bufferSize: number = 0, elementSize?: number): SharedChannel<T>
registerChannel<T>(id: string, channel: SharedChannel<T>): void

// Worker management
initializeGoroutines(maxWorkers?: number): void
shutdown(): Promise<void>
```

### Classes

```typescript
// Channel class
class SharedChannel<T> {
  send(data: T): Promise<void>
  receive(): Promise<T>
  close(): void
  isClosed(): boolean
  hasData(): boolean
}

// Worker pool
class WorkerPool {
  constructor(maxWorkers?: number)
  execute<T, R>(task: (data: T) => R | Promise<R>, data: T): Promise<R>
  shutdown(): Promise<void>
}

// WaitGroup for synchronization
class WaitGroup {
  add(promise: Promise<any>): void
  wait(): Promise<any[]>
}
```

### Utility Functions

```typescript
// Calculate buffer size for complex objects
calculateElementSize<T>(sizeMap: Record<string, any>): number
```

## Best Practices

1. Always initialize goroutines at the start of your application:
```typescript
initializeGoroutines(4); // or number of CPU cores
```

2. Register channels before using them in workers:
```typescript
const channel = makeChan<string>(10);
registerChannel('my-channel', channel);
```

3. Use proper error handling in goroutines:
```typescript
go(async () => {
  try {
    // Your code
  } catch (error) {
    // Handle error
  }
});
```

4. Close channels when done:
```typescript
try {
  // Use channel
} finally {
  channel.close();
}
```

5. Use WaitGroup for managing multiple goroutines:
```typescript
const wg = new WaitGroup();
wg.add(go(async () => { /* ... */ }));
await wg.wait();
```

## Examples

Check the `examples` directory for more detailed examples:
- Basic goroutine usage
- Channel communication
- Fan-out pattern
- Pipeline processing
- Worker pool
- And more!

## Benchmarking

The library includes built-in benchmarks to measure performance across different concurrency patterns. Run the benchmarks using:

```bash
npm run benchmark
```

The benchmark suite includes three main scenarios:

1. **Basic Parallel Tasks**
   - Compares single-threaded vs goroutine execution
   - Processes multiple tasks with random delays
   - Typical speedup: 3-4x

2. **Producer-Consumer Pattern**
   - Tests channel communication performance
   - Multiple producers and consumers
   - Typical speedup: 3-4x

3. **Worker Pool Pattern**
   - Evaluates worker pool efficiency
   - Multiple workers processing jobs in parallel
   - Typical speedup: 2-3x

Example benchmark output:
```
=== Goroutine vs Single-threaded Benchmark ===

1. Basic Parallel Tasks:
Single-threaded execution:
Total time: 1123.39ms
Average time per task: 112.34ms

Goroutine execution:
Total time: 305.54ms
Average time per task: 30.55ms
Speedup factor: 3.68x

2. Producer-Consumer Pattern:
Single-threaded processing:
Total time: 1137.53ms
Average time per message: 1.14ms

Goroutine processing:
Total time: 344.16ms
Average time per message: 0.34ms
Speedup factor: 3.31x

3. Worker Pool Pattern:
Single-threaded processing:
Total time: 1137.22ms
Average time per job: 1.14ms

Goroutine processing:
Total time: 415.16ms
Average time per job: 0.42ms
Speedup factor: 2.74x
```

Note: Actual performance may vary based on:
- System hardware (CPU cores, memory)
- Current system load
- Task complexity and size
- Node.js version and configuration

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Limitations

### Worker Environment
- Workers are implemented using `worker.js` with a preloaded script
- Only Node.js built-in globals are supported (as documented in [Node.js Globals](https://nodejs.org/api/globals.html))
- No support for importing external modules or using `require` in worker threads
- Limited to features available in the Node.js global scope

### Channel Limitations
- Shared channels have a fixed buffer size that must be specified at creation
- No support for dynamic buffer resizing
- Channel operations are blocking when buffer is full/empty

### Performance Considerations
- Worker creation has overhead, so very small tasks may be slower than single-threaded execution
- Shared memory operations have synchronization costs
- Large data transfers between threads can impact performance

## Future Enhancements

### Worker Improvements
- Support for importing external modules in workers
- Dynamic worker pool sizing based on system load
- Worker lifecycle management and automatic cleanup
- Support for worker-specific environment variables

### Channel Enhancements
- Dynamic buffer resizing for shared channels
- Non-blocking channel operations with timeouts
- Channel multiplexing and selection
- Support for typed channels with runtime type checking

### Performance Optimizations
- Zero-copy data transfer between threads
- Batched channel operations
- Worker thread pooling and reuse
- Automatic task scheduling optimization

### Additional Features
- Support for worker thread debugging
- Metrics and monitoring for worker and channel operations
- Error recovery and automatic retry mechanisms
- Support for distributed workers across multiple machines

### Documentation and Examples
- More comprehensive API documentation
- Additional examples for common use cases
- Performance benchmarking tools
- Best practices guide
