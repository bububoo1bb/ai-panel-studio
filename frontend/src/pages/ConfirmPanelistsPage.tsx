/**
 * ConfirmPanelistsPage — route: /discussion/:id/confirm
 *
 * Calls POST /api/discussions/:id/panelists/generate to generate
 * a host + expert panel via the AI backend, then displays the
 * results for user confirmation before entering the studio.
 */

import { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import type { Panelist } from "../types/panelist.js";
import { generatePanelists } from "../api/panelistApi.js";
import styles from "./ConfirmPanelistsPage.module.css";

export default function ConfirmPanelistsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const expertCount: number = (location.state as { expertCount?: number })?.expertCount ?? 4;

  const [panelists, setPanelists] = useState<Panelist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!id) return;
    const discussionId = id; // narrow for closure

    let cancelled = false;

    async function load() {
      try {
        const generated = await generatePanelists(discussionId, expertCount);
        if (!cancelled) {
          setPanelists(generated);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "生成嘉宾失败，请重试");
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [id, expertCount]);

  const host = panelists.find((p) => p.role === "host");
  const experts = panelists.filter((p) => p.role === "expert");

  function handleConfirm() {
    if (!id || confirming) return;
    setConfirming(true);
    // Panelists are already persisted server-side by the /generate endpoint.
    // Just navigate to the studio room.
    navigate(`/discussion/${id}`);
  }

  function handleRetry() {
    setError(null);
    setLoading(true);
    // Re-trigger the effect by remounting via key change — simple approach:
    window.location.reload();
  }

  // ── Loading state ──────────────────────────────────────────
  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.statusContainer}>
          <p className={styles.statusIcon}>🤖</p>
          <p className={styles.status}>正在生成嘉宾阵容…</p>
          <p className={styles.statusHint}>AI 正在根据讨论主题创建主持人与专家</p>
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────
  if (error) {
    return (
      <div className={styles.page}>
        <div className={styles.statusContainer}>
          <p className={styles.statusIcon}>⚠️</p>
          <p className={styles.errorText}>{error}</p>
          <div className={styles.statusActions}>
            <button className="btn btn-secondary" onClick={handleRetry}>
              重试
            </button>
            <Link to="/" className="btn btn-ghost">
              返回首页
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Confirmation view ──────────────────────────────────────
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/" className={styles.back}>← 返回首页</Link>
        <h1 className={styles.title}>确认嘉宾阵容</h1>
        <p className={styles.subtitle}>
          系统已根据讨论主题生成了 1 名主持人和 {experts.length} 名专家
        </p>
      </header>

      <main className={styles.main}>
        {/* Host */}
        {host && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>主持人</h2>
            <div className={styles.hostCard}>
              <PanelistCard panelist={host} />
            </div>
          </section>
        )}

        {/* Experts */}
        {experts.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>专家嘉宾</h2>
            <div className={styles.expertGrid}>
              {experts.map((p) => (
                <PanelistCard key={p.id} panelist={p} />
              ))}
            </div>
          </section>
        )}

        <div className={styles.actions}>
          <button
            className="btn btn-primary"
            onClick={handleConfirm}
            disabled={confirming}
          >
            {confirming ? "进入中…" : "确认并进入演播厅"}
          </button>
        </div>
      </main>
    </div>
  );
}

/** Simple panelist card used on the confirmation page. */
function PanelistCard({ panelist }: { panelist: Panelist }) {
  return (
    <div
      className={styles.card}
      style={{ borderLeftColor: panelist.color }}
    >
      <div
        className={styles.avatar}
        style={{ backgroundColor: panelist.color }}
      >
        {panelist.name.charAt(0)}
      </div>
      <div className={styles.info}>
        <h3 className={styles.name}>{panelist.name}</h3>
        <p className={styles.occupation}>
          {panelist.occupation} · {panelist.title}
        </p>
        <p className={styles.stance}>{panelist.stance}</p>
      </div>
    </div>
  );
}
