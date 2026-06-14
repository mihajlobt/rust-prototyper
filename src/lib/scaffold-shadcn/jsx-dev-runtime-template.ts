/**
 * Templates for the generated app's dev-only `react/jsx-dev-runtime` shim,
 * which stamps a `data-source-loc="src/pages/home.tsx:42:8"` attribute onto
 * every DOM element using the {fileName, lineNumber, columnNumber} info
 * Babel's dev JSX transform already passes to `jsxDEV` (see
 * getGeneratedViteConfig's `react/jsx-dev-runtime` alias, which wires this
 * shim in for `vite dev` only).
 *
 * See ./scaffold-shadcn.ts for the barrel re-export.
 */

/** Returns src/dev/jsx-dev-runtime-shim.ts for the generated/ app. */
export function getJsxDevRuntimeShim(): string {
  return `import { Fragment, jsxDEV as realJsxDEV } from "react/jsx-dev-runtime-real";

export { Fragment };

interface JsxSource {
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
}

function toRelativePath(fileName: string): string {
  const match = fileName.match(/\\/src\\/.*$/);
  return match ? match[0].slice(1) : fileName;
}

export function jsxDEV(
  type: unknown,
  props: Record<string, unknown> | null,
  key: unknown,
  isStaticChildren: boolean,
  source?: JsxSource,
  self?: unknown,
) {
  let finalProps = props;
  if (typeof type === "string" && source?.fileName && props && !("data-source-loc" in props)) {
    finalProps = {
      ...props,
      "data-source-loc": \`\${toRelativePath(source.fileName)}:\${source.lineNumber}:\${source.columnNumber}\`,
    };
  }
  return (realJsxDEV as (...args: unknown[]) => unknown)(type, finalProps, key, isStaticChildren, source, self);
}
`;
}

/** Returns src/dev/jsx-dev-runtime-real.d.ts for the generated/ app. */
export function getJsxDevRuntimeShimTypes(): string {
  return `declare module "react/jsx-dev-runtime-real" {
  export * from "react/jsx-dev-runtime";
}
`;
}
