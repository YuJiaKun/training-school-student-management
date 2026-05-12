import { useEffect, useState } from 'react';
import { apiGet } from '../api.js';

const defaultStats = {
  students: { total: 0, active: 0, archived: 0 },
  homework: { total: 0, completed: 0 },
  interviews: { total: 0 },
  employmentRate: 0
};

function percent(part, total) {
  if (!total) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState(defaultStats);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiGet('/api/dashboard/stats')
      .then((data) => {
        if (active) setStats({ ...defaultStats, ...data });
      })
      .catch((err) => {
        if (active) setError(err.message || '总览数据加载失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const metricCards = [
    { label: '学生总数', value: stats.students.total, hint: `在读 ${stats.students.active} 人，归档 ${stats.students.archived} 人` },
    { label: '在读学生', value: stats.students.active, hint: `在读占比 ${percent(stats.students.active, stats.students.total)}` },
    { label: '作业完成', value: `${stats.homework.completed}/${stats.homework.total}`, hint: `完成率 ${percent(stats.homework.completed, stats.homework.total)}` },
    { label: '就业率', value: `${stats.employmentRate}%`, hint: `基于 ${stats.interviews.total} 条面试记录统计` }
  ];

  return (
    <section className="admin-page admin-dashboard">
      <div className="page-header">
        <div>
          <p className="page-kicker">管理员工作台</p>
          <h1>教务 CRM 总览</h1>
          <p className="page-description">集中查看学生、作业、面试与就业转化情况，快速进入日常教务处理。</p>
        </div>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}
      {loading ? <div className="loading-state">正在加载总览数据...</div> : null}

      <div className="metric-grid">
        {metricCards.map((card) => (
          <article className="metric-card" key={card.label}>
            <span className="metric-label">{card.label}</span>
            <strong className="metric-value">{card.value}</strong>
            <span className="metric-hint">{card.hint}</span>
          </article>
        ))}
      </div>

      <div className="quick-entry-grid">
        <article className="quick-entry">
          <h2>学生管理</h2>
          <p>维护学员档案、在读状态和归档记录，支持按关键词和状态快速检索。</p>
        </article>
        <article className="quick-entry">
          <h2>作业跟进</h2>
          <p>跟进提交状态和批改结果，帮助老师定位待处理作业。</p>
        </article>
        <article className="quick-entry">
          <h2>面试记录</h2>
          <p>记录公司、岗位、面试结果和入职状态，沉淀就业过程数据。</p>
        </article>
        <article className="quick-entry">
          <h2>排期审批</h2>
          <p>处理学生发起的面试排期申请，审批通过后进入正式日程。</p>
        </article>
      </div>
    </section>
  );
}
