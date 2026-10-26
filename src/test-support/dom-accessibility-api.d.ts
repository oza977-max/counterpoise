// R18-G. Test support only: the one function the accessibility tests use from the accessible-name library that
// Testing Library itself depends on. Declared here because, with node_modules shared between worktrees by a
// symbolic link, the compiler cannot follow the package's own "exports" to its types.
declare module 'dom-accessibility-api' {
  export function computeAccessibleName(element: Element): string;
}
