// ── Move validity unit tests ─────────────────────────────────
// Run with:  npm test
//
// This runs on every dragover and decides whether a drop target is
// offered at all, so a wrong answer either blocks a legal move or
// promises an illegal one. The collision cases are the ones worth
// staring at: a grandchild's own field collides just as fatally as the
// dragged node's, and an override that loses its inherited field is a
// blocker the naive check misses entirely.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  canMoveUnder,
  outdentTarget,
  previousSibling,
  reorderSiblings,
  siblingsOf,
} from "./tree-move.ts";
import type { CategoryNode } from "./types.ts";

function node(
  id: string,
  keys: string[] = [],
  children: CategoryNode[] = [],
  overrides: Record<string, unknown> = {}
): CategoryNode {
  return {
    id,
    name: id,
    slug: id,
    description: null,
    parent_id: null,
    blueprint_id: null,
    own_fields: keys.map((key, position) => ({
      key,
      label: key,
      type: "string",
      required: false,
      position,
    })),
    overrides: overrides as CategoryNode["overrides"],
    icon: null,
    color: null,
    position: 0,
    created_at: "",
    updated_at: "",
    children,
    item_count: 0,
    subtree_item_count: 0,
    own_field_count: keys.length,
    inherited_field_count: 0,
  };
}

//  electronics [brand]
//    laptops   [gpu]
//      gaming  [rgb]
//  books       [author]
//  media       [brand]        ← same key as electronics, different tree
const tree: CategoryNode[] = [
  node("electronics", ["brand"], [node("laptops", ["gpu"], [node("gaming", ["rgb"])])]),
  node("books", ["author"]),
  node("media", ["brand"]),
];

describe("canMoveUnder — structural", () => {
  it("allows a plain move to another tree", () => {
    assert.deepEqual(canMoveUnder(tree, "laptops", "books"), { ok: true });
  });

  it("allows a move to the root", () => {
    assert.deepEqual(canMoveUnder(tree, "laptops", null), { ok: true });
  });

  it("refuses a node onto itself", () => {
    const verdict = canMoveUnder(tree, "laptops", "laptops");
    assert.equal(verdict.ok, false);
  });

  it("refuses a move into its own descendant", () => {
    const verdict = canMoveUnder(tree, "electronics", "gaming");
    assert.equal(verdict.ok, false);
    assert.match(verdict.ok === false ? verdict.reason : "", /inside/);
  });

  it("reports a no-op move rather than pretending it is valid", () => {
    const verdict = canMoveUnder(tree, "laptops", "electronics");
    assert.equal(verdict.ok, false);
    assert.match(verdict.ok === false ? verdict.reason : "", /Already there/);
  });

  it("reports a no-op move to root for a node already at root", () => {
    assert.equal(canMoveUnder(tree, "books", null).ok, false);
  });
});

describe("canMoveUnder — key collisions", () => {
  it("refuses when the dragged node's own key is inherited at the target", () => {
    // media defines `brand`; electronics also provides `brand`.
    const verdict = canMoveUnder(tree, "media", "electronics");
    assert.equal(verdict.ok, false);
    assert.equal(verdict.ok === false ? verdict.collidingKey : null, "brand");
  });

  it("refuses when a DESCENDANT's key collides, not just the dragged node's", () => {
    // Moving `books` under `media` is fine on its own keys, but give
    // books a child that defines `brand` and it is not.
    const withChild: CategoryNode[] = [
      node("media", ["brand"]),
      node("books", ["author"], [node("fiction", ["brand"])]),
    ];
    const verdict = canMoveUnder(withChild, "books", "media");
    assert.equal(verdict.ok, false);
    assert.equal(verdict.ok === false ? verdict.collidingKey : null, "brand");
  });

  it("looks the WHOLE ancestor chain, not just the immediate parent", () => {
    // gaming would inherit `brand` from electronics two levels up.
    const withGrandparentKey: CategoryNode[] = [
      node("electronics", ["brand"], [node("laptops", ["gpu"])]),
      node("loose", ["brand"]),
    ];
    const verdict = canMoveUnder(withGrandparentKey, "loose", "laptops");
    assert.equal(verdict.ok, false);
    assert.equal(verdict.ok === false ? verdict.collidingKey : null, "brand");
  });

  it("allows a move when no key overlaps", () => {
    assert.deepEqual(canMoveUnder(tree, "books", "media"), { ok: true });
  });
});

describe("canMoveUnder — overrides", () => {
  const withOverride: CategoryNode[] = [
    node("electronics", ["brand", "warranty"], [
      node("laptops", ["gpu"], [], { warranty: { required: true } }),
    ]),
    node("books", ["author"]),
  ];

  it("refuses a move that would strand an override", () => {
    // laptops overrides `warranty`, which books does not provide.
    const verdict = canMoveUnder(withOverride, "laptops", "books");
    assert.equal(verdict.ok, false);
    assert.equal(verdict.ok === false ? verdict.collidingKey : null, "warranty");
  });

  it("refuses a move to root when an override would be stranded", () => {
    assert.equal(canMoveUnder(withOverride, "laptops", null).ok, false);
  });

  it("allows the move when the target still provides the overridden key", () => {
    const shared: CategoryNode[] = [
      node("electronics", ["warranty"], [
        node("laptops", ["gpu"], [], { warranty: { required: true } }),
      ]),
      node("appliances", ["warranty"]),
    ];
    assert.deepEqual(canMoveUnder(shared, "laptops", "appliances"), { ok: true });
  });
});

describe("canMoveUnder — resilience", () => {
  it("reports a vanished node rather than throwing", () => {
    assert.equal(canMoveUnder(tree, "ghost", "books").ok, false);
  });

  it("handles an empty tree", () => {
    assert.equal(canMoveUnder([], "a", null).ok, false);
  });
});

describe("siblingsOf", () => {
  it("returns root nodes for a root", () => {
    assert.deepEqual(
      siblingsOf(tree, "books").map((n) => n.id),
      ["electronics", "books", "media"]
    );
  });

  it("returns the parent's children for a nested node", () => {
    assert.deepEqual(
      siblingsOf(tree, "laptops").map((n) => n.id),
      ["laptops"]
    );
  });
});

describe("reorderSiblings", () => {
  const siblings = [node("a"), node("b"), node("c")];

  it("moves a node down and renumbers everything from zero", () => {
    // Renumbering matters: seeded positions are often all 0, and
    // swapping two zeroes changes nothing visible.
    assert.deepEqual(reorderSiblings(siblings, "a", 1), [
      { id: "b", position: 0 },
      { id: "a", position: 1 },
      { id: "c", position: 2 },
    ]);
  });

  it("moves a node up", () => {
    assert.deepEqual(reorderSiblings(siblings, "c", -1), [
      { id: "a", position: 0 },
      { id: "c", position: 1 },
      { id: "b", position: 2 },
    ]);
  });

  it("refuses to move past the ends", () => {
    assert.equal(reorderSiblings(siblings, "a", -1), null);
    assert.equal(reorderSiblings(siblings, "c", 1), null);
  });

  it("returns null for an unknown node", () => {
    assert.equal(reorderSiblings(siblings, "zzz", 1), null);
  });
});

describe("previousSibling and outdentTarget", () => {
  it("finds the sibling ⌘→ would indent under", () => {
    assert.equal(previousSibling(tree, "books")?.id, "electronics");
  });

  it("returns null for the first sibling — nothing to indent under", () => {
    assert.equal(previousSibling(tree, "electronics"), null);
  });

  it("outdents to the grandparent", () => {
    assert.deepEqual(outdentTarget(tree, "gaming"), {
      targetId: "electronics",
      hasParent: true,
    });
  });

  it("outdents a first-level child to the root", () => {
    assert.deepEqual(outdentTarget(tree, "laptops"), { targetId: null, hasParent: true });
  });

  it("reports that a root node has nowhere to outdent to", () => {
    assert.deepEqual(outdentTarget(tree, "books"), { targetId: null, hasParent: false });
  });
});
