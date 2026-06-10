
export interface RemoteDisplayPixelFormat {
    bitsPerPixel: number;
    depth: number;
    bigEndian: boolean;
    trueColor: boolean;
    redMax: number;
    greenMax: number;
    blueMax: number;
    redShift: number;
    greenShift: number;
    blueShift: number;
}

export type RemoteDisplayRect =
    | {
        kind: 'rgba';
        x: number;
        y: number;
        width: number;
        height: number;
        rgba: Uint8ClampedArray;
      }
    | {
        kind: 'copy';
        x: number;
        y: number;
        width: number;
        height: number;
        srcX: number;
        srcY: number;
      }
    | {
        kind: 'resize';
        x: number;
        y: number;
        width: number;
        height: number;
      }
    | {
        kind: 'cursor';
        x: number;
        y: number;
        width: number;
        height: number;
        rgba: Uint8ClampedArray;
      }
    | {
        kind: 'desktop-name';
        name?: string;
      }
    | {
        kind: 'pipeline';
        x: number;
        y: number;
        width: number;
        height: number;
      };

export type RemoteDisplayProtocolEvent =
    | {
        type: 'protocol-version';
        protocol: string;
        server: string;
        client: string;
      }
    | {
        type: 'security-types';
        protocol: string;
        types: number[];
      }
    | {
        type: 'security-selected';
        protocol: string;
        securityType: number;
        label: string;
      }
    | {
        type: 'security-result';
        protocol: string;
        ok: boolean;
      }
    | {
        type: 'display-init';
        protocol: string;
        width: number;
        height: number;
        name?: string;
        pixelFormat?: RemoteDisplayPixelFormat | null;
      }
    | {
        type: 'framebuffer-update';
        protocol: string;
        width: number;
        height: number;
        rects: RemoteDisplayRect[];
      }
    | {
        type: 'clipboard';
        protocol: string;
        text: string;
      }
    | {
        type: 'bell';
        protocol: string;
      };

export interface RemoteDisplayProtocolReceiveResult {
    events: RemoteDisplayProtocolEvent[];
    outgoing: Uint8Array[];
}

export interface RemoteDisplayProtocolAdapter {
    readonly protocol: string;
    readonly state: string;
    readonly framebufferWidth: number;
    readonly framebufferHeight: number;
    readonly serverName: string;
    receive(chunk?: ArrayBuffer | Uint8Array | null): RemoteDisplayProtocolReceiveResult;
}
