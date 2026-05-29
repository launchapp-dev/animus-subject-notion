import { definePlugin, PluginKind, type Subject, type SubjectBackend, type SubjectCreateRequest, type SubjectListParams, type SubjectPatch, type SubjectStatus } from "@launchapp-dev/animus-plugin-sdk";

const NAME = "animus-subject-notion";
const VERSION = "0.1.0";
const SUBJECT_KIND = "notion.page";

type ParentType = "data_source" | "database";
type WritablePropertyType = "status" | "select" | "multi_select" | "rich_text" | "title" | "people" | "checkbox";

interface Config {
  baseUrl: string;
  token: string;
  notionVersion: string;
  parentId: string;
  parentType: ParentType;
  titleProperty: string;
  statusProperty: string;
  labelsProperty: string;
  descriptionProperty: string;
  assigneeProperty: string;
  statusPropertyType: WritablePropertyType;
  labelsPropertyType: WritablePropertyType;
  assigneePropertyType: WritablePropertyType;
  statusMap: Record<SubjectStatus, string>;
}

interface RichText {
  plain_text?: string;
  text?: { content?: string };
}

interface NotionOption {
  id?: string;
  name?: string;
  color?: string;
}

interface NotionPerson {
  id?: string;
  name?: string;
  person?: {
    email?: string;
  };
}

interface NotionProperty {
  id?: string;
  type?: string;
  title?: RichText[];
  rich_text?: RichText[];
  status?: NotionOption | null;
  select?: NotionOption | null;
  multi_select?: NotionOption[];
  people?: NotionPerson[];
  checkbox?: boolean;
  number?: number | null;
  date?: { start?: string | null; end?: string | null } | null;
  url?: string | null;
  email?: string | null;
  phone_number?: string | null;
}

interface NotionPage {
  id: string;
  created_time?: string;
  last_edited_time?: string;
  archived?: boolean;
  in_trash?: boolean;
  url?: string;
  properties?: Record<string, NotionProperty>;
}

interface NotionList {
  results?: NotionPage[];
  has_more?: boolean;
  next_cursor?: string | null;
}

function readConfig(): Config {
  const token = process.env.NOTION_TOKEN;
  const parentId = process.env.NOTION_DATA_SOURCE_ID ?? process.env.NOTION_DATABASE_ID;
  if (!token) throw new Error("NOTION_TOKEN is required");
  if (!parentId) throw new Error("NOTION_DATA_SOURCE_ID is required");
  const parentType = parseParentType(process.env.NOTION_PARENT_TYPE);
  return {
    baseUrl: (process.env.NOTION_BASE_URL ?? "https://api.notion.com/v1").replace(/\/+$/, ""),
    token,
    notionVersion: process.env.NOTION_VERSION ?? "2025-09-03",
    parentId,
    parentType,
    titleProperty: process.env.NOTION_TITLE_PROPERTY ?? "Name",
    statusProperty: process.env.NOTION_STATUS_PROPERTY ?? "Status",
    labelsProperty: process.env.NOTION_LABELS_PROPERTY ?? "Tags",
    descriptionProperty: process.env.NOTION_DESCRIPTION_PROPERTY ?? "Description",
    assigneeProperty: process.env.NOTION_ASSIGNEE_PROPERTY ?? "Assignee",
    statusPropertyType: parsePropertyType(process.env.NOTION_STATUS_PROPERTY_TYPE, "status"),
    labelsPropertyType: parsePropertyType(process.env.NOTION_LABELS_PROPERTY_TYPE, "multi_select"),
    assigneePropertyType: parsePropertyType(process.env.NOTION_ASSIGNEE_PROPERTY_TYPE, "rich_text"),
    statusMap: {
      ready: process.env.NOTION_READY_STATUS ?? "Not started",
      "in-progress": process.env.NOTION_IN_PROGRESS_STATUS ?? "In progress",
      blocked: process.env.NOTION_BLOCKED_STATUS ?? "Blocked",
      done: process.env.NOTION_DONE_STATUS ?? "Done",
      cancelled: process.env.NOTION_CANCELLED_STATUS ?? "Cancelled",
    },
  };
}

function parseParentType(raw: string | undefined): ParentType {
  if (!raw) return "data_source";
  if (raw === "data_source" || raw === "database") return raw;
  throw new Error("NOTION_PARENT_TYPE must be 'data_source' or 'database'");
}

function parsePropertyType(raw: string | undefined, fallback: WritablePropertyType): WritablePropertyType {
  if (!raw) return fallback;
  if (["status", "select", "multi_select", "rich_text", "title", "people", "checkbox"].includes(raw)) return raw as WritablePropertyType;
  throw new Error(`unsupported Notion property type '${raw}'`);
}

function pageId(id: string): string {
  return `${SUBJECT_KIND}:${id}`;
}

function parsePageId(id: string): string {
  if (id.startsWith(`${SUBJECT_KIND}:`)) return id.slice(`${SUBJECT_KIND}:`.length);
  if (/^[0-9a-f-]{32,36}$/i.test(id)) return id;
  throw new Error(`expected id '${SUBJECT_KIND}:<page-id>', got '${id}'`);
}

function richText(content: string): RichText[] {
  return [{ type: "text", text: { content } } as RichText];
}

function textFromRichText(items: RichText[] | undefined): string | undefined {
  const text = (items ?? []).map((item) => item.plain_text ?? item.text?.content ?? "").join("");
  return text.trim() || undefined;
}

function textFromProperty(prop: NotionProperty | undefined): string | undefined {
  if (!prop) return undefined;
  switch (prop.type) {
    case "title":
      return textFromRichText(prop.title);
    case "rich_text":
      return textFromRichText(prop.rich_text);
    case "status":
      return prop.status?.name;
    case "select":
      return prop.select?.name;
    case "multi_select":
      return prop.multi_select?.map((item) => item.name).filter(Boolean).join(", ") || undefined;
    case "people":
      return prop.people?.map((person) => person.name ?? person.person?.email ?? person.id).filter(Boolean).join(", ") || undefined;
    case "checkbox":
      return prop.checkbox ? "true" : "false";
    case "number":
      return prop.number === null || prop.number === undefined ? undefined : String(prop.number);
    case "date":
      return prop.date?.start ?? undefined;
    case "url":
      return prop.url ?? undefined;
    case "email":
      return prop.email ?? undefined;
    case "phone_number":
      return prop.phone_number ?? undefined;
    default:
      return undefined;
  }
}

function labelsFromProperty(prop: NotionProperty | undefined): string[] {
  if (!prop) return [];
  if (prop.type === "multi_select") return (prop.multi_select ?? []).map((item) => item.name).filter((name): name is string => Boolean(name));
  const text = textFromProperty(prop);
  return text ? [text] : [];
}

function statusFromNative(native: string | undefined, page: NotionPage): SubjectStatus {
  if (page.archived || page.in_trash) return "cancelled";
  const name = (native ?? "").trim().toLowerCase();
  if (!name) return "ready";
  if (name.includes("cancel") || name.includes("trash")) return "cancelled";
  if (name.includes("block")) return "blocked";
  if (name.includes("done") || name.includes("complete") || name.includes("closed")) return "done";
  if (name.includes("progress") || name.includes("doing") || name.includes("review")) return "in-progress";
  return "ready";
}

function subjectFromPage(page: NotionPage, config: Pick<Config, "titleProperty" | "statusProperty" | "labelsProperty" | "descriptionProperty" | "assigneeProperty">): Subject {
  const props = page.properties ?? {};
  const native = textFromProperty(props[config.statusProperty]);
  return {
    id: pageId(page.id),
    kind: SUBJECT_KIND,
    title: textFromProperty(props[config.titleProperty]) ?? page.id,
    description: textFromProperty(props[config.descriptionProperty]),
    status: statusFromNative(native, page),
    created_at: page.created_time ?? page.last_edited_time ?? new Date().toISOString(),
    updated_at: page.last_edited_time ?? page.created_time ?? new Date().toISOString(),
    labels: labelsFromProperty(props[config.labelsProperty]),
    assignee: textFromProperty(props[config.assigneeProperty]),
    url: page.url,
    native_status: native,
    custom: {
      notion_id: page.id,
      archived: page.archived,
      in_trash: page.in_trash,
      properties: page.properties,
    },
  };
}

function propertyValue(type: WritablePropertyType, value: string | string[] | boolean | null): Record<string, unknown> {
  switch (type) {
    case "title":
      return { title: typeof value === "string" ? richText(value) : [] };
    case "rich_text":
      return { rich_text: typeof value === "string" ? richText(value) : [] };
    case "status":
      return { status: typeof value === "string" ? { name: value } : null };
    case "select":
      return { select: typeof value === "string" ? { name: value } : null };
    case "multi_select":
      return { multi_select: Array.isArray(value) ? value.map((name) => ({ name })) : [] };
    case "people":
      return { people: typeof value === "string" && value ? [{ id: value }] : [] };
    case "checkbox":
      return { checkbox: Boolean(value) };
  }
}

function statusName(config: Config, status: SubjectStatus | undefined): string | undefined {
  return status ? config.statusMap[status] : undefined;
}

function createProperties(config: Config, params: SubjectCreateRequest): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    [config.titleProperty]: propertyValue("title", params.title),
  };
  if (params.description) properties[config.descriptionProperty] = propertyValue("rich_text", params.description);
  const native = statusName(config, params.status);
  if (native) properties[config.statusProperty] = propertyValue(config.statusPropertyType, native);
  if (params.labels && params.labels.length > 0) properties[config.labelsProperty] = propertyValue(config.labelsPropertyType, params.labels);
  if (params.assignee) properties[config.assigneeProperty] = propertyValue(config.assigneePropertyType, params.assignee);
  return properties;
}

function updateProperties(config: Config, patch: SubjectPatch, currentLabels: string[] = []): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const native = statusName(config, patch.status);
  if (native) properties[config.statusProperty] = propertyValue(config.statusPropertyType, native);
  if (patch.custom && typeof patch.custom.name === "string") properties[config.titleProperty] = propertyValue("title", patch.custom.name);
  if (patch.custom && typeof patch.custom.description === "string") properties[config.descriptionProperty] = propertyValue("rich_text", patch.custom.description);
  if (patch.assignee !== undefined) properties[config.assigneeProperty] = propertyValue(config.assigneePropertyType, patch.assignee);
  if (patch.labels_add || patch.labels_remove) {
    const labels = new Set(currentLabels);
    for (const label of patch.labels_remove ?? []) labels.delete(label);
    for (const label of patch.labels_add ?? []) labels.add(label);
    properties[config.labelsProperty] = propertyValue(config.labelsPropertyType, [...labels]);
  }
  return properties;
}

function matchesFilters(page: NotionPage, params: SubjectListParams, config: Config): boolean {
  const subject = subjectFromPage(page, config);
  if (params.status && params.status.length > 0 && !params.status.includes(subject.status)) return false;
  if (params.assignee && params.assignee.length > 0 && (!subject.assignee || !params.assignee.includes(subject.assignee))) return false;
  const labels = new Set(subject.labels ?? []);
  if (params.labels_all && !params.labels_all.every((label) => labels.has(label))) return false;
  if (params.labels_any && params.labels_any.length > 0 && !params.labels_any.some((label) => labels.has(label))) return false;
  if (params.updated_since && subject.updated_at && new Date(subject.updated_at) < new Date(params.updated_since)) return false;
  return true;
}

class NotionClient {
  constructor(private readonly config: Config) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.config.token}`);
    headers.set("Notion-Version", this.config.notionVersion);
    headers.set("Accept", "application/json");
    if (init.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(`${this.config.baseUrl}${path}`, { ...init, headers });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Notion API ${response.status} ${response.statusText}: ${body.slice(0, 500)}`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  queryPath(): string {
    return this.config.parentType === "database"
      ? `/databases/${encodeURIComponent(this.config.parentId)}/query`
      : `/data_sources/${encodeURIComponent(this.config.parentId)}/query`;
  }

  parentPayload(): Record<string, string> {
    return this.config.parentType === "database" ? { database_id: this.config.parentId } : { data_source_id: this.config.parentId };
  }

  async list(params: SubjectListParams): Promise<NotionList> {
    const body: Record<string, unknown> = {
      page_size: Math.max(1, Math.min(params.limit ?? 50, 100)),
    };
    if (params.cursor) body.start_cursor = params.cursor;
    return this.request<NotionList>(this.queryPath(), { method: "POST", body: JSON.stringify(body) });
  }

  async get(id: string): Promise<NotionPage> {
    return this.request<NotionPage>(`/pages/${encodeURIComponent(id)}`);
  }

  async create(params: SubjectCreateRequest): Promise<NotionPage> {
    return this.request<NotionPage>("/pages", {
      method: "POST",
      body: JSON.stringify({
        parent: this.parentPayload(),
        properties: createProperties(this.config, params),
      }),
    });
  }

  async update(id: string, patch: SubjectPatch): Promise<NotionPage> {
    const current = patch.labels_add || patch.labels_remove ? await this.get(id) : null;
    const currentLabels = current ? labelsFromProperty(current.properties?.[this.config.labelsProperty]) : [];
    const properties = updateProperties(this.config, patch, currentLabels);
    const body: Record<string, unknown> = {};
    if (Object.keys(properties).length > 0) body.properties = properties;
    if (patch.status === "cancelled") body.archived = true;
    if (Object.keys(body).length > 0) {
      await this.request(`/pages/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    }
    if (patch.comment) await this.appendCommentBlock(id, patch.comment);
    return this.get(id);
  }

  async appendCommentBlock(id: string, text: string): Promise<void> {
    await this.request(`/blocks/${encodeURIComponent(id)}/children`, {
      method: "PATCH",
      body: JSON.stringify({
        children: [
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: richText(text),
            },
          },
        ],
      }),
    });
  }
}

function buildBackend(): SubjectBackend {
  let cached: { config: Config; client: NotionClient } | null = null;
  const runtime = (): { config: Config; client: NotionClient } => {
    cached ??= (() => {
      const config = readConfig();
      return { config, client: new NotionClient(config) };
    })();
    return cached;
  };
  return {
    async list(params) {
      const { config, client } = runtime();
      const result = await client.list(params);
      return {
        subjects: (result.results ?? []).filter((page) => matchesFilters(page, params, config)).map((page) => subjectFromPage(page, config)),
        next_cursor: result.has_more ? result.next_cursor ?? null : null,
        fetched_at: new Date().toISOString(),
      };
    },
    async get(params) {
      const { config, client } = runtime();
      return subjectFromPage(await client.get(parsePageId(params.id)), config);
    },
    async create(params) {
      const { config, client } = runtime();
      return subjectFromPage(await client.create(params), config);
    },
    async update(params) {
      const { config, client } = runtime();
      return subjectFromPage(await client.update(parsePageId(params.id), params.patch), config);
    },
    async status(params) {
      const { config, client } = runtime();
      return subjectFromPage(await client.update(parsePageId(params.id), { status: params.status }), config);
    },
    schema() {
      return {
        kinds: [SUBJECT_KIND],
        status_values: ["ready", "in-progress", "blocked", "done", "cancelled"],
        supports_watch: false,
        supports_create: true,
        supports_pagination: true,
        native_status_values: ["Not started", "In progress", "Blocked", "Done", "Cancelled"],
        status_dispatch_hints: [
          { native_status: "Not started", status: "ready" },
          { native_status: "In progress", status: "in-progress" },
          { native_status: "Done", status: "done" },
        ],
        custom_fields: ["notion_id", "archived", "in_trash", "properties"],
      };
    },
    async health() {
      try {
        const { client } = runtime();
        await client.request("/users/me");
        return { status: "healthy", uptime_ms: null, memory_usage_bytes: null, last_error: null };
      } catch (err) {
        return { status: "unhealthy", uptime_ms: null, memory_usage_bytes: null, last_error: String(err) };
      }
    },
  };
}

export { NotionClient, createProperties, labelsFromProperty, matchesFilters, parsePageId, propertyValue, statusFromNative, subjectFromPage, textFromProperty, updateProperties };

const plugin = definePlugin({
  kind: PluginKind.SubjectBackend,
  name: NAME,
  version: VERSION,
  description: "Notion pages subject backend plugin for Animus",
  subject_kinds: [SUBJECT_KIND],
  env_required: [
    { name: "NOTION_TOKEN", description: "Notion internal integration token.", required: true, sensitive: true },
    { name: "NOTION_DATA_SOURCE_ID", description: "Notion data source id. NOTION_DATABASE_ID is accepted as an alias.", required: true },
    { name: "NOTION_PARENT_TYPE", description: "Parent/query type: data_source or database. Defaults to data_source.", required: false },
    { name: "NOTION_VERSION", description: "Notion-Version header. Defaults to 2025-09-03.", required: false },
    { name: "NOTION_TITLE_PROPERTY", description: "Title property name. Defaults to Name.", required: false },
    { name: "NOTION_STATUS_PROPERTY", description: "Status property name. Defaults to Status.", required: false },
    { name: "NOTION_LABELS_PROPERTY", description: "Labels property name. Defaults to Tags.", required: false },
    { name: "NOTION_DESCRIPTION_PROPERTY", description: "Description property name. Defaults to Description.", required: false },
    { name: "NOTION_ASSIGNEE_PROPERTY", description: "Assignee property name. Defaults to Assignee.", required: false },
    { name: "NOTION_STATUS_PROPERTY_TYPE", description: "Writable status property type. Defaults to status.", required: false },
    { name: "NOTION_LABELS_PROPERTY_TYPE", description: "Writable labels property type. Defaults to multi_select.", required: false },
    { name: "NOTION_ASSIGNEE_PROPERTY_TYPE", description: "Writable assignee property type. Defaults to rich_text.", required: false },
    { name: "NOTION_READY_STATUS", description: "Native status name for Animus ready.", required: false },
    { name: "NOTION_IN_PROGRESS_STATUS", description: "Native status name for Animus in-progress.", required: false },
    { name: "NOTION_BLOCKED_STATUS", description: "Native status name for Animus blocked.", required: false },
    { name: "NOTION_DONE_STATUS", description: "Native status name for Animus done.", required: false },
    { name: "NOTION_CANCELLED_STATUS", description: "Native status name for Animus cancelled.", required: false },
  ],
  impl: buildBackend(),
});

function isDirectRun(): boolean {
  const entry = process.argv[1] ?? "";
  return entry.endsWith("index.cjs") || entry.endsWith("index.js") || entry.endsWith(NAME);
}

if (isDirectRun()) {
  plugin.run().catch((err) => {
    process.stderr.write(`[${NAME}] fatal: ${String(err)}\n`);
    process.exit(1);
  });
}
