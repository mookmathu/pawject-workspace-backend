const { trimTrailingSlash } = require("../src/lib/url");

describe("trimTrailingSlash", () => {
  it.each([
    ["https://x.tech/", "https://x.tech"],
    ["https://x.tech///", "https://x.tech"],
    ["https://x.tech", "https://x.tech"],
    ["https://x.tech/app/", "https://x.tech/app"],
    ["/", ""],
    ["", ""],
  ])("%j -> %j", (input, expected) => {
    expect(trimTrailingSlash(input)).toBe(expected);
  });

  it("handles a very long run of slashes quickly", () => {
    const start = Date.now();
    expect(trimTrailingSlash(`a${"/".repeat(200000)}`)).toBe("a");
    expect(Date.now() - start).toBeLessThan(500);
  });
});
