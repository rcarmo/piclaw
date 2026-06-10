
import * as loader from '@assemblyscript/loader';
import { collectAssemblyScriptGarbageBestEffort } from './remote-display-gc.js';

const REMOTE_DISPLAY_DECODER_WASM_URL = '/static/common/js/vendor/remote-display-decoder.wasm';

/**
 * Full-pipeline WASM decoder.
 *
 * WASM owns the RGBA framebuffer surface. Each process* call writes
 * directly to the internal framebuffer — no per-rect allocation or
 * copy across the JS/WASM boundary on output.
 *
 * JS reads the framebuffer via getFramebuffer() for canvas rendering.
 */
export interface WasmDisplayPipeline {
    /** Allocate/resize the internal framebuffer. Call on display-init and resize. */
    initFramebuffer(width: number, height: number): void;

    /** Read the WASM-owned framebuffer as a Uint8ClampedArray view (zero-copy). */
    getFramebuffer(): Uint8ClampedArray;

    getFramebufferWidth(): number;
    getFramebufferHeight(): number;

    /** Process a Raw rect (encoding 0). Returns 0 on success. */
    processRawRect(data: Uint8Array, x: number, y: number, w: number, h: number, pf: any): number;

    /** Process a CopyRect (encoding 1). Returns 0 on success. */
    processCopyRect(dstX: number, dstY: number, w: number, h: number, srcX: number, srcY: number): number;

    /** Process an RRE rect (encoding 2). Returns 0 on success. */
    processRreRect(data: Uint8Array, x: number, y: number, w: number, h: number, pf: any): number;

    /** Process a CoRRE rect (encoding 4). Returns 0 on success. */
    processCoRreRect(data: Uint8Array, x: number, y: number, w: number, h: number, pf: any): number;

    /** Process a Hextile rect (encoding 5). Returns 0 on success. */
    processHextileRect(data: Uint8Array, x: number, y: number, w: number, h: number, pf: any): number;

    /** Process ZRLE decompressed tile data (encoding 16). Returns 0 on success. */
    processZrleTileData(decompressed: Uint8Array, x: number, y: number, w: number, h: number, pf: any): number;

    /** Legacy standalone decoder — returns new Uint8ClampedArray. */
    decodeRawRectToRgba(data: Uint8Array, width: number, height: number, pf: any): Uint8ClampedArray;
}

let pipelinePromise: Promise<WasmDisplayPipeline | null> | null = null;

function normalizeInput(bytes: Uint8Array | ArrayBuffer): ArrayBuffer {
    if (bytes instanceof ArrayBuffer) return bytes;
    if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
        return bytes.buffer as ArrayBuffer;
    }
    return bytes.slice().buffer as ArrayBuffer;
}

export async function loadRemoteDisplayWasmDecoder(): Promise<WasmDisplayPipeline | null> {
    if (pipelinePromise) return pipelinePromise;
    pipelinePromise = (async () => {
        try {
            const response = await fetch(REMOTE_DISPLAY_DECODER_WASM_URL, { credentials: 'same-origin' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const instantiated = typeof loader.instantiateStreaming === 'function'
                ? await loader.instantiateStreaming(response, {})
                : await loader.instantiate(await response.arrayBuffer(), {});
            const ex = instantiated.exports as Record<string, any>;

            // Verify expected exports
            for (const fn of [
                'initFramebuffer', 'getFramebufferPtr', 'getFramebufferLen',
                'getFramebufferWidth', 'getFramebufferHeight',
                'processRawRect', 'processCopyRect', 'processRreRect',
                'processCoRreRect', 'processHextileRect', 'processZrleTileData',
                'decodeRawRectToRgba',
            ]) {
                if (typeof ex[fn] !== 'function') throw new Error(`${fn} export is missing.`);
            }

            // Helper: call a process* function that takes (dataBuffer, x, y, w, h, pf...)
            // Allocates input in WASM, calls the function, then frees the input.
            function callProcess(fnName: string, data: Uint8Array, x: number, y: number, w: number, h: number, pf: any) {
                const input = normalizeInput(data);
                const ptr = ex.__pin(ex.__newArrayBuffer(input));
                try {
                    return ex[fnName](
                        ptr, x, y, w, h,
                        pf.bitsPerPixel,
                        pf.bigEndian ? 1 : 0,
                        pf.trueColor ? 1 : 0,
                        pf.redMax, pf.greenMax, pf.blueMax,
                        pf.redShift, pf.greenShift, pf.blueShift,
                    );
                } finally {
                    ex.__unpin(ptr);
                    collectAssemblyScriptGarbageBestEffort(ex);
                }
            }

            return {
                initFramebuffer(width, height) {
                    ex.initFramebuffer(width, height);
                },

                getFramebuffer() {
                    const ptr = ex.getFramebufferPtr();
                    const len = ex.getFramebufferLen();
                    // Copy out of WASM linear memory — memory.buffer can be
                    // detached/replaced when WASM memory grows, so a view is
                    // not safe to hold across calls.
                    return new Uint8ClampedArray(
                        new Uint8Array(ex.memory.buffer, ptr, len).slice().buffer
                    );
                },

                getFramebufferWidth() { return ex.getFramebufferWidth(); },
                getFramebufferHeight() { return ex.getFramebufferHeight(); },

                processRawRect(data, x, y, w, h, pf) {
                    return callProcess('processRawRect', data, x, y, w, h, pf);
                },

                processCopyRect(dstX, dstY, w, h, srcX, srcY) {
                    return ex.processCopyRect(dstX, dstY, w, h, srcX, srcY);
                },

                processRreRect(data, x, y, w, h, pf) {
                    return callProcess('processRreRect', data, x, y, w, h, pf);
                },

                processCoRreRect(data, x, y, w, h, pf) {
                    return callProcess('processCoRreRect', data, x, y, w, h, pf);
                },

                processHextileRect(data, x, y, w, h, pf) {
                    return callProcess('processHextileRect', data, x, y, w, h, pf);
                },

                processZrleTileData(decompressed, x, y, w, h, pf) {
                    return callProcess('processZrleTileData', decompressed, x, y, w, h, pf);
                },

                decodeRawRectToRgba(data, width, height, pf) {
                    const input = normalizeInput(data);
                    const inputPtr = ex.__pin(ex.__newArrayBuffer(input));
                    try {
                        const outputPtr = ex.__pin(ex.decodeRawRectToRgba(
                            inputPtr, width, height,
                            pf.bitsPerPixel,
                            pf.bigEndian ? 1 : 0,
                            pf.trueColor ? 1 : 0,
                            pf.redMax, pf.greenMax, pf.blueMax,
                            pf.redShift, pf.greenShift, pf.blueShift,
                        ));
                        try {
                            return new Uint8ClampedArray(ex.__getArrayBuffer(outputPtr));
                        } finally { ex.__unpin(outputPtr); }
                    } finally {
                        ex.__unpin(inputPtr);
                        collectAssemblyScriptGarbageBestEffort(ex);
                    }
                },
            };
        } catch (error) {
            console.warn('[remote-display] Failed to load WASM pipeline, using JS fallback.', error);
            return null;
        }
    })();
    return pipelinePromise;
}
