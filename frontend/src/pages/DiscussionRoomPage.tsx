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
import { fetchDiscussion, startDiscussion, stopDiscussion, fetchInsights, fetchSummary, type InsightData } from "../api/discussionApi.js";
import { fetchPanelists } from "../api/panelistApi.js";
import { fetchMessages } from "../api/messageApi.js";
import { ExpertPanel } from "../components/discussion/ExpertPanel.js";
import { TranscriptPanel } from "../components/discussion/TranscriptPanel.js";
import { InsightPanel } from "../components/discussion/InsightPanel.js";
import styles from "./DiscussionRoomPage.module.css";

type PageState = "loading" | "error" | "ready";
/** Discussion execution state — separate from page load state. */
type ExecutionState = "idle" | "running" | "stopped" | "finished";

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
  const [insights, setInsights] = useState<InsightData>({ consensus: [], divergence: [] });
  const [insightPhase, setInsightPhase] = useState<string>("waiting");
  const [finalSummary, setFinalSummary] = useState<string>("");
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadData = useCallback(async () => {
    if (!id) return;

    setPageState("loading");
    setError(null);

    try {
      const [disc, panels, msgs, insightData] = await Promise.all([
        fetchDiscussion(id),
        fetchPanelists(id),
        fetchMessages(id),
        fetchInsights(id).catch(() => ({ consensus: [], divergence: [], phase: "waiting" })),
      ]);

      setDiscussion(disc);
      setPanelists(panels);
      setMessages(msgs);
      setInsights(insightData);
      if ((insightData as Record<string, unknown>).phase) {
        setInsightPhase((insightData as Record<string, unknown>).phase as string);
      }
      if ((insightData as Record<string, unknown>).summary) {
        setFinalSummary((insightData as Record<string, unknown>).summary as string);
      }

      // Determine active speaker from the latest message
      if (msgs.length > 0) {
        const lastMsg = msgs[msgs.length - 1];
        setActiveSpeakerId(lastMsg.panelistId);
      }

      // Determine execution state from discussion status
      if (disc.status === "finished") {
        setExecutionState("finished");
      } else if (disc.status === "stopped") {
        setExecutionState("stopped");
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
      const maxRounds = 50; // generous cap, user stops when ready
      await startDiscussion(id, maxRounds);
    } catch (err) {
      setExecutionError(
        err instanceof Error ? err.message : "讨论启动失败",
      );
      setExecutionState("idle");
    }
  }, [id]);

  // ── Stop discussion handler ──────────────────────────────────
  const handleStop = useCallback(async () => {
    if (!id) return;

    try {
      await stopDiscussion(id);
      setExecutionState("stopped");
    } catch (err) {
      setExecutionError(
        err instanceof Error ? err.message : "停止讨论失败",
      );
    }
  }, [id]);

  // ── M16 TEMPORARY: HTTP polling for transcript updates ──────
  // Replaced by SSE event streaming in a future milestone.
  // The polling logic is isolated in this single useEffect.
  useEffect(() => {
    if (!id || executionState !== "running") return;

    const poll = async () => {
      try {
        const [disc, panels, msgs, insightData] = await Promise.all([
          fetchDiscussion(id),
          fetchPanelists(id),
          fetchMessages(id),
          fetchInsights(id).catch(() => ({ consensus: [], divergence: [] })),
        ]);

        setDiscussion(disc);
        setPanelists(panels);
        setMessages(msgs);
        setInsights(insightData);
        if ((insightData as Record<string, unknown>).phase) {
          setInsightPhase((insightData as Record<string, unknown>).phase as string);
        }

        // Update active speaker
        if (msgs.length > 0) {
          const lastMsg = msgs[msgs.length - 1];
          setActiveSpeakerId(lastMsg.panelistId);
        }

        // Check if discussion has finished or been stopped
        if (disc.status === "finished") {
          setExecutionState("finished");
          // Fetch final summary
          fetchSummary(id).then((s) => setFinalSummary(s.moderatorSummary ?? "")).catch(() => {});
        } else if (disc.status === "stopped") {
          setExecutionState("stopped");
          fetchSummary(id).then((s) => setFinalSummary(s.moderatorSummary ?? "")).catch(() => {});
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
              disabled={panelists.filter((p) => p.role === "expert").length === 0}
            >
              开始讨论
            </button>
          )}
          {executionState === "running" && (
            <>
              <span className={styles.onAir}>● ON AIR</span>
              <button
                className={styles.stopButton}
                onClick={handleStop}
              >
                停止讨论
              </button>
            </>
          )}
          {executionState === "stopped" && (
            <span className={styles.stoppedBadge}>讨论已停止</span>
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
            consensus={insights.consensus}
            divergence={insights.divergence}
            discussionStatus={discussion?.status}
            phase={insightPhase}
            finalSummary={finalSummary || undefined}
          />
        </aside>
      </div>
    </div>
  );
}
