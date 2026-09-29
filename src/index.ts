/**
 * obix-runtime-component — the components of OBIX's native runtime (Phase 6, docs/recovery/native-runtime.md).
 *
 *     canonical DOP IR (obix-dop-ir/3, plain data)  ──►  readComponent  ──►  mountComponent  ──►  the DOM, built and updated in place
 *
 * It reads the IR the frontends lower into — Vue-flavoured or React-flavoured source, it cannot tell — and runs it. No Vue, no React, no compiler package: its reading of the IR
 * is its own (ir.ts), held to the IR's definition by the repository's tests.
 */
export { ObixRuntimeError } from 'obix-runtime-dom';
export type { ObixRuntimeErrorCode } from 'obix-runtime-dom';
export { OBIX_RUNTIME_IR, OBIX_RUNTIME_IR_SCHEMA } from './ir.js';
export type * from './ir.js';
export { readComponent } from './read.js';
export { Linker } from './link.js';
export type { Registry } from './link.js';
export { mountComponent, pageListeners } from './mount.js';
export type { MountOptions, MountedComponent } from './mount.js';
