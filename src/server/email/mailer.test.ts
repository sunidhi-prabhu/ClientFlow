import { describe, expect, it } from "vitest";

import { smtpTransportUrl } from "./mailer";

describe("smtpTransportUrl", () => {
  it("adds connection, greeting and socket timeouts", () => {
    const url = new URL(smtpTransportUrl("smtps://user:pass@smtp.example.com:465"));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      connectionTimeout: "10000",
      greetingTimeout: "10000",
      socketTimeout: "30000",
    });
    expect(url.username).toBe("user");
    expect(url.host).toBe("smtp.example.com:465");
  });

  it("keeps values and options already in SMTP_URL", () => {
    const url = new URL(smtpTransportUrl("smtp://localhost:1025?socketTimeout=5000&pool=true"));
    expect(url.searchParams.get("socketTimeout")).toBe("5000");
    expect(url.searchParams.get("pool")).toBe("true");
    expect(url.searchParams.get("connectionTimeout")).toBe("10000");
  });
});
