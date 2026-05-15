import { useEffect, useMemo, useState } from 'react';
import { apiDelete, apiGet, apiPost } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import { buildPath } from '../utils/url.js';

const emptyAssignmentForm = {
  homeworkName: '',
  className: '',
  dueDate: '',
  description: ''
};

function percent(part, total) {
  if (!total) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

function formatDateTime(value) {
  if (!value) return '-';
  return value.replace('T', ' ').slice(0, 16);
}

function formatFileSize(value) {
  const size = Number(value || 0);
  if (!size) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function normalizeClassItem(item) {
  const className = String(item?.className || '').trim();
  if (!className) return null;
  return { ...item, className };
}

function classOptionLabel(item) {
  const count = Number(item.studentCount);
  return Number.isFinite(count) ? `${item.className}（${count} 名在读）` : item.className;
}

function homeworkStatusText(status) {
  if (status === 'submitted' || status === 'reviewed') return '已提交';
  if (status === 'pending') return '待提交';
  return status || '未知';
}

function readPendingAssignmentId() {
  const key = 'homework:selectedAssignmentId';
  const value = window.sessionStorage.getItem(key) || '';
  if (value) window.sessionStorage.removeItem(key);
  return value;
}

export default function HomeworkPage() {
  const [assignments, setAssignments] = useState([]);
  const [classes, setClasses] = useState([]);
  const [records, setRecords] = useState([]);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState('');
  const [submitStatus, setSubmitStatus] = useState('');
  const [lateStatus, setLateStatus] = useState('');
  const [keyword, setKeyword] = useState('');
  const [includeArchivedStudents, setIncludeArchivedStudents] = useState(false);
  const [form, setForm] = useState(emptyAssignmentForm);
  const [newClassName, setNewClassName] = useState('');
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [creating, setCreating] = useState(false);
  const [creatingClass, setCreatingClass] = useState(false);
  const [syncingRecords, setSyncingRecords] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const selectedAssignment = useMemo(() => {
    return assignments.find((assignment) => String(assignment.id) === String(selectedAssignmentId)) || null;
  }, [assignments, selectedAssignmentId]);
  const recordFilters = useMemo(() => ({
    assignmentId: selectedAssignmentId,
    submitStatus,
    lateStatus,
    keyword,
    includeArchivedStudents: includeArchivedStudents ? 1 : ''
  }), [selectedAssignmentId, submitStatus, lateStatus, keyword, includeArchivedStudents]);
  const exportCsvUrl = buildPath('/api/export/homework', recordFilters);
  const exportZipUrl = selectedAssignment ? `/api/export/homework/${selectedAssignment.id}.zip` : '';
  const classOptions = useMemo(() => {
    const seen = new Set();
    const options = [];
    classes.forEach((item) => {
      const option = normalizeClassItem(item);
      if (!option || seen.has(option.className)) return;
      seen.add(option.className);
      options.push(option);
    });
    const currentClassName = form.className.trim();
    if (currentClassName && !seen.has(currentClassName)) {
      options.unshift({ id: `current-${currentClassName}`, className: currentClassName });
    }
    return options;
  }, [classes, form.className]);

  async function loadClassList() {
    const classData = await apiGet('/api/classes');
    const items = (classData.items || []).map(normalizeClassItem).filter(Boolean);
    setClasses(items);
    return items;
  }

  async function loadAssignments(preferredId = '') {
    setLoadingAssignments(true);
    setError('');
    try {
      const [assignmentData] = await Promise.all([
        apiGet(buildPath('/api/homework-assignments', { includeArchivedStudents: includeArchivedStudents ? 1 : '' })),
        loadClassList()
      ]);
      const items = assignmentData.items || [];
      setAssignments(items);
      const nextId = preferredId || readPendingAssignmentId() || selectedAssignmentId || items[0]?.id || '';
      setSelectedAssignmentId(nextId ? String(nextId) : '');
    } catch (err) {
      setError(err.message || '作业任务加载失败');
    } finally {
      setLoadingAssignments(false);
    }
  }

  async function loadRecords() {
    if (!selectedAssignmentId) {
      setRecords([]);
      return;
    }
    setLoadingRecords(true);
    setError('');
    try {
      const data = await apiGet(buildPath('/api/homework', recordFilters));
      setRecords(data.items || []);
    } catch (err) {
      setError(err.message || '作业提交明细加载失败');
    } finally {
      setLoadingRecords(false);
    }
  }

  useEffect(() => {
    loadAssignments();
  }, [includeArchivedStudents]);

  useEffect(() => {
    loadRecords();
  }, [recordFilters]);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleCreateAssignment(event) {
    event.preventDefault();
    setCreating(true);
    setError('');
    setMessage('');
    try {
      const created = await apiPost('/api/homework-assignments', {
        homeworkName: form.homeworkName.trim(),
        className: form.className.trim(),
        dueDate: form.dueDate,
        description: form.description.trim()
      });
      setForm(emptyAssignmentForm);
      setMessage(`已发布作业，并生成 ${created.records?.length || 0} 条待提交记录`);
      await loadAssignments(created.assignment?.id);
    } catch (err) {
      setError(err.message || '发布作业失败');
    } finally {
      setCreating(false);
    }
  }

  async function handleCreateClass() {
    const className = newClassName.trim();
    if (!className) {
      setError('请先填写班级/课程名称');
      return;
    }

    setCreatingClass(true);
    setError('');
    setMessage('');
    try {
      const result = await apiPost('/api/classes', { className });
      const selectedClassName = result.class?.className || className;
      setNewClassName('');
      setForm((current) => ({ ...current, className: selectedClassName }));
      await loadClassList();
      setMessage(`已新增班级/课程：${selectedClassName}`);
    } catch (err) {
      setError(err.message || '新增班级/课程失败');
    } finally {
      setCreatingClass(false);
    }
  }

  async function handleSyncRecords() {
    if (!selectedAssignment) return;
    setSyncingRecords(true);
    setError('');
    setMessage('');
    try {
      const result = await apiPost(`/api/homework-assignments/${selectedAssignment.id}/sync-records`, {});
      setMessage(result.createdCount ? `已补发 ${result.createdCount} 条待提交记录` : '名单已是最新，无需补发');
      await loadAssignments(selectedAssignment.id);
      await loadRecords();
    } catch (err) {
      setError(err.message || '同步待提交名单失败');
    } finally {
      setSyncingRecords(false);
    }
  }

  async function handleDeleteAssignment(assignment) {
    if (!assignment) return;
    const confirmed = window.confirm(`确认删除「${assignment.homeworkName}」吗？该任务会从作业跟进和大屏隐藏，历史提交记录和文件会保留。`);
    if (!confirmed) return;

    setError('');
    setMessage('');
    try {
      await apiDelete(`/api/homework-assignments/${assignment.id}`);
      setSelectedAssignmentId('');
      setMessage('作业任务已删除，历史提交记录已保留。');
      await loadAssignments('');
    } catch (err) {
      setError(err.message || '删除作业任务失败');
    }
  }

  async function handleCopyMissingStudents() {
    const missing = records.filter((record) => !['submitted', 'reviewed'].includes(record.submitStatus));
    if (!missing.length) {
      setMessage('当前筛选下没有缺交学生');
      return;
    }
    const text = missing
      .map((record) => `${record.studentName || `#${record.studentId}`}${record.studentPhone ? `（${record.studentPhone}）` : ''}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setMessage(`已复制 ${missing.length} 名缺交学生`);
    } catch {
      setError('复制失败，请手动选中缺交名单复制');
    }
  }

  return (
    <section className="admin-page homework-page">
      <div className="page-header">
        <div>
          <p className="page-kicker">作业提交</p>
          <h1>作业跟进</h1>
          <p className="page-description">按班级发布作业，查看谁已提交、谁未提交，并将学生原始文件打包导出。</p>
        </div>
        <div className="form-actions">
          <a className="button button-secondary" href={exportCsvUrl}>导出清单 CSV</a>
          {selectedAssignment ? <a className="button button-primary" href={exportZipUrl}>批量导出 ZIP</a> : null}
        </div>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}
      {message ? <div className="alert alert-success">{message}</div> : null}

      <form className="panel form-grid" onSubmit={handleCreateAssignment}>
        <h2>发布新作业</h2>
        <label>
          作业名称
          <input required value={form.homeworkName} onChange={(event) => updateForm('homeworkName', event.target.value)} placeholder="例如：第1周 HTML 作业" />
        </label>
        <label>
          班级/课程
          <select required value={form.className} onChange={(event) => updateForm('className', event.target.value)}>
            <option value="">请选择班级/课程</option>
            {classOptions.map((item) => (
              <option key={`${item.id || 'class'}-${item.className}`} value={item.className}>
                {classOptionLabel(item)}
              </option>
            ))}
          </select>
        </label>
        <label>
          截止日期
          <input type="date" value={form.dueDate} onChange={(event) => updateForm('dueDate', event.target.value)} />
        </label>
        <div className="inline-create form-wide">
          <label>
            新增班级/课程
            <input
              value={newClassName}
              onChange={(event) => setNewClassName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleCreateClass();
                }
              }}
              placeholder="例如：前端就业班"
              disabled={creatingClass}
            />
          </label>
          <button className="button button-secondary" type="button" onClick={handleCreateClass} disabled={creatingClass || !newClassName.trim()}>
            {creatingClass ? '正在新增...' : '新增并选择'}
          </button>
          <span className="muted">老师可先新增班级，成功后立即用于发布作业。</span>
        </div>
        <label className="form-wide">
          作业说明
          <textarea value={form.description} onChange={(event) => updateForm('description', event.target.value)} placeholder="说明提交要求，例如：上传 TXT 文件。" />
        </label>
        <div className="form-actions">
          <button className="button button-primary" type="submit" disabled={creating}>{creating ? '正在发布...' : '发布并生成待提交名单'}</button>
          <span className="muted">系统会为该班级所有在读学生生成待提交记录。</span>
        </div>
      </form>

      <section className="assignment-board">
        <div className="panel assignment-list-panel">
          <div className="panel-header">
            <h2>作业任务</h2>
            <span>{loadingAssignments ? '加载中...' : `${assignments.length} 个任务`}</span>
          </div>
          {!assignments.length && !loadingAssignments ? <div className="empty-state">暂无作业任务，先发布一个作业。</div> : null}
          <div className="assignment-list">
            {assignments.map((assignment) => (
              <article
                className={String(assignment.id) === String(selectedAssignmentId) ? 'assignment-card-shell is-active' : 'assignment-card-shell'}
                key={assignment.id}
              >
                <button
                  className="assignment-card"
                  type="button"
                  onClick={() => setSelectedAssignmentId(String(assignment.id))}
                >
                  <strong>{assignment.homeworkName}</strong>
                  <span>{assignment.className} / 截止 {assignment.dueDate || '未设置'}</span>
                  <small>
                    已交 {assignment.submittedCount}/{assignment.totalCount}
                    <b>{percent(assignment.submittedCount, assignment.totalCount)}</b>
                  </small>
                  <small>
                    逾期未交 {assignment.overduePendingCount || 0}
                    <b>迟交 {assignment.lateSubmittedCount || 0}</b>
                  </small>
                </button>
                <button
                  className="button button-secondary danger-button assignment-delete-button"
                  type="button"
                  onClick={() => handleDeleteAssignment(assignment)}
                >
                  删除任务
                </button>
              </article>
            ))}
          </div>
        </div>

        <div className="panel assignment-detail-panel">
          <div className="panel-header">
            <div>
              <h2>{selectedAssignment?.homeworkName || '提交明细'}</h2>
              <p className="muted">
                {selectedAssignment
                  ? `${selectedAssignment.className}：已交 ${selectedAssignment.submittedCount} 人，未交 ${selectedAssignment.pendingCount} 人，逾期未交 ${selectedAssignment.overduePendingCount || 0} 人`
                  : '选择一个作业任务后查看学生提交情况。'}
              </p>
            </div>
            {selectedAssignment ? (
              <div className="form-actions">
                <button className="button button-secondary" type="button" onClick={handleSyncRecords} disabled={syncingRecords}>
                  {syncingRecords ? '正在同步...' : '同步待提交名单'}
                </button>
                <button className="button button-secondary" type="button" onClick={handleCopyMissingStudents}>
                  复制缺交名单
                </button>
              </div>
            ) : null}
          </div>

          <div className="toolbar">
            <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索学生姓名或手机号" />
            <select value={submitStatus} onChange={(event) => setSubmitStatus(event.target.value)}>
              <option value="">全部提交状态</option>
              <option value="pending">待提交</option>
              <option value="submitted">已提交</option>
            </select>
            <select value={lateStatus} onChange={(event) => setLateStatus(event.target.value)}>
              <option value="">全部逾期状态</option>
              <option value="overduePending">只看逾期未交</option>
              <option value="lateSubmitted">只看迟交</option>
            </select>
            <label className="inline-checkbox">
              <input
                type="checkbox"
                checked={includeArchivedStudents}
                onChange={(event) => setIncludeArchivedStudents(event.target.checked)}
              />
              包含已移出学生
            </label>
          </div>

          <div className="table-summary">{loadingRecords ? '正在加载提交明细...' : `当前筛选 ${records.length} 条记录`}</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>学生</th>
                  <th>手机号</th>
                  <th>状态</th>
                  <th>逾期</th>
                  <th>提交时间</th>
                  <th>文件</th>
                  <th>备注</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td>{record.studentName || `#${record.studentId}`}</td>
                    <td>{record.studentPhone || '-'}</td>
                    <td>
                      <StatusBadge status={record.submitStatus === 'reviewed' ? 'submitted' : record.submitStatus}>
                        {homeworkStatusText(record.submitStatus)}
                      </StatusBadge>
                    </td>
                    <td>{record.lateStatus ? <StatusBadge status={record.lateStatus}>{record.lateStatusText}</StatusBadge> : '-'}</td>
                    <td>{formatDateTime(record.submitAt)}</td>
                    <td>
                      {record.fileName ? (
                        <>
                          <strong>{record.fileName}</strong>
                          <span className="cell-subtext">{formatFileSize(record.fileSize)}</span>
                        </>
                      ) : '-'}
                    </td>
                    <td>{record.remark || '-'}</td>
                    <td className="table-actions">
                      {record.fileName ? <a href={`/api/homework/${record.id}/file`}>下载</a> : <span className="muted">未提交</span>}
                      <a href={buildPath(`/api/export/homework/student/${record.studentId}.zip`, { assignmentId: selectedAssignmentId })}>导出该生</a>
                    </td>
                  </tr>
                ))}
                {!records.length && !loadingRecords ? (
                  <tr>
                    <td colSpan="8" className="empty-cell">暂无提交记录</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </section>
  );
}
