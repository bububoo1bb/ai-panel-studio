/**
 * CreateDiscussionPage — route: /create
 *
 * Simple page wrapping the DiscussionForm with a back link.
 */

import { Link } from "react-router-dom";
import { DiscussionForm } from "../components/discussion/DiscussionForm.js";
import styles from "./CreateDiscussionPage.module.css";

export default function CreateDiscussionPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/" className={styles.back}>
          ← 返回首页
        </Link>
        <h1 className={styles.title}>创建新讨论</h1>
        <p className={styles.subtitle}>
          输入讨论主题和专家人数，系统将自动生成主持人与专家阵容
        </p>
      </header>

      <main className={styles.main}>
        <DiscussionForm />
      </main>
    </div>
  );
}
