import { describe, it, expect } from "vitest";
import type { Root, Element } from "hast";
import rehypeGroupDetails, { groupAdjacentDetails } from "@/panels/plans/rehype-group-details";

function details(label: string): Element {
  return {
    type: "element",
    tagName: "details",
    properties: {},
    children: [
      { type: "element", tagName: "summary", properties: {}, children: [{ type: "text", value: label }] },
    ],
  };
}

function paragraph(text: string): Element {
  return {
    type: "element",
    tagName: "p",
    properties: {},
    children: [{ type: "text", value: text }],
  };
}

describe("groupAdjacentDetails", () => {
  it("wraps 2+ adjacent details elements in a div.md-tabgroup", () => {
    const result = groupAdjacentDetails([details("A"), details("B")]);
    expect(result).toHaveLength(1);
    const wrapper = result[0] as Element;
    expect(wrapper.tagName).toBe("div");
    expect(wrapper.properties?.className).toEqual(["md-tabgroup"]);
    expect(wrapper.children).toHaveLength(2);
  });

  it("leaves a lone details element untouched", () => {
    const result = groupAdjacentDetails([paragraph("before"), details("A"), paragraph("after")]);
    expect(result).toHaveLength(3);
    expect((result[1] as Element).tagName).toBe("details");
  });

  it("does not merge details runs separated by other content", () => {
    const result = groupAdjacentDetails([details("A"), paragraph("between"), details("B")]);
    expect(result).toHaveLength(3);
    expect((result[0] as Element).tagName).toBe("details");
    expect((result[2] as Element).tagName).toBe("details");
  });
});

describe("rehypeGroupDetails", () => {
  it("groups details nested inside a blockquote, not just top-level", () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "blockquote",
          properties: {},
          children: [details("A"), details("B")],
        },
      ],
    };
    rehypeGroupDetails()(tree);
    const blockquote = tree.children[0] as Element;
    expect(blockquote.children).toHaveLength(1);
    expect((blockquote.children[0] as Element).properties?.className).toEqual(["md-tabgroup"]);
  });
});