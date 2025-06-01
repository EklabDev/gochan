import { EventEmitter } from 'events';

// Channel metadata structure in SharedArrayBuffer
interface ChannelHeader {
  bufferSize: number; // Total buffer capacity
  writeIndex: number; // Current write position
  readIndex: number; // Current read position
  closed: number; // 0 = open, 1 = closed
  elementSize: number; // Size of each element in bytes
  waitingSenders: number; // Number of waiting senders
  waitingReceivers: number; // Number of waiting receivers
}

const HEADER_SIZE = 7 * 4; // 7 int32 values = 28 bytes

export class SharedChannel<T> extends EventEmitter {
  private sharedBuffer: SharedArrayBuffer;
  private header: Int32Array;
  private dataView: DataView;
  private bufferSize: number;
  private elementSize: number;
  private serializer: (value: T) => ArrayBuffer;
  private deserializer: (buffer: ArrayBuffer) => T;

  constructor(
    bufferSize: number = 0,
    elementSize: number = 1024, // Default 1KB per element
    serializer?: (value: T) => ArrayBuffer,
    deserializer?: (buffer: ArrayBuffer) => T
  ) {
    super();
    this.bufferSize = bufferSize;
    this.elementSize = elementSize;

    // Create shared buffer: header + data buffer
    const totalSize = HEADER_SIZE + bufferSize * elementSize;
    this.sharedBuffer = new SharedArrayBuffer(totalSize);

    // Header view for metadata
    this.header = new Int32Array(this.sharedBuffer, 0, 7);

    // Data view for channel data
    this.dataView = new DataView(this.sharedBuffer, HEADER_SIZE);

    // Initialize header
    Atomics.store(this.header, 0, bufferSize); // bufferSize
    Atomics.store(this.header, 1, 0); // writeIndex
    Atomics.store(this.header, 2, 0); // readIndex
    Atomics.store(this.header, 3, 0); // closed
    Atomics.store(this.header, 4, elementSize); // elementSize
    Atomics.store(this.header, 5, 0); // waitingSenders
    Atomics.store(this.header, 6, 0); // waitingReceivers

    // Default JSON serialization
    this.serializer =
      serializer ||
      ((value: T) => {
        const str = JSON.stringify(value);
        const encoder = new TextEncoder();
        return encoder.encode(str).buffer as ArrayBuffer;
      });

    this.deserializer =
      deserializer ||
      ((buffer: ArrayBuffer) => {
        const decoder = new TextDecoder();
        const str = decoder.decode(buffer);
        return JSON.parse(str);
      });
  }

  // Get shared buffer for passing to workers
  getSharedBuffer(): SharedArrayBuffer {
    return this.sharedBuffer;
  }

  // Create channel from existing shared buffer (for workers)
  static fromSharedBuffer<T>(
    sharedBuffer: SharedArrayBuffer,
    serializer?: (value: T) => ArrayBuffer,
    deserializer?: (buffer: ArrayBuffer) => T
  ): SharedChannel<T> {
    const header = new Int32Array(sharedBuffer, 0, 7);
    const bufferSize = Atomics.load(header, 0);
    const elementSize = Atomics.load(header, 4);

    const channel = Object.create(SharedChannel.prototype);
    channel.sharedBuffer = sharedBuffer;
    channel.header = header;
    channel.dataView = new DataView(sharedBuffer, HEADER_SIZE);
    channel.bufferSize = bufferSize;
    channel.elementSize = elementSize;

    // Default serializers
    channel.serializer =
      serializer ||
      ((value: T) => {
        const str = JSON.stringify(value);
        const encoder = new TextEncoder();
        return encoder.encode(str).buffer;
      });

    channel.deserializer =
      deserializer ||
      ((buffer: ArrayBuffer) => {
        const decoder = new TextDecoder();
        const str = decoder.decode(buffer);
        return JSON.parse(str);
      });

    EventEmitter.call(channel);
    return channel;
  }

  async send(data: T): Promise<void> {
    return new Promise((resolve, reject) => {
      if (Atomics.load(this.header, 3) === 1) {
        reject(new Error('Cannot send to closed channel'));
        return;
      }

      const tryWrite = () => {
        const writeIndex = Atomics.load(this.header, 1);
        const readIndex = Atomics.load(this.header, 2);
        const currentSize = (writeIndex - readIndex + this.bufferSize) % this.bufferSize;

        // If unbuffered channel (bufferSize = 0) or buffer full, need to wait
        if (this.bufferSize === 0 || currentSize >= this.bufferSize) {
          // Increment waiting senders
          Atomics.add(this.header, 5, 1);

          // Wait for space or receiver
          this.waitForSpace()
            .then(() => {
              Atomics.sub(this.header, 5, 1);
              tryWrite();
            })
            .catch(reject);
          return;
        }

        // Serialize and write data
        try {
          const serialized = this.serializer(data);
          const offset = (writeIndex % this.bufferSize) * this.elementSize;

          // Write data length first (4 bytes)
          this.dataView.setUint32(offset, serialized.byteLength, true);

          // Write data
          const dataArray = new Uint8Array(serialized);
          for (let i = 0; i < dataArray.length; i++) {
            this.dataView.setUint8(offset + 4 + i, dataArray[i]);
          }

          // Update write index atomically
          Atomics.store(this.header, 1, writeIndex + 1);

          // Notify waiting receivers
          Atomics.notify(this.header, 6);

          resolve();
        } catch (error) {
          reject(error);
        }
      };

      tryWrite();
    });
  }

  async receive(): Promise<T> {
    return new Promise((resolve, reject) => {
      if (Atomics.load(this.header, 3) === 1) {
        const writeIndex = Atomics.load(this.header, 1);
        const readIndex = Atomics.load(this.header, 2);
        if (writeIndex === readIndex) {
          reject(new Error('Channel is closed and empty'));
          return;
        }
      }

      const tryRead = () => {
        const writeIndex = Atomics.load(this.header, 1);
        const readIndex = Atomics.load(this.header, 2);

        // If no data available, wait
        if (writeIndex === readIndex) {
          if (Atomics.load(this.header, 3) === 1) {
            reject(new Error('Channel is closed and empty'));
            return;
          }

          // Increment waiting receivers
          Atomics.add(this.header, 6, 1);

          // Wait for data
          this.waitForData()
            .then(() => {
              Atomics.sub(this.header, 6, 1);
              tryRead();
            })
            .catch(reject);
          return;
        }

        // Read data
        try {
          const offset = (readIndex % this.bufferSize) * this.elementSize;

          // Read data length
          const dataLength = this.dataView.getUint32(offset, true);

          // Read data
          const dataBuffer = new ArrayBuffer(dataLength);
          const dataArray = new Uint8Array(dataBuffer);
          for (let i = 0; i < dataLength; i++) {
            dataArray[i] = this.dataView.getUint8(offset + 4 + i);
          }

          // Deserialize
          const data = this.deserializer(dataBuffer);

          // Update read index atomically
          Atomics.store(this.header, 2, readIndex + 1);

          // Notify waiting senders
          Atomics.notify(this.header, 5);

          resolve(data);
        } catch (error) {
          reject(error);
        }
      };

      tryRead();
    });
  }

  private async waitForSpace(): Promise<void> {
    return new Promise(resolve => {
      const check = () => {
        const writeIndex = Atomics.load(this.header, 1);
        const readIndex = Atomics.load(this.header, 2);
        const currentSize = (writeIndex - readIndex + this.bufferSize) % this.bufferSize;

        if (currentSize < this.bufferSize || Atomics.load(this.header, 3) === 1) {
          resolve();
        } else {
          // Use Atomics.wait with timeout to avoid busy waiting
          Atomics.wait(this.header, 5, Atomics.load(this.header, 5), 10);
          setImmediate(check);
        }
      };
      check();
    });
  }

  private async waitForData(): Promise<void> {
    return new Promise(resolve => {
      const check = () => {
        const writeIndex = Atomics.load(this.header, 1);
        const readIndex = Atomics.load(this.header, 2);

        if (writeIndex !== readIndex || Atomics.load(this.header, 3) === 1) {
          resolve();
        } else {
          // Use Atomics.wait with timeout
          Atomics.wait(this.header, 6, Atomics.load(this.header, 6), 10);
          setImmediate(check);
        }
      };
      check();
    });
  }

  close(): void {
    Atomics.store(this.header, 3, 1);

    // Notify all waiting operations
    Atomics.notify(this.header, 5);
    Atomics.notify(this.header, 6);

    this.emit('close');
  }

  isClosed(): boolean {
    return Atomics.load(this.header, 3) === 1;
  }

  // Async iterator support
  async *[Symbol.asyncIterator](): AsyncIterableIterator<T> {
    try {
      while (!this.isClosed() || this.hasData()) {
        yield await this.receive();
      }
    } catch (error) {
      // Channel closed, iteration complete
      return;
    }
  }

  hasData(): boolean {
    const writeIndex = Atomics.load(this.header, 1);
    const readIndex = Atomics.load(this.header, 2);
    return writeIndex !== readIndex;
  }
}
