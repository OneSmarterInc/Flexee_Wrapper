// Integration test: Spec 27 Part A — contract change C2-1, launch passes last 120 minutes.
//
// Pure: no database, and no dependency on a checkout of the sims. The expiry checks move a fake
// clock rather than asserting the constant, because what C2-1 changes is a behaviour — whether a
// pass minted at the start of a 70-minute sim is still accepted when that sim submits its result —
// and a test that only read PASS_MINUTES would pass even if verifyPass ignored `exp`.
import assert from "node:assert/strict";
import { launchPass, verifyPass, signPass, PASS_MINUTES } from "@/lib/launchpass";

let passed = 0;
const t = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

const env = { LAUNCH_SECRET: "test-launch-secret" } as any;
const WHO = { userId: "u1", name: "Ann Wright", email: "ann@wright.edu", role: "student" as const, simId: "rapid-01-disaster", sectionId: "c1" };

/** Verify a token as if it were `minutes` after it was minted. */
function at(minutes: number, token: string) {
  const real = Date.now;
  const then = real() + minutes * 60000;
  Date.now = () => then;
  try { return verifyPass(token, env); } finally { Date.now = real; }
}

t("the default is two hours, and it is stated once", () => {
  assert.equal(PASS_MINUTES, 120);
  const p = verifyPass(launchPass(WHO, env), env)!;
  assert.ok(p, "a fresh pass verifies");
  assert.equal(Math.round((p.exp - p.iat) / 60000), 120);
});

t("a pass issued by default is still valid at 119 minutes", () => {
  const token = launchPass(WHO, env);
  const p = at(119, token);
  assert.ok(p, "a pass minted by default was rejected 119 minutes in");
  // and it is the same pass, not a re-mint: the payload still names the player and the sim
  assert.equal(p!.sub, "u1"); assert.equal(p!.sim, "rapid-01-disaster"); assert.equal(p!.course, "c1");
});

t("and invalid at 121 minutes", () => {
  assert.equal(at(121, launchPass(WHO, env)), null);
});

t("the two sims that were over the old line are now inside it", () => {
  // RapidSim+ 01 declares 70 minutes and RapidSim+ 02 declares 65, both read from their own
  // scenario metadata in Disaster_New. Each runs every request through a guard that calls
  // verifyLaunch, the final submit included, so at sixty minutes the longer one lost its result.
  const token = launchPass({ ...WHO, simId: "rapid-plus-01" }, env);
  assert.ok(at(70, token), "RapidSim+ 01's final submit at 70 minutes");
  assert.ok(at(65, token), "RapidSim+ 02's report at 65 minutes");
  // the old default would have refused both
  assert.ok(70 > 60 && 65 > 60);
});

t("a caller that asks for its own length is still honoured, longer or shorter", () => {
  const short = launchPass({ ...WHO, minutes: 5 }, env);
  assert.ok(at(4, short), "a 5-minute pass at 4 minutes");
  assert.equal(at(6, short), null, "a 5-minute pass at 6 minutes");

  const long = launchPass({ ...WHO, minutes: 600 }, env);
  assert.ok(at(599, long));
  assert.equal(at(601, long), null);

  // 0 means "already expired", not "fall back to the default" — ?? only replaces null/undefined
  assert.equal(at(1, launchPass({ ...WHO, minutes: 0 }, env)), null);
});

t("the change is in the default alone: the format and the payload's keys are untouched", () => {
  // A sim reads these keys and nothing else. If C2-1 had added or renamed one, every sim's
  // verifier would still accept the pass and then misread it, which no expiry test would catch.
  const p = verifyPass(launchPass(WHO, env), env)!;
  assert.deepEqual(Object.keys(p).sort(),
    ["course", "email", "exp", "iat", "mode", "name", "role", "sim", "sub"]);
  assert.equal(p.mode, "play");
  const token = launchPass(WHO, env);
  assert.equal(token.split(".").length, 2, "body.mac, as the sims split it");
});

t("expiry is still enforced, and a doctored exp does not survive the signature", () => {
  // The guard against a test that passes because `exp` stopped being read at all.
  const now = Date.now();
  assert.equal(verifyPass(signPass({ sub: "u1", exp: now - 1 }, env), env), null, "an expired pass");
  assert.ok(verifyPass(signPass({ sub: "u1", exp: now + 60000 }, env), env), "an unexpired one");
  assert.equal(verifyPass(signPass({ sub: "u1" }, env), env), null, "no exp at all");

  // Re-signing with a different secret, or editing the body, both fail.
  const token = launchPass(WHO, env);
  const [body] = token.split(".");
  const forged = signPass({ sub: "u1", exp: now + 999999999 }, { LAUNCH_SECRET: "other" } as any);
  assert.equal(verifyPass(forged, env), null, "signed with another secret");
  assert.equal(verifyPass(body + ".not-the-mac", env), null);
});

console.log("\n%d checks passed", passed);
