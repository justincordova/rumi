import { describe, expect, it } from "bun:test";
import {
  AddToBlacklistBody,
  AddToWhitelistBody,
  CreateRoomBody,
  CreateTabBody,
  ErrorCode,
  ErrorEnvelope,
  GetRoomResponse,
  GetSubscriptionResponse,
  GuestAccess,
  ListRoomsResponse,
  PlanType,
  Role,
  Room,
  SlugParam,
  Subscription,
  SubscriptionStatus,
  TabSummary,
  TabType,
  UpdateRoomBody,
  UpdateTabBody,
  Visibility,
} from "./index";

describe("Visibility", () => {
  it("accepts 'open' and 'private'", () => {
    expect(Visibility.parse("open")).toBe("open");
    expect(Visibility.parse("private")).toBe("private");
  });
  it("rejects invalid values", () => {
    expect(() => Visibility.parse("public")).toThrow();
  });
});

describe("GuestAccess", () => {
  it("accepts valid values", () => {
    expect(GuestAccess.parse("none")).toBe("none");
    expect(GuestAccess.parse("view")).toBe("view");
    expect(GuestAccess.parse("edit")).toBe("edit");
  });
  it("rejects invalid values", () => {
    expect(() => GuestAccess.parse("admin")).toThrow();
  });
});

describe("Room", () => {
  const valid = {
    id: "00000000-0000-0000-0000-000000000001",
    slug: "happy-cat-42",
    name: null,
    ownerId: "00000000-0000-0000-0000-000000000002",
    visibility: "open",
    guestAccess: "none",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  it("parses a valid room", () => {
    expect(Room.parse(valid).slug).toBe("happy-cat-42");
  });
  it("allows null name", () => {
    expect(Room.parse({ ...valid, name: null }).name).toBeNull();
  });
  it("rejects missing fields", () => {
    const { slug: _, ...noSlug } = valid;
    expect(() => Room.parse(noSlug)).toThrow();
  });
  it("rejects non-uuid id", () => {
    expect(() => Room.parse({ ...valid, id: "not-a-uuid" })).toThrow();
  });
});

describe("TabSummary", () => {
  const valid = {
    id: "00000000-0000-0000-0000-000000000001",
    roomId: "00000000-0000-0000-0000-000000000002",
    type: "tab",
    language: "markdown",
    name: "Welcome",
    ordinal: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  it("parses a valid tab", () => {
    expect(TabSummary.parse(valid).name).toBe("Welcome");
  });
  it("allows null language", () => {
    expect(TabSummary.parse({ ...valid, language: null }).language).toBeNull();
  });
  it("rejects negative ordinal", () => {
    expect(() => TabSummary.parse({ ...valid, ordinal: -1 })).toThrow();
  });
});

describe("CreateRoomBody", () => {
  it("accepts empty body (all optional)", () => {
    expect(CreateRoomBody.parse({})).toEqual({});
  });
  it("trims and validates name", () => {
    expect(CreateRoomBody.parse({ name: "  hello  " }).name).toBe("hello");
    expect(() => CreateRoomBody.parse({ name: "" })).toThrow();
    expect(() => CreateRoomBody.parse({ name: "x".repeat(101) })).toThrow();
  });
});

describe("UpdateRoomBody", () => {
  it("allows nullable name", () => {
    expect(UpdateRoomBody.parse({ name: null }).name).toBeNull();
    expect(UpdateRoomBody.parse({ name: "New" }).name).toBe("New");
  });
  it("trims name", () => {
    expect(UpdateRoomBody.parse({ name: "  hi  " }).name).toBe("hi");
  });
});

describe("CreateTabBody", () => {
  it("accepts valid tab type", () => {
    expect(CreateTabBody.parse({ type: "tab" }).type).toBe("tab");
    expect(CreateTabBody.parse({ type: "drawing" }).type).toBe("drawing");
  });
  it("rejects invalid type", () => {
    expect(() => CreateTabBody.parse({ type: "canvas" })).toThrow();
  });
  it("allows optional language", () => {
    expect(CreateTabBody.parse({ type: "tab", language: "typescript" }).language).toBe(
      "typescript",
    );
    expect(CreateTabBody.parse({ type: "tab", language: null }).language).toBeNull();
  });
});

describe("SlugParam", () => {
  it("accepts valid slugs", () => {
    expect(SlugParam.parse({ slug: "happy-cat-42" }).slug).toBe("happy-cat-42");
  });
  it("rejects uppercase", () => {
    expect(() => SlugParam.parse({ slug: "Happy-Cat" })).toThrow();
  });
  it("rejects too-long slugs", () => {
    expect(() => SlugParam.parse({ slug: "a".repeat(65) })).toThrow();
  });
  it("rejects special chars", () => {
    expect(() => SlugParam.parse({ slug: "bad_slug!" })).toThrow();
  });
});

describe("AddToWhitelistBody", () => {
  it("lowercases email", () => {
    expect(AddToWhitelistBody.parse({ email: "User@Example.COM" }).email).toBe("user@example.com");
  });
  it("rejects invalid email", () => {
    expect(() => AddToWhitelistBody.parse({ email: "not-email" })).toThrow();
  });
});

describe("AddToBlacklistBody", () => {
  it("lowercases email", () => {
    expect(AddToBlacklistBody.parse({ email: "User@Example.COM" }).email).toBe("user@example.com");
  });
  it("rejects invalid email", () => {
    expect(() => AddToBlacklistBody.parse({ email: "not-email" })).toThrow();
  });
});

describe("ErrorEnvelope", () => {
  it("parses valid error", () => {
    const result = ErrorEnvelope.parse({
      error: { code: "forbidden", message: "No access" },
    });
    expect(result.error.code).toBe("forbidden");
  });
  it("rejects unknown error code", () => {
    expect(() => ErrorEnvelope.parse({ error: { code: "unknown_error", message: "x" } })).toThrow();
  });
});

describe("GetRoomResponse", () => {
  it("parses full response with tabs and role", () => {
    const data = {
      room: {
        id: "00000000-0000-0000-0000-000000000001",
        slug: "test",
        name: null,
        ownerId: "00000000-0000-0000-0000-000000000002",
        visibility: "open",
        guestAccess: "none",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      role: "owner",
      tabs: [],
    };
    expect(GetRoomResponse.parse(data).role).toBe("owner");
  });
});

describe("ListRoomsResponse", () => {
  it("parses rooms with pendingInvite", () => {
    const data = {
      rooms: [
        {
          id: "00000000-0000-0000-0000-000000000001",
          slug: "test",
          name: "Room",
          ownerId: "00000000-0000-0000-0000-000000000002",
          visibility: "open",
          guestAccess: "none",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          pendingAccess: true,
        },
      ],
    };
    expect(ListRoomsResponse.parse(data).rooms[0]?.pendingAccess).toBe(true);
  });
});

describe("PlanType", () => {
  it("accepts valid plan types", () => {
    expect(PlanType.parse("free")).toBe("free");
    expect(PlanType.parse("pro")).toBe("pro");
    expect(PlanType.parse("max")).toBe("max");
  });
  it("rejects invalid plan", () => {
    expect(() => PlanType.parse("enterprise")).toThrow();
  });
});

describe("SubscriptionStatus", () => {
  it("accepts valid statuses", () => {
    expect(SubscriptionStatus.parse("active")).toBe("active");
    expect(SubscriptionStatus.parse("past_due")).toBe("past_due");
    expect(SubscriptionStatus.parse("canceled")).toBe("canceled");
  });
});

describe("Subscription", () => {
  it("parses a valid subscription", () => {
    const result = Subscription.parse({
      plan: "pro",
      status: "active",
      currentPeriodEnd: new Date().toISOString(),
    });
    expect(result.plan).toBe("pro");
  });
  it("parses subscription without currentPeriodEnd", () => {
    const result = Subscription.parse({ plan: "free", status: "active" });
    expect(result.currentPeriodEnd).toBeUndefined();
  });
});

describe("GetSubscriptionResponse", () => {
  it("parses response with subscription", () => {
    const result = GetSubscriptionResponse.parse({
      subscription: { plan: "pro", status: "active", currentPeriodEnd: new Date().toISOString() },
    });
    expect(result.subscription?.plan).toBe("pro");
  });
  it("parses response with null subscription", () => {
    const result = GetSubscriptionResponse.parse({ subscription: null });
    expect(result.subscription).toBeNull();
  });
});
