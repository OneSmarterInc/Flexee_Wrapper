// Stand-in for next/link in tests: the same anchor, with href and the rest passed through, so a
// markup assertion sees what a reader's browser would.
import { createElement } from "react";
export default function Link({ href, children, ...rest }) {
  return createElement("a", { href, ...rest }, children);
}
