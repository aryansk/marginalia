import { describe, it, expect } from "vitest";
import sha3 from "../../src/chatgpt/sha3.js";

const { sha3_512 } = sha3;

// Official FIPS 202 SHA3-512 test vectors.
describe("sha3_512", () => {
  it("hashes the empty string", () => {
    expect(sha3_512("")).toBe(
      "a69f73cca23a9ac5c8b567dc185a756e97c982164fe25859e0d1dcc1475c80a615b2123af1f5f94c11e3e9402c3ac558f500199d95b6d3e301758586281dcd26"
    );
  });

  it("hashes 'abc'", () => {
    expect(sha3_512("abc")).toBe(
      "b751850b1a57168a5693cd924b6b096e08f621827444f70d884f5d0240d2712e10e116e9192af3c91a7ec57647e3934057340b4cf408d5a56592f8274eec53f0"
    );
  });

  it("hashes a multi-block input (> 72 bytes)", () => {
    // "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"
    expect(sha3_512("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "04a371e84ecfb5b8b77cb48610fca8182dd457ce6f326a0fd3d7ec2f1e91636dee691fbe0c985302ba1b0d8dc78c086346b533b49c030d99a27daf1139d6e75e"
    );
  });
});
