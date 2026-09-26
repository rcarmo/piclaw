#!/usr/bin/env bun
/** Remove only the generated pack-time seed; never touch a workspace. */
import { rmSync } from "node:fs";
import { seedDir } from "./prepare-core-addons.js";

rmSync(seedDir, { recursive: true, force: true });
