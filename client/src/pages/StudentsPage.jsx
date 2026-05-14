import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import { buildPath } from '../utils/url.js';

const emptyForm = {
  name: '',
  phone: '',
  gender: '',
  birthday: '',
  className: '',
  enrolledAt: '',
  remark: ''
};

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

export default function StudentsPage() {
  const [students, setStudents] = useState([]);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [accountStatus, setAccountStatus] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [importText, setImportText] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [importPreview, setImportPreview] = useState(null);
  const [importMessage, setImportMessage] = useState('');
  const [generateAccounts, setGenerateAccounts] = useState(true);
  const [generatedAccounts, setGeneratedAccounts] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [generatingAccounts, setGeneratingAccounts] = useState(false);
  const [resettingAccountId, setResettingAccountId] = useState(null);
  const [error, setError] = useState('');

  const filters = useMemo(() => ({ keyword, status, accountStatus }), [accountStatus, keyword, status]);
  const exportUrl = buildPath('/api/export/students', filters);
  const accountExportUrl = buildPath('/api/export/student-accounts', filters);

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

  useEffect(() => {
    loadStudents();
  }, [filters]);

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
      if (editingId) {
        await apiPatch(`/api/students/${editingId}`, form);
      } else {
        await apiPost('/api/students', form);
      }
      resetForm();
      await loadStudents();
    } catch (err) {
      setError(err.message || '学生信息保存失败');
    }
  }

  async function previewImport(event) {
    event.preventDefault();
    setError('');
    setImportMessage('');
    setGeneratedAccounts([]);
    setImporting(true);
    try {
      const preview = await apiPost('/api/students/import/preview', { text: importText });
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
      const result = await apiPost('/api/students/import/commit', { text: importText, generateAccounts });
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
      await loadStudents();
    } catch (err) {
      setError(err.message || '导入学生失败');
    } finally {
      setImporting(false);
    }
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
      await loadStudents();
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
      await loadStudents();
    } catch (err) {
      setError(err.message || '重置账号密码失败');
    } finally {
      setResettingAccountId(null);
    }
  }

  async function archiveStudent(student) {
    setError('');
    try {
      await apiPost(`/api/students/${student.id}/archive`, {});
      await loadStudents();
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
          <p className="page-description">维护学生基础资料，筛选在读或归档状态，并导出当前结果。</p>
        </div>
        <div className="form-actions">
          <a className="button button-secondary" href="/api/students/import/template.csv" download>下载导入模板</a>
          <a className="button button-secondary" href={exportUrl}>导出学生 CSV</a>
          <a className="button button-secondary" href={accountExportUrl}>导出账号清单</a>
        </div>
      </div>

      <div className="toolbar">
        <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索姓名或手机号" />
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">全部状态</option>
          <option value="active">在读</option>
          <option value="archived">已归档</option>
        </select>
        <select value={accountStatus} onChange={(event) => setAccountStatus(event.target.value)}>
          <option value="">全部账号</option>
          <option value="missing">仅看未生成账号</option>
          <option value="generated">仅看已生成账号</option>
        </select>
        <button type="button" onClick={generateAccountsForCurrentStudents} disabled={generatingAccounts || loading || !students.length}>
          {generatingAccounts ? '正在生成账号...' : '批量生成账号'}
        </button>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}
      {importMessage ? <div className="alert alert-success">{importMessage}</div> : null}

      <form className="panel form-grid" onSubmit={previewImport}>
        <h2>批量导入学生</h2>
        <label>
          上传学生表格
          <input type="file" accept=".csv,text/csv,text/plain" onChange={handleImportFile} />
        </label>
        <label>
          文件名称
          <input value={importFileName || '未选择文件'} readOnly />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={generateAccounts}
            onChange={(event) => setGenerateAccounts(event.target.checked)}
          />
          导入后自动生成学生账号
        </label>
        <label className="form-wide">
          粘贴导入内容
          <textarea
            value={importText}
            onChange={(event) => {
              setImportText(event.target.value);
              setImportFileName('');
              setImportPreview(null);
              setGeneratedAccounts([]);
            }}
            placeholder="姓名,手机号,性别,出生日期,班级/课程,入学日期,备注"
          />
        </label>
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
            <span className="muted">可导入 {importPreview.validCount} 条，需修正 {importPreview.invalidCount} 条</span>
          ) : null}
        </div>
        {importPreview?.rows?.length ? (
          <div className="import-preview form-wide">
            {importPreview.rows.slice(0, 5).map((row) => (
              <div className={row.errors.length ? 'preview-row has-error' : 'preview-row'} key={row.rowNumber}>
                <strong>第 {row.rowNumber} 行：{row.student.name || '未填写姓名'}</strong>
                <span>{row.errors.length ? row.errors.join('、') : '可导入'}</span>
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
        <input required value={form.name} onChange={(event) => updateForm('name', event.target.value)} placeholder="姓名" />
        <input required value={form.phone} onChange={(event) => updateForm('phone', event.target.value)} placeholder="手机号" />
        <input value={form.gender} onChange={(event) => updateForm('gender', event.target.value)} placeholder="性别" />
        <input type="date" value={form.birthday} onChange={(event) => updateForm('birthday', event.target.value)} />
        <input value={form.className} onChange={(event) => updateForm('className', event.target.value)} placeholder="班级/课程" />
        <input type="date" value={form.enrolledAt} onChange={(event) => updateForm('enrolledAt', event.target.value)} />
        <textarea value={form.remark} onChange={(event) => updateForm('remark', event.target.value)} placeholder="备注" />
        <div className="form-actions">
          <button className="button button-primary" type="submit">{editingId ? '保存修改' : '新增学生'}</button>
          {editingId ? <button className="button button-secondary" type="button" onClick={resetForm}>取消编辑</button> : null}
        </div>
      </form>

      <div className="table-summary">{loading ? '正在加载学生...' : `共 ${total} 名学生`}</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>姓名</th>
              <th>手机号</th>
              <th>班级/课程</th>
              <th>入学时间</th>
              <th>状态</th>
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
                    <button type="button" onClick={() => resetStudentPassword(student)} disabled={resettingAccountId === student.id}>
                      {resettingAccountId === student.id ? '重置中...' : '重置密码'}
                    </button>
                  ) : null}
                  {student.status !== 'archived' ? <button type="button" onClick={() => archiveStudent(student)}>归档</button> : null}
                </td>
              </tr>
            ))}
            {!students.length && !loading ? (
              <tr>
                <td colSpan="8" className="empty-cell">暂无学生数据</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
