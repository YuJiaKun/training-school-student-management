const DEFAULT_ERROR_TEXT = '请求失败，请稍后重试';
const LOGIN_EXPIRED_TEXT = '登录状态已失效，请重新登录';
const AUTH_EXPIRED_EVENT = 'auth:expired';

const ERROR_TEXT_MAP = {
  unauthorized: LOGIN_EXPIRED_TEXT,
  'invalid credentials': '账号或密码不正确',
  'not found': '请求的资源不存在',
  'name and phone are required': '请填写学生姓名和手机号',
  'student not found': '未找到对应学生',
  'homework record not found': '未找到对应作业记录',
  'interview record not found': '未找到对应面试记录',
  'schedule not found': '未找到对应面试安排',
  'schedule fields are required': '请完整填写面试安排信息',
  'invalid schedule time': '面试开始时间必须早于结束时间',
  'invalid homework submit status': '作业提交状态无效',
  'invalid interview result': '面试结果无效',
  'invalid hired status': '入职状态无效',
  'invalid schedule status': '排期状态无效',
  'teacher conflict': '该老师在这个时间段已有安排',
  'student conflict': '该学生在这个时间段已有安排',
  'request body too large': '请求内容过大，请减少备注内容后再试',
  'unsupported content type': '请求格式不支持',
  'too many login attempts': '登录失败次数过多，请稍后再试',
  'student import contains invalid rows': '导入内容存在错误，请先根据预览修正'
};

async function request(method, path, body) {
  const options = {
    method,
    credentials: 'include',
    headers: {}
  };

  if (body !== undefined) {
    options.headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new Error('网络连接失败，请确认服务已启动');
  }

  const payload = await parsePayload(response);
  if (!response.ok) {
    const sessionExpired =
      response.status === 401 && payload?.error !== 'invalid credentials' && path !== '/api/me';
    if (sessionExpired) notifyAuthExpired();
    const errorText =
      sessionExpired
        ? LOGIN_EXPIRED_TEXT
        : toDisplayError(payload?.error || response.statusText);
    throw new Error(errorText);
  }

  return payload;
}

async function parsePayload(response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function toDisplayError(error) {
  if (!error) return DEFAULT_ERROR_TEXT;
  const text = String(error).trim();
  if (text.startsWith('invalid schedule transition')) {
    return '当前排期状态不允许执行该操作';
  }
  return ERROR_TEXT_MAP[text] || text || DEFAULT_ERROR_TEXT;
}

function notifyAuthExpired() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
}

export function apiGet(path) {
  return request('GET', path);
}

export function apiPost(path, body) {
  return request('POST', path, body);
}

export function apiPatch(path, body) {
  return request('PATCH', path, body);
}

export const api = {
  get: apiGet,
  post: apiPost,
  patch: apiPatch
};

export { AUTH_EXPIRED_EVENT, LOGIN_EXPIRED_TEXT };
