/**
 * DashboardPage — route: /
 *
 * Lists all discussions and provides navigation to create a new one.
 * Fetches discussions and their panelist counts on mount.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Discussion } from "../types/discussion.js";
import { fetchDiscussions } from "../api/discussionApi.js";
import { fetchPanelists } from "../api/panelistApi.js";
import { DiscussionList } from "../components/discussion/DiscussionList.js";
import styles from "./DashboardPage.module.css";

export default function DashboardPage() {
  const [discussions, setDiscussions] = useState<Discussion[]>([]);
  const [expertCounts, setExpertCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const list = await fetchDiscussions();
        if (cancelled) return;
        setDiscussions(list);

        // Fetch panelist counts for each discussion in parallel
        const counts: Record<string, number> = {};
        await Promise.all(
          list.map(async (d) => {
            try {
              const panelists = await fetchPanelists(d.id);
              counts[d.id] = panelists.length;
            } catch {
              counts[d.id] = 0;
            }
          }),
        );
        if (!cancelled) setExpertCounts(counts);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>AI Panel Studio</h1>
          <p className={styles.subtitle}>AI 圆桌讨论演播室</p>
        </div>
        <Link to="/create" className="btn btn-primary">
          + 创建讨论
        </Link>
      </header>

      <main className={styles.main}>
        {loading && (
          <div className={styles.status}>
            <p className={styles.statusText}>加载中…</p>
          </div>
        )}

        {error && (
          <div className={styles.status}>
            <p className={styles.errorText}>{error}</p>
            <button
              className="btn btn-secondary"
              onClick={() => window.location.reload()}
            >
              重试
            </button>
          </div>
        )}

        {!loading && !error && (
          <DiscussionList
            discussions={discussions}
            expertCounts={expertCounts}
          />
        )}
      </main>
    </div>
  );
}
