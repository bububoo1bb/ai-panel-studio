/**
 * ExpertPanel — left column of the studio room.
 *
 * Displays all panelists (host first, then experts) as a scrollable list
 * of ExpertCards. The currently speaking panelist is highlighted.
 */

import type { Panelist } from "../../types/panelist.js";
import { ExpertCard } from "./ExpertCard.js";
import styles from "./ExpertPanel.module.css";

interface ExpertPanelProps {
  panelists: Panelist[];
  activeSpeakerId?: string | null;
}

export function ExpertPanel({ panelists, activeSpeakerId }: ExpertPanelProps) {
  const host = panelists.find((p) => p.role === "host");
  const experts = panelists.filter((p) => p.role === "expert");

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>嘉宾</h2>
        <span className={styles.count}>{panelists.length} 人</span>
      </div>

      <div className={styles.list}>
        {host && (
          <div className={styles.section}>
            <span className={styles.sectionLabel}>主持人</span>
            <ExpertCard
              panelist={host}
              isActive={activeSpeakerId === host.id}
            />
          </div>
        )}

        {experts.length > 0 && (
          <div className={styles.section}>
            <span className={styles.sectionLabel}>专家</span>
            <div className={styles.expertList}>
              {experts.map((p) => (
                <ExpertCard
                  key={p.id}
                  panelist={p}
                  isActive={activeSpeakerId === p.id}
                />
              ))}
            </div>
          </div>
        )}

        {panelists.length === 0 && (
          <p className={styles.empty}>暂无嘉宾信息</p>
        )}
      </div>
    </div>
  );
}
