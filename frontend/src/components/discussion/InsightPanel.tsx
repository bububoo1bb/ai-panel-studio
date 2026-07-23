/**
 * InsightPanel — right column of the studio room.
 *
 * Displays live consensus and divergence analysis driven by
 * the backend InsightAnalyzer (GET /api/discussions/:id/insights).
 *
 * Data structure (M16.5):
 * - consensus: string[] — points where experts broadly agree
 * - divergence: string[] — points where experts disagree
 */

import styles from "./InsightPanel.module.css";

interface InsightPanelProps {
  /** Consensus points (strings from backend analysis). */
  consensus?: string[];
  /** Divergence points (strings from backend analysis). */
  divergence?: string[];
  /** Current discussion status for live badge display. */
  discussionStatus?: string;
}

export function InsightPanel({
  consensus = [],
  divergence = [],
  discussionStatus,
}: InsightPanelProps) {
  const isEmpty = consensus.length === 0 && divergence.length === 0;
  const hasContent = !isEmpty;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>洞察分析</h2>
        {discussionStatus === "active" && hasContent && (
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
                  {consensus.map((item, i) => (
                    <li key={`consensus-${i}`} className={styles.item}>
                      <p className={styles.itemContent}>{item}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Divergence Section */}
            {divergence.length > 0 && (
              <section className={styles.section}>
                <h3 className={`${styles.sectionTitle} ${styles.divergenceTitle}`}>
                  <span className={styles.icon}>⚡</span>
                  主要分歧
                </h3>
                <ul className={styles.list}>
                  {divergence.map((item, i) => (
                    <li key={`divergence-${i}`} className={`${styles.item} ${styles.divergenceItem}`}>
                      <p className={styles.itemContent}>{item}</p>
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
