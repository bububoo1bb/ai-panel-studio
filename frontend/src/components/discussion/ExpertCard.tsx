/**
 * ExpertCard — displays a single panelist's status in the Expert Panel.
 *
 * Shows: color avatar, name, title, current status, current focus.
 * Never exposes raw Chain-of-Thought — only status + public summary.
 */

import type { Panelist } from "../../types/panelist.js";
import { PANELIST_STATUS_LABELS } from "../../types/panelist.js";
import styles from "./ExpertCard.module.css";

interface ExpertCardProps {
  panelist: Panelist;
  isActive?: boolean;
}

export function ExpertCard({ panelist, isActive = false }: ExpertCardProps) {
  const statusLabel = PANELIST_STATUS_LABELS[panelist.status];

  return (
    <div
      className={`${styles.card} ${isActive ? styles.active : ""}`}
      style={{ "--expert-color": panelist.color } as React.CSSProperties}
    >
      <div className={styles.top}>
        <div
          className={styles.avatar}
          style={{ backgroundColor: panelist.color }}
        >
          {panelist.name.charAt(0)}
        </div>
        <div className={styles.identity}>
          <span className={styles.name}>{panelist.name}</span>
          <span className={styles.title}>
            {panelist.role === "host" ? "主持人" : panelist.title}
          </span>
        </div>
        <span className={`${styles.status} ${styles[`status-${panelist.status}`]}`}>
          <span className={styles.statusDot} />
          {statusLabel}
        </span>
      </div>

      {panelist.publicSummary && (
        <p className={styles.summary}>{panelist.publicSummary}</p>
      )}

      {panelist.currentFocus && (
        <p className={styles.focus}>
          <span className={styles.focusLabel}>关注：</span>
          {panelist.currentFocus}
        </p>
      )}
    </div>
  );
}
