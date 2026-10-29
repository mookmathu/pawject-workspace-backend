const { orderedPair } = require("../src/lib/pair");

describe("orderedPair", () => {
  it("puts the smaller id first", () => {
    expect(orderedPair("b", "a")).toEqual(["a", "b"]);
    expect(orderedPair("a", "b")).toEqual(["a", "b"]);
  });

  it("gives the same pair whoever asks", () => {
    const x = "0b2f9a10-1111-4222-8333-444455556666";
    const y = "f1e2d3c4-aaaa-4bbb-8ccc-ddddeeeeffff";
    expect(orderedPair(x, y)).toEqual(orderedPair(y, x));
  });

  it("matches the old Array.sort() ordering for uuid-style ids", () => {
    const ids = ["9c1d", "10aa", "Ab12", "ab12", "00ff", "zz"];
    for (const p of ids) for (const q of ids) expect(orderedPair(p, q)).toEqual([p, q].sort());
  });

  it("keeps both ids when they are equal", () => {
    expect(orderedPair("a", "a")).toEqual(["a", "a"]);
  });
});
