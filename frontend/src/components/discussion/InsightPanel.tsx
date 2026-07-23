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
  consensus?: string[];
  divergence?: string[];
  discussionStatus?: string;
  phase?: string;
  /** Final summary string from backend (after discussion ends). */
  finalSummary?: string;
}

export function InsightPanel({
  consensus = [],
  divergence = [],
  discussionStatus,
  phase,
  finalSummary,
}: InsightPanelProps) {
  const isEmpty = consensus.length === 0 && divergence.length === 0;
  const isWaiting = phase === "waiting";
  const isFinal = phase === "final";

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>洞察分析</h2>
        {phase === "live" && <span className={styles.liveBadge}>实时</span>}
        {isFinal && <span className={styles.finalBadge}>最终</span>}
      </div>

      <div className={styles.content}>
        {isWaiting && (
          <div className={styles.empty}>
            <p className={styles.emptyText}>等待讨论产生洞察...</p>
          </div>
        )}

        {!isWaiting && isEmpty && !isFinal && (
          <div className={styles.empty}>
            <p className={styles.emptyText}>分析中...</p>
          </div>
        )}

        {/* Final Summary */}
        {isFinal && finalSummary && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>
              <span className={styles.icon}>📋</span>
              主持人总结
            </h3>
            <div className={styles.summaryBlock}>
              <p>{finalSummary}</p>
            </div>
          </section>
        )}

        {/* Divergence (final — structured) */}
        {isFinal && divergence.length > 0 && (
          <section className={styles.section}>
            <h3 className={`${styles.sectionTitle} ${styles.divergenceTitle}`}>
              <span className={styles.icon}>⚡</span>
              核心分歧
            </h3>
            <ul className={styles.list}>
              {divergence.map((item, i) => (
                <li key={`d-${i}`} className={`${styles.item} ${styles.divergenceItem}`}>
                  <p className={styles.itemContent}>{item}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Consensus (final) */}
        {isFinal && consensus.length > 0 && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>
              <span className={styles.icon}>✓</span>
              最终共识
            </h3>
            <ul className={styles.list}>
              {consensus.map((item, i) => (
                <li key={`c-${i}`} className={styles.item}>
                  <p className={styles.itemContent}>{item}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Live (during discussion) */}
        {!isWaiting && !isFinal && (
          <>
            {consensus.length > 0 && (
              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>
                  <span className={styles.icon}>✓</span>
                  当前共识
                </h3>
                <ul className={styles.list}>
                  {consensus.map((item, i) => (
                    <li key={`c-${i}`} className={styles.item}>
                      <p className={styles.itemContent}>{item}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {divergence.length > 0 && (
              <section className={styles.section}>
                <h3 className={`${styles.sectionTitle} ${styles.divergenceTitle}`}>
                  <span className={styles.icon}>⚡</span>
                  主要分歧
                </h3>
                <ul className={styles.list}>
                  {divergence.map((item, i) => (
                    <li key={`d-${i}`} className={`${styles.item} ${styles.divergenceItem}`}>
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
