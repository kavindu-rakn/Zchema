import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  clearDraft,
  draftKey,
  peekDraft,
  readDraft,
  subscribeToDrafts,
  writeDraft,
} from "./drafts.ts";

/** Enough of the Storage interface for the module under test. */
function fakeStorage(overrides: Partial<Storage> = {}): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    ...overrides,
  } as Storage;
}

function install(storage: Storage | undefined) {
  Object.defineProperty(globalThis, "sessionStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
}

const original = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");

afterEach(() => {
  if (original) Object.defineProperty(globalThis, "sessionStorage", original);
  else Reflect.deleteProperty(globalThis, "sessionStorage");
});

describe("draftKey", () => {
  it("namespaces by kind so two editors cannot read each other's work", () => {
    assert.notEqual(draftKey("schema", "abc"), draftKey("blueprint", "abc"));
    assert.match(draftKey("schema", "abc"), /^zchema:draft:schema:abc$/);
  });
});

describe("drafts round trip", () => {
  beforeEach(() => install(fakeStorage()));

  it("reads back what it stored", () => {
    writeDraft("k", { fields: [{ key: "price" }] });
    assert.deepEqual(readDraft<{ fields: { key: string }[] }>("k"), {
      fields: [{ key: "price" }],
    });
  });

  it("reports nothing for a key never written", () => {
    assert.equal(readDraft("missing"), null);
    assert.equal(peekDraft("missing"), null);
  });

  it("forgets a cleared draft", () => {
    writeDraft("k", 1);
    clearDraft("k");
    assert.equal(readDraft("k"), null);
  });

  it("treats a corrupt draft as no draft rather than throwing", () => {
    install(fakeStorage({ getItem: () => "{not json" }));
    assert.equal(readDraft("k"), null);
  });
});

describe("drafts survive a hostile environment", () => {
  it("returns null when there is no storage at all (the server)", () => {
    install(undefined);
    assert.equal(readDraft("k"), null);
    assert.doesNotThrow(() => writeDraft("k", 1));
    assert.doesNotThrow(() => clearDraft("k"));
  });

  it("keeps working when the browser blocks storage", () => {
    install(
      fakeStorage({
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
        removeItem: () => {
          throw new Error("denied");
        },
      })
    );
    assert.equal(readDraft("k"), null);
    assert.doesNotThrow(() => writeDraft("k", 1));
    assert.doesNotThrow(() => clearDraft("k"));
  });

  it("swallows a quota error so editing continues", () => {
    install(
      fakeStorage({
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      })
    );
    assert.doesNotThrow(() => writeDraft("k", "x".repeat(10)));
    assert.equal(readDraft("k"), null);
  });
});

describe("subscribers", () => {
  beforeEach(() => install(fakeStorage()));

  it("hears about writes and clears, and stops after unsubscribing", () => {
    let calls = 0;
    const unsubscribe = subscribeToDrafts(() => {
      calls += 1;
    });

    writeDraft("k", 1);
    clearDraft("k");
    assert.equal(calls, 2);

    unsubscribe();
    writeDraft("k", 2);
    assert.equal(calls, 2);
  });

  it("still notifies when the write itself failed", () => {
    install(
      fakeStorage({
        setItem: () => {
          throw new Error("denied");
        },
      })
    );
    let called = false;
    const unsubscribe = subscribeToDrafts(() => {
      called = true;
    });
    writeDraft("k", 1);
    unsubscribe();
    assert.equal(called, true);
  });
});
