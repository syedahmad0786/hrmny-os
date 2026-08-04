import { describe, expect, it } from "vitest";
import { csvToObjects, parseCsv } from "./csv-parse";

describe("parseCsv", () => {
  it("parses plain rows with CRLF and LF endings", () => {
    expect(parseCsv("a,b\r\nc,d\ne,f")).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
    ]);
  });

  it("handles quoted fields containing commas and escaped quotes", () => {
    expect(parseCsv('name,notes\r\n"Acme, Inc.","She said ""hi"""')).toEqual([
      ["name", "notes"],
      ["Acme, Inc.", 'She said "hi"'],
    ]);
  });

  it("handles newlines inside quoted fields", () => {
    expect(parseCsv('a\r\n"line1\r\nline2",b')).toEqual([
      ["a"],
      ["line1\r\nline2", "b"],
    ]);
  });

  it("keeps empty cells and trailing commas", () => {
    expect(parseCsv("a,,c\r\nx,y,")).toEqual([
      ["a", "", "c"],
      ["x", "y", ""],
    ]);
  });

  it("ignores a trailing newline", () => {
    expect(parseCsv("a,b\r\n")).toEqual([["a", "b"]]);
  });
});

describe("csvToObjects", () => {
  it("maps header row to object keys and omits empty cells", () => {
    expect(
      csvToObjects("firstName,lastName,email\r\nAda,,ada@ex.com\r\nBob,Ray,"),
    ).toEqual([
      { firstName: "Ada", email: "ada@ex.com" },
      { firstName: "Bob", lastName: "Ray" },
    ]);
  });

  it("skips blank lines and strips a BOM", () => {
    expect(csvToObjects("﻿name\r\n\r\nAcme\r\n")).toEqual([
      { name: "Acme" },
    ]);
  });

  it("returns [] for empty input", () => {
    expect(csvToObjects("")).toEqual([]);
  });

  it("round-trips RFC 4180 quoting from the server serializer", () => {
    const csv = 'name,notes\r\n"Acme, Inc.","multi\r\nline ""quoted"""';
    expect(csvToObjects(csv)).toEqual([
      { name: "Acme, Inc.", notes: 'multi\r\nline "quoted"' },
    ]);
  });
});
