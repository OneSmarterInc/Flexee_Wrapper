// Load a program's declared outcomes (e.g. ABET student outcomes) from a JSON record.
//   npm run aol:load-program -- institutions/wsu-mis-bsb.json
import { readFileSync } from "node:fs";
import { loadProgramOutcomes } from "../src/lib/aol.ts";
const file = process.argv[2];
if (!file) { console.error("usage: npm run aol:load-program -- <program.json>"); process.exit(1); }
const rec = JSON.parse(readFileSync(file, "utf8"));
await loadProgramOutcomes(rec.outcomes.map((o: any) => ({ program: rec.program, framework: rec.framework, code: o.code, label: o.label, sourceUrl: rec.sourceUrl, capturedAt: rec.capturedAt })));
console.log(`loaded ${rec.outcomes.length} outcomes for ${rec.program}`);
process.exit(0);
