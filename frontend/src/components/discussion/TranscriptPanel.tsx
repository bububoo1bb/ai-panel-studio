/**
 * TranscriptPanel — center column of the studio room.
 *
 * Displays the live transcript of the discussion as a scrollable feed.
 * Auto-scrolls to the latest message when new content arrives.
 * Shows a "waiting" state when no messages exist yet.
 */

import { useEffect, useRef } from "react";
import type { Message } from "../../types/message.js";
import type { Panelist } from "../../types/panelist.js";
import { MessageBubble } from "./MessageBubble.js";
import styles from "./TranscriptPanel.module.css";

interface TranscriptPanelProps {
  messages: Message[];
  panelists: Panelist[];
  discussionStatus?: string;
}

export function TranscriptPanel({
  messages,
  panelists,
  discussionStatus,
}: TranscriptPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const panelistMap = useRef<Map<string, Panelist>>(new Map());

  // Build panelist lookup map
  useEffect(() => {
    const map = new Map<string, Panelist>();
    for (const p of panelists) {
      map.set(p.id, p);
    }
    panelistMap.current = map;
  }, [panelists]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const isActive = discussionStatus === "active";

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>实时记录</h2>
        {isActive && <span className={styles.liveIndicator}>● 直播中</span>}
      </div>

      <div className={styles.transcript}>
        {messages.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyIcon}>🎙️</p>
            <p className={styles.emptyText}>讨论即将开始…</p>
            <p className={styles.emptyHint}>主持人正在准备开场</p>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              speaker={
                msg.panelistId
                  ? panelistMap.current.get(msg.panelistId) ?? null
                  : null
              }
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
