/**
 * DiscussionList — renders a collection of DiscussionCards.
 * Handles empty state when no discussions exist.
 */

import type { Discussion } from "../../types/discussion.js";
import { DiscussionCard } from "./DiscussionCard.js";
import styles from "./DiscussionList.module.css";

interface DiscussionListProps {
  discussions: Discussion[];
  expertCounts?: Record<string, number>;
}

export function DiscussionList({ discussions, expertCounts }: DiscussionListProps) {
  if (discussions.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}>🎙️</div>
        <p className={styles.emptyTitle}>暂无讨论</p>
        <p className={styles.emptyHint}>创建第一个 AI 圆桌讨论吧</p>
      </div>
    );
  }

  return (
    <div className={styles.list}>
      {discussions.map((d) => (
        <DiscussionCard
          key={d.id}
          discussion={d}
          expertCount={expertCounts?.[d.id]}
        />
      ))}
    </div>
  );
}
