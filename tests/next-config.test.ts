import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";

describe("next.config", () => {
  it("does not log Server Action arguments (passwords, codes, tokens) in development", () => {
    expect(nextConfig.logging).toMatchObject({ serverFunctions: false });
  });

  it("does not advertise the framework", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
