import { describe, expect, it } from "vitest";
import { createProperties, labelsFromProperty, matchesFilters, parsePageId, propertyValue, statusFromNative, subjectFromPage, textFromProperty, updateProperties } from "./index.js";

const config = {
  baseUrl: "https://api.notion.com/v1",
  token: "token",
  notionVersion: "2025-09-03",
  parentId: "source-id",
  parentType: "data_source" as const,
  titleProperty: "Name",
  statusProperty: "Status",
  labelsProperty: "Tags",
  descriptionProperty: "Description",
  assigneeProperty: "Assignee",
  statusPropertyType: "status" as const,
  labelsPropertyType: "multi_select" as const,
  assigneePropertyType: "rich_text" as const,
  statusMap: {
    ready: "Not started",
    "in-progress": "In progress",
    blocked: "Blocked",
    done: "Done",
    cancelled: "Cancelled",
  },
};

const page = {
  id: "2f1e0000000000000000000000000000",
  created_time: "2026-01-01T00:00:00.000Z",
  last_edited_time: "2026-01-02T00:00:00.000Z",
  archived: false,
  url: "https://notion.so/2f1e",
  properties: {
    Name: { type: "title", title: [{ plain_text: "Write launch memo" }] },
    Status: { type: "status", status: { name: "In progress" } },
    Tags: { type: "multi_select", multi_select: [{ name: "docs" }, { name: "launch" }] },
    Description: { type: "rich_text", rich_text: [{ plain_text: "Draft the memo." }] },
    Assignee: { type: "rich_text", rich_text: [{ plain_text: "Sam" }] },
  },
};

describe("Notion subject mapping", () => {
  it("parses canonical ids and raw page ids", () => {
    expect(parsePageId("notion.page:2f1e0000000000000000000000000000")).toBe("2f1e0000000000000000000000000000");
    expect(parsePageId("2f1e0000000000000000000000000000")).toBe("2f1e0000000000000000000000000000");
  });

  it("extracts text and labels from Notion properties", () => {
    expect(textFromProperty(page.properties.Name)).toBe("Write launch memo");
    expect(labelsFromProperty(page.properties.Tags)).toEqual(["docs", "launch"]);
  });

  it("maps native statuses", () => {
    expect(statusFromNative("In progress", page)).toBe("in-progress");
    expect(statusFromNative("Blocked", page)).toBe("blocked");
    expect(statusFromNative("Done", page)).toBe("done");
    expect(statusFromNative("Cancelled", page)).toBe("cancelled");
  });

  it("builds property payloads", () => {
    expect(propertyValue("status", "Done")).toEqual({ status: { name: "Done" } });
    expect(propertyValue("multi_select", ["docs"])).toEqual({ multi_select: [{ name: "docs" }] });
    expect(createProperties(config, { kind: "notion.page", title: "New page", status: "ready", labels: ["docs"], assignee: "Sam" })).toMatchObject({
      Name: { title: [{ text: { content: "New page" } }] },
      Status: { status: { name: "Not started" } },
      Tags: { multi_select: [{ name: "docs" }] },
      Assignee: { rich_text: [{ text: { content: "Sam" } }] },
    });
    expect(updateProperties(config, { status: "done", custom: { name: "Done page" } })).toMatchObject({
      Name: { title: [{ text: { content: "Done page" } }] },
      Status: { status: { name: "Done" } },
    });
  });

  it("applies filters locally", () => {
    expect(matchesFilters(page, { labels_all: ["docs"], assignee: ["Sam"], status: ["in-progress"] }, config)).toBe(true);
    expect(matchesFilters(page, { labels_all: ["support"] }, config)).toBe(false);
    expect(matchesFilters(page, { updated_since: "2026-02-01T00:00:00.000Z" }, config)).toBe(false);
  });

  it("emits required Animus subject fields", () => {
    expect(subjectFromPage(page, config)).toMatchObject({
      id: "notion.page:2f1e0000000000000000000000000000",
      kind: "notion.page",
      title: "Write launch memo",
      status: "in-progress",
      assignee: "Sam",
      native_status: "In progress",
    });
  });
});
