/**
 * MessageBubble — renders a single transcript message.
 *
 * Shows: speaker avatar/color, name, title, message content, timestamp.
 * Uses the panelist's color for visual identity.
 * System notifications are rendered differently from panelist messages.
 */

import type { Message } from "../../types/message.js";
import type { Panelist } from "../../types/panelist.js";
import styles from "./MessageBubble.module.css";

interface MessageBubbleProps {
  message: Message;
  /** The panelist who sent this message, if any (resolved from panelistId). */
  speaker?: Panelist | null;
}

export function MessageBubble({ message, speaker }: MessageBubbleProps) {
  const isSystem = message.kind === "system_notification" || message.role === "user";
  const time = new Date(message.createdAt).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  // System notification or user message — simple centered display
  if (isSystem || !speaker) {
    return (
      <div className={styles.system}>
        <span className={styles.systemTime}>{time}</span>
        <p className={styles.systemContent}>{message.content}</p>
      </div>
    );
  }

  const isHost = speaker.role === "host";
  const kindLabel = message.kind === "moderator_opening"
    ? "开场"
    : message.kind === "moderator_closing"
      ? "总结"
      : undefined;

  return (
    <div className={styles.bubble}>
      <div
        className={styles.avatar}
        style={{ backgroundColor: speaker.color }}
      >
        {speaker.name.charAt(0)}
      </div>

      <div className={styles.body}>
        <div className={styles.meta}>
          <span className={styles.name} style={{ color: speaker.color }}>
            {speaker.name}
          </span>
          <span className={styles.role}>
            {isHost ? "主持人" : speaker.title}
          </span>
          {kindLabel && (
            <span className={styles.kind}>{kindLabel}</span>
          )}
          <span className={styles.time}>{time}</span>
        </div>

        <p className={styles.content}>{message.content}</p>
      </div>
    </div>
  );
}
