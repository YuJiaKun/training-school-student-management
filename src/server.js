const http = require('node:http');

function createServerApp({ app }) {
  return {
    renderHomePage() {
      const stats = app.getDashboardStats();
      const students = app.listStudents().items;
      const rows = students.map((student) => `<tr><td>${escapeHtml(student.name)}</td><td>${escapeHtml(student.phone)}</td><td>${escapeHtml(student.className)}</td><td>${escapeHtml(student.status)}</td></tr>`).join('');

      return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>学生信息管理系统</title>
  <style>
    body { font-family: sans-serif; margin: 24px; }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(120px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .card { border: 1px solid #ddd; border-radius: 8px; padding: 12px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
  </style>
</head>
<body>
  <h1>学生信息管理系统</h1>
  <p>学生总数：${stats.students.total}</p>
  <section class="stats">
    <div class="card"><strong>学生总数</strong><div>${stats.students.total}</div></div>
    <div class="card"><strong>作业完成数</strong><div>${stats.homework.completed}</div></div>
    <div class="card"><strong>面试次数</strong><div>${stats.interviews.total}</div></div>
    <div class="card"><strong>就业率</strong><div>${stats.employmentRate}%</div></div>
  </section>
  <h2>新增学生</h2>
  <table>
    <thead><tr><th>姓名</th><th>手机号</th><th>班级</th><th>状态</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
    },

    renderHomeworkPage() {
      const records = app.listHomeworkRecords().items;
      const rows = records.map((record) => `<tr><td>${escapeHtml(record.homeworkName)}</td><td>${escapeHtml(String(record.studentId))}</td><td>${escapeHtml(record.className)}</td><td>${escapeHtml(record.submitStatus)}</td></tr>`).join('');
      return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>作业管理</title></head><body><h1>作业管理</h1><table><tbody>${rows}</tbody></table></body></html>`;
    },

    renderInterviewPage() {
      const records = app.listInterviewRecords().items;
      const rows = records.map((record) => `<tr><td>${escapeHtml(record.companyName)}</td><td>${escapeHtml(record.positionName)}</td><td>${escapeHtml(record.result)}</td></tr>`).join('');
      return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>面试记录</title></head><body><h1>面试记录</h1><table><tbody>${rows}</tbody></table></body></html>`;
    },

    renderSchedulePage(filters = {}) {
      const timeline = app.listInterviewScheduleTimeline({ weekStart: filters.weekStart || currentWeekStart() });
      const header = timeline.weeks.map((day) => `<th>${escapeHtml(day)}</th>`).join('');
      const rows = timeline.teachers.map((teacher) => {
        const cells = timeline.weeks.map((day) => {
          const entries = teacher.entries.filter((entry) => entry.startsAt.startsWith(day));
          return `<td>${entries.map((entry) => `<div class="schedule-card"><strong>${escapeHtml(entry.startsAt.slice(11, 16))}</strong><div>${escapeHtml(entry.studentName)}</div><div>${escapeHtml(entry.companyName)}</div><div>${escapeHtml(entry.positionName)}</div><div>${escapeHtml(entry.status)}</div></div>`).join('')}</td>`;
        }).join('');
        return `<tr><th>${escapeHtml(teacher.teacherName)}</th>${cells}</tr>`;
      }).join('');
      return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>面试排期</title><style>body{font-family:sans-serif;margin:24px}.schedule{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;vertical-align:top;padding:8px}.schedule-card{border:1px solid #ddd;border-radius:6px;padding:8px;margin-bottom:8px}</style></head><body><h1>面试排期</h1><p>${timeline.weeks[0]} ~ ${timeline.weeks[6]}</p><table class="schedule"><thead><tr><th>老师</th>${header}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
    },

    listen(port = 0) {
      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (req.method === 'GET' && url.pathname === '/') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(this.renderHomePage());
          return;
        }

        if (req.method === 'GET' && url.pathname === '/homework') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(this.renderHomeworkPage());
          return;
        }

        if (req.method === 'GET' && url.pathname === '/interviews') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(this.renderInterviewPage());
          return;
        }

        if (req.method === 'GET' && url.pathname === '/schedules') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(this.renderSchedulePage({ weekStart: url.searchParams.get('weekStart') || undefined }));
          return;
        }

        if (req.method === 'GET' && url.pathname === '/api/students') {
          const status = url.searchParams.get('status') || undefined;
          const keyword = url.searchParams.get('keyword') || undefined;
          const className = url.searchParams.get('className') || undefined;
          const data = app.listStudents({ status, keyword, className });
          sendJson(res, 200, data);
          return;
        }

        if (req.method === 'GET' && url.pathname === '/api/homework') {
          const studentId = url.searchParams.get('studentId') || undefined;
          const className = url.searchParams.get('className') || undefined;
          const submitStatus = url.searchParams.get('submitStatus') || undefined;
          sendJson(res, 200, app.listHomeworkRecords({ studentId, className, submitStatus }));
          return;
        }

        if (req.method === 'GET' && url.pathname === '/api/interviews') {
          const studentId = url.searchParams.get('studentId') || undefined;
          const companyName = url.searchParams.get('companyName') || undefined;
          const result = url.searchParams.get('result') || undefined;
          sendJson(res, 200, app.listInterviewRecords({ studentId, companyName, result }));
          return;
        }

        if (req.method === 'GET' && url.pathname === '/api/schedules') {
          const teacherId = url.searchParams.get('teacherId') || undefined;
          const studentId = url.searchParams.get('studentId') || undefined;
          const status = url.searchParams.get('status') || undefined;
          const from = url.searchParams.get('from') || undefined;
          const to = url.searchParams.get('to') || undefined;
          sendJson(res, 200, app.listInterviewSchedules({ teacherId, studentId, status, from, to }));
          return;
        }

        if (req.method === 'POST' && url.pathname === '/api/students') {
          const body = await readJson(req);
          const student = app.createStudent(body);
          sendJson(res, 201, { student });
          return;
        }

        if (req.method === 'POST' && url.pathname === '/api/homework') {
          const body = await readJson(req);
          const record = app.addHomeworkRecord(body);
          sendJson(res, 201, { record });
          return;
        }

        if (req.method === 'POST' && url.pathname === '/api/interviews') {
          const body = await readJson(req);
          const record = app.addInterviewRecord(body);
          sendJson(res, 201, { record });
          return;
        }

        if (req.method === 'POST' && url.pathname === '/api/schedules') {
          try {
            const body = await readJson(req);
            const schedule = app.createInterviewSchedule(body);
            sendJson(res, 201, { schedule });
          } catch (error) {
            sendJson(res, 400, { error: error.message });
          }
          return;
        }

        const scheduleMatch = url.pathname.match(/^\/api\/schedules\/(\d+)$/);
        if (scheduleMatch && req.method === 'PATCH') {
          try {
            const body = await readJson(req);
            const schedule = app.updateInterviewSchedule(Number(scheduleMatch[1]), body);
            sendJson(res, 200, { schedule });
          } catch (error) {
            sendJson(res, 400, { error: error.message });
          }
          return;
        }

        const scheduleCancelMatch = url.pathname.match(/^\/api\/schedules\/(\d+)\/cancel$/);
        if (scheduleCancelMatch && req.method === 'POST') {
          try {
            const schedule = app.cancelInterviewSchedule(Number(scheduleCancelMatch[1]));
            sendJson(res, 200, { schedule });
          } catch (error) {
            sendJson(res, 400, { error: error.message });
          }
          return;
        }

        const scheduleCompleteMatch = url.pathname.match(/^\/api\/schedules\/(\d+)\/complete$/);
        if (scheduleCompleteMatch && req.method === 'POST') {
          try {
            const schedule = app.completeInterviewSchedule(Number(scheduleCompleteMatch[1]));
            sendJson(res, 200, { schedule });
          } catch (error) {
            sendJson(res, 400, { error: error.message });
          }
          return;
        }


        const archiveMatch = url.pathname.match(/^\/api\/students\/(\d+)\/archive$/);
        if (req.method === 'POST' && archiveMatch) {
          const student = app.archiveStudent(Number(archiveMatch[1]));
          sendJson(res, 200, { student });
          return;
        }

        const studentsExport = url.pathname === '/api/export/students';
        if (req.method === 'GET' && studentsExport) {
          const status = url.searchParams.get('status') || undefined;
          const keyword = url.searchParams.get('keyword') || undefined;
          const className = url.searchParams.get('className') || undefined;
          sendText(res, 200, app.exportStudents({ status, keyword, className }), 'text/csv; charset=utf-8');
          return;
        }

        const homeworkExport = url.pathname === '/api/export/homework';
        if (req.method === 'GET' && homeworkExport) {
          const studentId = url.searchParams.get('studentId') || undefined;
          const className = url.searchParams.get('className') || undefined;
          const submitStatus = url.searchParams.get('submitStatus') || undefined;
          sendText(res, 200, app.exportHomeworkRecords({ studentId, className, submitStatus }), 'text/csv; charset=utf-8');
          return;
        }

        const interviewExport = url.pathname === '/api/export/interviews';
        if (req.method === 'GET' && interviewExport) {
          const studentId = url.searchParams.get('studentId') || undefined;
          const companyName = url.searchParams.get('companyName') || undefined;
          const result = url.searchParams.get('result') || undefined;
          sendText(res, 200, app.exportInterviewRecords({ studentId, companyName, result }), 'text/csv; charset=utf-8');
          return;
        }

        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'not found' }));
      });

      return server.listen(port);
    }
  };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8') || '{}';
  return JSON.parse(text);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, payload, contentType) {
  res.writeHead(statusCode, { 'content-type': contentType });
  res.end(payload);
}

function currentWeekStart() {
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + 1);
  return monday.toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

module.exports = { createServerApp };
