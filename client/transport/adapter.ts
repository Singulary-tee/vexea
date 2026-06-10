import { TRANSPORT_MODE } from "../../shared/transport.config";
import geckos, { ClientChannel } from "@geckos.io/client";
import { io as socketio, Socket } from "socket.io-client";

export interface ClientTransport {
  connect(url: string, port: number): void;
  onConnect(callback: () => void): void;
  onDisconnect(callback: () => void): void;
  on(event: string, callback: (data: unknown) => void): void;
  onRaw(callback: (buffer: ArrayBuffer) => void): void;
  emit(event: string, data: unknown): void;
  rawEmit(buffer: ArrayBuffer): void;
}

export function createClientTransport(): ClientTransport {
  if (TRANSPORT_MODE === 'socketio') {
    return new SocketIOClientAdapter();
  } else {
    return new GeckosClientAdapter();
  }
}

class GeckosClientAdapter implements ClientTransport {
    private channel?: ClientChannel;
    private onConnectCb?: () => void;
    private onDisconnectCb?: () => void;
    private onRawCb?: (buffer: ArrayBuffer) => void;
    private eventCallbacks: Map<string, ((data: any) => void)[]> = new Map();

    connect(url: string, port: number): void {
        this.channel = geckos({ port });
        this.channel.onConnect((error) => {
            if (error) {
                console.error(error);
            } else {
                console.log(`[TRANSPORT] Connected to server via geckos`);
                if (this.onConnectCb) this.onConnectCb();
            }
        });
        this.channel.onDisconnect(() => {
            console.log(`[TRANSPORT] Disconnected from server`);
            if (this.onDisconnectCb) this.onDisconnectCb();
        });
        this.channel.onRaw((data: ArrayBuffer) => {
             if (this.onRawCb) this.onRawCb(data);
        });
        // re-bind registered events
        for (const [event, cbs] of this.eventCallbacks.entries()) {
            this.channel.on(event, (data) => {
                for (const cb of cbs) cb(data);
            });
        }
    }

    onConnect(callback: () => void): void {
        this.onConnectCb = callback;
    }

    onDisconnect(callback: () => void): void {
        this.onDisconnectCb = callback;
    }

    on(event: string, callback: (data: unknown) => void): void {
        if (!this.eventCallbacks.has(event)) {
             this.eventCallbacks.set(event, []);
             if (this.channel) {
                 this.channel.on(event, (data) => {
                     const cbs = this.eventCallbacks.get(event) || [];
                     for (const cb of cbs) cb(data);
                 });
             }
        }
        this.eventCallbacks.get(event)!.push(callback);
    }

    onRaw(callback: (buffer: ArrayBuffer) => void): void {
        this.onRawCb = callback;
    }

    emit(event: string, data: unknown): void {
        if (this.channel) {
            this.channel.emit(event, data);
        }
    }

    rawEmit(buffer: ArrayBuffer): void {
        if (this.channel) {
            this.channel.raw.emit(buffer);
        }
    }
}

class SocketIOClientAdapter implements ClientTransport {
    private socket?: Socket;
    private onConnectCb?: () => void;
    private onDisconnectCb?: () => void;
    private onRawCb?: (buffer: ArrayBuffer) => void;
    private eventCallbacks: Map<string, ((data: any) => void)[]> = new Map();

    connect(url: string, port: number): void {
        // AI Studio usually runs clients connected to the same domain.
        // We'll let socket.io figure out the window.location or use the specified url.
        this.socket = socketio(url);
        
        this.socket.on("connect", () => {
            console.log(`[TRANSPORT] Connected to server via socketio`);
            if (this.onConnectCb) this.onConnectCb();
        });

        this.socket.on("disconnect", () => {
            console.log(`[TRANSPORT] Disconnected from server`);
            if (this.onDisconnectCb) this.onDisconnectCb();
        });

        this.socket.on("raw", (payload: any) => {
             if (payload && payload.type === 'raw' && Array.isArray(payload.data)) {
                 const buffer = new Uint8Array(payload.data).buffer;
                 if (this.onRawCb) this.onRawCb(buffer);
             }
        });

        for (const [event, cbs] of this.eventCallbacks.entries()) {
            this.socket.on(event, (data) => {
                for (const cb of cbs) cb(data);
            });
        }
    }

    onConnect(callback: () => void): void {
        this.onConnectCb = callback;
    }

    onDisconnect(callback: () => void): void {
        this.onDisconnectCb = callback;
    }

    on(event: string, callback: (data: unknown) => void): void {
        if (!this.eventCallbacks.has(event)) {
             this.eventCallbacks.set(event, []);
             if (this.socket) {
                 this.socket.on(event, (data) => {
                     const cbs = this.eventCallbacks.get(event) || [];
                     for (const cb of cbs) cb(data);
                 });
             }
        }
        this.eventCallbacks.get(event)!.push(callback);
    }

    onRaw(callback: (buffer: ArrayBuffer) => void): void {
        this.onRawCb = callback;
    }

    emit(event: string, data: unknown): void {
        if (this.socket) {
            this.socket.emit(event, data);
        }
    }

    rawEmit(buffer: ArrayBuffer): void {
        if (this.socket) {
            const serializedPayload = { type: 'raw', data: Array.from(new Uint8Array(buffer)) };
            this.socket.emit("raw", serializedPayload);
        }
    }
}
