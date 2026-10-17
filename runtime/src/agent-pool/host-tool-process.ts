import { killProcessTree, registerProcess, unregisterProcess } from "../utils/process-tracker.js";

/** Private bounded process port shared by host find/grep; no shell or downloads. */
export async function runHostToolProcess(binary: string, args: string[], cwd: string, assert: () => void,
  signal?: AbortSignal, onLine?: (line: string) => boolean) {
  assert(); signal?.throwIfAborted();
  const child = Bun.spawn([binary, ...args], { cwd, detached: true, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  registerProcess(child.pid);
  const kill = () => killProcessTree(child.pid);
  signal?.addEventListener("abort", kill, { once: true });
  let bytes = 0, stopped = false;
  const consume = async (stream: ReadableStream<Uint8Array>, stdout: boolean) => {
    const decoder = new TextDecoder();
    let text = "", pending = "";
    for await (const chunk of stream) {
      bytes += chunk.byteLength;
      if (bytes > 1024 * 1024) { kill(); throw Error("Host tool output exceeded limit"); }
      const decoded = decoder.decode(chunk, { stream: true });
      if (!stdout || !onLine) text += decoded;
      else {
        pending += decoded;
        let end: number;
        while ((end = pending.indexOf("\n")) !== -1) {
          const line = pending.slice(0, end); pending = pending.slice(end + 1);
          if (!stopped && onLine(line)) { stopped = true; kill(); }
        }
      }
    }
    const tail = decoder.decode();
    if (stdout && onLine) { if (!stopped && (pending || tail) && onLine(pending + tail)) stopped = true; }
    else text += tail;
    return text;
  };
  try {
    const [out, err, exit] = await Promise.allSettled([consume(child.stdout, true), consume(child.stderr, false), child.exited]);
    assert(); signal?.throwIfAborted();
    if (out.status === "rejected") throw out.reason;
    if (err.status === "rejected") throw err.reason;
    if (exit.status === "rejected") throw exit.reason;
    return { stdout: out.value, stderr: err.value, code: exit.value, stopped };
  } finally {
    signal?.removeEventListener("abort", kill);
    unregisterProcess(child.pid);
  }
}
