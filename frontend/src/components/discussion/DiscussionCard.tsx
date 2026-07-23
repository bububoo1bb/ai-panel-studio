/**
 * DiscussionCard — displays a single discussion in the dashboard list.
 *
 * Shows: topic, created time, status badge, expert count.
 * Links to the discussion room or studio depending on state.
 */

import { Link } from "react-router-dom";
import type { Discussion } from "../../types/discussion.js";
import { toDisplayStatus } from "../../types/discussion.js";
import styles from "./DiscussionCard.module.css";

interface DiscussionCardProps {
  discussion: Discussion;
  expertCount?: number;
}

const STATUS_LABELS: Record<string, string> = {
  waiting: "待开始",
  running: "进行中",
  finished: "已结束",
};

export function DiscussionCard({ discussion, expertCount }: DiscussionCardProps) {
  const displayStatus = toDisplayStatus(discussion.status);

  const formattedTime = new Date(discussion.createdAt).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Link to={`/discussion/${discussion.id}`} className={styles.card}>
      <div className={styles.header}>
        <h3 className={styles.topic}>{discussion.title}</h3>
        <span className={`${styles.badge} ${styles[`badge-${displayStatus}`]}`}>
          {STATUS_LABELS[displayStatus]}
        </span>
      </div>
      <div className={styles.meta}>
        <span className={styles.time}>{formattedTime}</span>
        {expertCount !== undefined && (
          <span className={styles.experts}>{expertCount} 位专家</span>
        )}
      </div>
    </Link>
  );
}
