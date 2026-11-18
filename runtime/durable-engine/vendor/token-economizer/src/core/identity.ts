// SPDX-License-Identifier: Apache-2.0
import { sha256 } from "@noble/hashes/sha2.js";
/** Stable content identity, separate from reference MD5 failure signatures. */
export function fingerprint(text: string): string {return Array.from(sha256(new TextEncoder().encode(text)),byte => byte.toString(16).padStart(2,"0")).join("");}
