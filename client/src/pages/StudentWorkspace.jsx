import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, apiUpload } from '../api.js';
import StatusBadge, { statusText } from '../components/StatusBadge.jsx';

const EMPTY_PROFILE_FORM = {
  phone: '',
  gender: '',
  graduationDate: '',
  enrolledAt: '',
  remark: ''
};

const PRIORITY_PENDING_HOMEWORK_LIMIT = 5;

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
    interviewRecords: readList(payload, 'interviewRecords', 'interviews'),
    scheduleGuard: payload?.scheduleGuard || {
      canRequest: false,
      unfinishedCount: 0,
      maxUnfinishedCount: 3,
      pendingTranscriptSchedules: []
    }
  };
}

function toProfileForm(student) {
  return {
    phone: student?.phone || '',
    gender: student?.gender || '',
    graduationDate: student?.graduationDate || '',
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

function scheduleEntryText(student, guard) {
  if (student?.status === 'archived') return '学生档案已归档，暂不能申请面试排期。';
  if (student?.learningStage === 'studying') return '进入求职中后可申请面试排期。';
  if (student?.learningStage === 'employed') return '已就业学生默认不再开放新的面试排期。';
  if (!guard?.canRequest && guard?.reason === 'interview transcript required') {
    return '请先补齐已完成面试的 TXT 面试记录后再申请新的排期。';
  }
  if (!guard?.canRequest && guard?.reason === 'unfinished schedule limit reached') {
    return `当前未完成面试已达 ${guard.maxUnfinishedCount || 3} 个，请等待处理后再申请。`;
  }
  return '进入我的排期，查看本周时间并提交预约申请。';
}

export default function StudentWorkspace({ user = {} }) {
  const [student, setStudent] = useState(null);
  const [homeworkRecords, setHomeworkRecords] = useState([]);
  const [interviewRecords, setInterviewRecords] = useState([]);
  const [scheduleGuard, setScheduleGuard] = useState({
    canRequest: false,
    unfinishedCount: 0,
    maxUnfinishedCount: 3,
    pendingTranscriptSchedules: []
  });
  const [profileForm, setProfileForm] = useState(EMPTY_PROFILE_FORM);
  const [profileExpanded, setProfileExpanded] = useState(false);
  const [showHistoryPendingHomework, setShowHistoryPendingHomework] = useState(false);
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
      setScheduleGuard(workspace.scheduleGuard);
    } catch (err) {
      setStudent(null);
      setHomeworkRecords([]);
      setInterviewRecords([]);
      setScheduleGuard({
        canRequest: false,
        reason: 'student account not bound',
        unfinishedCount: 0,
        maxUnfinishedCount: 3,
        pendingTranscriptSchedules: []
      });
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

  const pendingHomeworkRecords = useMemo(() => {
    return sortedHomeworkRecords.filter((record) => !isHomeworkSubmitted(record));
  }, [sortedHomeworkRecords]);

  const priorityPendingHomeworkRecords = useMemo(() => {
    return pendingHomeworkRecords.slice(0, PRIORITY_PENDING_HOMEWORK_LIMIT);
  }, [pendingHomeworkRecords]);

  const historyPendingHomeworkRecords = useMemo(() => {
    return pendingHomeworkRecords.slice(PRIORITY_PENDING_HOMEWORK_LIMIT);
  }, [pendingHomeworkRecords]);

  const submittedHomeworkRecords = useMemo(() => {
    return sortedHomeworkRecords
      .filter(isHomeworkSubmitted)
      .sort((left, right) => String(right.submitAt || '').localeCompare(String(left.submitAt || '')));
  }, [sortedHomeworkRecords]);

  const recentSubmittedHomeworkRecords = useMemo(() => {
    return submittedHomeworkRecords.slice(0, 4);
  }, [submittedHomeworkRecords]);

  const recentInterviewRecords = useMemo(() => {
    return [...interviewRecords]
      .sort((left, right) => String(right.interviewAt || '').localeCompare(String(left.interviewAt || '')))
      .slice(0, 3);
  }, [interviewRecords]);

  const scheduleHint = scheduleEntryText(student, scheduleGuard);
  const canOpenSchedule = student?.learningStage === 'job_seeking' && student?.status !== 'archived';
  const profileSummary = useMemo(() => {
    const fields = [
      { label: '手机号', value: student?.phone },
      { label: '性别', value: student?.gender },
      { label: '毕业日期', value: student?.graduationDate },
      { label: '入学日期', value: student?.enrolledAt },
      { label: '备注', value: student?.remark, display: student?.remark ? '已填写' : '未填写' }
    ];
    const completed = fields.filter((field) => String(field.value || '').trim()).length;
    const total = fields.length;
    const missingFields = fields.filter((field) => !String(field.value || '').trim());
    return {
      fields,
      missingFields,
      completed,
      total,
      percent: total ? Math.round((completed / total) * 100) : 0
    };
  }, [student]);

  function updateProfileForm(field, value) {
    setProfileForm((current) => ({ ...current, [field]: value }));
  }

  async function handleProfileSubmit(event) {
    event.preventDefault();
    if (!student?.id) return;

    const payload = {
      phone: profileForm.phone.trim(),
      gender: profileForm.gender.trim(),
      graduationDate: profileForm.graduationDate,
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
      setProfileExpanded(false);
      setSuccess('个人资料已保存。姓名和班级仍由教务端统一维护。');
    } catch (err) {
      setError(err.message || '个人资料保存失败');
    } finally {
      setSavingProfile(false);
    }
  }

  function handleProfileCancel() {
    setProfileForm(toProfileForm(student));
    setProfileExpanded(false);
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

  function renderHomeworkTask(record) {
    return (
      <article className="homework-card homework-task-row is-pending" key={record.id}>
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
        </div>
        <form className="homework-upload-form homework-task-action" onSubmit={(event) => handleHomeworkSubmit(event, record)}>
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
            {submittingHomeworkId === record.id ? '正在上传...' : '上传作业'}
          </button>
        </form>
      </article>
    );
  }

  return (
    <section className="page student-workspace">
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
          <section className="panel student-overview-card student-overview-strip">
            <div className="student-overview-main">
              <div className="student-overview-title">
                <h2>{student.name}</h2>
                <StatusBadge status={student.learningStage || 'studying'} />
              </div>
              <div className="student-overview-meta">
                <span>班级：{student.className || '未分配'}</span>
                <span>账号：{user.username || '-'}</span>
                <span>手机：{student.phone || '未填'}</span>
              </div>
            </div>
            <div className="student-metric-grid student-overview-metrics">
              <div className="metric">
                <span>全部作业</span>
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
                  <h2>我的作业</h2>
                  <p className="muted">优先处理待提交作业，已提交内容会沉淀在最近提交里。</p>
                </div>
                <StatusBadge status={homeworkSummary.pendingCount ? 'pending' : 'submitted'}>
                  待提交 {homeworkSummary.pendingCount}
                </StatusBadge>
              </div>

              <div className="homework-workspace">
                <section className="homework-workspace-section">
                  <div className="homework-section-heading">
                    <div>
                      <h3>优先处理</h3>
                      <p>逾期未交和临近截止的作业优先展示，最多显示 5 条。</p>
                    </div>
                    <span>{pendingHomeworkRecords.length} 项</span>
                  </div>

                  {!pendingHomeworkRecords.length ? (
                    <div className="empty-state student-homework-empty">
                      <strong>当前暂无待提交作业</strong>
                      <span>{homeworkRecords.length ? '已提交作业可在下方最近提交中查看。' : '老师发布班级作业后，会显示在这里。'}</span>
                    </div>
                  ) : (
                    <div className="homework-card-list">
                      {priorityPendingHomeworkRecords.map(renderHomeworkTask)}
                    </div>
                  )}
                </section>

                {historyPendingHomeworkRecords.length ? (
                  <section className="homework-workspace-section homework-history-section">
                    <div className="homework-history-summary">
                      <div>
                        <h3>历史待补交</h3>
                        <p>还有 {historyPendingHomeworkRecords.length} 项未在首屏展开，任务不会隐藏或删除。</p>
                      </div>
                      <button
                        className="button button-secondary"
                        type="button"
                        onClick={() => setShowHistoryPendingHomework((current) => !current)}
                      >
                        {showHistoryPendingHomework ? '收起' : '展开全部'}
                      </button>
                    </div>
                    {showHistoryPendingHomework ? (
                      <div className="homework-card-list homework-history-list">
                        {historyPendingHomeworkRecords.map(renderHomeworkTask)}
                      </div>
                    ) : null}
                  </section>
                ) : null}

                <section className="homework-workspace-section homework-recent-section">
                  <div className="homework-section-heading">
                    <div>
                      <h3>最近提交</h3>
                      <p>只保留作业相关记录，不重复资料和排期信息。</p>
                    </div>
                    <span>{submittedHomeworkRecords.length} 项</span>
                  </div>

                  {!recentSubmittedHomeworkRecords.length ? (
                    <div className="homework-recent-empty">暂无提交记录，完成上传后会在这里显示文件和时间。</div>
                  ) : (
                    <div className="homework-recent-list">
                      {recentSubmittedHomeworkRecords.map((record) => (
                        <article className="homework-recent-item" key={record.id}>
                          <div>
                            <strong>{record.homeworkName || '未命名作业'}</strong>
                            <p>
                              {record.submitAt ? formatDateTime(record.submitAt) : '未记录提交时间'}
                              {record.fileName ? ` / ${record.fileName}` : ''}
                              {formatFileSize(record.fileSize) ? ` / ${formatFileSize(record.fileSize)}` : ''}
                            </p>
                          </div>
                          {record.fileName ? (
                            <a className="inline-link" href={`/api/homework/${record.id}/file`}>下载文件</a>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  )}
                </section>

                <div className="homework-note-strip">
                  <strong>提交说明</strong>
                  <span>仅支持 TXT 文件；如需重新提交，请重新选择文件上传，系统以最后一次成功上传为准。</span>
                </div>
              </div>
            </section>

            <aside className="student-side-column">
              <section className="panel student-profile-card">
                <div className="panel-header">
                  <div>
                    <h2>资料补全</h2>
                    <p className="muted">姓名和班级由教务维护，其余资料可自行补充。</p>
                  </div>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => setProfileExpanded((current) => !current)}
                  >
                    {profileExpanded ? '收起' : '编辑资料'}
                  </button>
                </div>

                <div className="student-profile-summary-card">
                  <div className="profile-completion-row">
                    <div>
                      <strong>资料完整度</strong>
                      <span>{profileSummary.completed}/{profileSummary.total} 项已填写</span>
                    </div>
                    <b>{profileSummary.percent}%</b>
                  </div>
                  <div className="profile-completion-track">
                    <span style={{ width: `${profileSummary.percent}%` }} />
                  </div>
                  <div className="profile-missing-list">
                    {profileSummary.missingFields.length ? (
                      <>
                        <span>待补充</span>
                        <div>
                          {profileSummary.missingFields.slice(0, 4).map((field) => (
                            <b key={field.label}>{field.label}</b>
                          ))}
                        </div>
                      </>
                    ) : (
                      <>
                        <span>资料状态</span>
                        <div><b>已补全</b></div>
                      </>
                    )}
                  </div>
                </div>

                {profileExpanded ? (
                  <form className="student-profile-form" onSubmit={handleProfileSubmit}>
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
                      毕业日期
                      <input
                        type="date"
                        value={profileForm.graduationDate}
                        onChange={(event) => updateProfileForm('graduationDate', event.target.value)}
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
                    <div className="form-actions compact-actions">
                      <button className="button button-primary" type="submit" disabled={savingProfile}>
                        {savingProfile ? '正在保存...' : '保存资料'}
                      </button>
                      <button className="button button-secondary" type="button" onClick={handleProfileCancel} disabled={savingProfile}>
                        取消
                      </button>
                    </div>
                  </form>
                ) : null}
              </section>

              <section className="panel student-schedule-entry-card student-side-card">
                <div>
                  <h2>面试排期</h2>
                  <p className="muted">{scheduleHint}</p>
                </div>
                <div className="record-meta-row">
                  <StatusBadge status={canOpenSchedule ? 'job_seeking' : 'pending'}>
                    未完成面试 {scheduleGuard?.unfinishedCount || 0}/{scheduleGuard?.maxUnfinishedCount || 3}
                  </StatusBadge>
                </div>
                <a className={canOpenSchedule ? 'button button-secondary' : 'button button-secondary is-disabled'} href="#student-schedules">
                  查看我的排期
                </a>
              </section>

              <section className="panel student-side-card student-recent-card">
                <div className="panel-header">
                  <div>
                    <h2>最近面试记录</h2>
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
