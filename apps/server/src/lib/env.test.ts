import { expect, test } from "bun:test";
import { env } from "@/lib/env";

test("env.PORT is a positive integer", () => {
  expect(env.PORT).toBeGreaterThan(0);
  expect(Number.isInteger(env.PORT)).toBe(true);
});

test("env.NODE_ENV is a known value", () => {
  expect(["development", "production", "test"]).toContain(env.NODE_ENV);
});
