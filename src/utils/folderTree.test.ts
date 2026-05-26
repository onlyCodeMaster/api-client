import { describe, expect, it } from "vitest";
import type { Collection, CollectionFolder, CollectionRequest } from "../types";
import {
  addFolderTo,
  addRequestTo,
  createNewFolder,
  findFolderById,
  findFolderParent,
  findRequestParent,
  isFolderDescendantOf,
  moveFolder,
  moveRequest,
  removeFolder,
  removeRequest,
  renameFolder,
  renameRequest,
  reorderFoldersInContainer,
  reorderRequestsInContainer,
  takeFolder,
  takeRequest,
} from "./folderTree";

const makeRequest = (id: string, name = `req-${id}`): CollectionRequest => ({
  id,
  name,
  method: "GET",
  url: `https://example.com/${id}`,
  headers: [],
  params: [],
  body: "",
  body_type: "none",
  created_at: 1,
  updated_at: 1,
});

const makeFolder = (
  id: string,
  name = `folder-${id}`,
  opts: { requests?: CollectionRequest[]; folders?: CollectionFolder[] } = {},
): CollectionFolder => ({
  id,
  name,
  requests: opts.requests ?? [],
  folders: opts.folders ?? [],
});

const makeCollection = (
  opts: {
    requests?: CollectionRequest[];
    folders?: CollectionFolder[];
  } = {},
): Collection => ({
  id: "col1",
  name: "Col",
  description: "",
  requests: opts.requests ?? [],
  folders: opts.folders ?? [],
  created_at: 1,
  updated_at: 1,
});

describe("createNewFolder", () => {
  it("generates a folder with a unique id and empty children", () => {
    const a = createNewFolder("Apis");
    const b = createNewFolder("Apis");
    expect(a.name).toBe("Apis");
    expect(a.requests).toEqual([]);
    expect(a.folders).toEqual([]);
    expect(a.id).not.toBe(b.id);
  });
});

describe("findFolderById", () => {
  it("finds nested folders at any depth", () => {
    const col = makeCollection({
      folders: [
        makeFolder("f1", "F1", {
          folders: [makeFolder("f2", "F2", { folders: [makeFolder("f3", "F3")] })],
        }),
      ],
    });
    expect(findFolderById(col, "f3")?.name).toBe("F3");
    expect(findFolderById(col, "missing")).toBeNull();
  });
});

describe("findFolderParent / findRequestParent", () => {
  it("identifies root vs nested containers", () => {
    const col = makeCollection({
      requests: [makeRequest("r1")],
      folders: [
        makeFolder("f1", "F1", {
          requests: [makeRequest("r2")],
          folders: [makeFolder("f2", "F2")],
        }),
      ],
    });
    expect(findRequestParent(col, "r1")).toEqual({ kind: "root" });
    expect(findRequestParent(col, "r2")).toEqual({ kind: "folder", folderId: "f1" });
    expect(findRequestParent(col, "nope")).toBeNull();

    expect(findFolderParent(col, "f1")).toEqual({ kind: "root" });
    expect(findFolderParent(col, "f2")).toEqual({ kind: "folder", folderId: "f1" });
    expect(findFolderParent(col, "missing")).toBeNull();
  });
});

describe("isFolderDescendantOf", () => {
  it("returns true for self, direct, and transitive descendants", () => {
    const col = makeCollection({
      folders: [
        makeFolder("a", "A", {
          folders: [makeFolder("b", "B", { folders: [makeFolder("c", "C")] })],
        }),
      ],
    });
    expect(isFolderDescendantOf(col, "a", "a")).toBe(true);
    expect(isFolderDescendantOf(col, "b", "a")).toBe(true);
    expect(isFolderDescendantOf(col, "c", "a")).toBe(true);
    expect(isFolderDescendantOf(col, "c", "b")).toBe(true);
    expect(isFolderDescendantOf(col, "a", "b")).toBe(false);
  });
});

describe("addFolderTo / addRequestTo", () => {
  it("appends to root", () => {
    const col = makeCollection();
    const withFolder = addFolderTo(col, { kind: "root" }, makeFolder("f1"));
    expect(withFolder.folders.map((f) => f.id)).toEqual(["f1"]);
    const withReq = addRequestTo(withFolder, { kind: "root" }, makeRequest("r1"));
    expect(withReq.requests.map((r) => r.id)).toEqual(["r1"]);
  });

  it("appends into a named folder", () => {
    const col = makeCollection({ folders: [makeFolder("f1")] });
    const next = addRequestTo(col, { kind: "folder", folderId: "f1" }, makeRequest("r1"));
    expect(next.folders[0].requests.map((r) => r.id)).toEqual(["r1"]);
  });
});

describe("removeRequest", () => {
  it("removes a request from the root", () => {
    const col = makeCollection({
      requests: [makeRequest("r1"), makeRequest("r2")],
    });
    const next = removeRequest(col, "r1");
    expect(next.requests.map((r) => r.id)).toEqual(["r2"]);
  });
  it("removes a request from inside a nested folder", () => {
    const col = makeCollection({
      folders: [
        makeFolder("f1", "F1", {
          requests: [makeRequest("r1")],
          folders: [
            makeFolder("f2", "F2", {
              requests: [makeRequest("r2"), makeRequest("r3")],
            }),
          ],
        }),
      ],
    });
    const next = removeRequest(col, "r2");
    expect(next.folders[0].folders[0].requests.map((r) => r.id)).toEqual(["r3"]);
    // Other branches untouched.
    expect(next.folders[0].requests.map((r) => r.id)).toEqual(["r1"]);
  });
});

describe("renameRequest", () => {
  it("renames a request at the root", () => {
    const col = makeCollection({ requests: [makeRequest("r1", "Old")] });
    const next = renameRequest(col, "r1", "New");
    expect(next.requests[0].name).toBe("New");
    expect(next.requests[0].updated_at).toBeGreaterThanOrEqual(col.requests[0].updated_at);
  });
  it("renames a request inside a nested folder", () => {
    const col = makeCollection({
      folders: [
        makeFolder("f1", "F1", {
          folders: [
            makeFolder("f2", "F2", { requests: [makeRequest("r1", "Old")] }),
          ],
        }),
      ],
    });
    const next = renameRequest(col, "r1", "New");
    expect(next.folders[0].folders[0].requests[0].name).toBe("New");
  });
  it("is a no-op if the id is missing", () => {
    const col = makeCollection({ requests: [makeRequest("r1", "Old")] });
    const next = renameRequest(col, "missing", "New");
    expect(next.requests[0].name).toBe("Old");
  });
});

describe("removeFolder / renameFolder", () => {
  it("removes a folder from anywhere in the tree", () => {
    const col = makeCollection({
      folders: [makeFolder("f1", "F1", { folders: [makeFolder("f2")] })],
    });
    const next = removeFolder(col, "f2");
    expect(next.folders[0].folders).toEqual([]);
  });
  it("renames a folder by id", () => {
    const col = makeCollection({ folders: [makeFolder("f1", "Old")] });
    const next = renameFolder(col, "f1", "New");
    expect(next.folders[0].name).toBe("New");
  });
});

describe("takeRequest / takeFolder", () => {
  it("pops a request and removes it from the source", () => {
    const col = makeCollection({
      folders: [makeFolder("f1", "F1", { requests: [makeRequest("r1")] })],
    });
    const popped = takeRequest(col, "r1");
    expect(popped).not.toBeNull();
    expect(popped!.request.id).toBe("r1");
    expect(popped!.collection.folders[0].requests).toEqual([]);
  });
  it("pops a folder and removes it from the source", () => {
    const col = makeCollection({
      folders: [
        makeFolder("f1", "F1", { folders: [makeFolder("f2", "F2")] }),
      ],
    });
    const popped = takeFolder(col, "f2");
    expect(popped!.folder.id).toBe("f2");
    expect(popped!.collection.folders[0].folders).toEqual([]);
  });
});

describe("reorderFoldersInContainer / reorderRequestsInContainer", () => {
  it("reorders sibling folders at root", () => {
    const col = makeCollection({
      folders: [makeFolder("a"), makeFolder("b"), makeFolder("c")],
    });
    const next = reorderFoldersInContainer(col, "c", "a");
    expect(next.folders.map((f) => f.id)).toEqual(["c", "a", "b"]);
  });
  it("refuses to reorder when ids live in different containers", () => {
    const col = makeCollection({
      folders: [
        makeFolder("a"),
        makeFolder("b", "B", { folders: [makeFolder("c")] }),
      ],
    });
    const next = reorderFoldersInContainer(col, "a", "c");
    expect(next).toBe(col);
  });
  it("reorders sibling requests at root", () => {
    const col = makeCollection({
      requests: [makeRequest("a"), makeRequest("b"), makeRequest("c")],
    });
    const next = reorderRequestsInContainer(col, "a", "c");
    expect(next.requests.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });
});

describe("moveRequest / moveFolder", () => {
  it("moves a request from root into a folder", () => {
    const col = makeCollection({
      requests: [makeRequest("r1")],
      folders: [makeFolder("f1")],
    });
    const next = moveRequest(col, "r1", { kind: "folder", folderId: "f1" });
    expect(next.requests).toEqual([]);
    expect(next.folders[0].requests.map((r) => r.id)).toEqual(["r1"]);
  });
  it("moves a folder into another folder", () => {
    const col = makeCollection({
      folders: [makeFolder("a"), makeFolder("b")],
    });
    const next = moveFolder(col, "a", { kind: "folder", folderId: "b" });
    expect(next.folders.map((f) => f.id)).toEqual(["b"]);
    expect(next.folders[0].folders.map((f) => f.id)).toEqual(["a"]);
  });
  it("refuses to move a folder into its own descendant", () => {
    const col = makeCollection({
      folders: [
        makeFolder("a", "A", { folders: [makeFolder("b")] }),
      ],
    });
    const next = moveFolder(col, "a", { kind: "folder", folderId: "b" });
    expect(next).toBe(col);
  });
});
