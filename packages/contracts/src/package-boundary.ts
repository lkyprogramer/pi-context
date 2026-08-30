export interface PackageBoundary {
  from: string;
  allowedImports: string[];
}

export const TARGET_PACKAGE_BOUNDARIES: readonly PackageBoundary[] = [
  { from: "@pcr/contracts", allowedImports: [] },
  { from: "@pcr/core", allowedImports: ["@pcr/contracts"] },
  { from: "@pcr/runtime", allowedImports: ["@pcr/contracts", "@pcr/core"] },
  { from: "@pcr/storage-node", allowedImports: ["@pcr/contracts", "@pcr/runtime"] },
  { from: "@pcr/pi-adapter", allowedImports: ["@pcr/contracts", "@pcr/runtime"] },
  { from: "@pcr/benchmark", allowedImports: ["@pcr/contracts", "@pcr/pi-adapter", "@pcr/runtime"] },
  {
    from: "@pcr/testkit",
    allowedImports: [
      "@pcr/benchmark",
      "@pcr/contracts",
      "@pcr/core",
      "@pcr/pi-adapter",
      "@pcr/runtime",
      "@pcr/storage-node",
    ],
  },
  {
    from: "pi-context-runtime",
    allowedImports: ["@pcr/contracts", "@pcr/pi-adapter", "@pcr/runtime", "@pcr/storage-node"],
  },
];

function assertAcyclic(boundaries: ReadonlyMap<string, readonly string[]>): void {
  const visited = new Set<string>();
  const active = new Set<string>();

  const visit = (packageName: string): void => {
    if (active.has(packageName)) {
      throw new Error(`package boundary cycle includes ${packageName}`);
    }
    if (visited.has(packageName)) return;
    active.add(packageName);
    for (const dependency of boundaries.get(packageName) ?? []) visit(dependency);
    active.delete(packageName);
    visited.add(packageName);
  };

  for (const packageName of boundaries.keys()) visit(packageName);
}

export function assertPackageImports(
  boundaries: readonly PackageBoundary[],
  observedImports: Readonly<Record<string, readonly string[]>>,
): PackageBoundary[] {
  const allowedByPackage = new Map<string, readonly string[]>();
  for (const boundary of boundaries) {
    if (!boundary || typeof boundary.from !== "string" || boundary.from.length === 0) {
      throw new TypeError("package boundary owner is required");
    }
    if (allowedByPackage.has(boundary.from)) {
      throw new Error(`duplicate package boundary: ${boundary.from}`);
    }
    if (!Array.isArray(boundary.allowedImports)) {
      throw new TypeError(`allowed imports must be an array: ${boundary.from}`);
    }
    if (new Set(boundary.allowedImports).size !== boundary.allowedImports.length) {
      throw new Error(`duplicate allowed import: ${boundary.from}`);
    }
    allowedByPackage.set(boundary.from, boundary.allowedImports);
  }

  for (const [packageName, imports] of allowedByPackage) {
    for (const dependency of imports) {
      if (!allowedByPackage.has(dependency)) {
        throw new Error(`${packageName} declares unknown package ${dependency}`);
      }
    }
  }
  assertAcyclic(allowedByPackage);

  for (const [packageName, imports] of Object.entries(observedImports)) {
    const allowedImports = allowedByPackage.get(packageName);
    if (!allowedImports) {
      throw new Error(`observed package is outside target graph: ${packageName}`);
    }
    if (!Array.isArray(imports)) {
      throw new TypeError(`observed imports must be an array: ${packageName}`);
    }
    for (const dependency of imports) {
      if (!allowedImports.includes(dependency)) {
        throw new Error(`${packageName} cannot import ${dependency}`);
      }
    }
  }

  return [...allowedByPackage]
    .map(([from, allowedImports]) => ({ from, allowedImports: [...allowedImports].sort() }))
    .sort((left, right) => left.from.localeCompare(right.from));
}
