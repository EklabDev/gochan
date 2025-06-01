const { parentPort, workerData } = require('worker_threads');

// Global registry of shared channels
const sharedChannels = new Map();

// Initialize shared channels from worker data
if (workerData && workerData.sharedChannels) {
  workerData.sharedChannels.forEach(([id, buffer]) => {
    sharedChannels.set(id, createSharedChannelFromBuffer(buffer));
  });
}

// Create SharedChannel instance from buffer (complete implementation for worker)
function createSharedChannelFromBuffer(sharedBuffer) {
  const header = new Int32Array(sharedBuffer, 0, 7);
  const dataView = new DataView(sharedBuffer, 28); // 28 bytes header

  return {
    header,
    dataView,
    sharedBuffer,

    async send(data) {
      return new Promise((resolve, reject) => {
        if (Atomics.load(header, 3) === 1) {
          reject(new Error('Cannot send to closed channel'));
          return;
        }

        try {
          const serialized = JSON.stringify(data);
          const encoder = new TextEncoder();
          const encoded = encoder.encode(serialized);

          const tryWrite = () => {
            const writeIndex = Atomics.load(header, 1);
            const readIndex = Atomics.load(header, 2);
            const bufferSize = Atomics.load(header, 0);
            const elementSize = Atomics.load(header, 4);
            const currentSize = (writeIndex - readIndex + bufferSize) % bufferSize;

            // If unbuffered channel or buffer full, need to wait
            if (bufferSize === 0 || currentSize >= bufferSize) {
              // Increment waiting senders
              Atomics.add(header, 5, 1);
              setTimeout(() => {
                Atomics.sub(header, 5, 1);
                tryWrite();
              }, 1);
              return;
            }

            const offset = (writeIndex % bufferSize) * elementSize;
            dataView.setUint32(offset, encoded.length, true);

            for (let i = 0; i < encoded.length; i++) {
              dataView.setUint8(offset + 4 + i, encoded[i]);
            }

            Atomics.store(header, 1, writeIndex + 1);
            Atomics.notify(header, 6); // Notify waiting receivers
            resolve();
          };

          tryWrite();
        } catch (error) {
          reject(error);
        }
      });
    },

    async receive() {
      return new Promise((resolve, reject) => {
        if (Atomics.load(header, 3) === 1) {
          const writeIndex = Atomics.load(header, 1);
          const readIndex = Atomics.load(header, 2);
          if (writeIndex === readIndex) {
            reject(new Error('Channel is closed and empty'));
            return;
          }
        }

        const tryRead = () => {
          const writeIndex = Atomics.load(header, 1);
          const readIndex = Atomics.load(header, 2);

          if (writeIndex === readIndex) {
            if (Atomics.load(header, 3) === 1) {
              reject(new Error('Channel is closed and empty'));
              return;
            }

            // Increment waiting receivers
            Atomics.add(header, 6, 1);
            setTimeout(() => {
              Atomics.sub(header, 6, 1);
              tryRead();
            }, 1);
            return;
          }

          try {
            const bufferSize = Atomics.load(header, 0);
            const elementSize = Atomics.load(header, 4);
            const offset = (readIndex % bufferSize) * elementSize;

            const dataLength = dataView.getUint32(offset, true);
            const dataArray = new Uint8Array(dataLength);

            for (let i = 0; i < dataLength; i++) {
              dataArray[i] = dataView.getUint8(offset + 4 + i);
            }

            const decoder = new TextDecoder();
            const serialized = decoder.decode(dataArray);
            const data = JSON.parse(serialized);

            Atomics.store(header, 2, readIndex + 1);
            Atomics.notify(header, 5); // Notify waiting senders

            resolve(data);
          } catch (error) {
            reject(error);
          }
        };

        tryRead();
      });
    },

    close() {
      Atomics.store(header, 3, 1);
      // Notify all waiting operations
      Atomics.notify(header, 5);
      Atomics.notify(header, 6);
    },

    isClosed() {
      return Atomics.load(header, 3) === 1;
    },

    // Async iterator support
    async *[Symbol.asyncIterator]() {
      try {
        while (!this.isClosed() || this.hasData()) {
          yield await this.receive();
        }
      } catch (error) {
        // Channel closed, iteration complete
        return;
      }
    },

    hasData() {
      const writeIndex = Atomics.load(header, 1);
      const readIndex = Atomics.load(header, 2);
      return writeIndex !== readIndex;
    },
  };
}

// Create global shared channel helper
global.sharedChan = function (id) {
  return sharedChannels.get(id);
};

// Function to safely evaluate serialized functions
function evaluateFunction(fnString, argsString) {
  try {
    // Parse arguments
    const args = JSON.parse(argsString);

    // Create function from string with sharedChan injected
    const fn = eval(`(${fnString})`);

    // For goShared functions, inject sharedChan as first argument
    if (fnString.includes('sharedChan')) {
      const result = fn(global.sharedChan, ...args);

      // Handle async functions
      if (result instanceof Promise) {
        return result;
      }

      return Promise.resolve(result);
    } else {
      // Regular function execution
      const result = fn(...args);

      // Handle async functions
      if (result instanceof Promise) {
        return result;
      }

      return Promise.resolve(result);
    }
  } catch (error) {
    return Promise.reject(error);
  }
}

parentPort?.on('message', async message => {
  const { id, type, payload, channelId, sharedBuffer } = message;

  try {
    if (type === 'register-shared-channel') {
      sharedChannels.set(channelId, createSharedChannelFromBuffer(sharedBuffer));
      return;
    }

    if (type === 'execute') {
      const { fn, args } = payload;
      const result = await evaluateFunction(fn, args);

      parentPort?.postMessage({
        id,
        type: 'result',
        payload: result,
      });
    }
  } catch (error) {
    parentPort?.postMessage({
      id,
      type: 'error',
      error: error.message,
      stack: error.stack,
    });
  }
});
