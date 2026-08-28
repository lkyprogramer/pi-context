/**
 * Pi package entry. Pi loads this via jiti (`pi.extensions` / `pi -e`).
 * The factory default accepts the host ExtensionAPI and only registers handlers.
 */
export { default, createPiContextExtension, register } from "../src/extension.ts";
