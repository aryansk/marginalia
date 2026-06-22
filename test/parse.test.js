// Offline sanity tests for the pure logic in gemini/client.js (no DOM/network).
// Run: node test/parse.test.js
const fs = require("fs");
const path = require("path");

globalThis.GA = {};
const code = fs.readFileSync(path.join(__dirname, "..", "src", "gemini", "client.js"), "utf8");
(0, eval)(code);

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    pass++;
    console.log("PASS  " + name);
  } else {
    fail++;
    console.log("FAIL  " + name);
  }
}

const PREFIX = ")]}'" + "\n\n";

function frame(body) {
  const item = ["wrb.fr", "f.abc", JSON.stringify(body), null, null, null, "generic"];
  const line = JSON.stringify([item]);
  return line.length + "\n" + line + "\n";
}

// body[4][0][1][0] = text ; body[1] = [cid,rid] ; body[4][0][0] = rcid
const b1 = [null, ["cid1", "rid1"], null, null, [["rcid1", ["Hello"]]]];
const b2 = [null, ["cid1", "rid1"], null, null, [["rcid1", ["Hello, an **8 KB** page is chosen because..."]]]];
const raw = PREFIX + frame(b1) + frame(b2);

const out = GA.client.parseLatest(raw);
check("streaming returns the latest (longest) frame", out === "Hello, an **8 KB** page is chosen because...");

// fallback deep-find when the primary path is absent
const weird = [null, null, null, null, [["x", null, null, ["A reasonably long fallback answer string."]]]];
const out2 = GA.client.parseLatest(PREFIX + frame(weird));
check("fallback deep-find returns a non-empty string", typeof out2 === "string" && out2.length > 10);

// empty input -> null
check("empty input returns null", GA.client.parseLatest(PREFIX) === null);

// non-wrb.fr noise is ignored
const noise = PREFIX + '54\n[["di",123]]\n' + frame(b1);
check("ignores non-wrb.fr frames", GA.client.parseLatest(noise) === "Hello");

// request builder
const body = GA.client.buildBody("why 8kb?", "AT_TOKEN");
check("buildBody includes at + f.req", body.indexOf("at=AT_TOKEN") >= 0 && body.indexOf("f.req=") >= 0);

// Parse with URLSearchParams (as the server does) so '+' decodes back to space.
const decoded = new URLSearchParams(body).get("f.req");
const outer = JSON.parse(decoded);
const inner = JSON.parse(outer[1]);
check("f.req inner has prompt at [0][0]", inner[0][0] === "why 8kb?");
check("f.req inner uses empty conversation triplet", JSON.stringify(inner[2]) === "[null,null,null]");

// url builder
const url = GA.client.buildUrl("boq_x", "12345");
check("buildUrl carries bl/sid/rt", url.indexOf("bl=boq_x") >= 0 && url.indexOf("f.sid=12345") >= 0 && url.indexOf("rt=c") >= 0);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
