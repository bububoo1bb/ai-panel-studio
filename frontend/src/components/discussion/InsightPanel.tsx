/**
 * InsightPanel — right column of the studio room.
 *
 * Displays live consensus and divergence analysis.
 * In MVP:
 * - Consensus: points where experts broadly agree
 * - Divergence: points where experts disagree or have conflicting views
 *
 * TODO: Replace hardcoded insights with data from
 *       GET /api/discussions/:id/summary (backend endpoint not yet implemented).
 *       The panel should update in real-time via SSE consensus_updated events.
 */

import { useState } from "react";
import styles from "./InsightPanel.module.css";

interface InsightItem {
  id: string;
  content: string;
  supporters?: number;
  total?: number;
}

interface InsightPanelProps {
  consensus?: InsightItem[];
  divergences?: InsightItem[];
  discussionStatus?: string;
}

export function InsightPanel({
  consensus: initialConsensus,
  divergences: initialDivergences,
  discussionStatus,
}: InsightPanelProps) {
  const [consensus] = useState<InsightItem[]>(initialConsensus ?? []);
  const [divergences] = useState<InsightItem[]>(initialDivergences ?? []);

  const isEmpty = consensus.length === 0 && divergences.length === 0;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>洞察分析</h2>
        {discussionStatus === "active" && (
          <span className={styles.liveBadge}>实时</span>
        )}
      </div>

      <div className={styles.content}>
        {isEmpty ? (
          <div className={styles.empty}>
            <p className={styles.emptyText}>
              讨论开始后将在此处实时展示共识与分歧
            </p>
          </div>
        ) : (
          <>
            {/* Consensus Section */}
            {consensus.length > 0 && (
              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>
                  <span className={styles.icon}>✓</span>
                  当前共识
                </h3>
                <ul className={styles.list}>
                  {consensus.map((item) => (
                    <li key={item.id} className={styles.item}>
                      <p className={styles.itemContent}>{item.content}</p>
                      {item.supporters !== undefined && item.total !== undefined && (
                        <span className={styles.itemMeta}>
                          {item.supporters}/{item.total} 位赞同
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Divergence Section */}
            {divergences.length > 0 && (
              <section className={styles.section}>
                <h3 className={`${styles.sectionTitle} ${styles.divergenceTitle}`}>
                  <span className={styles.icon}>⚡</span>
                  主要分歧
                </h3>
                <ul className={styles.list}>
                  {divergences.map((item) => (
                    <li key={item.id} className={`${styles.item} ${styles.divergenceItem}`}>
                      <p className={styles.itemContent}>{item.content}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
