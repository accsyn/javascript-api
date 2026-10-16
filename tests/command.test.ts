import { describe, expect, it } from "vitest";
import { formatResult, runSessionCommand } from "../test/command.mjs";

describe("runSessionCommand", () => {
  const session = {
    find: async (query, options) => ({ query, options: options ?? null }),
    username: "user@example.com",
  };

  it("runs the expression after session.", async () => {
    await expect(runSessionCommand(session, 'session.find("Job")')).resolves.toEqual({
      query: "Job",
      options: null,
    });
  });

  it("accepts await and a trailing semicolon", async () => {
    await expect(runSessionCommand(session, 'await session.find("Job", { limit: 2 });')).resolves.toEqual({
      query: "Job",
      options: { limit: 2 },
    });
  });

  it("reads a property", async () => {
    await expect(runSessionCommand(session, "session.username")).resolves.toBe("user@example.com");
  });

  it("rejects commands that do not start with session.", async () => {
    await expect(runSessionCommand(session, 'find("Job")')).rejects.toThrow(/session\./);
  });
});

describe("formatResult", () => {
  it("prints objects and dates", () => {
    expect(formatResult({ created: new Date("2020-01-02T03:04:05.000Z") })).toContain("2020-01-02T03:04:05.000Z");
    expect(formatResult(undefined)).toBe("undefined");
  });
});
