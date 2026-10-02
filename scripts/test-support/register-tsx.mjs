// The ordinary test loader, plus a JSX transform so a suite can import real .tsx components.
// Registered only by the suites that need it; everything else uses register.mjs unchanged.
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);
register("./jsx.mjs", import.meta.url);
