import type { PiWebHostPiSessionsV1, PiWebHostPiSessionEventsV1, PiWebHostPiSessionConnection, ServerPluginPeerRequestContext } from "@jmfederico/pi-web/server-plugin-api";
import { LIBRARY_MAX_EVIDENCE, LIBRARY_MAX_TASKS, libraryId, libraryInteger, libraryObject, libraryPage, libraryText, type LibraryRepository, type LibraryTask, type LibraryTextAccess } from "../domain/workbench.js";
import { WORKBENCH_ACK_CHANNEL, WORKBENCH_RESULT_CHANNEL, resultHashText } from "../domain/workbenchResearchProtocol.js";
import { activeResearch, assertEvidenceSource, assertFresh, assertResearchTaskBudget, assertRevision, evidenceAnchor, evidenceContent, parseEvidence, parseTaskInput, researchNow, researchPreview, taskIn, validateTaskResult } from "./workbenchResearchData.js";

type Authority = Pick<ServerPluginPeerRequestContext, "project" | "workspace">;
interface Dependencies { sessions: PiWebHostPiSessionsV1; events: PiWebHostPiSessionEventsV1; lifetime: AbortSignal; log: (message: string) => void; text: LibraryTextAccess }

/**
 * Backend alone publishes agent results, bound to its public host session connection.
 * Native events are shared with cooperative installed extensions, not an authentication
 * boundary against malicious extensions or a tool sandbox. Connections never stop sessions.
 */
export class LibraryResearch {
  private readonly active = new Map<string, string>();
  private readonly admissions = new Set<string>();
  private readonly executions = new Set<Promise<void>>();
  private readonly stopped = new AbortController();
  private readonly lifetime: AbortSignal;

  constructor(private readonly store: LibraryRepository, private readonly dependencies: Dependencies) {
    this.lifetime = AbortSignal.any([dependencies.lifetime, this.stopped.signal]);
  }

  async handle(context: Authority, operation: string, value: unknown, signal: AbortSignal): Promise<unknown> {
    this.lifetime.throwIfAborted(); signal.throwIfAborted();
    const root = context.workspace.path;
    if (operation.startsWith("evidence.")) return this.evidence(root, operation, value, signal);
    if (operation === "tasks.preview") {
      const preview = researchPreview(await this.store.read(root, signal), parseTaskInput(value, false));
      return { corpusHash: preview.corpusHash, prompt: preview.prompt, referenceIds: preview.referenceIds, warnings: preview.warnings };
    }
    if (operation === "tasks.start") return this.start(context, value, signal);
    if (operation === "tasks.list" || operation === "tasks.get") {
      const input = operation === "tasks.list" ? libraryObject(value, [], ["offset"]) : libraryObject(value, ["id"]);
      const id = operation === "tasks.get" ? libraryId(input["id"], "task") : null;
      const offset = operation === "tasks.list" ? libraryInteger(input["offset"] ?? 0) : 0;
      if (!this.admissions.has(root)) await this.recover(root, signal);
      const state = await this.store.read(root, signal);
      return id === null ? libraryPage(state.tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)), offset) : taskIn(state, id);
    }
    if (operation === "tasks.review") {
      const input = libraryObject(value, ["id", "expectedRevision", "decision"]);
      const id = libraryId(input["id"], "task"), expected = libraryInteger(input["expectedRevision"], 1);
      const decision = input["decision"];
      if (decision !== "accepted" && decision !== "rejected") throw new Error("Invalid review decision");
      return this.store.update(root, state => {
        const task = taskIn(state, id);
        assertRevision(task.revision, expected);
        if (task.status !== "completed" || task.result === null) throw new Error("Only completed, validated results can be reviewed");
        assertFresh(state, task);
        validateTaskResult(task.result, state, task);
        task.review = decision; task.reviewedAt = researchNow(); this.touch(task);
        return task;
      }, signal);
    }
    throw new Error(`Unsupported research operation: ${operation}`);
  }

  async dispose(): Promise<void> { this.stopped.abort(); await Promise.all(this.executions); }

  private async evidence(root: string, operation: string, value: unknown, signal: AbortSignal): Promise<unknown> {
    if (operation === "evidence.list") {
      const input = libraryObject(value, [], ["referenceId", "query", "kind", "status", "trash", "offset"]);
      const referenceId = input["referenceId"] === undefined ? undefined : libraryId(input["referenceId"], "ref");
      const query = libraryText(input["query"] ?? "", 200).toLowerCase();
      const kind = input["kind"], status = input["status"], trash = input["trash"] ?? false;
      if (kind !== undefined && kind !== "quote" && kind !== "note" && kind !== "question") throw new Error("Invalid evidence kind");
      if (status !== undefined && status !== "open" && status !== "resolved") throw new Error("Invalid evidence status");
      if (typeof trash !== "boolean") throw new Error("Invalid trash filter");
      const offset = libraryInteger(input["offset"] ?? 0);
      const state = await this.store.read(root, signal);
      return libraryPage(state.evidence.filter(item => (item.deletedAt !== null) === trash && (referenceId === undefined || item.referenceId === referenceId) && (kind === undefined || item.kind === kind) && (status === undefined || item.status === status) && `${item.quote}\n${item.body}\n${item.tags.join(" ")}`.toLowerCase().includes(query)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)), offset);
    }
    if (operation === "evidence.save") {
      const { fields, expectedRevision } = parseEvidence(value);
      const snapshot = await this.store.read(root, signal);
      assertEvidenceSource(snapshot, fields);
      if (fields.documentId !== null && fields.page !== null) {
        const page = await this.dependencies.text.read(root, fields.referenceId, fields.documentId, fields.page, signal);
        if (page.page !== fields.page) throw new Error("PDF page could not be verified");
      }
      return this.store.update(root, state => {
        assertEvidenceSource(state, fields);
        const existing = state.evidence.find(item => item.id === fields.id);
        if (existing !== undefined) {
          if (existing.deletedAt !== null) throw new Error("Deleted evidence cannot be recreated");
          if (expectedRevision === 0 && existing.revision === 1 && evidenceContent(existing) === evidenceContent(fields)) return existing;
          assertRevision(existing.revision, expectedRevision);
          if (evidenceAnchor(existing) !== evidenceAnchor(fields)) throw new Error("Evidence anchors and quotes are immutable");
          Object.assign(existing, fields, { revision: existing.revision + 1, updatedAt: researchNow() });
          return existing;
        }
        assertRevision(0, expectedRevision);
        if (state.evidence.length >= LIBRARY_MAX_EVIDENCE) throw new Error("Evidence history is full");
        const now = researchNow();
        const evidence = { ...fields, revision: 1, createdAt: now, updatedAt: now, deletedAt: null };
        state.evidence.push(evidence);
        return evidence;
      }, signal);
    }
    if (operation === "evidence.delete") {
      const input = libraryObject(value, ["id", "expectedRevision"]);
      const id = libraryId(input["id"], "ev"), expected = libraryInteger(input["expectedRevision"], 1);
      return this.store.update(root, state => {
        const evidence = state.evidence.find(item => item.id === id);
        if (evidence === undefined) throw new Error("Evidence not found");
        assertRevision(evidence.revision, expected);
        if (evidence.deletedAt !== null) throw new Error("Evidence is already deleted");
        // Repository publication retains the previous record in a .deleted recovery file.
        evidence.deletedAt = researchNow(); evidence.updatedAt = evidence.deletedAt; evidence.revision++;
        return evidence;
      }, signal);
    }
    throw new Error(`Unsupported evidence operation: ${operation}`);
  }

  private async recover(root: string, signal: AbortSignal): Promise<void> {
    const stale = (await this.store.read(root, signal)).tasks.some(task => activeResearch(task) && this.active.get(root) !== task.id);
    if (!stale) return;
    await this.store.update(root, state => {
      for (const task of state.tasks) {
        if (activeResearch(task) && this.active.get(root) !== task.id) {
          task.status = "interrupted"; task.message = "Backend tracking restarted before final completion. Inspect Sessions; this task will not be automatically resubmitted or accepted."; this.touch(task);
        }
      }
    }, signal);
  }

  private async start(context: Authority, value: unknown, signal: AbortSignal): Promise<LibraryTask> {
    const input = parseTaskInput(value, true), root = context.workspace.path;
    if (this.admissions.has(root)) throw new Error("Another research task is being admitted; refresh before retrying");
    this.admissions.add(root);
    try {
      await this.recover(root, signal);
      const previous = (await this.store.read(root, signal)).tasks.find(task => task.id === input.id);
      if (previous !== undefined) {
        if (previous.kind !== input.kind || previous.goal !== input.goal || JSON.stringify(previous.referenceIds) !== JSON.stringify(input.referenceIds) || previous.corpusHash !== input.expectedCorpusHash) throw new Error("Task identity was already used for different content");
        return previous;
      }
      if (this.active.has(root)) throw new Error("A research task is already running in this workspace");
      if (this.active.size + this.admissions.size > 4) throw new Error("Global research task limit reached");
      const admitted = await this.store.update(root, state => {
        if (state.tasks.length >= LIBRARY_MAX_TASKS) throw new Error("Research task history is full");
        if (state.tasks.some(activeResearch)) throw new Error("A research task is already active");
        const preview = researchPreview(state, input);
        if (preview.corpusHash !== input.expectedCorpusHash) throw new Error("Corpus changed since preview; obtain new consent");
        const now = researchNow();
        const task: LibraryTask = { id: input.id, revision: 1, kind: input.kind, goal: input.goal, referenceIds: input.referenceIds, corpus: preview.corpus, corpusHash: preview.corpusHash, createdAt: now, updatedAt: now, sessionId: "", status: "starting", message: "Starting a normal Pi conversation; results require human review.", result: null, review: "unreviewed", reviewedAt: null };
        assertResearchTaskBudget(task);
        state.tasks.push(task);
        return { task: structuredClone(task), prompt: `${preview.prompt}\n\nTask identity: ${JSON.stringify({ taskId: task.id, corpusHash: task.corpusHash })}` };
      }, signal);
      // From durable admission onward the browser request signal must not cancel tracking.
      this.active.set(root, input.id);
      const execution = this.execute(context, admitted.task, admitted.prompt);
      this.executions.add(execution);
      void execution.then(() => { this.executions.delete(execution); });
      return admitted.task;
    } finally { this.admissions.delete(root); }
  }

  private async execute(context: Authority, admitted: LibraryTask, prompt: string): Promise<void> {
    const root = context.workspace.path;
    let connection: PiWebHostPiSessionConnection | undefined;
    let unsubscribe: (() => void) | undefined;
    const pending = new Set<Promise<void>>();
    let accepting = true;
    try {
      this.lifetime.throwIfAborted();
      const running = this.dependencies.sessions.run({ projectId: context.project.id, workspaceId: context.workspace.id, prompt });
      // Even a late admission after timeout may carry an already rejected completion.
      void running.then(session => { void session.completion.catch(() => undefined); }, () => undefined);
      const session = await bounded(running, this.lifetime, 30_000);
      // Observe final rejection before connection establishment or durable publication can fail.
      const completion = session.completion.then(outcome => outcome, (error: unknown) => ({ status: "failed" as const, error: String(error) }));
      const sessionId = libraryText(session.sessionId, 512, false);
      await this.store.update(root, state => { const task = taskIn(state, admitted.id); task.sessionId = sessionId; task.status = "running"; task.message = "Waiting for a durable structured result and final initial-turn completion."; this.touch(task); });
      const connecting = this.dependencies.events.connect({ projectId: context.project.id, workspaceId: context.workspace.id, sessionId });
      // A late connection must not leak after the bounded connect wait has ended.
      void connecting.then(value => { if (!accepting) value.close(); }, () => undefined);
      connection = await bounded(connecting, this.lifetime, 30_000);
      const connected = connection;
      const tracking = AbortSignal.any([this.lifetime, connection.signal]);
      unsubscribe = connection.on(WORKBENCH_RESULT_CHANNEL, data => {
        if (!accepting || pending.size >= 8) return;
        const publication = this.publish(root, admitted.id, sessionId, data, connected, tracking);
        pending.add(publication);
        void publication.then(() => { pending.delete(publication); });
      });
      const outcome = await bounded(completion, tracking, 30 * 60_000);
      accepting = false;
      await Promise.all(pending);
      await this.store.update(root, state => {
        const task = taskIn(state, admitted.id);
        if (outcome.status === "completed" && task.result !== null) {
          assertFresh(state, task);
          task.status = "completed"; task.message = "Structured result recorded. Execution completed; human acceptance is still required.";
        } else {
          task.status = outcome.status === "cancelled" ? "cancelled" : "failed";
          task.message = outcome.status === "failed" ? outcome.error.slice(0, 1_000) : outcome.status === "cancelled" ? "Initial turn cancelled; any saved result is not eligible for acceptance." : "Initial turn ended without a structured result. Companion tools may be missing or publication failed; inspect Sessions.";
        }
        this.touch(task);
      });
    } catch (error) {
      accepting = false;
      await Promise.all(pending);
      const message = `Research tracking interrupted: ${String(error)}. The conversation may still exist; inspect Sessions before starting again.`.slice(0, 1_500);
      try { await this.store.update(root, state => { const task = taskIn(state, admitted.id); task.status = "interrupted"; task.message = message; this.touch(task); }); }
      catch (failure) { this.dependencies.log(`Could not persist interrupted research task ${admitted.id}: ${String(failure)}. ${message}`); }
    } finally {
      accepting = false;
      try { unsubscribe?.(); } catch (error) { this.dependencies.log(`Research listener cleanup failed: ${String(error)}`); }
      try { connection?.close(); } catch (error) { this.dependencies.log(`Research connection cleanup failed: ${String(error)}`); }
      this.active.delete(root);
    }
  }

  private async publish(root: string, taskId: string, sessionId: string, value: unknown, connection: PiWebHostPiSessionConnection, signal: AbortSignal): Promise<void> {
    let requestId = "";
    try {
      signal.throwIfAborted();
      const input = libraryObject(value, ["version", "requestId", "taskId", "corpusHash", "result"]);
      requestId = libraryText(input["requestId"], 80, false);
      if (!/^[a-f0-9]{32}$/u.test(requestId) || input["version"] !== 1 || input["taskId"] !== taskId) throw new Error("Result request identity mismatch");
      const corpusHash = resultHashText(input["corpusHash"]);
      const receipt = await this.store.update(root, state => {
        const task = taskIn(state, taskId);
        if (task.sessionId !== sessionId || task.corpusHash !== corpusHash || task.status !== "running") throw new Error("Result does not belong to this active task and session");
        const result = validateTaskResult(input["result"], state, task);
        if (task.result !== null) {
          if (JSON.stringify(task.result) !== JSON.stringify(result)) throw new Error("A different result was already published");
        } else {
          const candidate = { ...task, result, message: "Structured result saved; awaiting final initial-turn outcome." };
          this.touch(candidate);
          assertResearchTaskBudget(candidate);
          Object.assign(task, candidate);
        }
        return { taskId, revision: task.revision };
      }, signal);
      connection.emit(WORKBENCH_ACK_CHANNEL, { version: 1, requestId, sessionId, ok: true, ...receipt });
    } catch (error) {
      if (requestId !== "" && !connection.signal.aborted) {
        try { connection.emit(WORKBENCH_ACK_CHANNEL, { version: 1, requestId, taskId, sessionId, ok: false, error: String(error).slice(0, 1_000) }); }
        catch (failure) { this.dependencies.log(`Research result acknowledgement failed: ${String(failure)}`); }
      } else this.dependencies.log(`Research result rejected: ${String(error)}`);
    }
  }

  private touch(task: LibraryTask): void { task.revision++; task.updatedAt = researchNow(); }
}

function bounded<T>(promise: Promise<T>, signal: AbortSignal, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", stop); };
    const stop = () => { cleanup(); reject(new Error("Research connection closed or tracking stopped")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("Research tracking timed out")); }, timeoutMs);
    signal.addEventListener("abort", stop, { once: true });
    void promise.then(value => { cleanup(); resolve(value); }, (error: unknown) => { cleanup(); reject(error instanceof Error ? error : new Error(String(error))); });
    if (signal.aborted) stop();
  });
}
