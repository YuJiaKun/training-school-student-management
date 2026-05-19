import { useEffect, useMemo, useState } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost } from '../api.js';
import StatusBadge, { statusText } from '../components/StatusBadge.jsx';
import { buildPath } from '../utils/url.js';

const emptyForm = {
  name: '',
  phone: '',
  gender: '',
  birthday: '',
  className: '',
  learningStage: 'studying',
  enrolledAt: '',
  remark: ''
};

const LEARNING_STAGE_OPTIONS = [
  { value: 'studying', label: '学习中' },
  { value: 'job_seeking', label: '求职中' },
  { value: 'employed', label: '已就业' }
];

function downloadRecentAccounts(accounts) {
  const rows = [
    ['学生姓名', '班级/课程', '手机号', '用户名', '初始密码'],
    ...accounts.map((account) => [
      account.studentName || `学生 #${account.studentId}`,
      account.className || '',
      account.studentPhone || '',
      account.username || '',
      account.initialPassword || ''
    ])
  ];
  downloadCsv('本次学生账号清单.csv', rows);
}

function downloadInvalidImportRows(preview) {
  const rows = [
    ['行号', '姓名', '手机号', '班级/课程', '错误原因'],
    ...(preview?.rows || [])
      .filter((row) => row.errors?.length)
      .map((row) => [
        row.rowNumber,
        row.student?.name || '',
        row.student?.phone || '',
        row.student?.className || '',
        row.errors.join('；')
      ])
  ];
  downloadCsv('学生导入错误行.csv', rows);
}

function downloadCsv(fileName, rows) {
  const csv = `\ufeff${rows.map((row) => row.map(csvCell).join(',')).join('\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
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

function summarizeClasses(items) {
  const names = items.map((item) => item.className).filter(Boolean);
  if (!names.length) return '暂无班级/课程，请先新增后再选择或导入。';
  const visible = names.slice(0, 8).join('、');
  return names.length > 8 ? `${visible} 等 ${names.length} 个班级/课程` : visible;
}

export default function StudentsPage() {
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [learningStage, setLearningStage] = useState('');
  const [accountStatus, setAccountStatus] = useState('');
  const [className, setClassName] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [newClassName, setNewClassName] = useState('');
  const [importText, setImportText] = useState('');
  const [importDefaultClassName, setImportDefaultClassName] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [importPreview, setImportPreview] = useState(null);
  const [importMessage, setImportMessage] = useState('');
  const [generateAccounts, setGenerateAccounts] = useState(true);
  const [generatedAccounts, setGeneratedAccounts] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [creatingClass, setCreatingClass] = useState(false);
  const [deleteClassId, setDeleteClassId] = useState('');
  const [deletingClass, setDeletingClass] = useState(false);
  const [generatingAccounts, setGeneratingAccounts] = useState(false);
  const [bulkClassName, setBulkClassName] = useState('');
  const [bulkLearningStage, setBulkLearningStage] = useState('job_seeking');
  const [bulkUpdatingStage, setBulkUpdatingStage] = useState(false);
  const [resettingAccountId, setResettingAccountId] = useState(null);
  const [error, setError] = useState('');

  const filters = useMemo(
    () => ({ keyword, status, learningStage, accountStatus, className }),
    [accountStatus, className, keyword, learningStage, status]
  );
  const exportUrl = buildPath('/api/export/students', filters);
  const accountExportUrl = buildPath('/api/export/student-accounts', filters);
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
  const classSummary = useMemo(() => summarizeClasses(classes), [classes]);
  const deletableClassOptions = useMemo(() => classes.filter((item) => item.id !== undefined && item.id !== null), [classes]);

  async function loadStudents() {
    setLoading(true);
    setError('');
    try {
      const data = await apiGet(buildPath('/api/students', filters));
      setStudents(data.items || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message || '学生列表加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function loadClasses() {
    try {
      const data = await apiGet('/api/classes');
      const items = (data.items || []).map(normalizeClassItem).filter(Boolean);
      setClasses(items);
      return items;
    } catch (err) {
      setError(err.message || '班级列表加载失败');
      return [];
    }
  }

  useEffect(() => {
    loadClasses();
  }, []);

  function hasSearchCondition() {
    return Boolean(keyword.trim() || status || learningStage || accountStatus || className);
  }

  async function handleSearch() {
    if (!hasSearchCondition()) {
      setHasSearched(false);
      setStudents([]);
      setTotal(0);
      setError('');
      return;
    }
    setHasSearched(true);
    await loadStudents();
  }

  function resetSearch() {
    setKeyword('');
    setStatus('');
    setLearningStage('');
    setAccountStatus('');
    setClassName('');
    setHasSearched(false);
    setStudents([]);
    setTotal(0);
  }

  async function refreshStudentsIfNeeded() {
    if (!hasSearched && !hasSearchCondition()) return;
    setHasSearched(true);
    await loadStudents();
  }

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function startEdit(student) {
    setEditingId(student.id);
    setForm({
      name: student.name || '',
      phone: student.phone || '',
      gender: student.gender || '',
      birthday: student.birthday || '',
      className: student.className || '',
      learningStage: student.learningStage || 'studying',
      enrolledAt: student.enrolledAt || '',
      remark: student.remark || ''
    });
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        phone: form.phone.trim(),
        gender: form.gender.trim(),
        className: form.className.trim(),
        learningStage: form.learningStage || 'studying',
        remark: form.remark.trim()
      };
      if (editingId) {
        await apiPatch(`/api/students/${editingId}`, payload);
      } else {
        await apiPost('/api/students', payload);
      }
      resetForm();
      await refreshStudentsIfNeeded();
    } catch (err) {
      setError(err.message || '学生信息保存失败');
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
    setImportMessage('');
    try {
      const result = await apiPost('/api/classes', { className });
      const selectedClassName = result.class?.className || className;
      setNewClassName('');
      setForm((current) => ({ ...current, className: selectedClassName }));
      await loadClasses();
      setImportMessage(`已新增班级/课程：${selectedClassName}`);
    } catch (err) {
      setError(err.message || '新增班级/课程失败');
    } finally {
      setCreatingClass(false);
    }
  }

  async function handleBulkLearningStage() {
    if (!bulkClassName) {
      setError('请先选择要批量修改的班级/课程');
      return;
    }

    setBulkUpdatingStage(true);
    setError('');
    setImportMessage('');
    try {
      const result = await apiPost('/api/students/bulk-learning-stage', {
        className: bulkClassName,
        learningStage: bulkLearningStage
      });
      setImportMessage(`已将「${bulkClassName}」的 ${result.updatedCount || 0} 名在读学生切换为${statusText(bulkLearningStage)}。`);
      await refreshStudentsIfNeeded();
    } catch (err) {
      setError(err.message || '批量修改学习阶段失败');
    } finally {
      setBulkUpdatingStage(false);
    }
  }

  async function handleDeleteClass() {
    const classItem = deletableClassOptions.find((item) => String(item.id) === String(deleteClassId));
    if (!classItem) {
      setError('请先选择要删除的空班级');
      return;
    }

    const confirmed = window.confirm(`确认删除空班级「${classItem.className}」吗？仅删除班级枚举，不删除学生、作业、面试或排期历史记录。`);
    if (!confirmed) return;

    setDeletingClass(true);
    setError('');
    setImportMessage('');
    try {
      await apiDelete(`/api/classes/${classItem.id}`);
      setImportMessage(`已删除空班级：${classItem.className}`);
      setDeleteClassId('');
      if (className === classItem.className) setClassName('');
      if (bulkClassName === classItem.className) setBulkClassName('');
      if (importDefaultClassName === classItem.className) setImportDefaultClassName('');
      if (form.className === classItem.className) setForm((current) => ({ ...current, className: '' }));
      await loadClasses();
      await refreshStudentsIfNeeded();
    } catch (err) {
      setError(err.message || '删除班级失败');
    } finally {
      setDeletingClass(false);
    }
  }

  async function previewImport(event) {
    event.preventDefault();
    setError('');
    setImportMessage('');
    setGeneratedAccounts([]);
    setImporting(true);
    try {
      const preview = await apiPost('/api/students/import/preview', buildImportPayload());
      setImportPreview(preview);
    } catch (err) {
      setError(err.message || '导入预览失败');
    } finally {
      setImporting(false);
    }
  }

  async function commitImport() {
    setError('');
    setImportMessage('');
    setGeneratedAccounts([]);
    setImporting(true);
    try {
      const result = await apiPost('/api/students/import/commit', { ...buildImportPayload(), generateAccounts });
      setImportPreview(result);
      setGeneratedAccounts(result.accounts || []);
      const accountText = generateAccounts
        ? `，生成 ${result.accounts?.length || 0} 个账号，跳过 ${result.skippedCount || 0} 名已有账号学生`
        : '';
      const invalidText = result.invalidCount ? `，另有 ${result.invalidCount} 条未导入需修正` : '';
      setImportMessage(`已导入 ${result.created?.length || 0} 名学生${accountText}${invalidText}`);
      if (!result.invalidCount) {
        setImportText('');
        setImportFileName('');
      }
      await refreshStudentsIfNeeded();
    } catch (err) {
      setError(err.message || '导入学生失败');
    } finally {
      setImporting(false);
    }
  }

  function buildImportPayload() {
    if (importFileName) return { text: importText };
    return {
      mode: 'simplePaste',
      text: importText,
      defaultClassName: importDefaultClassName
    };
  }

  async function handleImportFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    setImportMessage('');
    setGeneratedAccounts([]);
    try {
      const text = await file.text();
      setImportText(text);
      setImportFileName(file.name);
      setImportPreview(null);
      setImportMessage(`已读取表格：${file.name}`);
    } catch (err) {
      setError(err.message || '读取表格失败');
    }
  }

  async function generateAccountsForCurrentStudents() {
    setError('');
    setImportMessage('');
    setGeneratedAccounts([]);
    setGeneratingAccounts(true);
    try {
      const result = await apiPost('/api/students/accounts/generate', { filters });
      setGeneratedAccounts(result.accounts || []);
      setImportMessage(`已生成 ${result.accounts?.length || 0} 个账号，跳过 ${result.skippedCount || 0} 名已有账号学生`);
      await refreshStudentsIfNeeded();
    } catch (err) {
      setError(err.message || '批量生成账号失败');
    } finally {
      setGeneratingAccounts(false);
    }
  }

  async function resetStudentPassword(student) {
    setError('');
    setImportMessage('');
    setGeneratedAccounts([]);
    setResettingAccountId(student.id);
    try {
      const result = await apiPost('/api/students/accounts/reset', { studentIds: [student.id] });
      setGeneratedAccounts(result.accounts || []);
      setImportMessage(`已重置 ${result.accounts?.length || 0} 个账号密码，跳过 ${result.skippedCount || 0} 名学生`);
      await refreshStudentsIfNeeded();
    } catch (err) {
      setError(err.message || '重置账号密码失败');
    } finally {
      setResettingAccountId(null);
    }
  }

  async function disableStudentAccount(student) {
    setError('');
    setImportMessage('');
    setGeneratedAccounts([]);
    setResettingAccountId(student.id);
    try {
      await apiDelete(`/api/students/${student.id}/account`);
      setImportMessage(`已停用 ${student.name} 的学生账号，学生档案和历史记录已保留。`);
      await refreshStudentsIfNeeded();
    } catch (err) {
      setError(err.message || '停用学生账号失败');
    } finally {
      setResettingAccountId(null);
    }
  }

  async function archiveStudent(student) {
    setError('');
    try {
      await apiPost(`/api/students/${student.id}/archive`, {});
      await refreshStudentsIfNeeded();
    } catch (err) {
      setError(err.message || '归档学生失败');
    }
  }

  return (
    <section className="admin-page students-page">
      <div className="page-header">
        <div>
          <p className="page-kicker">学员档案</p>
          <h1>学生管理</h1>
          <p className="page-description">新增学生时只需要先确认姓名和班级/课程，联系方式与其他资料可由学生后续补全。</p>
        </div>
        <div className="form-actions">
          <a className="button button-secondary" href="/api/students/import/template.csv" download>下载导入模板</a>
          <a className="button button-secondary" href={exportUrl}>导出学生 CSV</a>
          <a className="button button-secondary" href={accountExportUrl}>导出账号清单</a>
        </div>
      </div>

      <div className="toolbar">
        <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索姓名、手机号" />
        <select value={className} onChange={(event) => setClassName(event.target.value)}>
          <option value="">选择班级/课程</option>
          {classOptions.map((item) => (
            <option key={`filter-${item.className}`} value={item.className}>{item.className}</option>
          ))}
        </select>
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">全部档案状态</option>
          <option value="active">在读</option>
          <option value="archived">已归档</option>
        </select>
        <select value={learningStage} onChange={(event) => setLearningStage(event.target.value)}>
          <option value="">全部学习阶段</option>
          {LEARNING_STAGE_OPTIONS.map((option) => (
            <option value={option.value} key={option.value}>{option.label}</option>
          ))}
        </select>
        <select value={accountStatus} onChange={(event) => setAccountStatus(event.target.value)}>
          <option value="">全部账号</option>
          <option value="missing">仅看未生成账号</option>
          <option value="generated">仅看已生成账号</option>
        </select>
        <button className="button button-primary" type="button" onClick={handleSearch} disabled={loading}>
          {loading ? '正在搜索...' : '搜索'}
        </button>
        <button className="button button-secondary" type="button" onClick={resetSearch}>清空</button>
        <button type="button" onClick={generateAccountsForCurrentStudents} disabled={generatingAccounts || loading || !students.length}>
          {generatingAccounts ? '正在生成账号...' : '批量生成账号'}
        </button>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}
      {importMessage ? <div className="alert alert-success">{importMessage}</div> : null}

      <section className="panel form-grid">
        <h2>整班学习阶段</h2>
        <p className="form-hint form-wide">只会修改该班级当前在读学生，不影响已归档学生和历史记录。</p>
        <label>
          班级/课程
          <select value={bulkClassName} onChange={(event) => setBulkClassName(event.target.value)}>
            <option value="">请选择班级/课程</option>
            {classOptions.map((item) => (
              <option key={`bulk-${item.className}`} value={item.className}>{classOptionLabel(item)}</option>
            ))}
          </select>
        </label>
        <label>
          目标学习阶段
          <select value={bulkLearningStage} onChange={(event) => setBulkLearningStage(event.target.value)}>
            {LEARNING_STAGE_OPTIONS.map((option) => (
              <option value={option.value} key={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <div className="form-actions">
          <button className="button button-secondary" type="button" onClick={handleBulkLearningStage} disabled={bulkUpdatingStage || !bulkClassName}>
            {bulkUpdatingStage ? '正在修改...' : '批量修改学习阶段'}
          </button>
        </div>
      </section>

      <section className="panel form-grid">
        <h2>班级维护</h2>
        <p className="form-hint form-wide">只允许删除没有在读学生、也没有未删除作业任务的空班级；历史数据不会被物理删除。</p>
        <label>
          删除空班级
          <select value={deleteClassId} onChange={(event) => setDeleteClassId(event.target.value)}>
            <option value="">请选择空班级</option>
            {deletableClassOptions.map((item) => (
              <option key={`delete-${item.id}`} value={item.id}>{classOptionLabel(item)}</option>
            ))}
          </select>
        </label>
        <div className="form-actions">
          <button className="danger-button" type="button" onClick={handleDeleteClass} disabled={deletingClass || !deleteClassId}>
            {deletingClass ? '正在删除...' : '删除空班级'}
          </button>
        </div>
      </section>

      <form className="panel form-grid" onSubmit={previewImport}>
        <h2>批量导入学生</h2>
        <label>
          默认班级/课程
          <select value={importDefaultClassName} onChange={(event) => setImportDefaultClassName(event.target.value)}>
            <option value="">粘贴内容里填写班级</option>
            {classOptions.map((item) => (
              <option key={`import-${item.className}`} value={item.className}>{item.className}</option>
            ))}
          </select>
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={generateAccounts}
            onChange={(event) => setGenerateAccounts(event.target.checked)}
          />
          导入后自动生成学生账号
        </label>
        <div className="class-helper form-wide">
          <strong>可用班级/课程</strong>
          <span>{classSummary}</span>
          <small>推荐直接从 Excel/WPS 复制两列：姓名、班级/课程；如果上方选择了默认班级，也可以只粘贴姓名列。手机号等资料由学生登录后补全。</small>
        </div>
        <label className="form-wide">
          粘贴学生名单
          <textarea
            value={importText}
            onChange={(event) => {
              setImportText(event.target.value);
              setImportFileName('');
              setImportPreview(null);
              setGeneratedAccounts([]);
            }}
            placeholder={importDefaultClassName ? '张三\n李四\n王五' : '张三\t前端就业班\n李四\tJava 就业班'}
          />
        </label>
        <details className="form-wide advanced-import">
          <summary>兼容旧 CSV 上传</summary>
          <div className="inline-create">
            <label>
              上传 CSV/TXT
              <input type="file" accept=".csv,text/csv,text/plain" onChange={handleImportFile} />
            </label>
            <label>
              文件名称
              <input value={importFileName || '未选择文件'} readOnly />
            </label>
          </div>
        </details>
        <div className="form-actions">
          <button className="button button-secondary" type="submit" disabled={importing || !importText.trim()}>预览导入</button>
          <button
            className="button button-primary"
            type="button"
            onClick={commitImport}
            disabled={importing || !importPreview || importPreview.validCount === 0}
          >
            确认导入
          </button>
          {importPreview?.invalidCount ? (
            <button className="button button-secondary" type="button" onClick={() => downloadInvalidImportRows(importPreview)}>
              下载错误行
            </button>
          ) : null}
          {importPreview ? (
            <span className="muted">可导入 {importPreview.validCount} 条，需修正 {importPreview.invalidCount} 条；仅姓名和班级/课程为必填</span>
          ) : null}
        </div>
        {importPreview?.rows?.length ? (
          <div className="import-preview form-wide">
            {importPreview.rows.slice(0, 5).map((row) => (
              <div className={row.errors.length ? 'preview-row has-error' : 'preview-row'} key={row.rowNumber}>
                <strong>第 {row.rowNumber} 行：{row.student.name || '未填写姓名'} / {row.student.className || '未选择班级'}</strong>
                <span>{row.errors.length ? row.errors.join('、') : '姓名和班级有效，其余资料可后续补全'}</span>
              </div>
            ))}
          </div>
        ) : null}
        {generatedAccounts.length ? (
          <div className="account-preview form-wide">
            <div className="panel-header">
              <div>
                <h3>最近生成账号</h3>
                <p className="muted">已生成 {generatedAccounts.length} 个账号，初始密码仅在本次操作后展示。</p>
              </div>
              <button className="button button-secondary" type="button" onClick={() => downloadRecentAccounts(generatedAccounts)}>
                下载本次账号清单
              </button>
            </div>
            <div className="account-chip-list">
              {generatedAccounts.slice(0, 6).map((account) => (
                <div className="account-chip" key={account.id || `${account.studentId}-${account.username}`}>
                  <strong>{account.studentName || `学生 #${account.studentId}`}</strong>
                  <span>{account.username} / {account.initialPassword || '-'}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </form>

      <form className="panel form-grid" onSubmit={handleSubmit}>
        <h2>{editingId ? '编辑学生' : '新增学生'}</h2>
        <p className="form-hint form-wide">必填只有“姓名、班级/课程”。手机号、性别、出生日期、入学日期和备注可留空，学生后续在学生端自行补全。</p>
        <label>
          姓名
          <input required value={form.name} onChange={(event) => updateForm('name', event.target.value)} placeholder="必填：学生姓名" />
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
          手机号
          <input value={form.phone} onChange={(event) => updateForm('phone', event.target.value)} placeholder="学生后续补全，可选" />
        </label>
        <label>
          学习阶段
          <select value={form.learningStage} onChange={(event) => updateForm('learningStage', event.target.value)}>
            {LEARNING_STAGE_OPTIONS.map((option) => (
              <option value={option.value} key={option.value}>{option.label}</option>
            ))}
          </select>
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
          <span className="muted">新增成功后会刷新班级列表，并自动选中该班级。</span>
        </div>
        <label>
          性别
          <select value={form.gender} onChange={(event) => updateForm('gender', event.target.value)}>
            <option value="">学生后续补全</option>
            <option value="男">男</option>
            <option value="女">女</option>
            <option value="其他">其他</option>
          </select>
        </label>
        <label>
          出生日期
          <input type="date" value={form.birthday} onChange={(event) => updateForm('birthday', event.target.value)} />
        </label>
        <label>
          入学日期
          <input type="date" value={form.enrolledAt} onChange={(event) => updateForm('enrolledAt', event.target.value)} />
        </label>
        <label className="form-wide">
          备注
          <textarea value={form.remark} onChange={(event) => updateForm('remark', event.target.value)} placeholder="可选，学生后续也可补充" />
        </label>
        <div className="form-actions">
          <button className="button button-primary" type="submit">{editingId ? '保存修改' : '新增学生'}</button>
          {editingId ? <button className="button button-secondary" type="button" onClick={resetForm}>取消编辑</button> : null}
        </div>
      </form>

      <div className="table-summary">
        {!hasSearched ? '默认不展示全部学生，请输入姓名/手机号，或选择班级、档案状态、学习阶段、账号状态后搜索。' : (loading ? '正在加载学生...' : `共 ${total} 名学生`)}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>姓名</th>
              <th>手机号</th>
              <th>班级/课程</th>
              <th>入学时间</th>
              <th>档案状态</th>
              <th>学习阶段</th>
              <th>账号</th>
              <th>备注</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {students.map((student) => (
              <tr key={student.id}>
                <td>{student.name}</td>
                <td>{student.phone}</td>
                <td>{student.className || '-'}</td>
                <td>{student.enrolledAt || '-'}</td>
                <td><StatusBadge status={student.status} /></td>
                <td><StatusBadge status={student.learningStage || 'studying'} /></td>
                <td>
                  <span className={student.hasAccount ? 'status-badge status-success' : 'status-badge status-muted'}>
                    {student.hasAccount ? '已生成' : '未生成'}
                  </span>
                  {student.accountUsername ? <span className="cell-subtext">{student.accountUsername}</span> : null}
                </td>
                <td>{student.remark || '-'}</td>
                <td className="table-actions">
                  <button type="button" onClick={() => startEdit(student)}>编辑</button>
                  {student.hasAccount ? (
                    <>
                      <button type="button" onClick={() => resetStudentPassword(student)} disabled={resettingAccountId === student.id}>
                        {resettingAccountId === student.id ? '处理中...' : '重置密码'}
                      </button>
                      <button type="button" onClick={() => disableStudentAccount(student)} disabled={resettingAccountId === student.id}>
                        停用账号
                      </button>
                    </>
                  ) : null}
                  {student.status !== 'archived' ? <button type="button" onClick={() => archiveStudent(student)}>归档</button> : null}
                </td>
              </tr>
            ))}
            {!students.length && !loading ? (
              <tr>
                <td colSpan="9" className="empty-cell">
                  {hasSearched ? '暂无符合条件的学生' : '请先搜索，再展示学生列表'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
