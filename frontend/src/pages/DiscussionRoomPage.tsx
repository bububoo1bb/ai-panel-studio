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
 * TODO: Real-time updates via SSE — currently polls on mount only.
 *       When GET /api/discussions/:id/events (SSE) is implemented,
 *       subscribe to expert_status_update, message_created, and
 *       consensus_updated events for live updates.
 */

import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import type { Discussion } from "../types/discussion.js";
import type { Panelist } from "../types/panelist.js";
import type { Message } from "../types/message.js";
import { fetchDiscussion } from "../api/discussionApi.js";
import { fetchPanelists } from "../api/panelistApi.js";
import { fetchMessages } from "../api/messageApi.js";
import { ExpertPanel } from "../components/discussion/ExpertPanel.js";
import { TranscriptPanel } from "../components/discussion/TranscriptPanel.js";
import { InsightPanel } from "../components/discussion/InsightPanel.js";
import styles from "./DiscussionRoomPage.module.css";

type PageState = "loading" | "error" | "ready";

export default function DiscussionRoomPage() {
  const { id } = useParams<{ id: string }>();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [discussion, setDiscussion] = useState<Discussion | null>(null);
  const [panelists, setPanelists] = useState<Panelist[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);

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

      setPageState("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载讨论失败");
      setPageState("error");
    }
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // TODO: Set up SSE connection for real-time updates
  // useEffect(() => {
  //   if (!id || pageState !== "ready") return;
  //
  //   const eventSource = new EventSource(`/api/discussions/${id}/events`);
  //
  //   eventSource.addEventListener("message_created", (e) => {
  //     const msg: Message = JSON.parse(e.data);
  //     setMessages((prev) => [...prev, msg]);
  //     setActiveSpeakerId(msg.panelistId);
  //   });
  //
  //   eventSource.addEventListener("expert_status_update", (e) => {
  //     const update = JSON.parse(e.data);
  //     setPanelists((prev) =>
  //       prev.map((p) =>
  //         p.id === update.expert_id ? { ...p, status: update.status } : p,
  //       ),
  //     );
  //   });
  //
  //   return () => eventSource.close();
  // }, [id, pageState]);

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
          {discussion?.status === "active" && (
            <span className={styles.onAir}>● ON AIR</span>
          )}
        </div>
      </header>

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
