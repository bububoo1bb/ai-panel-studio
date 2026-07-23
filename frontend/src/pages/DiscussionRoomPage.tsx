/**
 * DiscussionRoomPage — route: /discussion/:id
 *
 * Core product page: three-column studio layout.
 * - Left: ExpertPanel (panelist status cards)
 * - Center: TranscriptPanel (live transcript)
 * - Right: InsightPanel (consensus & divergence)
 *
 * Follows DDD.md §3 演播厅页面设计 exactly.
 *
 * M16: Discussion execution support — start button, execution state,
 *      and temporary HTTP polling for transcript updates.
 *      Polling is isolated in one useEffect; replacing with SSE
 *      changes one location only.
 *
 * Future: SSE event streaming for real-time updates.
 *   eventSource.addEventListener("message_created", ...);
 *   eventSource.addEventListener("expert_status_update", ...);
 *   eventSource.addEventListener("consensus_updated", ...);
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import type { Discussion } from "../types/discussion.js";
import type { Panelist } from "../types/panelist.js";
import type { Message } from "../types/message.js";
import { fetchDiscussion, startDiscussion } from "../api/discussionApi.js";
import { fetchPanelists } from "../api/panelistApi.js";
import { fetchMessages } from "../api/messageApi.js";
import { ExpertPanel } from "../components/discussion/ExpertPanel.js";
import { TranscriptPanel } from "../components/discussion/TranscriptPanel.js";
import { InsightPanel } from "../components/discussion/InsightPanel.js";
import styles from "./DiscussionRoomPage.module.css";

type PageState = "loading" | "error" | "ready";
/** Discussion execution state — separate from page load state. */
type ExecutionState = "idle" | "running" | "finished";

export default function DiscussionRoomPage() {
  const { id } = useParams<{ id: string }>();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [discussion, setDiscussion] = useState<Discussion | null>(null);
  const [panelists, setPanelists] = useState<Panelist[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  const [executionState, setExecutionState] = useState<ExecutionState>("idle");
  const [executionError, setExecutionError] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadData = useCallback(async () => {
    if (!id) return;

    setPageState("loading");
    setError(null);

    try {
      const [disc, panels, msgs] = await Promise.all([
        fetchDiscussion(id),
        fetchPanelists(id),
        fetchMessages(id),
      ]);

      setDiscussion(disc);
      setPanelists(panels);
      setMessages(msgs);

      // Determine active speaker from the latest message
      if (msgs.length > 0) {
        const lastMsg = msgs[msgs.length - 1];
        setActiveSpeakerId(lastMsg.panelistId);
      }

      // Determine execution state from discussion status
      if (disc.status === "finished") {
        setExecutionState("finished");
      } else if (msgs.length > 0) {
        // Discussion is active with messages — may be mid-execution
        // (page refresh during a running discussion)
        setExecutionState("running");
      } else {
        setExecutionState("idle");
      }

      setPageState("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载讨论失败");
      setPageState("error");
    }
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Start discussion handler ────────────────────────────────
  const handleStart = useCallback(async () => {
    if (!id) return;

    setExecutionError(null);
    setExecutionState("running");

    try {
      await startDiscussion(id, 5); // default maxRounds = 5
    } catch (err) {
      setExecutionError(
        err instanceof Error ? err.message : "讨论启动失败",
      );
      setExecutionState("idle");
    }
  }, [id]);

  // ── M16 TEMPORARY: HTTP polling for transcript updates ──────
  // Replaced by SSE event streaming in a future milestone.
  // The polling logic is isolated in this single useEffect.
  useEffect(() => {
    if (!id || executionState !== "running") return;

    const poll = async () => {
      try {
        const [disc, msgs] = await Promise.all([
          fetchDiscussion(id),
          fetchMessages(id),
        ]);

        setDiscussion(disc);
        setMessages(msgs);

        // Update active speaker
        if (msgs.length > 0) {
          const lastMsg = msgs[msgs.length - 1];
          setActiveSpeakerId(lastMsg.panelistId);
        }

        // Check if discussion has finished
        if (disc.status === "finished") {
          setExecutionState("finished");
        }
      } catch {
        // Polling failure is silent — retry on next interval
      }
    };

    // Initial poll immediately
    poll();

    pollingRef.current = setInterval(poll, 2000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [id, executionState]);

  // ── Loading state ──────────────────────────────────────────
  if (pageState === "loading") {
    return (
      <div className={styles.statusPage}>
        <p className={styles.statusText}>加载讨论中…</p>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────
  if (pageState === "error") {
    return (
      <div className={styles.statusPage}>
        <p className={styles.errorText}>{error}</p>
        <div className={styles.statusActions}>
          <button className="btn btn-secondary" onClick={loadData}>
            重试
          </button>
          <Link to="/" className="btn btn-ghost">
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  // ── Studio Room ────────────────────────────────────────────
  return (
    <div className={styles.room}>
      {/* Top bar */}
      <header className={styles.topBar}>
        <Link to="/" className={styles.backLink}>
          ← 返回
        </Link>
        <h1 className={styles.topic}>{discussion?.title ?? "讨论演播厅"}</h1>
        <div className={styles.topRight}>
          {executionState === "idle" && (
            <button
              className={styles.startButton}
              onClick={handleStart}
              disabled={panelists.length === 0}
            >
              开始讨论
            </button>
          )}
          {executionState === "running" && (
            <span className={styles.onAir}>● ON AIR</span>
          )}
          {executionState === "finished" && (
            <span className={styles.finishedBadge}>讨论已结束</span>
          )}
        </div>
      </header>

      {/* Execution error banner */}
      {executionError && (
        <div className={styles.executionError}>
          <span>{executionError}</span>
          <button
            className={styles.retryButton}
            onClick={() => setExecutionError(null)}
          >
            ×
          </button>
        </div>
      )}

      {/* Three-column layout */}
      <div className={styles.columns}>
        <aside className={styles.left}>
          <ExpertPanel
            panelists={panelists}
            activeSpeakerId={activeSpeakerId}
          />
        </aside>

        <main className={styles.center}>
          <TranscriptPanel
            messages={messages}
            panelists={panelists}
            discussionStatus={discussion?.status}
          />
        </main>

        <aside className={styles.right}>
          <InsightPanel
            discussionStatus={discussion?.status}
          />
        </aside>
      </div>
    </div>
  );
}
