import { WorkerPool } from './worker-pool';
import { SharedChannel } from './channel';
import { v4 as uuidv4 } from 'uuid';

// Global worker pool instance
let globalWorkerPool: WorkerPool | null = null;

// Initialize the global worker pool
export function initializeGoroutines(maxWorkers?: number): void {
  if (globalWorkerPool) {
    return;
  }
  globalWorkerPool = new WorkerPool(maxWorkers);
}

// Get or create the global worker pool
function getWorkerPool(): WorkerPool {
  if (!globalWorkerPool) {
    initializeGoroutines();
  }
  return globalWorkerPool!;
}

// Channel creation function (similar to Go's make(chan Type, buffer))
export function makeChan<T>(bufferSize: number = 0, elementSize: number = 1024): SharedChannel<T> {
  return new SharedChannel<T>(bufferSize, elementSize);
}

// Go function - executes a function as a goroutine
export function go<T extends any[], R>(fn: (...args: T) => R | Promise<R>, ...args: T): Promise<R> {
  const pool = getWorkerPool();
  const taskId = uuidv4();

  return pool.execute({
    id: taskId,
    type: 'execute',
    payload: {
      fn: fn.toString(),
      args: JSON.stringify(args),
    },
  });
}

// Go function with shared channel access
export function goShared<T extends any[], R>(
  fn: (sharedChan: (id: string) => SharedChannel<any>, ...args: T) => R | Promise<R>,
  ...args: T
): Promise<R> {
  const pool = getWorkerPool();
  const taskId = uuidv4();

  return pool.execute({
    id: taskId,
    type: 'execute',
    payload: {
      fn: fn.toString(),
      args: JSON.stringify(args),
    },
  });
}

// Register a shared channel with the worker pool
export function registerChannel<T>(id: string, channel: SharedChannel<T>): void {
  const pool = getWorkerPool();
  pool.registerSharedChannel(id, channel);
}

// Graceful shutdown
export async function shutdown(): Promise<void> {
  if (globalWorkerPool) {
    await globalWorkerPool.terminate();
    globalWorkerPool = null;
  }
}
