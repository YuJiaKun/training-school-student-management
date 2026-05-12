const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createDatabase } = require('./db');
const { createApp } = require('./app');

const DEFAULT_CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

function createServerApp({ app, clientDistPath = DEFAULT_CLIENT_DIST }) {
  return {
    renderClientShell() {
      return readClientIndex(clientDistPath) || renderFallbackShell();
    },

    listen(port = 0) {
      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const session = getSessionFromRequest(req, app);

        try {
          if (req.method === 'GET' && url.pathname === '/health') {
            sendJson(res, 200, { status: 'ok' });
            return;
          }

          if (req.method === 'POST' && url.pathname === '/api/login') {
            await handleApiLogin(req, res, app);
            return;
          }

          if (req.method === 'POST' && url.pathname === '/login') {
            await handleLegacyLogin(req, res, app);
            return;
          }

          if (req.method === 'POST' && url.pathname === '/api/logout') {
            res.writeHead(200, {
              'content-type': 'application/json; charset=utf-8',
              'set-cookie': clearSessionCookie()
            });
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/logout') {
            res.writeHead(302, {
              location: '/',
              'set-cookie': clearSessionCookie()
            });
            res.end();
            return;
          }

          if (req.method === 'GET' && url.pathname === '/api/me') {
            if (!session) {
              sendJson(res, 401, { error: 'unauthorized' });
              return;
            }
            sendJson(res, 200, { user: sessionToUser(session) });
            return;
          }

          if (req.method === 'GET' && url.pathname === '/api/dashboard/stats') {
            sendJson(res, 200, app.getDashboardStats());
            return;
          }

          if (req.method === 'GET' && url.pathname === '/api/students') {
            sendJson(res, 200, app.listStudents(readStudentFilters(url)));
            return;
          }

          if (req.method === 'POST' && url.pathname === '/api/students') {
            await mutateJson(req, res, 201, (body) => ({ student: app.createStudent(body) }), app);
            return;
          }

          const studentMatch = url.pathname.match(/^\/api\/students\/(\d+)$/);
          if (studentMatch && req.method === 'PATCH') {
            await mutateJson(req, res, 200, (body) => ({ student: app.updateStudent(Number(studentMatch[1]), body) }), app);
            return;
          }

          const archiveMatch = url.pathname.match(/^\/api\/students\/(\d+)\/archive$/);
          if (archiveMatch && req.method === 'POST') {
            mutate(res, 200, () => ({ student: app.archiveStudent(Number(archiveMatch[1])) }), app);
            return;
          }

          if (req.method === 'GET' && url.pathname === '/api/homework') {
            sendJson(res, 200, app.listHomeworkRecords(readHomeworkFilters(url)));
            return;
          }

          if (req.method === 'POST' && url.pathname === '/api/homework') {
            await mutateJson(req, res, 201, (body) => ({ record: app.addHomeworkRecord(body) }), app);
            return;
          }

          const homeworkMatch = url.pathname.match(/^\/api\/homework\/(\d+)$/);
          if (homeworkMatch && req.method === 'PATCH') {
            await mutateJson(req, res, 200, (body) => ({ record: app.updateHomeworkRecord(Number(homeworkMatch[1]), body) }), app);
            return;
          }

          if (req.method === 'GET' && url.pathname === '/api/interviews') {
            sendJson(res, 200, app.listInterviewRecords(readInterviewFilters(url)));
            return;
          }

          if (req.method === 'POST' && url.pathname === '/api/interviews') {
            await mutateJson(req, res, 201, (body) => ({ record: app.addInterviewRecord(body) }), app);
            return;
          }

          const interviewMatch = url.pathname.match(/^\/api\/interviews\/(\d+)$/);
          if (interviewMatch && req.method === 'PATCH') {
            await mutateJson(req, res, 200, (body) => ({ record: app.updateInterviewRecord(Number(interviewMatch[1]), body) }), app);
            return;
          }

          if (req.method === 'GET' && url.pathname === '/api/schedules/timeline') {
            sendJson(res, 200, app.listInterviewScheduleTimeline({ weekStart: url.searchParams.get('weekStart') || currentWeekStart() }));
            return;
          }

          if (req.method === 'GET' && url.pathname === '/api/schedules') {
            sendJson(res, 200, app.listInterviewSchedules(readScheduleFilters(url)));
            return;
          }

          if (req.method === 'POST' && url.pathname === '/api/schedules') {
            await mutateJson(req, res, 201, (body) => ({ schedule: app.requestInterviewSchedule(body) }), app);
            return;
          }

          const scheduleApproveMatch = url.pathname.match(/^\/api\/schedules\/(\d+)\/approve$/);
          if (scheduleApproveMatch && req.method === 'POST') {
            await mutateJson(req, res, 200, (body) => ({ schedule: app.approveInterviewSchedule(Number(scheduleApproveMatch[1]), body) }), app);
            return;
          }

          const scheduleAcceptMatch = url.pathname.match(/^\/api\/schedules\/(\d+)\/accept$/);
          if (scheduleAcceptMatch && req.method === 'POST') {
            await mutateJson(req, res, 200, (body) => ({ schedule: app.acceptInterviewSchedule(Number(scheduleAcceptMatch[1]), body) }), app);
            return;
          }

          const scheduleRejectMatch = url.pathname.match(/^\/api\/schedules\/(\d+)\/reject$/);
          if (scheduleRejectMatch && req.method === 'POST') {
            mutate(res, 200, () => ({ schedule: app.rejectInterviewSchedule(Number(scheduleRejectMatch[1])) }), app);
            return;
          }

          const scheduleCancelMatch = url.pathname.match(/^\/api\/schedules\/(\d+)\/cancel$/);
          if (scheduleCancelMatch && req.method === 'POST') {
            mutate(res, 200, () => ({ schedule: app.cancelInterviewSchedule(Number(scheduleCancelMatch[1])) }), app);
            return;
          }

          const scheduleCompleteMatch = url.pathname.match(/^\/api\/schedules\/(\d+)\/complete$/);
          if (scheduleCompleteMatch && req.method === 'POST') {
            mutate(res, 200, () => ({ schedule: app.completeInterviewSchedule(Number(scheduleCompleteMatch[1])) }), app);
            return;
          }

          const scheduleMatch = url.pathname.match(/^\/api\/schedules\/(\d+)$/);
          if (scheduleMatch && req.method === 'PATCH') {
            await mutateJson(req, res, 200, (body) => ({ schedule: app.updateInterviewSchedule(Number(scheduleMatch[1]), body) }), app);
            return;
          }

          if (req.method === 'GET' && url.pathname === '/api/export/students') {
            sendText(res, 200, app.exportStudents(readStudentFilters(url)), 'text/csv; charset=utf-8');
            return;
          }

          if (req.method === 'GET' && url.pathname === '/api/export/homework') {
            sendText(res, 200, app.exportHomeworkRecords(readHomeworkFilters(url)), 'text/csv; charset=utf-8');
            return;
          }

          if (req.method === 'GET' && url.pathname === '/api/export/interviews') {
            sendText(res, 200, app.exportInterviewRecords(readInterviewFilters(url)), 'text/csv; charset=utf-8');
            return;
          }

          if (url.pathname.startsWith('/api/')) {
            sendJson(res, 404, { error: 'not found' });
            return;
          }

          if (req.method === 'GET') {
            serveClientAssetOrShell(res, clientDistPath, url.pathname);
            return;
          }

          sendJson(res, 404, { error: 'not found' });
        } catch (error) {
          sendJson(res, 500, { error: error.message });
        }
      });

      return server.listen(port);
    }
  };
}

async function handleApiLogin(req, res, app) {
  try {
    const body = await readBody(req);
    const login = app.login({ username: body.username, password: body.password });
    const session = app.getSession(login.token);
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': sessionCookie(login.token)
    });
    res.end(JSON.stringify({ user: sessionToUser(session) }));
  } catch (error) {
    sendJson(res, 401, { error: error.message });
  }
}

async function handleLegacyLogin(req, res, app) {
  try {
    const body = await readBody(req);
    const login = app.login({ username: body.username, password: body.password });
    res.writeHead(302, {
      location: '/dashboard',
      'set-cookie': sessionCookie(login.token)
    });
    res.end();
  } catch (error) {
    sendJson(res, 401, { error: error.message });
  }
}

async function mutateJson(req, res, statusCode, handler, app) {
  try {
    const body = await readBody(req);
    const payload = handler(body);
    persist(app);
    sendJson(res, statusCode, payload);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

function mutate(res, statusCode, handler, app) {
  try {
    const payload = handler();
    persist(app);
    sendJson(res, statusCode, payload);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

function persist(app) {
  if (typeof app.saveDatabase === 'function') app.saveDatabase();
}

function readStudentFilters(url) {
  return {
    status: url.searchParams.get('status') || undefined,
    keyword: url.searchParams.get('keyword') || undefined,
    className: url.searchParams.get('className') || undefined,
    page: url.searchParams.get('page') || undefined,
    pageSize: url.searchParams.get('pageSize') || undefined
  };
}

function readHomeworkFilters(url) {
  return {
    studentId: url.searchParams.get('studentId') || undefined,
    className: url.searchParams.get('className') || undefined,
    submitStatus: url.searchParams.get('submitStatus') || undefined
  };
}

function readInterviewFilters(url) {
  return {
    studentId: url.searchParams.get('studentId') || undefined,
    companyName: url.searchParams.get('companyName') || undefined,
    result: url.searchParams.get('result') || undefined
  };
}

function readScheduleFilters(url) {
  return {
    teacherId: url.searchParams.get('teacherId') || undefined,
    studentId: url.searchParams.get('studentId') || undefined,
    status: url.searchParams.get('status') || undefined,
    from: url.searchParams.get('from') || undefined,
    to: url.searchParams.get('to') || undefined
  };
}

function serveClientAssetOrShell(res, clientDistPath, requestPath) {
  const index = readClientIndex(clientDistPath);
  if (!index) {
    sendText(res, 200, renderFallbackShell(), 'text/html; charset=utf-8');
    return;
  }

  const filePath = resolveClientPath(clientDistPath, requestPath);
  if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    sendFile(res, filePath);
    return;
  }

  sendText(res, 200, index, 'text/html; charset=utf-8');
}

function readClientIndex(clientDistPath) {
  const indexPath = path.join(clientDistPath, 'index.html');
  if (!fs.existsSync(indexPath)) return null;
  return fs.readFileSync(indexPath, 'utf8');
}

function resolveClientPath(clientDistPath, requestPath) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  const relativePath = decodedPath.replace(/^\/+/, '') || 'index.html';
  const resolved = path.resolve(clientDistPath, relativePath);
  const root = path.resolve(clientDistPath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  return resolved;
}

function sendFile(res, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[extension] || 'application/octet-stream';
  sendText(res, 200, fs.readFileSync(filePath), contentType);
}

function renderFallbackShell() {
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>培训机构学生管理系统</title></head><body><div id="root">前端资源尚未构建，请先运行 npm run build。</div></body></html>';
}

function getSessionFromRequest(req, app) {
  const cookie = parseCookies(req.headers.cookie || '');
  if (!cookie.session) return null;
  return app.getSession(cookie.session);
}

function parseCookies(header) {
  const result = {};
  for (const part of header.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (!rawKey) continue;
    result[rawKey] = decodeURIComponent(rawValue.join('='));
  }
  return result;
}

function sessionToUser(session) {
  return {
    username: session.username,
    role: session.role,
    teacherId: session.teacherId || null
  };
}

function sessionCookie(token) {
  return `session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`;
}

function clearSessionCookie() {
  return 'session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const contentType = (req.headers['content-type'] || '').split(';')[0].trim();
        if (!body) {
          resolve({});
          return;
        }
        if (contentType === 'application/x-www-form-urlencoded') {
          resolve(Object.fromEntries(new URLSearchParams(body)));
          return;
        }
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  sendText(res, statusCode, JSON.stringify(payload), 'application/json; charset=utf-8');
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

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const filePath = process.env.DATA_FILE || './data/data.json';
  const db = createDatabase({ filePath });
  const app = createApp({ db });
  const server = createServerApp({ app }).listen(port);

  server.on('listening', () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    console.log(`学生管理系统已启动：http://127.0.0.1:${actualPort}`);
    console.log(`数据文件：${filePath}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`端口 ${port} 已被占用，请设置 PORT 使用其他端口，例如：PORT=3001 npm start`);
    } else {
      console.error(`启动失败：${error.message}`);
    }
    process.exit(1);
  });
}

module.exports = { createServerApp };
