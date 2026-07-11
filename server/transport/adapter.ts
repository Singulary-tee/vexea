import { TRANSPORT_MODE } from "../../shared/transport.config";
import geckos, { GeckosServer, ServerChannel } from "@geckos.io/server";
import { Server as SocketIOServer, Socket } from "socket.io";
import { Server as HttpServer } from "http";

export interface ChannelAdapter {
  id: string;
  connected: boolean;
  onDisconnect(callback: () => void): void;
  on(event: string, callback: (data: unknown) => void): void;
  onRaw(callback: (buffer: ArrayBuffer) => void): void;
  emit(event: string, data: unknown): void;
  rawEmit(buffer: ArrayBuffer): void;
  removeAllListeners(): void;
}

export interface ServerTransport {
  listen(port: number, server?: HttpServer): void;
  onConnection(callback: (channel: ChannelAdapter) => void): void;
  rawEmitAll(buffer: ArrayBuffer): void;
  reliableEmitAll(event: string, data: unknown): void;
  getConnectedCount(): number;
}

export function createTransport(): ServerTransport {
  if (TRANSPORT_MODE === 'socketio') {
    return new SocketIOAdapter();
  } else {
    return new GeckosAdapter();
  }
}

class GeckosAdapter implements ServerTransport {
  private io: GeckosServer;
  private connections: Map<string, ServerChannel> = new Map();
  private onConnectionCallback?: (channel: ChannelAdapter) => void;

  constructor() {
    this.io = geckos({ cors: { origin: "*" } });
  }

  listen(port: number, server?: HttpServer): void {
    if (server) {
      this.io.addServer(server);
    }
    console.log(`[TRANSPORT] Mode: geckos | Listening on port ${port}`);

    this.io.onConnection((channel: ServerChannel) => {
      const id = channel.id || Math.random().toString(36).substring(7);
      this.connections.set(id, channel);
      console.log(`[TRANSPORT] Client connected: ${id} | Total: ${this.getConnectedCount()}`);
      
      const wrappedChannel = new GeckosChannelAdapter(channel, id, () => {
         this.connections.delete(id);
         console.log(`[TRANSPORT] Client disconnected: ${id} | Total: ${this.getConnectedCount()}`);
      });
      if (this.onConnectionCallback) {
        this.onConnectionCallback(wrappedChannel);
      }
    });
  }

  onConnection(callback: (channel: ChannelAdapter) => void): void {
    this.onConnectionCallback = callback;
  }

  rawEmitAll(buffer: ArrayBuffer): void {
    const count = this.getConnectedCount();
    if (count > 0) {
      for (const channel of this.connections.values()) {
        try {
           channel.raw.emit(buffer);
        } catch(e) {}
      }
    }
  }

  reliableEmitAll(event: string, data: unknown): void {
    for (const channel of this.connections.values()) {
      try {
         channel.emit(event, data);
      } catch(e) {}
    }
  }

  getConnectedCount(): number {
    return this.connections.size;
  }
}

class GeckosChannelAdapter implements ChannelAdapter {
  private _id: string;
  private _connected: boolean = true;
  constructor(private channel: ServerChannel, id: string, private onDisconnectCb: () => void) {
      this._id = id;
      this.channel.onDisconnect(() => {
          this._connected = false;
          this.onDisconnectCb();
      });
  }
  
  get id() { return this._id; }
  get connected() { return this._connected; }
  
  onDisconnect(callback: () => void): void {
      this.channel.onDisconnect(() => {
          callback();
      });
  }
  
  on(event: string, callback: (data: any) => void): void {
      this.channel.on(event, (data) => callback(data));
  }
  
  onRaw(callback: (buffer: ArrayBuffer) => void): void {
      this.channel.onRaw((msg) => {
          callback(msg as ArrayBuffer);
      });
  }
  
  emit(event: string, data: unknown): void {
      this.channel.emit(event, data);
  }
  
  rawEmit(buffer: ArrayBuffer): void {
      try {
          this.channel.raw.emit(buffer);
      } catch(e) {}
  }

  removeAllListeners(): void {
    // Geckos doesn't have a simple removeAllListeners but we can try to clear by event if needed
    // However, most geckos implementations allow re-binding.
    // For now, we'll try to use the fact that we're wrapping it.
    // Actually, Geckos channels don't expose removeAllListeners easily.
    // We might need to handle this manually in the adapter.
    (this.channel as any).removeAllListeners?.();
  }
}

class SocketIOAdapter implements ServerTransport {
    private io!: SocketIOServer;
    private connections: Map<string, Socket> = new Map();
    private onConnectionCallback?: (channel: ChannelAdapter) => void;
  
    listen(port: number, server?: HttpServer): void {
      if (server) {
        this.io = new SocketIOServer(server, { cors: { origin: "*" } });
      } else {
        this.io = new SocketIOServer(port, { cors: { origin: "*" } });
      }
      console.log(`[TRANSPORT] Mode: socketio | Listening on port ${port}`);
  
      this.io.on('connection', (socket: Socket) => {
        this.connections.set(socket.id, socket);
        console.log(`[TRANSPORT] Client connected: ${socket.id} | Total: ${this.getConnectedCount()}`);
        
        const wrappedChannel = new SocketIOChannelAdapter(socket, () => {
           this.connections.delete(socket.id);
           console.log(`[TRANSPORT] Client disconnected: ${socket.id} | Total: ${this.getConnectedCount()}`);
        });
        if (this.onConnectionCallback) {
          this.onConnectionCallback(wrappedChannel);
        }
      });
    }
  
    onConnection(callback: (channel: ChannelAdapter) => void): void {
      this.onConnectionCallback = callback;
    }
  
    rawEmitAll(buffer: ArrayBuffer): void {
      const count = this.getConnectedCount();
      if (count > 0) {
        const serializedPayload = { type: 'raw', data: Array.from(new Uint8Array(buffer)) };
        this.io.emit('raw', serializedPayload);
      }
    }
  
    reliableEmitAll(event: string, data: unknown): void {
        this.io.emit(event, data);
    }
  
    getConnectedCount(): number {
      return this.connections.size;
    }
}

class SocketIOChannelAdapter implements ChannelAdapter {
    private localDisconnectCb: (() => void)[] = [];
    
    constructor(private socket: Socket, private onDisconnectCb: () => void) {
        this.socket.on('disconnect', () => {
            this.onDisconnectCb();
            for(const cb of this.localDisconnectCb) cb();
        });
    }
    
    get id() { return this.socket.id; }
    get connected() { return this.socket.connected; }
    
    onDisconnect(callback: () => void): void {
        this.localDisconnectCb.push(callback);
    }
    
    on(event: string, callback: (data: any) => void): void {
        this.socket.on(event, (data) => callback(data));
    }
    
    onRaw(callback: (buffer: ArrayBuffer) => void): void {
        this.socket.on('raw', (payload: any) => {
            if (payload && payload.type === 'raw' && Array.isArray(payload.data)) {
                 callback(new Uint8Array(payload.data).buffer);
            }
        });
    }
    
    emit(event: string, data: unknown): void {
        this.socket.emit(event, data);
    }
    
    rawEmit(buffer: ArrayBuffer): void {
        const serializedPayload = { type: 'raw', data: Array.from(new Uint8Array(buffer)) };
        this.socket.emit('raw', serializedPayload);
    }

    removeAllListeners(): void {
        this.socket.removeAllListeners();
    }
}
