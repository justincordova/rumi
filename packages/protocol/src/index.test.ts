import { expect, test } from "bun:test";
import { PROTOCOL_VERSION } from "./index";

test("PROTOCOL_VERSION is exported", () => {
  expect(PROTOCOL_VERSION).toBe("0.1.0");
});
