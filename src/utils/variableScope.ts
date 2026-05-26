import type { Collection, CollectionFolder, EnvVariable, Environment, RequestItem, Workspace } from "../types";

/**
 * Variable hierarchy / precedence (highest to lowest):
 *
 *   1. Transient (per-execution overrides from pre/post scripts)
 *   2. Environment (active environment's vars)
 *   3. Folder (innermost folder containing the request, walking outward)
 *   4. Collection (request's owning collection)
 *   5. Global (workspace.variables)
 *
 * Everything below the transient layer comes from on-disk state. This module
 * is responsible only for the bottom four layers. Transient overlay happens
 * in `requestPipeline.ts` after pre-scripts run, by mutating the returned
 * record before `substituteAll` consumes it.
 */

function applyVars(into: Record<string, string>, vars: EnvVariable[] | undefined) {
  if (!vars) return;
  for (const v of vars) {
    if (v.enabled && v.key) into[v.key] = v.value;
  }
}

/** Depth-first search to find the chain of folders leading to a request. */
function findFolderChain(
  folders: CollectionFolder[],
  requestId: string,
  trail: CollectionFolder[],
): CollectionFolder[] | null {
  for (const f of folders) {
    if (f.requests.some((r) => r.id === requestId)) {
      return [...trail, f];
    }
    const deeper = findFolderChain(f.folders, requestId, [...trail, f]);
    if (deeper) return deeper;
  }
  return null;
}

interface BuildContext {
  workspace: Workspace | null;
  collections: Collection[];
  environments: Environment[];
  /** The request whose variables we're resolving (used to find owning collection/folder). */
  request: RequestItem;
}

/**
 * Build the flat variable lookup map used by `substituteAll`. Higher-priority
 * scopes overwrite lower-priority ones via simple Object.assign-style overlay.
 *
 * Folder precedence is "innermost wins" — a variable defined on a leaf folder
 * shadows the same name on its parent. We do this by applying folder vars in
 * outer-to-inner order so the inner overwrite happens last.
 */
export function buildScopedVars(ctx: BuildContext): Record<string, string> {
  const out: Record<string, string> = {};

  // (5) Global — lowest priority
  applyVars(out, ctx.workspace?.variables);

  // (4) Collection
  const collection = ctx.request.collectionId
    ? ctx.collections.find((c) => c.id === ctx.request.collectionId)
    : undefined;
  if (collection) {
    applyVars(out, collection.variables);

    // (3) Folders — walk outer→inner so inner-most overrides win.
    const chain = findFolderChain(collection.folders, ctx.request.id, []);
    if (chain) {
      for (const folder of chain) {
        applyVars(out, folder.variables);
      }
    }
  }

  // (2) Environment — highest priority before transient overlay
  const activeEnvId = ctx.workspace?.active_environment_id;
  const activeEnv = activeEnvId
    ? ctx.environments.find((e) => e.id === activeEnvId)
    : undefined;
  if (activeEnv) {
    applyVars(out, activeEnv.variables);
  }

  return out;
}
