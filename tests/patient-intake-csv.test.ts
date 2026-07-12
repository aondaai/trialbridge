import { describe, it, expect } from "vitest";
import { parseCsv } from "@/lib/patient-intake/csv";

describe("parseCsv", () => {
  it("parses a simple grid and drops blank lines", () => {
    expect(parseCsv("a,b\n1,2\n\n3,4\n")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });
  it("handles quoted fields with commas, newlines and escaped quotes", () => {
    const rows = parseCsv('name,note\n"Doe, Jane","line1\nline2"\n"He said ""hi""",x');
    expect(rows[1]).toEqual(["Doe, Jane", "line1\nline2"]);
    expect(rows[2]).toEqual(['He said "hi"', "x"]);
  });
  it("handles CRLF and a missing trailing newline", () => {
    expect(parseCsv("a,b\r\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });
});
