/**
 * Stands for the generated WebAssembly packages (`src/*\/pkg/`) in unit tests: they are built by
 * `scripts/build.sh`, which the unit tests do not need. Loading one fails, as without a build.
 */
export default function init(): Promise<never> {
  return Promise.reject(new Error("WebAssembly is not built for unit tests"));
}
