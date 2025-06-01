export interface SerializableFunction {
    (...args: any[]): any;
  }
  
  export interface WorkerMessage {
    id: string;
    type: 'execute' | 'result' | 'error' | 'channel-send' | 'channel-receive' | 'channel-close';
    payload?: any;
    channelId?: string;
    error?: string;
  }
  
  export interface ChannelMessage<T> {
    type: 'send' | 'receive' | 'close';
    data?: T;
    resolve?: (value: any) => void;
    reject?: (error: any) => void;
  }
  