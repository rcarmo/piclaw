// SPDX-License-Identifier: Apache-2.0
/** Local adapters for the selected mcp-recall handlers; no MCP, database or process dependency. */
export type RecallOutput = { stdout:string; stderr:string; exit_code:number };
export type CompressionResult = {summary:string;originalSize:number};
export type Handler = (name:string,output:RecallOutput) => CompressionResult;
export const MAX_BUILD_ERRORS = 20;
export const extractStdout = (output:RecallOutput) => output.stdout;
export const extractStderr = (output:RecallOutput) => output.stderr;
export const extractExitCode = (output:RecallOutput) => output.exit_code;
export const bashOutputText = (output:RecallOutput) => output.stdout+output.stderr;
/** Unrecognised diagnostics pass through without upstream shell truncation. */
export const shellHandler:Handler = (_name,output) => ({summary:bashOutputText(output),originalSize:Buffer.byteLength(bashOutputText(output))});
