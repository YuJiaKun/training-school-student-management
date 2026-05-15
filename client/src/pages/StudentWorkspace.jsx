import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, apiUpload } from '../api.js';
import StatusBadge, { statusText } from '../components/StatusBadge.jsx';

const EMPTY_PROFILE_FORM = {
  phone: '',
  gender: '',
  birthday: '',
  enrolledAt: '',
  remark: ''
};

function formatDateTime(value) {
  if (!value) return '未设置时间';
  return value.replace('T', ' ').slice(0, 16);
}

function formatFileSize(value) {
  const size = Number(value || 0);
  if (!size) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function readList(payload, key, fallbackKey) {
  const value = payload?.[key];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;

  const fallbackValue = payload?.[fallbackKey];
  if (Array.isArray(fallbackValue)) return fallbackValue;
  if (Array.isArray(fallbackValue?.items)) return fallbackValue.items;

  return [];
}

function normalizeWorkspacePayload(payload) {
  return {
    student: payload?.student || payload?.currentStudent || null,
    homeworkRecords: readList(payload, 'homeworkRecords', 'homework'),
    interviewRecords: readList(payload, 'interviewRecords', 'interviews')
  };
}

function toProfileForm(student) {
  return {
    phone: student?.phone || '',
    gender: student?.gender || '',
    birthday: student?.birthday || '',
    enrolledAt: student?.enrolledAt || '',
    remark: student?.remark || ''
  };
}

function homeworkStatusText(status) {
  if (status === 'submitted' || status === 'reviewed') return '已提交';
  if (status === 'pending') return '待提交';
  return statusText(status);
}

function isHomeworkSubmitted(record) {
  return record.submitStatus === 'submitted' || record.submitStatus === 'reviewed';
}

function homeworkPriority(record) {
  if (record.lateStatus === 'overduePending') return 0;
  if (!isHomeworkSubmitted(record)) return 1;
  return 2;
}

export default function StudentWorkspace({ user = {} }) {
  const [student, setStudent] = useState(null);
  const [homeworkRecords, setHomeworkRecords] = useState([]);
  const [interviewRecords, setInterviewRecords] = useState([]);
  const [profileForm, setProfileForm] = useState(EMPTY_PROFILE_FORM);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [submittingHomeworkId, setSubmittingHomeworkId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const hasStudent = Boolean(student?.id);

  async function loadStudentData() {
    setLoading(true);
    setError('');
    try {
      const payload = await apiGet('/api/student-workspace');
      const workspace = normalizeWorkspacePayload(payload);
      setStudent(workspace.student);
      setProfileForm(toProfileForm(workspace.student));
      setHomeworkRecords(workspace.homeworkRecords);
      setInterviewRecords(workspace.interviewRecords);
    } catch (err) {
      setStudent(null);
      setHomeworkRecords([]);
      setInterviewRecords([]);
      setError(err.message || '学生工作台加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStudentData();
  }, [user.studentId, user.username]);

  const homeworkSummary = useMemo(() => {
    const submittedCount = homeworkRecords.filter(isHomeworkSubmitted).length;
    const pendingCount = homeworkRecords.length - submittedCount;
    return {
      totalCount: homeworkRecords.length,
      submittedCount,
      pendingCount
    };
  }, [homeworkRecords]);

  const sortedHomeworkRecords = useMemo(() => {
    return [...homeworkRecords].sort((left, right) => {
      const priority = homeworkPriority(left) - homeworkPriority(right);
      if (priority !== 0) return priority;
      return String(left.dueDate || '').localeCompare(String(right.dueDate || ''));
    });
  }, [homeworkRecords]);

  const recentInterviewRecords = useMemo(() => {
    return [...interviewRecords]
      .sort((left, right) => String(right.interviewAt || '').localeCompare(String(left.interviewAt || '')))
      .slice(0, 3);
  }, [interviewRecords]);

  function updateProfileForm(field, value) {
    setProfileForm((current) => ({ ...current, [field]: value }));
  }

  async function handleProfileSubmit(event) {
    event.preventDefault();
    if (!student?.id) return;

    const payload = {
      phone: profileForm.phone.trim(),
      gender: profileForm.gender.trim(),
      birthday: profileForm.birthday,
      enrolledAt: profileForm.enrolledAt,
      remark: profileForm.remark.trim()
    };

    setSavingProfile(true);
    setError('');
    setSuccess('');
    try {
      const result = await apiPatch('/api/student-workspace/profile', payload);
      const nextStudent = result.student || { ...student, ...payload };
      setStudent(nextStudent);
      setProfileForm(toProfileForm(nextStudent));
      setSuccess('个人资料已保存。姓名和班级仍由教务端统一维护。');
    } catch (err) {
      setError(err.message || '个人资料保存失败');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleHomeworkSubmit(event, record) {
    event.preventDefault();
    const fileInput = event.currentTarget.elements.homeworkFile;
    const remarkInput = event.currentTarget.elements.homeworkRemark;
    const file = fileInput?.files?.[0];
    if (!file) {
      setError('请先选择要上传的作业文件');
      return;
    }

    setSubmittingHomeworkId(record.id);
    setError('');
    setSuccess('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('remark', remarkInput?.value || '');
      await apiUpload(`/api/homework/${record.id}/submission`, formData);
      setSuccess('作业已提交，老师端会同步看到提交状态。');
      await loadStudentData();
    } catch (err) {
      setError(err.message || '作业提交失败');
    } finally {
      setSubmittingHomeworkId(null);
    }
  }

  return (
    <section className="page student-workspace">
      <header className="page-header">
        <div>
          <p className="eyebrow">学生端</p>
          <h1>我的学习工作台</h1>
          <p className="muted">先完成资料补全和 TXT 作业提交；面试排期功能后续由教务统一开放。</p>
        </div>
      </header>

      {error ? <div className="alert alert-error">{error}</div> : null}
      {success ? <div className="alert alert-success">{success}</div> : null}
      {loading ? <div className="empty-state">正在加载学生工作台...</div> : null}

      {!loading && !hasStudent ? (
        <div className="empty-state">
          当前账号尚未绑定学生档案，请联系管理员完成绑定后再查看学习进度或提交作业。
        </div>
      ) : null}

      {!loading && hasStudent ? (
        <>
          <section className="panel student-summary-card">
            <div className="student-summary-main">
              <p className="eyebrow">当前学生</p>
              <h2>{student.name}</h2>
              <p>{student.className || '未分配班级'} / {student.phone || '未填写手机号'}</p>
              <span>账号：{user.username || '-'}</span>
            </div>
            <div className="student-metric-grid">
              <div className="metric">
                <span>作业数量</span>
                <strong>{homeworkSummary.totalCount}</strong>
              </div>
              <div className="metric">
                <span>已提交</span>
                <strong>{homeworkSummary.submittedCount}</strong>
              </div>
              <div className="metric">
                <span>待提交</span>
                <strong>{homeworkSummary.pendingCount}</strong>
              </div>
            </div>
          </section>

          <div className="student-workspace-layout">
            <section className="panel student-homework-panel">
              <div className="panel-header">
                <div>
                  <h2>作业提交</h2>
                  <p className="muted">只支持 TXT 文件，可重复上传，系统保留最后一次提交。</p>
                </div>
                <StatusBadge status={homeworkSummary.pendingCount ? 'pending' : 'submitted'}>
                  待提交 {homeworkSummary.pendingCount}
                </StatusBadge>
              </div>

              {!sortedHomeworkRecords.length ? (
                <div className="empty-state">暂无作业记录。</div>
              ) : (
                <div className="homework-card-list">
                  {sortedHomeworkRecords.map((record) => (
                    <article className="homework-card" key={record.id}>
                      <div className="homework-card-main">
                        <div className="homework-card-title">
                          <strong>{record.homeworkName || '未命名作业'}</strong>
                          <div className="record-meta-row">
                            <StatusBadge status={record.submitStatus === 'reviewed' ? 'submitted' : record.submitStatus}>
                              {homeworkStatusText(record.submitStatus)}
                            </StatusBadge>
                            {record.lateStatus ? <StatusBadge status={record.lateStatus}>{record.lateStatusText}</StatusBadge> : null}
                          </div>
                        </div>
                        <p className="homework-meta">
                          截止日期：{record.dueDate || '未设置'}；提交时间：{record.submitAt ? formatDateTime(record.submitAt) : '未提交'}
                        </p>
                        {record.description ? <p className="muted">说明：{record.description}</p> : null}
                        {record.fileName ? (
                          <p className="muted">
                            已上传：{record.fileName}{formatFileSize(record.fileSize) ? ` / ${formatFileSize(record.fileSize)}` : ''}
                            <a className="inline-link" href={`/api/homework/${record.id}/file`}>下载我已提交的文件</a>
                          </p>
                        ) : null}
                      </div>
                      <form className="homework-upload-form" onSubmit={(event) => handleHomeworkSubmit(event, record)}>
                        <input
                          name="homeworkFile"
                          type="file"
                          accept=".txt,text/plain"
                          disabled={submittingHomeworkId === record.id}
                          required
                        />
                        <input
                          name="homeworkRemark"
                          placeholder="备注，可选"
                          disabled={submittingHomeworkId === record.id}
                        />
                        <button className="button button-primary" type="submit" disabled={submittingHomeworkId === record.id}>
                          {submittingHomeworkId === record.id ? '正在上传...' : record.fileName ? '重新上传' : '上传作业'}
                        </button>
                      </form>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <aside className="student-side-column">
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <h2>资料补全</h2>
                    <p className="muted">手机号、生日等信息可自行补充；姓名和班级由教务维护。</p>
                  </div>
                </div>
                <form className="student-profile-form" onSubmit={handleProfileSubmit}>
                  <div className="profile-readonly">
                    <span>姓名：{student.name || '-'}</span>
                    <span>班级/课程：{student.className || '未分配班级'}</span>
                  </div>
                  <label>
                    手机号
                    <input
                      value={profileForm.phone}
                      onChange={(event) => updateProfileForm('phone', event.target.value)}
                      placeholder="填写常用手机号"
                      disabled={savingProfile}
                    />
                  </label>
                  <label>
                    性别
                    <select
                      value={profileForm.gender}
                      onChange={(event) => updateProfileForm('gender', event.target.value)}
                      disabled={savingProfile}
                    >
                      <option value="">暂不填写</option>
                      <option value="男">男</option>
                      <option value="女">女</option>
                      <option value="其他">其他</option>
                    </select>
                  </label>
                  <label>
                    出生日期
                    <input
                      type="date"
                      value={profileForm.birthday}
                      onChange={(event) => updateProfileForm('birthday', event.target.value)}
                      disabled={savingProfile}
                    />
                  </label>
                  <label>
                    入学日期
                    <input
                      type="date"
                      value={profileForm.enrolledAt}
                      onChange={(event) => updateProfileForm('enrolledAt', event.target.value)}
                      disabled={savingProfile}
                    />
                  </label>
                  <label>
                    备注
                    <textarea
                      value={profileForm.remark}
                      onChange={(event) => updateProfileForm('remark', event.target.value)}
                      placeholder="补充学习方向、联系方式偏好或其他说明"
                      disabled={savingProfile}
                    />
                  </label>
                  <button className="button button-primary" type="submit" disabled={savingProfile}>
                    {savingProfile ? '正在保存...' : '保存资料'}
                  </button>
                </form>
              </section>

              <section className="panel student-placeholder-card">
                <div className="placeholder-icon">后续</div>
                <div>
                  <h2>面试排期（暂未开放）</h2>
                  <p className="muted">当前阶段先完成学习资料和作业提交。面试排期后续由教务开放后再使用。</p>
                </div>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <h2>最近面试记录</h2>
                    <p className="muted">仅展示已有记录，不提供学生端排期申请。</p>
                  </div>
                </div>
                {!recentInterviewRecords.length ? (
                  <div className="empty-state">暂无面试记录。</div>
                ) : (
                  <div className="record-list">
                    {recentInterviewRecords.map((record) => (
                      <article className="record-item student-mini-record" key={record.id}>
                        <div>
                          <strong>{record.companyName || '未填写公司'} / {record.positionName || '未填写岗位'}</strong>
                          <p>{formatDateTime(record.interviewAt)} / {record.result ? statusText(record.result) : '未记录结果'}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </aside>
          </div>
        </>
      ) : null}
    </section>
  );
}
