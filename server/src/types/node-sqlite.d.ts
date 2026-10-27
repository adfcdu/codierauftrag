// Type shim for the Node 26.11 DatabaseSync→Database / StatementSync→Statement rename.
// REMOVE this file when @types/node exports Database/Statement natively.
declare module 'node:sqlite' {
  export import Database = DatabaseSync;
  export import Statement = StatementSync;
}
