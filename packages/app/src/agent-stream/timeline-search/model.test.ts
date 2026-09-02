import { describe, expect, it } from "vitest";
import {
  isSearchableQuery,
  normalizeSearchQuery,
  resolveInitialHitIndex,
  shouldAcceptSearchResponse,
  stepHitIndex,
} from "./model";

describe("isSearchableQuery", () => {
  it("rejects blank and single-character queries", () => {
    expect(isSearchableQuery("")).toBe(false);
    expect(isSearchableQuery("   ")).toBe(false);
    expect(isSearchableQuery("a")).toBe(false);
    expect(isSearchableQuery(" a ")).toBe(false);
  });

  it("accepts a two-character query once trimmed", () => {
    expect(isSearchableQuery("ab")).toBe(true);
    expect(isSearchableQuery("  ab  ")).toBe(true);
  });
});

describe("normalizeSearchQuery", () => {
  it("trims the edges and leaves the inside alone", () => {
    expect(normalizeSearchQuery("  two words  ")).toBe("two words");
  });
});

describe("shouldAcceptSearchResponse", () => {
  it("accepts a response for the query still in the field", () => {
    expect(shouldAcceptSearchResponse("parser", "parser")).toBe(true);
    expect(shouldAcceptSearchResponse(" parser ", "parser")).toBe(true);
  });

  it("drops a response the user has typed past", () => {
    expect(shouldAcceptSearchResponse("parse", "parser")).toBe(false);
  });
});

describe("stepHitIndex", () => {
  it("wraps at both ends", () => {
    expect(stepHitIndex(3, 2, 1)).toBe(0);
    expect(stepHitIndex(3, 0, -1)).toBe(2);
  });

  it("advances in the middle", () => {
    expect(stepHitIndex(3, 0, 1)).toBe(1);
    expect(stepHitIndex(3, 2, -1)).toBe(1);
  });

  it("stays at zero with no hits", () => {
    expect(stepHitIndex(0, 0, 1)).toBe(0);
    expect(stepHitIndex(0, 0, -1)).toBe(0);
  });
});

describe("resolveInitialHitIndex", () => {
  it("lands on the first hit, or on nothing", () => {
    expect(resolveInitialHitIndex(4)).toBe(0);
    expect(resolveInitialHitIndex(0)).toBe(-1);
  });
});
