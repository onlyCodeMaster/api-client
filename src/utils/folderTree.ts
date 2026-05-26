/**
 * Pure helpers for navigating and mutating a `Collection`'s folder tree.
 *
 * `Collection` is a recursive tree: `Collection -> folders[] -> requests[]`
 * where each `CollectionFolder` may itself have nested `folders[]`. These
 * helpers return *new* collection/folder objects (never mutate the input)
 * so the request store can swap them in via shallow `set`.
 *
 * Every function here is exhaustively typed against the existing types in
 * `src/types`. The store is the only intended caller — keeping the
 * tree-walking logic in one place makes future operations (move-between-
 * collections, multi-select, …) easier to add.
 */

import type { Collection, CollectionFolder, CollectionRequest } from "../types";

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

/** Build an empty folder with a fresh id and the given name. */
export function createNewFolder(name: string): CollectionFolder {
  return {
    id: generateId(),
    name,
    requests: [],
    folders: [],
  };
}

/** Locate a folder by id anywhere in the tree. Returns `null` if missing. */
export function findFolderById(
  collection: Collection,
  folderId: string,
): CollectionFolder | null {
  const walk = (folders: CollectionFolder[]): CollectionFolder | null => {
    for (const f of folders) {
      if (f.id === folderId) return f;
      const nested = walk(f.folders);
      if (nested) return nested;
    }
    return null;
  };
  return walk(collection.folders);
}

/** A node's location within a collection: either the collection root or a
 *  specific folder identified by id. */
export type NodeContainer =
  | { kind: "root" }
  | { kind: "folder"; folderId: string };

/** Find the parent container of a folder. Returns `null` if the folder
 *  doesn't exist in the tree. */
export function findFolderParent(
  collection: Collection,
  folderId: string,
): NodeContainer | null {
  if (collection.folders.some((f) => f.id === folderId)) return { kind: "root" };
  const walk = (parent: CollectionFolder): NodeContainer | null => {
    if (parent.folders.some((f) => f.id === folderId)) {
      return { kind: "folder", folderId: parent.id };
    }
    for (const f of parent.folders) {
      const nested = walk(f);
      if (nested) return nested;
    }
    return null;
  };
  for (const top of collection.folders) {
    const found = walk(top);
    if (found) return found;
  }
  return null;
}

/** Find the parent container of a request. Returns `null` if the request
 *  doesn't exist. */
export function findRequestParent(
  collection: Collection,
  requestId: string,
): NodeContainer | null {
  if (collection.requests.some((r) => r.id === requestId)) return { kind: "root" };
  const walk = (parent: CollectionFolder): NodeContainer | null => {
    if (parent.requests.some((r) => r.id === requestId)) {
      return { kind: "folder", folderId: parent.id };
    }
    for (const f of parent.folders) {
      const nested = walk(f);
      if (nested) return nested;
    }
    return null;
  };
  for (const top of collection.folders) {
    const found = walk(top);
    if (found) return found;
  }
  return null;
}

/** True if `descendantFolderId` is `ancestorFolderId` itself or sits inside
 *  it at any depth. Used to prevent moving a folder into its own subtree. */
export function isFolderDescendantOf(
  collection: Collection,
  descendantFolderId: string,
  ancestorFolderId: string,
): boolean {
  if (descendantFolderId === ancestorFolderId) return true;
  const ancestor = findFolderById(collection, ancestorFolderId);
  if (!ancestor) return false;
  const walk = (folders: CollectionFolder[]): boolean => {
    for (const f of folders) {
      if (f.id === descendantFolderId) return true;
      if (walk(f.folders)) return true;
    }
    return false;
  };
  return walk(ancestor.folders);
}

/** Apply a transform to every folder in the tree, preserving structure. */
function mapFolders(
  folders: CollectionFolder[],
  fn: (f: CollectionFolder) => CollectionFolder,
): CollectionFolder[] {
  return folders.map((f) => {
    const transformed = fn(f);
    return { ...transformed, folders: mapFolders(transformed.folders, fn) };
  });
}

/** Insert `folder` into a container. Appends at the end. */
export function addFolderTo(
  collection: Collection,
  container: NodeContainer,
  folder: CollectionFolder,
): Collection {
  if (container.kind === "root") {
    return { ...collection, folders: [...collection.folders, folder] };
  }
  return {
    ...collection,
    folders: mapFolders(collection.folders, (f) =>
      f.id === container.folderId ? { ...f, folders: [...f.folders, folder] } : f,
    ),
  };
}

/** Remove a folder from the tree by id. No-op if not found. */
export function removeFolder(
  collection: Collection,
  folderId: string,
): Collection {
  const removeFromList = (folders: CollectionFolder[]): CollectionFolder[] =>
    folders
      .filter((f) => f.id !== folderId)
      .map((f) => ({ ...f, folders: removeFromList(f.folders) }));
  return { ...collection, folders: removeFromList(collection.folders) };
}

/** Rename a folder by id. No-op if not found. */
export function renameFolder(
  collection: Collection,
  folderId: string,
  name: string,
): Collection {
  return {
    ...collection,
    folders: mapFolders(collection.folders, (f) =>
      f.id === folderId ? { ...f, name } : f,
    ),
  };
}

/** Insert `request` into a container. Appends at the end. */
export function addRequestTo(
  collection: Collection,
  container: NodeContainer,
  request: CollectionRequest,
): Collection {
  if (container.kind === "root") {
    return { ...collection, requests: [...collection.requests, request] };
  }
  return {
    ...collection,
    folders: mapFolders(collection.folders, (f) =>
      f.id === container.folderId
        ? { ...f, requests: [...f.requests, request] }
        : f,
    ),
  };
}

/** Remove a request from anywhere in the tree by id. No-op if not found. */
export function removeRequest(
  collection: Collection,
  requestId: string,
): Collection {
  return {
    ...collection,
    requests: collection.requests.filter((r) => r.id !== requestId),
    folders: mapFolders(collection.folders, (f) => ({
      ...f,
      requests: f.requests.filter((r) => r.id !== requestId),
    })),
  };
}

/** Pop a request from the tree, returning the new collection and the
 *  popped node. Returns `null` if the request isn't found. */
export function takeRequest(
  collection: Collection,
  requestId: string,
): { collection: Collection; request: CollectionRequest } | null {
  const direct = collection.requests.find((r) => r.id === requestId);
  if (direct) {
    return {
      collection: { ...collection, requests: collection.requests.filter((r) => r.id !== requestId) },
      request: direct,
    };
  }
  let popped: CollectionRequest | null = null;
  const walk = (folders: CollectionFolder[]): CollectionFolder[] =>
    folders.map((f) => {
      const found = f.requests.find((r) => r.id === requestId);
      if (found && !popped) {
        popped = found;
        return { ...f, requests: f.requests.filter((r) => r.id !== requestId) };
      }
      return { ...f, folders: walk(f.folders) };
    });
  const nextFolders = walk(collection.folders);
  if (!popped) return null;
  return { collection: { ...collection, folders: nextFolders }, request: popped };
}

/** Pop a folder from the tree, returning the new collection and the popped
 *  folder (with its full subtree intact). Returns `null` if not found. */
export function takeFolder(
  collection: Collection,
  folderId: string,
): { collection: Collection; folder: CollectionFolder } | null {
  let popped: CollectionFolder | null = null;
  const walk = (folders: CollectionFolder[]): CollectionFolder[] => {
    const filtered: CollectionFolder[] = [];
    for (const f of folders) {
      if (f.id === folderId && !popped) {
        popped = f;
      } else {
        filtered.push({ ...f, folders: walk(f.folders) });
      }
    }
    return filtered;
  };
  const nextFolders = walk(collection.folders);
  if (!popped) return null;
  return { collection: { ...collection, folders: nextFolders }, folder: popped };
}

/** Reorder folders within their current container. Both ids must live in
 *  the same container, otherwise this is a no-op. */
export function reorderFoldersInContainer(
  collection: Collection,
  fromFolderId: string,
  toFolderId: string,
): Collection {
  const fromParent = findFolderParent(collection, fromFolderId);
  const toParent = findFolderParent(collection, toFolderId);
  if (!fromParent || !toParent) return collection;
  if (fromParent.kind !== toParent.kind) return collection;
  if (
    fromParent.kind === "folder" &&
    toParent.kind === "folder" &&
    fromParent.folderId !== toParent.folderId
  ) {
    return collection;
  }
  const reorder = (list: CollectionFolder[]): CollectionFolder[] => {
    const from = list.findIndex((f) => f.id === fromFolderId);
    const to = list.findIndex((f) => f.id === toFolderId);
    if (from === -1 || to === -1 || from === to) return list;
    const copy = [...list];
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved);
    return copy;
  };
  if (fromParent.kind === "root") {
    return { ...collection, folders: reorder(collection.folders) };
  }
  return {
    ...collection,
    folders: mapFolders(collection.folders, (f) =>
      f.id === fromParent.folderId ? { ...f, folders: reorder(f.folders) } : f,
    ),
  };
}

/** Reorder requests within their current container. */
export function reorderRequestsInContainer(
  collection: Collection,
  fromRequestId: string,
  toRequestId: string,
): Collection {
  const fromParent = findRequestParent(collection, fromRequestId);
  const toParent = findRequestParent(collection, toRequestId);
  if (!fromParent || !toParent) return collection;
  if (fromParent.kind !== toParent.kind) return collection;
  if (
    fromParent.kind === "folder" &&
    toParent.kind === "folder" &&
    fromParent.folderId !== toParent.folderId
  ) {
    return collection;
  }
  const reorder = (list: CollectionRequest[]): CollectionRequest[] => {
    const from = list.findIndex((r) => r.id === fromRequestId);
    const to = list.findIndex((r) => r.id === toRequestId);
    if (from === -1 || to === -1 || from === to) return list;
    const copy = [...list];
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved);
    return copy;
  };
  if (fromParent.kind === "root") {
    return { ...collection, requests: reorder(collection.requests) };
  }
  return {
    ...collection,
    folders: mapFolders(collection.folders, (f) =>
      f.id === fromParent.folderId ? { ...f, requests: reorder(f.requests) } : f,
    ),
  };
}

/** Move a request from its current location to a target container. */
export function moveRequest(
  collection: Collection,
  requestId: string,
  target: NodeContainer,
): Collection {
  const popped = takeRequest(collection, requestId);
  if (!popped) return collection;
  return addRequestTo(popped.collection, target, popped.request);
}

/** Move a folder (and its subtree) to a target container. No-op if the
 *  target sits inside the folder being moved (would create a cycle). */
export function moveFolder(
  collection: Collection,
  folderId: string,
  target: NodeContainer,
): Collection {
  if (target.kind === "folder" && isFolderDescendantOf(collection, target.folderId, folderId)) {
    return collection;
  }
  const popped = takeFolder(collection, folderId);
  if (!popped) return collection;
  return addFolderTo(popped.collection, target, popped.folder);
}
