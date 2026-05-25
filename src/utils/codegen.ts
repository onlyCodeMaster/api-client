import type { RequestItem } from "../types";

export type CodegenTarget =
  | "fetch"
  | "axios"
  | "node-http"
  | "python-requests"
  | "go"
  | "rust-reqwest";

function buildFinalUrl(req: RequestItem): string {
  let url = req.url;
  const enabledParams = req.params.filter((p) => p.enabled && p.key);
  if (enabledParams.length > 0) {
    const qs = enabledParams
      .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
      .join("&");
    const sep = url.includes("?") ? "&" : "?";
    url = `${url}${sep}${qs}`;
  }
  return url;
}

function buildHeaders(req: RequestItem): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const h of req.headers) {
    if (h.enabled && h.key) headers[h.key] = h.value;
  }
  // Auth
  if (req.auth) {
    const a = req.auth;
    if (a.auth_type === "bearer" && a.bearer_token) {
      headers["Authorization"] = `Bearer ${a.bearer_token}`;
    } else if (a.auth_type === "basic" && a.basic_username) {
      const encoded = btoa(`${a.basic_username}:${a.basic_password || ""}`);
      headers["Authorization"] = `Basic ${encoded}`;
    } else if (a.auth_type === "api_key" && a.api_key_key && a.api_key_in === "header") {
      headers[a.api_key_key] = a.api_key_value || "";
    }
  }
  // Auto Content-Type for typed bodies
  const lowerKeys = Object.keys(headers).map((k) => k.toLowerCase());
  if (!lowerKeys.includes("content-type")) {
    if (req.bodyType === "json" || req.bodyType === "graphql") {
      headers["Content-Type"] = "application/json";
    } else if (req.bodyType === "xml") {
      headers["Content-Type"] = "application/xml";
    } else if (req.bodyType === "text") {
      headers["Content-Type"] = "text/plain";
    }
  }
  return headers;
}

function bodyString(req: RequestItem): string | null {
  if (req.bodyType === "none") return null;
  if (req.bodyType === "graphql") {
    return JSON.stringify({
      query: req.graphqlQuery || "",
      variables: req.graphqlVariables ? JSON.parse(req.graphqlVariables) : undefined,
    });
  }
  if (req.bodyType === "form-data") return null;
  return req.body || null;
}

function jsLiteral(s: string): string {
  return JSON.stringify(s);
}

function genFetch(req: RequestItem): string {
  const url = buildFinalUrl(req);
  const headers = buildHeaders(req);
  const body = bodyString(req);

  const lines: string[] = [];
  lines.push(`const response = await fetch(${jsLiteral(url)}, {`);
  lines.push(`  method: ${jsLiteral(req.method)},`);
  if (Object.keys(headers).length > 0) {
    lines.push(`  headers: ${JSON.stringify(headers, null, 2).replace(/\n/g, "\n  ")},`);
  }
  if (body !== null) {
    lines.push(`  body: ${jsLiteral(body)},`);
  } else if (req.bodyType === "form-data") {
    lines.push(`  // form-data: build FormData() with text and file fields`);
    lines.push(`  // body: formData,`);
  }
  lines.push(`});`);
  lines.push(`const data = await response.text();`);
  lines.push(`console.log(response.status, data);`);
  return lines.join("\n");
}

function genAxios(req: RequestItem): string {
  const url = buildFinalUrl(req);
  const headers = buildHeaders(req);
  const body = bodyString(req);
  const config: Record<string, unknown> = {
    method: req.method.toLowerCase(),
    url,
  };
  if (Object.keys(headers).length > 0) config.headers = headers;
  if (body !== null) {
    try {
      config.data = JSON.parse(body);
    } catch {
      config.data = body;
    }
  }
  return [
    `import axios from "axios";`,
    ``,
    `const response = await axios(${JSON.stringify(config, null, 2)});`,
    `console.log(response.status, response.data);`,
  ].join("\n");
}

function genNodeHttp(req: RequestItem): string {
  const url = buildFinalUrl(req);
  const headers = buildHeaders(req);
  const body = bodyString(req);
  return [
    `import { request } from "node:https";`,
    `import { URL } from "node:url";`,
    ``,
    `const u = new URL(${jsLiteral(url)});`,
    `const req = request({`,
    `  method: ${jsLiteral(req.method)},`,
    `  hostname: u.hostname,`,
    `  port: u.port || undefined,`,
    `  path: u.pathname + u.search,`,
    `  headers: ${JSON.stringify(headers, null, 2).replace(/\n/g, "\n  ")},`,
    `}, (res) => {`,
    `  let data = "";`,
    `  res.on("data", (c) => (data += c));`,
    `  res.on("end", () => console.log(res.statusCode, data));`,
    `});`,
    body !== null ? `req.write(${jsLiteral(body)});` : ``,
    `req.end();`,
  ]
    .filter(Boolean)
    .join("\n");
}

function genPython(req: RequestItem): string {
  const url = buildFinalUrl(req);
  const headers = buildHeaders(req);
  const body = bodyString(req);
  const pyHeaders = JSON.stringify(headers, null, 4)
    .replace(/"/g, '"')
    .replace(/:/g, ":");
  const lines = [
    `import requests`,
    ``,
    `url = ${JSON.stringify(url)}`,
    `headers = ${pyHeaders}`,
  ];
  if (body !== null) {
    try {
      JSON.parse(body);
      lines.push(`payload = ${body}`);
      lines.push(``);
      lines.push(`response = requests.request(${JSON.stringify(req.method)}, url, headers=headers, json=payload)`);
    } catch {
      lines.push(`payload = ${JSON.stringify(body)}`);
      lines.push(``);
      lines.push(`response = requests.request(${JSON.stringify(req.method)}, url, headers=headers, data=payload)`);
    }
  } else {
    lines.push(``);
    lines.push(`response = requests.request(${JSON.stringify(req.method)}, url, headers=headers)`);
  }
  lines.push(`print(response.status_code, response.text)`);
  return lines.join("\n");
}

function genGo(req: RequestItem): string {
  const url = buildFinalUrl(req);
  const headers = buildHeaders(req);
  const body = bodyString(req);
  const lines = [
    `package main`,
    ``,
    `import (`,
    `\t"fmt"`,
    `\t"io"`,
    `\t"net/http"`,
    body !== null ? `\t"strings"` : ``,
    `)`,
    ``,
    `func main() {`,
    body !== null
      ? `\tbody := strings.NewReader(${JSON.stringify(body)})`
      : `\tvar body io.Reader = nil`,
    `\treq, err := http.NewRequest(${JSON.stringify(req.method)}, ${JSON.stringify(url)}, body)`,
    `\tif err != nil { panic(err) }`,
  ];
  for (const [k, v] of Object.entries(headers)) {
    lines.push(`\treq.Header.Set(${JSON.stringify(k)}, ${JSON.stringify(v)})`);
  }
  lines.push(`\tresp, err := http.DefaultClient.Do(req)`);
  lines.push(`\tif err != nil { panic(err) }`);
  lines.push(`\tdefer resp.Body.Close()`);
  lines.push(`\tdata, _ := io.ReadAll(resp.Body)`);
  lines.push(`\tfmt.Println(resp.StatusCode, string(data))`);
  lines.push(`}`);
  return lines.filter((l) => l !== "").join("\n");
}

function genRustReqwest(req: RequestItem): string {
  const url = buildFinalUrl(req);
  const headers = buildHeaders(req);
  const body = bodyString(req);
  const methodCall = req.method.toLowerCase();
  const lines = [
    `use reqwest::Client;`,
    ``,
    `#[tokio::main]`,
    `async fn main() -> Result<(), Box<dyn std::error::Error>> {`,
    `    let client = Client::new();`,
    `    let mut req = client.${methodCall}(${JSON.stringify(url)});`,
  ];
  for (const [k, v] of Object.entries(headers)) {
    lines.push(`    req = req.header(${JSON.stringify(k)}, ${JSON.stringify(v)});`);
  }
  if (body !== null) {
    lines.push(`    req = req.body(${JSON.stringify(body)});`);
  }
  lines.push(`    let resp = req.send().await?;`);
  lines.push(`    let status = resp.status();`);
  lines.push(`    let text = resp.text().await?;`);
  lines.push(`    println!("{} {}", status, text);`);
  lines.push(`    Ok(())`);
  lines.push(`}`);
  return lines.join("\n");
}

export function generateCode(req: RequestItem, target: CodegenTarget): string {
  switch (target) {
    case "fetch":
      return genFetch(req);
    case "axios":
      return genAxios(req);
    case "node-http":
      return genNodeHttp(req);
    case "python-requests":
      return genPython(req);
    case "go":
      return genGo(req);
    case "rust-reqwest":
      return genRustReqwest(req);
  }
}

export const CODEGEN_TARGETS: { value: CodegenTarget; label: string }[] = [
  { value: "fetch", label: "JavaScript fetch" },
  { value: "axios", label: "JavaScript axios" },
  { value: "node-http", label: "Node.js https" },
  { value: "python-requests", label: "Python requests" },
  { value: "go", label: "Go net/http" },
  { value: "rust-reqwest", label: "Rust reqwest" },
];
