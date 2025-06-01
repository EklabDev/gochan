import { Worker } from 'worker_threads';
import { EventEmitter } from 'events';
import { WorkerMessage } from './types';
import { SharedChannel } from './channel';
import * as path from 'path';

export class WorkerPool extends EventEmitter {
  private workers: Worker[] = [];
  private availableWorkers: Worker[] = [];
  private taskQueue: Array<{ message: WorkerMessage; resolve: Function; reject: Function }> = [];
  private maxWorkers: number;
  private workerScript: string;
  private sharedChannels: Map<string, SharedArrayBuffer> = new Map();

  public static instance: WorkerPool;

  public static getInstance(): WorkerPool {
    return WorkerPool.instance;
  }

  constructor(maxWorkers: number = require('os').cpus().length) {
    super();
    this.maxWorkers = maxWorkers;
    this.workerScript = path.join(__dirname, 'worker.js');
    this.initializeWorkers();
    WorkerPool.instance = this;
  }

  private initializeWorkers(): void {
    for (let i = 0; i < this.maxWorkers; i++) {
      this.createWorker();
    }
  }

  public getMaxWorkers(): number {
    return this.maxWorkers;
  }

  private createWorker(): Worker {
    const worker = new Worker(this.workerScript, {
      // Pass shared channels to worker
      transferList: [],
      workerData: {
        sharedChannels: Array.from(this.sharedChannels.entries()),
      },
    });

    worker.on('message', (message: WorkerMessage) => {
      this.handleWorkerMessage(worker, message);
    });

    worker.on('error', error => {
      console.error('Worker error:', error);
      this.removeWorker(worker);
    });

    worker.on('exit', code => {
      if (code !== 0) {
        console.error(`Worker stopped with exit code ${code}`);
      }
      this.removeWorker(worker);
    });

    // Send existing shared channels to new worker
    this.sharedChannels.forEach((buffer, id) => {
      worker.postMessage({
        type: 'register-shared-channel',
        channelId: id,
        sharedBuffer: buffer,
      });
    });

    this.workers.push(worker);
    this.availableWorkers.push(worker);
    return worker;
  }

  private handleWorkerMessage(worker: Worker, message: WorkerMessage): void {
    this.emit('message', { worker, message });

    // Return worker to available pool
    if (!this.availableWorkers.includes(worker)) {
      this.availableWorkers.push(worker);
    }

    // Process next task in queue
    this.processQueue();
  }

  private removeWorker(worker: Worker): void {
    const workerIndex = this.workers.indexOf(worker);
    if (workerIndex > -1) {
      this.workers.splice(workerIndex, 1);
    }

    const availableIndex = this.availableWorkers.indexOf(worker);
    if (availableIndex > -1) {
      this.availableWorkers.splice(availableIndex, 1);
    }

    // Create replacement worker if needed
    if (this.workers.length < this.maxWorkers && this.taskQueue.length > 0) {
      this.createWorker();
    }
  }

  public registerSharedChannel(id: string, channel: SharedChannel<any>): void {
    const sharedBuffer = channel.getSharedBuffer();
    this.sharedChannels.set(id, sharedBuffer);

    // Send to all existing workers
    this.workers.forEach(worker => {
      worker.postMessage({
        type: 'register-shared-channel',
        channelId: id,
        sharedBuffer: sharedBuffer,
      });
    });
  }

  public execute(message: WorkerMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      this.taskQueue.push({ message, resolve, reject });
      this.processQueue();
    });
  }

  private processQueue(): void {
    while (this.taskQueue.length > 0 && this.availableWorkers.length > 0) {
      const task = this.taskQueue.shift()!;
      const worker = this.availableWorkers.shift()!;

      const messageHandler = (message: WorkerMessage) => {
        if (message.id === task.message.id) {
          worker.off('message', messageHandler);

          if (message.type === 'result') {
            task.resolve(message.payload);
          } else if (message.type === 'error') {
            task.reject(new Error(message.error));
          }
        }
      };

      worker.on('message', messageHandler);
      worker.postMessage(task.message);
    }

    // Create more workers if needed
    if (this.taskQueue.length > 0 && this.workers.length < this.maxWorkers) {
      this.createWorker();
    }
  }

  public terminate(): Promise<number[]> {
    const promises = this.workers.map(worker => worker.terminate());
    return Promise.all(promises);
  }
}
