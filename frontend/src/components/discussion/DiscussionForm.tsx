/**
 * DiscussionForm — form for creating a new discussion.
 *
 * Inputs: discussion topic (required), number of experts (2-8, default 4).
 * On submit: calls the API to create the discussion, then navigates
 * to the panelist confirmation page.
 */

import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { createDiscussion } from "../../api/discussionApi.js";
import styles from "./DiscussionForm.module.css";

export function DiscussionForm() {
  const navigate = useNavigate();
  const [topic, setTopic] = useState("");
  const [expertCount, setExpertCount] = useState(4);
  const [durationLimit, setDurationLimit] = useState<number>(300);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedTopic = topic.trim();
  const isValid = trimmedTopic.length > 0 && expertCount >= 2 && expertCount <= 8;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isValid || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const discussion = await createDiscussion(trimmedTopic, durationLimit);
      // Navigate to confirmation, passing expert count for generation
      navigate(`/discussion/${discussion.id}/confirm`, {
        state: { expertCount },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败，请重试");
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className="form-group">
        <label htmlFor="topic" className="form-label">
          讨论主题
        </label>
        <input
          id="topic"
          type="text"
          className="form-input"
          placeholder="例如：新能源汽车的未来发展趋势"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          disabled={submitting}
          autoFocus
        />
        <span className="form-hint">输入一个你想要探讨的话题</span>
      </div>

      <div className="form-group">
        <label htmlFor="durationLimit" className="form-label">
          讨论时长
        </label>
        <select
          id="durationLimit"
          className="form-select"
          value={durationLimit}
          onChange={(e) => setDurationLimit(Number(e.target.value))}
          disabled={submitting}
        >
          <option value={60}>1 分钟</option>
          <option value={180}>3 分钟</option>
          <option value={300}>5 分钟</option>
        </select>
        <span className="form-hint">时间到后主持人将自动总结并结束讨论</span>
      </div>

      <div className="form-group">
        <label htmlFor="expertCount" className="form-label">
          专家人数
        </label>
        <select
          id="expertCount"
          className="form-select"
          value={expertCount}
          onChange={(e) => setExpertCount(Number(e.target.value))}
          disabled={submitting}
        >
          {[2, 3, 4, 5, 6, 7, 8].map((n) => (
            <option key={n} value={n}>
              {n} 位专家
            </option>
          ))}
        </select>
        <span className="form-hint">
          系统将自动生成 1 名主持人和 {expertCount} 名专家
        </span>
      </div>

      {error && <p className="form-error">{error}</p>}

      <button
        type="submit"
        className="btn btn-primary"
        disabled={!isValid || submitting}
      >
        {submitting ? "创建中…" : "创建讨论"}
      </button>
    </form>
  );
}
