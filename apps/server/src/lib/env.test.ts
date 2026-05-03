import { expect, test } from "bun:test";
import { z } from "zod";

// Test the schema constraints in isolation — avoids importing the side-effectful
// env.ts module (which calls process.exit on parse failure) in a context where
// the required env vars may not be present.
const portSchema = z.coerce.number().int().positive().default(3000);
const nodeEnvSchema = z.enum(["development", "production", "test"]).default("development");

test("env.PORT is a positive integer", () => {
  const port = portSchema.parse(process.env.PORT);
  expect(port).toBeGreaterThan(0);
  expect(Number.isInteger(port)).toBe(true);
});

test("env.NODE_ENV is a known value", () => {
  const nodeEnv = nodeEnvSchema.parse(process.env.NODE_ENV);
  expect(["development", "production", "test"]).toContain(nodeEnv);
});
