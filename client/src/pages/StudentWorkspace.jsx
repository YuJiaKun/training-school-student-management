import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '../api.js';
import StatusBadge, { statusText } from '../components/StatusBadge.jsx';

const DEFAULT_FORM = {
  teacherId: '1',
  teacherName: '张老师',
  companyName: '',
  positionName: '',
  startsAt: '',
  endsAt: '',
  remark: ''
};

function formatDateTime(value) {
  if (!value) return '未设置时间';
  return value.replace('T', ' ').slice(0, 16);
}

export default function StudentWorkspace({ user = {} }) {
  const [student, setStudent] = useState(null);
  const [homeworkRecords, setHomeworkRecords] = useState([]);
  const [interviewRecords, setInterviewRecords] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const hasStudent = Boolean(student?.id);

  async function loadStudentData() {
    setLoading(true);
    setError('');
    try {
      const studentData = await apiGet('/api/students?pageSize=1000');
      const studentItems = studentData.items || [];
      const matchedStudent = studentItems.find((item) => Number(item.id) === Number(user.studentId)) || studentItems[0] || null;
      setStudent(matchedStudent);

      if (!matchedStudent) {
        setHomeworkRecords([]);
        setInterviewRecords([]);
        setSchedules([]);
        return;
      }

      const [homeworkData, interviewData, scheduleData] = await Promise.all([
        apiGet(`/api/homework?studentId=${encodeURIComponent(matchedStudent.id)}`),
        apiGet(`/api/interviews?studentId=${encodeURIComponent(matchedStudent.id)}`),
        apiGet(`/api/schedules?studentId=${encodeURIComponent(matchedStudent.id)}`)
      ]);
      setHomeworkRecords(homeworkData.items || []);
      setInterviewRecords(interviewData.items || []);
      setSchedules(scheduleData.items || []);
    } catch (err) {
      setError(err.message || '学生工作台加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStudentData();
  }, [user.studentId]);

  const overview = useMemo(() => {
    const submittedHomework = homeworkRecords.filter((record) => record.submitStatus === 'submitted' || record.submitStatus === 'reviewed').length;
    const upcomingSchedules = schedules.filter((schedule) => !['completed', 'cancelled'].includes(schedule.status)).length;
    return [
      { label: '作业记录', value: homeworkRecords.length },
      { label: '已提交作业', value: submittedHomework },
      { label: '面试记录', value: interviewRecords.length },
      { label: '进行中排期', value: upcomingSchedules }
    ];
  }, [homeworkRecords, interviewRecords, schedules]);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!student?.id) return;

    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      await apiPost('/api/schedules', {
        studentId: student.id,
        teacherId: Number(form.teacherId),
        teacherName: form.teacherName,
        companyName: form.companyName,
        positionName: form.positionName,
        startsAt: form.startsAt,
        endsAt: form.endsAt,
        remark: form.remark
      });
      setForm(DEFAULT_FORM);
      setSuccess('排期申请已提交，等待老师接收。');
      await loadStudentData();
    } catch (err) {
      setError(err.message || '排期申请提交失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="page student-workspace">
      <header className="page-header">
        <div>
          <p className="eyebrow">学生端</p>
          <h1>我的学习与面试中心</h1>
          <p className="muted">查看个人进度、作业反馈和面试记录，也可以主动发起排期申请。</p>
        </div>
      </header>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}
      {loading && <div className="empty-state">正在加载学生工作台...</div>}

      {!loading && !hasStudent && (
        <div className="empty-state">暂无可用学生档案，请管理员先创建学生后再申请排期。</div>
      )}

      {!loading && hasStudent && (
        <>
          <section className="panel student-profile">
            <div>
              <p className="eyebrow">当前学生</p>
              <h2>{student.name}</h2>
              <p>{student.className || '未分配班级'} · {student.phone || '未填写手机号'}</p>
              {user.studentId ? (
                <p className="muted">已使用当前账号绑定的学生档案。</p>
              ) : (
                <p className="muted">当前账号未绑定学生档案，系统默认展示第一个学生。</p>
              )}
            </div>
            <div className="metric-row">
              {overview.map((item) => (
                <div className="metric" key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </section>

          <div className="workspace-grid">
            <section className="panel">
              <div className="panel-header">
                <h2>作业记录</h2>
                <span>{homeworkRecords.length} 条</span>
              </div>
              {!homeworkRecords.length && <div className="empty-state">暂无作业记录。</div>}
              <div className="record-list">
                {homeworkRecords.map((record) => (
                  <article className="record-item" key={record.id}>
                    <div>
                      <strong>{record.homeworkName || '未命名作业'}</strong>
                      <p>{record.className || '未填写班级'} · <StatusBadge status={record.submitStatus} /></p>
                      <p className="muted">提交时间：{record.submitAt || '未提交'}；批改结果：{record.reviewResult ? statusText(record.reviewResult) : '暂无'}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <h2>面试记录</h2>
                <span>{interviewRecords.length} 条</span>
              </div>
              {!interviewRecords.length && <div className="empty-state">暂无面试记录。</div>}
              <div className="record-list">
                {interviewRecords.map((record) => (
                  <article className="record-item" key={record.id}>
                    <div>
                      <strong>{record.companyName || '未填写公司'} · {record.positionName || '未填写岗位'}</strong>
                      <p>{formatDateTime(record.interviewAt)} · <StatusBadge status={record.result} /></p>
                      <p className="muted">反馈：{record.feedback || '暂无'}；入职状态：{record.hiredStatus ? statusText(record.hiredStatus) : '未记录'}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </>
      )}

      <section className="panel">
        <div className="panel-header">
          <h2>申请排期</h2>
          <span>{schedules.length} 条历史排期</span>
        </div>
        <form className="schedule-form" onSubmit={handleSubmit}>
          <label>
            老师编号
            <input disabled={!hasStudent || submitting} value={form.teacherId} onChange={(event) => updateForm('teacherId', event.target.value)} required />
          </label>
          <label>
            老师姓名
            <input disabled={!hasStudent || submitting} value={form.teacherName} onChange={(event) => updateForm('teacherName', event.target.value)} required />
          </label>
          <label>
            公司名称
            <input disabled={!hasStudent || submitting} value={form.companyName} onChange={(event) => updateForm('companyName', event.target.value)} placeholder="例如：星河科技" />
          </label>
          <label>
            面试岗位
            <input disabled={!hasStudent || submitting} value={form.positionName} onChange={(event) => updateForm('positionName', event.target.value)} placeholder="例如：前端工程师" />
          </label>
          <label>
            开始时间
            <input disabled={!hasStudent || submitting} type="datetime-local" value={form.startsAt} onChange={(event) => updateForm('startsAt', event.target.value)} required />
          </label>
          <label>
            结束时间
            <input disabled={!hasStudent || submitting} type="datetime-local" value={form.endsAt} onChange={(event) => updateForm('endsAt', event.target.value)} required />
          </label>
          <label className="form-wide">
            申请说明
            <textarea disabled={!hasStudent || submitting} value={form.remark} onChange={(event) => updateForm('remark', event.target.value)} placeholder="补充期望时间、面试形式或其他说明" />
          </label>
          <button className="button button-primary" type="submit" disabled={!hasStudent || submitting}>
            {submitting ? '正在提交...' : '提交排期申请'}
          </button>
        </form>

        {hasStudent && schedules.length > 0 && (
          <div className="record-list">
            {schedules.map((schedule) => (
              <article className="record-item" key={schedule.id}>
                <div>
                  <strong>{schedule.companyName || '未填写公司'} · {schedule.positionName || '未填写岗位'}</strong>
                  <p>{formatDateTime(schedule.startsAt)} 至 {formatDateTime(schedule.endsAt)}</p>
                  <StatusBadge status={schedule.status} />
                </div>
              </article>
            ))}
          </div>
        )}

        {!hasStudent && <p className="muted">没有学生档案时无法提交排期申请。</p>}
      </section>
    </section>
  );
}
