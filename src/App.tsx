import { useEffect, useState } from "react";
import {
  downloadFile,
  exportCurl,
  importCurl,
  importPostmanCollection,
  listenBridgeEvents,
  loadBootstrapState,
  saveEnvironment,
  saveRequest,
  saveSecret,
  uploadFile,
  type BridgeEvent,
} from "./lib/tauri";
import {
  useRequestStore,
  type RequestMethod,
  type RequestRecord,
} from "./store/requestStore";
import { useUiStore } from "./store/uiStore";

const requestTabs = [
  { key: "params", label: "Params" },
  { key: "headers", label: "Headers" },
  { key: "body", label: "Body" },
  { key: "auth", label: "Auth" },
] as const;

const responseTabs = [
  { key: "body", label: "Body" },
  { key: "headers", label: "Headers" },
  { key: "timeline", label: "Timeline" },
] as const;

const sidebarPanels = [
  { key: "collections", short: "CO", label: "Collections", caption: "Workspace Explorer" },
  { key: "history", short: "HI", label: "History", caption: "Recent Requests" },
  { key: "environments", short: "EN", label: "Environments", caption: "Variables and Secrets" },
  { key: "settings", short: "ST", label: "Settings", caption: "Local Runtime" },
] as const;

const requestMethods: RequestMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];

function commandErrorMessage(error: unknown, action: string) {
  if (error instanceof Error) {
    if (error.message.includes("reading 'invoke'")) {
      return `${action} requires the Tauri desktop runtime.`;
    }

    return error.message;
  }

  return `Failed to ${action.toLowerCase()}.`;
}

function safePathname(url: string) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function formatBytes(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return "0 B";
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRuntimeTimestamp(timestamp: string) {
  if (!timestamp) {
    return "Not written yet";
  }

  const parsed = Number(timestamp);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return timestamp;
  }

  return new Date(parsed).toLocaleString();
}

function resolveHistoryRequestId(
  historyItem: {
    requestId: string;
    method: string;
    url: string;
  },
  requests: RequestRecord[],
) {
  if (historyItem.requestId && requests.some((request) => request.id === historyItem.requestId)) {
    return historyItem.requestId;
  }

  const pathname = safePathname(historyItem.url);
  const matched = requests.find(
    (request) =>
      request.method === historyItem.method && safePathname(request.url) === pathname,
  );

  return matched?.id ?? requests[0]?.id ?? "";
}

function normalizeRows(
  rows: Array<{ key: string; value: string; enabled: boolean }>,
  prefix: string,
) {
  return rows.map((row, index) => ({
    id: `${prefix}-${index + 1}-${row.key || "row"}`,
    key: row.key,
    value: row.value,
    enabled: row.enabled,
  }));
}

export default function App() {
  const {
    activeSidebarPanel,
    requestTab,
    responseTab,
    setActiveSidebarPanel,
    setRequestTab,
    setResponseTab,
  } = useUiStore();
  const {
    requests,
    environments,
    history,
    activeRequestId,
    activeEnvironmentId,
    response,
    bootstrap,
    isSending,
    lastError,
    setActiveRequest,
    setActiveEnvironment,
    updateEnvironmentVar,
    replaceEnvironment,
    replaceRequest,
    upsertRequests,
    upsertSecretStatus,
    applyBootstrap,
    updateRequestMethod,
    updateRequestUrl,
    updateRequestBody,
    updateAuthType,
    updateAuthToken,
    updateParamRow,
    updateHeaderRow,
    toggleParamRow,
    toggleHeaderRow,
    addParamRow,
    addHeaderRow,
    sendActiveRequest,
  } = useRequestStore();
  const [isSavingRequest, setIsSavingRequest] = useState(false);
  const [isSavingEnvironment, setIsSavingEnvironment] = useState(false);
  const [isSavingSecret, setIsSavingSecret] = useState<string | null>(null);
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({});
  const [expandedCollections, setExpandedCollections] = useState<Record<string, boolean>>({});
  const [bridgeEvents, setBridgeEvents] = useState<BridgeEvent[]>([]);
  const [isBridgeListenerReady, setIsBridgeListenerReady] = useState(false);
  const [isCurlPanelOpen, setIsCurlPanelOpen] = useState(false);
  const [curlInput, setCurlInput] = useState(
    "curl -X GET 'https://api.example.com/v1/workspaces?page=1' -H 'Accept: application/json'",
  );
  const [curlOutput, setCurlOutput] = useState("");
  const [curlMessage, setCurlMessage] = useState("");
  const [isPostmanPanelOpen, setIsPostmanPanelOpen] = useState(false);
  const [postmanInput, setPostmanInput] = useState(`{
  "info": { "name": "Imported API" },
  "item": [
    {
      "name": "GET /health",
      "request": {
        "method": "GET",
        "url": "https://api.example.com/v1/health",
        "header": [
          { "key": "Accept", "value": "application/json" }
        ]
      }
    }
  ]
}`);
  const [postmanMessage, setPostmanMessage] = useState("");
  const [isTransferPanelOpen, setIsTransferPanelOpen] = useState(false);
  const [uploadPath, setUploadPath] = useState("/tmp/api-client-upload.txt");
  const [uploadFieldName, setUploadFieldName] = useState("file");
  const [downloadUrl, setDownloadUrl] = useState("{{base_url}}/v1/files/report.json");
  const [downloadPath, setDownloadPath] = useState("/tmp/api-client-download.json");
  const [allowDownloadOverwrite, setAllowDownloadOverwrite] = useState(false);
  const [transferMessage, setTransferMessage] = useState("");

  const activeRequest =
    requests.find((request) => request.id === activeRequestId) ?? requests[0];
  const activeEnvironment =
    environments.find((environment) => environment.id === activeEnvironmentId) ??
    environments[0];
  const activePanelMeta =
    sidebarPanels.find((panel) => panel.key === activeSidebarPanel) ?? sidebarPanels[0];
  const activeBaseUrl =
    activeEnvironment.vars.find((item) => item.key === "base_url")?.value ?? "n/a";
  const activeCookieJar =
    activeEnvironment.vars.find((item) => item.key === "cookie_jar")?.value ?? "default";
  const activeProxy =
    activeEnvironment.vars.find((item) => item.key === "proxy")?.value ?? "system";
  const collectionSections = Array.from(
    requests.reduce<Map<string, { title: string; subtitle: string; requests: RequestRecord[] }>>(
      (state, request) => {
        const existing = state.get(request.collection);
        const pathParts = request.collectionFile.split("/");
        const subtitle = pathParts[pathParts.length - 1] ?? request.collectionFile;

        if (existing) {
          existing.requests.push(request);
          return state;
        }

        state.set(request.collection, {
          title: request.collection,
          subtitle,
          requests: [request],
        });
        return state;
      },
      new Map(),
    ).values(),
  );
  const sidebarItemCount =
    activeSidebarPanel === "collections"
      ? requests.length
      : activeSidebarPanel === "history"
        ? history.length
        : activeSidebarPanel === "environments"
          ? environments.length
          : 3;

  useEffect(() => {
    setExpandedCollections((current) => {
      let hasChanges = false;
      const next = { ...current };
      for (const section of collectionSections) {
        if (!(section.title in next)) {
          next[section.title] = true;
          hasChanges = true;
        }
      }
      return hasChanges ? next : current;
    });
  }, [collectionSections]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void listenBridgeEvents((event) => {
      if (cancelled) {
        return;
      }

      setBridgeEvents((current) => [event, ...current].slice(0, 8));
    })
      .then((unsubscribe) => {
        if (cancelled) {
          unsubscribe();
          return;
        }

        unlisten = unsubscribe;
        setIsBridgeListenerReady(true);
      })
      .catch(() => {
        // Event listening is only available inside the Tauri runtime.
        if (!cancelled) {
          setIsBridgeListenerReady(true);
        }
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isBridgeListenerReady) {
      return;
    }

    let cancelled = false;

    void loadBootstrapState()
      .then((state) => {
        if (cancelled) {
          return;
        }

        const requestCatalog = useRequestStore.getState().requests;

        applyBootstrap({
          appDataDir: state.paths.appDataDir,
          databasePath: state.paths.databasePath,
          environmentsDir: state.paths.environmentsDir,
          cacheDir: state.paths.cacheDir,
          logsDir: state.paths.logsDir,
          recentWorkspace: state.settings.recentWorkspace,
          runtime: state.runtime,
          history: state.history.map((item) => ({
            id: `history-db-${item.id}`,
            title: `${item.method} ${safePathname(item.url)}`,
            meta: `${item.status} / ${item.durationMs}ms / ${item.createdAt}`,
            requestId: resolveHistoryRequestId(item, requestCatalog),
          })),
          collections: state.collections.flatMap((collection) =>
            collection.requests.map((request) => ({
              id: request.id,
              name: request.name,
              collection: request.collection,
              collectionFile: request.collectionFile,
              method: request.method as RequestMethod,
              url: request.url,
              params: normalizeRows(request.params, `${request.id}-param`),
              headers: normalizeRows(request.headers, `${request.id}-header`),
              body: request.body,
              authType: request.authType as "none" | "bearer",
              authToken: request.authToken,
            })),
          ),
          environments: state.environments.map((item, index) => ({
            id: `env-db-${index}`,
            name: item.name,
            source: item.filePath,
            vars: item.vars,
          })),
          secrets: state.secrets,
        });
      })
      .catch(() => {
        // Seeded frontend state remains available outside Tauri runtime.
      });

    return () => {
      cancelled = true;
    };
  }, [applyBootstrap, isBridgeListenerReady]);

  const toggleCollection = (title: string) => {
    setExpandedCollections((current) => ({
      ...current,
      [title]: !current[title],
    }));
  };
  const workspaceMode = activeSidebarPanel;
  const handleSidebarPanelChange = (panel: (typeof sidebarPanels)[number]["key"]) => {
    setActiveSidebarPanel(panel);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSaveEnvironment = async () => {
    setIsSavingEnvironment(true);
    try {
      const saved = await saveEnvironment({
        name: activeEnvironment.name,
        filePath: activeEnvironment.source,
        vars: activeEnvironment.vars,
      });

      replaceEnvironment({
        id: activeEnvironment.id,
        name: saved.name,
        source: saved.filePath,
        vars: saved.vars,
      });
    } finally {
      setIsSavingEnvironment(false);
    }
  };

  const handleSaveRequest = async () => {
    if (!activeRequest) {
      return;
    }

    setIsSavingRequest(true);
    try {
      const saved = await saveRequest({
        id: activeRequest.id,
        name: activeRequest.name,
        collection: activeRequest.collection,
        collectionFile: activeRequest.collectionFile,
        method: activeRequest.method,
        url: activeRequest.url,
        params: activeRequest.params,
        headers: activeRequest.headers,
        body: activeRequest.body,
        authType: activeRequest.authType,
        authToken: activeRequest.authToken,
      });

      const savedRequest = saved.requests.find((request) => request.id === activeRequest.id);
      if (savedRequest) {
        replaceRequest({
          id: savedRequest.id,
          name: savedRequest.name,
          collection: savedRequest.collection,
          collectionFile: savedRequest.collectionFile,
          method: savedRequest.method as RequestMethod,
          url: savedRequest.url,
          params: normalizeRows(savedRequest.params, `${savedRequest.id}-param`),
          headers: normalizeRows(savedRequest.headers, `${savedRequest.id}-header`),
          body: savedRequest.body,
          authType: savedRequest.authType as "none" | "bearer",
          authToken: savedRequest.authToken,
        });
      }
    } finally {
      setIsSavingRequest(false);
    }
  };

  const handleSecretDraftChange = (name: string, value: string) => {
    setSecretDrafts((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleSaveSecret = async (name: string) => {
    const value = secretDrafts[name]?.trim() ?? "";
    if (!value) {
      return;
    }

    setIsSavingSecret(name);
    try {
      const saved = await saveSecret({ name, value });
      upsertSecretStatus(saved);
      setSecretDrafts((current) => ({
        ...current,
        [name]: "",
      }));
    } finally {
      setIsSavingSecret(null);
    }
  };

  const handleImportCurl = async () => {
    if (!activeRequest) {
      return;
    }

    setCurlMessage("Importing cURL...");
    try {
      const imported = await importCurl({
        command: curlInput,
        requestId: activeRequest.id,
        collection: activeRequest.collection,
        collectionFile: activeRequest.collectionFile,
      });
      const method = imported.method.toUpperCase();
      if (!requestMethods.includes(method as RequestMethod)) {
        setCurlMessage(`Imported method ${method} is not supported by the editor yet.`);
        return;
      }

      replaceRequest({
        id: imported.id,
        name: imported.name,
        collection: imported.collection,
        collectionFile: imported.collectionFile,
        method: method as RequestMethod,
        url: imported.url,
        params: normalizeRows(imported.params, `${imported.id}-param`),
        headers: normalizeRows(imported.headers, `${imported.id}-header`),
        body: imported.body,
        authType: imported.authType as "none" | "bearer",
        authToken: imported.authToken,
      });
      setCurlMessage("Imported into the active request. Use Save to persist it.");
      setIsCurlPanelOpen(true);
    } catch (error) {
      setCurlMessage(commandErrorMessage(error, "Import cURL"));
    }
  };

  const handleExportCurl = async () => {
    if (!activeRequest) {
      return;
    }

    setCurlMessage("Exporting active request...");
    try {
      const command = await exportCurl({
        method: activeRequest.method,
        url: activeRequest.url,
        params: activeRequest.params,
        headers: activeRequest.headers,
        body: activeRequest.body,
        authType: activeRequest.authType,
        authToken: activeRequest.authToken,
      });
      setCurlOutput(command);
      setCurlMessage("Exported cURL command from the active request.");
      setIsCurlPanelOpen(true);
    } catch (error) {
      setCurlMessage(commandErrorMessage(error, "Export cURL"));
    }
  };

  const handleImportPostman = async () => {
    if (!activeRequest) {
      return;
    }

    setPostmanMessage("Importing Postman collection...");
    try {
      const importedRequests = await importPostmanCollection({
        collection: activeRequest.collection,
        collectionFile: `collections/postman-${Date.now()}.json`,
        collectionJson: postmanInput,
      });
      const supportedRequests = importedRequests.filter((request) =>
        requestMethods.includes(request.method.toUpperCase() as RequestMethod),
      );

      if (supportedRequests.length === 0) {
        setPostmanMessage("No supported requests found in the Postman collection.");
        return;
      }

      upsertRequests(
        supportedRequests.map((request) => ({
          id: request.id,
          name: request.name,
          collection: request.collection,
          collectionFile: request.collectionFile,
          method: request.method.toUpperCase() as RequestMethod,
          url: request.url,
          params: normalizeRows(request.params, `${request.id}-param`),
          headers: normalizeRows(request.headers, `${request.id}-header`),
          body: request.body,
          authType: request.authType as "none" | "bearer",
          authToken: request.authToken,
        })),
      );
      setPostmanMessage(
        `Imported ${supportedRequests.length} requests. Use Save on each request to persist edits.`,
      );
    } catch (error) {
      setPostmanMessage(commandErrorMessage(error, "Import Postman"));
    }
  };

  const handleUploadFile = async () => {
    if (!activeRequest || !activeEnvironment) {
      return;
    }

    setTransferMessage("Uploading file...");
    try {
      const result = await uploadFile({
        url: activeRequest.url,
        filePath: uploadPath,
        fieldName: uploadFieldName,
        headers: activeRequest.headers,
        environment: {
          name: activeEnvironment.name,
          filePath: activeEnvironment.source,
          vars: activeEnvironment.vars,
        },
      });
      setTransferMessage(
        `Uploaded ${result.fileName} (${result.sizeBytes} bytes): ${result.status}`,
      );
    } catch (error) {
      setTransferMessage(commandErrorMessage(error, "Upload file"));
    }
  };

  const handleDownloadFile = async () => {
    if (!activeEnvironment) {
      return;
    }

    setTransferMessage("Downloading file...");
    try {
      const result = await downloadFile({
        url: downloadUrl,
        destinationPath: downloadPath,
        overwrite: allowDownloadOverwrite,
        headers: activeRequest.headers,
        environment: {
          name: activeEnvironment.name,
          filePath: activeEnvironment.source,
          vars: activeEnvironment.vars,
        },
      });
      setTransferMessage(
        `Downloaded ${result.sizeBytes} bytes to ${result.destinationPath}: ${result.status}`,
      );
    } catch (error) {
      setTransferMessage(commandErrorMessage(error, "Download file"));
    }
  };

  return (
    <main className="postman-shell">
      <header className="postman-topbar">
        <div className="postman-topbar__brand">
          <div className="postman-logo">AC</div>
          <div>
            <strong>API Client</strong>
            <span>Workspace: {bootstrap.recentWorkspace || "default-workspace"}</span>
          </div>
        </div>

        <div className="postman-topbar__center">
          {requests.map((request) => (
            <button
              key={request.id}
              type="button"
              className={`top-tab ${request.id === activeRequestId ? "is-active" : ""}`}
              onClick={() => setActiveRequest(request.id)}
            >
              {request.name}
            </button>
          ))}
        </div>

        <div className="postman-topbar__actions">
          <span className={`status-dot ${bootstrap.loaded ? "is-live" : ""}`}>
            {bootstrap.loaded ? "Local Data Ready" : "Seed Mode"}
          </span>
          <button
            type="button"
            className="ghost-button"
            onClick={() => setIsPostmanPanelOpen(true)}
          >
            Import Postman
          </button>
          <button type="button" className="ghost-button" onClick={() => setIsCurlPanelOpen(true)}>
            Import cURL
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              void handleExportCurl();
            }}
          >
            Export cURL
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => setIsTransferPanelOpen(true)}
          >
            Files
          </button>
        </div>
      </header>

      <section className="postman-body">
        <aside className="workspace-nav">
          <div className="workspace-nav__badge">AC</div>
          <div className="workspace-nav__items">
            {sidebarPanels.map((panel) => (
              <button
                key={panel.key}
                type="button"
                className={`workspace-nav__item ${
                  activeSidebarPanel === panel.key ? "is-active" : ""
                }`}
                onClick={() => handleSidebarPanelChange(panel.key)}
              >
                <strong>{panel.short}</strong>
                <span>{panel.label}</span>
              </button>
            ))}
          </div>
          <div className="workspace-nav__footer">
            <span className={`workspace-nav__status ${bootstrap.loaded ? "is-live" : ""}`} />
            <small>{bootstrap.loaded ? "local" : "seed"}</small>
          </div>
        </aside>

        <aside className="explorer-panel">
          <div className="explorer-panel__header">
            <div>
              <span>{activePanelMeta.caption}</span>
              <h2>{activePanelMeta.label}</h2>
            </div>
            <button type="button" className="icon-button">
              {activeSidebarPanel === "history" ? "..." : "+"}
            </button>
          </div>

          <div className="mobile-panel-switcher" aria-label="Workspace sections">
            {sidebarPanels.map((panel) => (
              <button
                key={panel.key}
                type="button"
                className={`mobile-panel-switcher__item ${
                  activeSidebarPanel === panel.key ? "is-active" : ""
                }`}
                onClick={() => handleSidebarPanelChange(panel.key)}
              >
                <strong>{panel.short}</strong>
                <span>{panel.label}</span>
              </button>
            ))}
          </div>

          <input
            className="sidebar__search-input"
            placeholder={`Search ${activePanelMeta.label.toLowerCase()}`}
          />

          {activeSidebarPanel === "collections" ? (
            <div className="explorer-panel__path">
              <span>{bootstrap.recentWorkspace || "default-workspace"}</span>
              <strong>{activeRequest.collection}</strong>
            </div>
          ) : null}

          <div className="sidebar__content">
            {activeSidebarPanel === "collections"
              ? collectionSections.map((section) => (
                  <section
                    key={section.title}
                    className={`tree-group ${expandedCollections[section.title] ? "is-open" : ""}`}
                  >
                    <button
                      type="button"
                      className="tree-group__toggle"
                      onClick={() => toggleCollection(section.title)}
                    >
                      <span className="tree-group__chevron">
                        {expandedCollections[section.title] ? "v" : ">"}
                      </span>
                      <div className="tree-group__title">
                        <strong>{section.title}</strong>
                        <small>{section.subtitle}</small>
                      </div>
                      <span className="tree-group__count">{section.requests.length}</span>
                    </button>

                    {expandedCollections[section.title] ? (
                      <div className="tree-group__body">
                        <div className="tree-group__branch">Requests</div>
                        {section.requests.map((request) => (
                            <button
                              key={request.id}
                              type="button"
                              className={`tree-request ${
                                request.id === activeRequestId ? "is-active" : ""
                              }`}
                              onClick={() => setActiveRequest(request.id)}
                            >
                              <span
                                className={`method-pill method-pill--${request.method.toLowerCase()}`}
                              >
                                {request.method}
                              </span>
                              <div className="tree-request__meta">
                                <strong>{request.name}</strong>
                                <small>{safePathname(request.url)}</small>
                              </div>
                            </button>
                          ))}
                      </div>
                    ) : null}
                  </section>
                ))
              : null}

            {activeSidebarPanel === "history"
              ? history.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="sidebar-row"
                    onClick={() => setActiveRequest(item.requestId)}
                  >
                    <div>
                      <strong>{item.title}</strong>
                      <small>{item.meta}</small>
                    </div>
                  </button>
                ))
              : null}

            {activeSidebarPanel === "environments"
              ? environments.map((environment) => (
                  <article
                    key={environment.id}
                    className={`environment-card ${
                      environment.id === activeEnvironmentId ? "is-active" : ""
                    }`}
                  >
                    <button
                      type="button"
                      className="environment-card__header"
                      onClick={() => setActiveEnvironment(environment.id)}
                    >
                      <div>
                        <strong>{environment.name}</strong>
                        <small>{environment.source}</small>
                      </div>
                      <span>{environment.vars.length} vars</span>
                    </button>
                    <div className="environment-card__vars">
                      {environment.vars.map((row) => (
                        <div key={`${environment.id}-${row.key}`} className="environment-var">
                          <span>{row.key}</span>
                          <strong>{row.value}</strong>
                        </div>
                      ))}
                    </div>
                  </article>
                ))
              : null}

            {activeSidebarPanel === "settings" ? (
              <>
                <article className="runtime-card">
                  <div className="runtime-card__header">
                    <strong>SQLite</strong>
                    <span>History / Cookie / Recent</span>
                  </div>
                  <small>{bootstrap.databasePath || "pending..."}</small>
                </article>
                <article className="runtime-card">
                  <div className="runtime-card__header">
                    <strong>Filesystem</strong>
                    <span>Collections / Envs / Workspace</span>
                  </div>
                  <small>{bootstrap.appDataDir || "pending..."}</small>
                </article>
                <article className="runtime-card">
                  <div className="runtime-card__header">
                    <strong>Keychain</strong>
                    <span>Secrets / Tokens</span>
                  </div>
                  <small>
                    {bootstrap.secrets.length > 0
                      ? bootstrap.secrets
                          .map((item) => `${item.name}:${item.exists ? "ready" : "missing"}`)
                        .join(" / ")
                      : "pending..."}
                  </small>
                </article>
                <article className="runtime-card">
                  <div className="runtime-card__header">
                    <strong>Tauri Bridge</strong>
                    <span>invoke / event / validation</span>
                  </div>
                  <small>Command expose / type conversion / error wrapping / event channel</small>
                </article>
                <article className="runtime-card">
                  <div className="runtime-card__header">
                    <strong>Rust Core</strong>
                    <span>request engine / auth / proxy / import</span>
                  </div>
                  <small>
                    Env keys: proxy=system|disabled|custom, proxy_url, tls_verify,
                    tls_hostname_verify, https_only
                  </small>
                </article>
              </>
            ) : null}
          </div>

          <div className="sidebar__footer">
            <strong>{sidebarItemCount}</strong>
            <span>items</span>
          </div>
        </aside>

        <section
          className={`workspace ${workspaceMode !== "collections" ? "workspace--with-inspector" : ""}`}
        >
          <div className="workbench">
          <div className="request-editor">
            <div className="request-editor__header">
              <div className="request-context">
                <span className="request-context__eyebrow">
                  {bootstrap.recentWorkspace || "default-workspace"} / {activeRequest.collection}
                </span>
                <h1>{activeRequest.name}</h1>
                <p>{activeBaseUrl}</p>
              </div>
              <div className="request-context__stats">
                <span>{activeEnvironment.name}</span>
                <span>{activeProxy}</span>
                <span>{activeCookieJar}</span>
              </div>
            </div>

            <div className="request-editor__subbar">
              <div className="environment-pills">
                {environments.map((environment) => (
                  <button
                    key={environment.id}
                    type="button"
                    className={`env-pill ${
                      environment.id === activeEnvironmentId ? "is-active" : ""
                    }`}
                    onClick={() => setActiveEnvironment(environment.id)}
                  >
                    {environment.name}
                  </button>
                ))}
              </div>

              <div className="request-meta">
                <span>Collection: {activeRequest.collection}</span>
                <span>Storage: SQLite / Filesystem / Keychain</span>
              </div>
            </div>

            <div className="request-editor__bar">
              <select
                className="method-select"
                value={activeRequest.method}
                onChange={(event) =>
                  updateRequestMethod(event.target.value as RequestMethod)
                }
              >
                {requestMethods.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
              <input
                className="request-url-input"
                value={activeRequest.url}
                onChange={(event) => updateRequestUrl(event.target.value)}
              />
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  void handleSaveRequest();
                }}
              >
                {isSavingRequest ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  void sendActiveRequest();
                }}
              >
                {isSending ? "Sending..." : "Send"}
              </button>
            </div>

            <div className="request-utility-bar">
              <div className="request-utility-bar__group">
                <span className="utility-pill utility-pill--active">
                  Params {activeRequest.params.length}
                </span>
                <span className="utility-pill">Headers {activeRequest.headers.length}</span>
                <span className="utility-pill">
                  Auth {activeRequest.authType === "none" ? "Off" : "On"}
                </span>
                <span className="utility-pill">Body {activeRequest.body.length}</span>
              </div>
              <div className="request-utility-bar__group">
                <span className="utility-note">Environment: {activeEnvironment.name}</span>
                <span className="utility-note">URL: {safePathname(activeRequest.url)}</span>
              </div>
            </div>

            {lastError ? <div className="request-error-banner">{lastError}</div> : null}

            {isPostmanPanelOpen ? (
              <section className="import-panel">
                <div className="import-panel__header">
                  <div>
                    <span>Postman Collection Import</span>
                    <h2>Collection Interop</h2>
                  </div>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setIsPostmanPanelOpen(false)}
                  >
                    Close
                  </button>
                </div>
                <label className="import-field">
                  <span>Collection JSON</span>
                  <textarea
                    value={postmanInput}
                    onChange={(event) => setPostmanInput(event.target.value)}
                  />
                </label>
                <div className="import-panel__actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      void handleImportPostman();
                    }}
                  >
                    Import Collection
                  </button>
                  {postmanMessage ? <span>{postmanMessage}</span> : null}
                </div>
              </section>
            ) : null}

            {isCurlPanelOpen ? (
              <section className="curl-panel">
                <div className="curl-panel__header">
                  <div>
                    <span>cURL Import / Export</span>
                    <h2>Command Interop</h2>
                  </div>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setIsCurlPanelOpen(false)}
                  >
                    Close
                  </button>
                </div>
                <div className="curl-panel__grid">
                  <label className="curl-field">
                    <span>Import cURL</span>
                    <textarea
                      value={curlInput}
                      onChange={(event) => setCurlInput(event.target.value)}
                    />
                  </label>
                  <label className="curl-field">
                    <span>Exported cURL</span>
                    <textarea
                      readOnly
                      value={curlOutput}
                      placeholder="Use Export cURL to generate a command from the active request."
                    />
                  </label>
                </div>
                <div className="curl-panel__actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      void handleImportCurl();
                    }}
                  >
                    Import into Request
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      void handleExportCurl();
                    }}
                  >
                    Export Active Request
                  </button>
                  {curlMessage ? <span>{curlMessage}</span> : null}
                </div>
              </section>
            ) : null}

            {isTransferPanelOpen ? (
              <section className="transfer-panel">
                <div className="transfer-panel__header">
                  <div>
                    <span>File Upload / Download</span>
                    <h2>Binary Transfer</h2>
                  </div>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setIsTransferPanelOpen(false)}
                  >
                    Close
                  </button>
                </div>
                <div className="transfer-panel__grid">
                  <div className="transfer-card">
                    <div>
                      <span>Upload</span>
                      <strong>multipart/form-data</strong>
                    </div>
                    <label className="transfer-field">
                      <span>File Path</span>
                      <input
                        value={uploadPath}
                        onChange={(event) => setUploadPath(event.target.value)}
                        placeholder="/absolute/path/to/file"
                      />
                    </label>
                    <label className="transfer-field">
                      <span>Field Name</span>
                      <input
                        value={uploadFieldName}
                        onChange={(event) => setUploadFieldName(event.target.value)}
                        placeholder="file"
                      />
                    </label>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        void handleUploadFile();
                      }}
                    >
                      Upload Active Request
                    </button>
                  </div>
                  <div className="transfer-card">
                    <div>
                      <span>Download</span>
                      <strong>Save response body</strong>
                    </div>
                    <label className="transfer-field">
                      <span>URL</span>
                      <input
                        value={downloadUrl}
                        onChange={(event) => setDownloadUrl(event.target.value)}
                        placeholder="{{base_url}}/file.json"
                      />
                    </label>
                    <label className="transfer-field">
                      <span>Destination Path</span>
                      <input
                        value={downloadPath}
                        onChange={(event) => setDownloadPath(event.target.value)}
                        placeholder="/absolute/path/to/download"
                      />
                    </label>
                    <label className="transfer-check">
                      <input
                        type="checkbox"
                        checked={allowDownloadOverwrite}
                        onChange={() =>
                          setAllowDownloadOverwrite((current) => !current)
                        }
                      />
                      <span>Allow overwrite</span>
                    </label>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        void handleDownloadFile();
                      }}
                    >
                      Download to Path
                    </button>
                  </div>
                </div>
                <div className="transfer-panel__footer">
                  <span>
                    Upload uses the active request URL, headers and environment. Download defaults
                    to no-overwrite for safer local files.
                  </span>
                  {transferMessage ? <strong>{transferMessage}</strong> : null}
                </div>
              </section>
            ) : null}

            <div className="request-tabs">
              {requestTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={`request-tab ${requestTab === tab.key ? "is-active" : ""}`}
                  onClick={() => setRequestTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="request-content">
              {requestTab === "params" ? (
                <section className="editor-panel">
                  <div className="editor-panel__header">
                    <div>
                      <span>Query Params</span>
                      <h2>Request Parameters</h2>
                    </div>
                    <button type="button" className="text-button" onClick={addParamRow}>
                      + Add Param
                    </button>
                  </div>
                  <div className="form-table">
                    <div className="form-table__head">
                      <span>On</span>
                      <span>Key</span>
                      <span>Value</span>
                    </div>
                    <div className="form-grid">
                      {activeRequest.params.map((row) => (
                        <div key={row.id} className="form-row">
                          <label className="toggle-cell">
                            <input
                              type="checkbox"
                              checked={row.enabled}
                              onChange={() => toggleParamRow(row.id)}
                            />
                          </label>
                          <input
                            className={!row.enabled ? "is-disabled" : ""}
                            value={row.key}
                            placeholder="key"
                            onChange={(event) =>
                              updateParamRow(row.id, "key", event.target.value)
                            }
                          />
                          <input
                            className={!row.enabled ? "is-disabled" : ""}
                            value={row.value}
                            placeholder="value"
                            onChange={(event) =>
                              updateParamRow(row.id, "value", event.target.value)
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              ) : null}

              {requestTab === "headers" ? (
                <section className="editor-panel">
                  <div className="editor-panel__header">
                    <div>
                      <span>Headers</span>
                      <h2>Request Headers</h2>
                    </div>
                    <button type="button" className="text-button" onClick={addHeaderRow}>
                      + Add Header
                    </button>
                  </div>
                  <div className="form-table">
                    <div className="form-table__head">
                      <span>On</span>
                      <span>Header</span>
                      <span>Value</span>
                    </div>
                    <div className="form-grid">
                      {activeRequest.headers.map((row) => (
                        <div key={row.id} className="form-row">
                          <label className="toggle-cell">
                            <input
                              type="checkbox"
                              checked={row.enabled}
                              onChange={() => toggleHeaderRow(row.id)}
                            />
                          </label>
                          <input
                            className={!row.enabled ? "is-disabled" : ""}
                            value={row.key}
                            placeholder="key"
                            onChange={(event) =>
                              updateHeaderRow(row.id, "key", event.target.value)
                            }
                          />
                          <input
                            className={!row.enabled ? "is-disabled" : ""}
                            value={row.value}
                            placeholder="value"
                            onChange={(event) =>
                              updateHeaderRow(row.id, "value", event.target.value)
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              ) : null}

              {requestTab === "body" ? (
                <section className="editor-panel editor-panel--full">
                  <div className="editor-panel__header">
                    <div>
                      <span>Body</span>
                      <h2>JSON Body Editor</h2>
                    </div>
                    <div className="chip-row">
                      <span>Pretty</span>
                      <span>Raw</span>
                      <span>Schema</span>
                    </div>
                  </div>
                  <div className="editor-toolbar">
                    <span>application/json</span>
                    <span>UTF-8</span>
                    <span>{activeRequest.body.length} chars</span>
                  </div>
                  <textarea
                    className="editor-textarea"
                    value={activeRequest.body}
                    onChange={(event) => updateRequestBody(event.target.value)}
                  />
                </section>
              ) : null}

              {requestTab === "auth" ? (
                <section className="editor-panel">
                  <div className="editor-panel__header">
                    <div>
                      <span>Authorization</span>
                      <h2>Auth Settings</h2>
                    </div>
                  </div>
                  <div className="auth-grid">
                    <label className="field-block">
                      <span>Auth Type</span>
                      <select
                        value={activeRequest.authType}
                        onChange={(event) =>
                          updateAuthType(event.target.value as "none" | "bearer")
                        }
                      >
                        <option value="none">No Auth</option>
                        <option value="bearer">Bearer Token</option>
                      </select>
                    </label>
                    <label className="field-block">
                      <span>Token</span>
                      <input
                        value={activeRequest.authToken}
                        onChange={(event) => updateAuthToken(event.target.value)}
                        placeholder="{{secret.prod_token}}"
                      />
                    </label>
                  </div>
                </section>
              ) : null}
            </div>
          </div>

          <div className="response-panel">
            <div className="response-panel__header">
              <div className="response-tabs">
                {responseTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    className={`response-tab ${responseTab === tab.key ? "is-active" : ""}`}
                    onClick={() => setResponseTab(tab.key)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="response-summary">
                <span className="response-status">{response.status}</span>
                <span>{response.duration}</span>
                <span>{response.size}</span>
                <span>{response.protocol}</span>
              </div>
            </div>

            <div className="response-panel__body">
              <div className="response-info-bar">
                <span>Cookie Jar: {response.summary.cookieJar}</span>
                <span>Secret: {response.summary.secretSource}</span>
                <span>Collection: {response.summary.collectionFile}</span>
              </div>

              {responseTab === "body" ? (
                <pre className="response-viewer">{response.body}</pre>
              ) : null}

              {responseTab === "headers" ? (
                <div className="response-list">
                  {response.headers.map((header) => (
                    <div key={header.key} className="response-row">
                      <span>{header.key}</span>
                      <strong>{header.value}</strong>
                    </div>
                  ))}
                </div>
              ) : null}

              {responseTab === "timeline" ? (
                <div className="response-list">
                  {response.timeline.map((item) => (
                    <div key={item.step} className="response-row">
                      <span>{item.step}</span>
                      <strong>{item.value}</strong>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          </div>

          {workspaceMode !== "collections" ? (
            <aside className="workspace-inspector">

          {workspaceMode === "history" ? (
            <section className="workspace-panel">
              <div className="workspace-panel__header">
                <div>
                  <span>History</span>
                  <h2>Recent Request Sessions</h2>
                </div>
                <button type="button" className="secondary-button">
                  Clear
                </button>
              </div>
              <div className="workspace-panel__grid">
                {history.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="workspace-card workspace-card--interactive"
                    onClick={() => setActiveRequest(item.requestId)}
                  >
                    <strong>{item.title}</strong>
                    <small>{item.meta}</small>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {workspaceMode === "environments" ? (
            <section className="workspace-panel">
              <div className="workspace-panel__header">
                <div>
                  <span>Environment Variables</span>
                  <h2>{activeEnvironment.name}</h2>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    void handleSaveEnvironment();
                  }}
                >
                  {isSavingEnvironment ? "Saving..." : "Save Env"}
                </button>
              </div>
              <div className="workspace-panel__table">
                <div className="workspace-panel__table-head">
                  <span>Key</span>
                  <span>Value</span>
                </div>
                {activeEnvironment.vars.map((row) => (
                  <div
                    key={`${activeEnvironment.id}-${row.key}`}
                    className="workspace-panel__table-row"
                  >
                    <strong>{row.key}</strong>
                    <input
                      value={row.value}
                      onChange={(event) =>
                        updateEnvironmentVar(activeEnvironment.id, row.key, event.target.value)
                      }
                    />
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {workspaceMode === "settings" ? (
            <section className="workspace-panel">
              <div className="workspace-panel__header">
                <div>
                  <span>Architecture</span>
                  <h2>Local Runtime Overview</h2>
                </div>
              </div>
              <div className="architecture-grid">
                <article className="architecture-card">
                  <span>Frontend UI</span>
                  <h3>React + TypeScript</h3>
                  <p>
                    Request editor, header/query/body forms, response viewer, history,
                    environments, collections and settings.
                  </p>
                </article>
                <article className="architecture-card">
                  <span>Tauri Bridge</span>
                  <h3>invoke / event</h3>
                  <p>
                    Command exposure, parameter validation, type conversion, error wrapping
                    and frontend-backend event channels.
                  </p>
                </article>
                <article className="architecture-card">
                  <span>Rust Core</span>
                  <h3>HTTP / Auth / Proxy</h3>
                  <p>
                    HTTP engine, environment resolution, cookie handling, auth flow,
                    TLS/proxy setup and import/export pipelines.
                  </p>
                </article>
                <article className="architecture-card">
                  <span>Local Data</span>
                  <h3>SQLite / Files / Keychain</h3>
                  <p>
                    History, settings, cookies, collections, environment files, secrets,
                    local cache and logs.
                  </p>
                </article>
              </div>
              <div className="workspace-panel__header">
                <div>
                  <span>Runtime Storage</span>
                  <h2>Cache / Logs</h2>
                </div>
              </div>
              <div className="runtime-storage-grid">
                <article className="runtime-storage-card">
                  <div className="runtime-storage-card__header">
                    <span>Local Cache</span>
                    <strong>{bootstrap.runtime.cache.entries} entries</strong>
                  </div>
                  <dl>
                    <div>
                      <dt>Directory</dt>
                      <dd>{bootstrap.runtime.cache.directory || bootstrap.cacheDir || "Pending runtime"}</dd>
                    </div>
                    <div>
                      <dt>Index</dt>
                      <dd>{bootstrap.runtime.cache.indexFile || "cache/index.json"}</dd>
                    </div>
                    <div>
                      <dt>Size</dt>
                      <dd>{formatBytes(bootstrap.runtime.cache.sizeBytes)}</dd>
                    </div>
                    <div>
                      <dt>Updated</dt>
                      <dd>{formatRuntimeTimestamp(bootstrap.runtime.cache.updatedAt)}</dd>
                    </div>
                  </dl>
                </article>
                <article className="runtime-storage-card">
                  <div className="runtime-storage-card__header">
                    <span>Application Logs</span>
                    <strong>{formatBytes(bootstrap.runtime.logs.sizeBytes)}</strong>
                  </div>
                  <dl>
                    <div>
                      <dt>Directory</dt>
                      <dd>{bootstrap.runtime.logs.directory || bootstrap.logsDir || "Pending runtime"}</dd>
                    </div>
                    <div>
                      <dt>Active File</dt>
                      <dd>{bootstrap.runtime.logs.activeFile || "logs/api-client.log"}</dd>
                    </div>
                    <div>
                      <dt>Updated</dt>
                      <dd>{formatRuntimeTimestamp(bootstrap.runtime.logs.updatedAt)}</dd>
                    </div>
                    <div>
                      <dt>Last Entry</dt>
                      <dd>{bootstrap.runtime.logs.lastLine || "No log entries yet"}</dd>
                    </div>
                  </dl>
                </article>
              </div>
              <div className="workspace-panel__header">
                <div>
                  <span>Bridge Events</span>
                  <h2>Frontend / Backend Channel</h2>
                </div>
              </div>
              <div className="bridge-event-list">
                {bridgeEvents.length > 0 ? (
                  bridgeEvents.map((event) => (
                    <article key={event.id} className="bridge-event-card">
                      <div className="bridge-event-card__meta">
                        <span className={`bridge-event-phase bridge-event-phase--${event.phase}`}>
                          {event.phase}
                        </span>
                        <strong>{event.command}</strong>
                        <small>{new Date(Number(event.timestamp)).toLocaleTimeString()}</small>
                      </div>
                      <p>{event.message}</p>
                      {event.detail ? <small>{event.detail}</small> : null}
                    </article>
                  ))
                ) : (
                  <article className="bridge-event-card bridge-event-card--empty">
                    <div className="bridge-event-card__meta">
                      <span className="bridge-event-phase">idle</span>
                      <strong>Waiting for runtime events</strong>
                    </div>
                    <p>
                      Tauri will stream command lifecycle events here after the
                      desktop runtime is active.
                    </p>
                  </article>
                )}
              </div>
              <div className="workspace-panel__header">
                <div>
                  <span>Secrets</span>
                  <h2>Keychain Secrets</h2>
                </div>
              </div>
              <div className="workspace-panel__table">
                <div className="workspace-panel__table-head workspace-panel__table-head--secrets">
                  <span>Name</span>
                  <span>Status</span>
                  <span>Value</span>
                  <span>Action</span>
                </div>
                {bootstrap.secrets.map((secret) => (
                  <div
                    key={secret.name}
                    className="workspace-panel__table-row workspace-panel__table-row--secrets"
                  >
                    <strong>{secret.name}</strong>
                    <span className={secret.exists ? "secret-status is-ready" : "secret-status"}>
                      {secret.exists ? "Ready" : "Missing"}
                    </span>
                    <input
                      type="password"
                      value={secretDrafts[secret.name] ?? ""}
                      placeholder={
                        secret.exists ? "Update secret value" : "Enter secret value"
                      }
                      onChange={(event) =>
                        handleSecretDraftChange(secret.name, event.target.value)
                      }
                    />
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        void handleSaveSecret(secret.name);
                      }}
                      disabled={isSavingSecret === secret.name}
                    >
                      {isSavingSecret === secret.name ? "Saving..." : "Save Secret"}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

            </aside>
          ) : null}
        </section>
      </section>
    </main>
  );
}
