import crypto from 'node:crypto';

const BASE = 'https://ai.pixeltools.ru/api';
const corsHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer'
};

const result = (status, data) => ({
  statusCode: status,
  headers: corsHeaders,
  body: JSON.stringify(data)
});
const str = (value, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const id = (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1 || n > 2_000_000_000) throw new Error('Некорректный ID проекта.');
  return n;
};
const draftId = (v) => {
  const value = str(v, 100);
  if (!/^[a-f0-9-]{16,80}$/i.test(value)) throw new Error('Некорректный ID черновика.');
  return value;
};
const domain = (v) => {
  if (!v) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(v) ? v : 'https://' + v);
    if (!url.hostname.includes('.') || url.port || url.username || url.password) throw Error();
    return url.hostname.toLowerCase();
  } catch {
    throw new Error('Укажите корректный сайт компании.');
  }
};
const only = (arr, max=16) => Array.isArray(arr) ? arr.slice(0, max) : [];

function authorized(event) {
  const want = process.env.MIRVIX_AUDIT_PASSWORD || '';
  const have = event.headers?.['x-mirvix-audit-key'] || event.headers?.['X-Mirvix-Audit-Key'] || '';
  if (want.length < 12 || typeof have !== 'string' || have.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(have), Buffer.from(want));
}
async function pixel(path, method = 'GET', body = null) {
  if (!/^\/(?:projects(?:\/\d+(?:\/[\w/-]+)?)?|project-drafts(?:\/[a-f0-9-]+(?:\/(?:prompts|project))?)?|neurals)$/.test(path)) {
    throw new Error('Недопустимый API-адрес.');
  }
  const timeout = AbortSignal.timeout(13000);
  const response = await fetch(BASE + path, {
    method,
    redirect: 'error',
    signal: timeout,
    headers: {
      'Authorization': 'Bearer ' + process.env.PIXELTOOLS_API_TOKEN,
      'Accept': 'application/json',
      ...(body ? {'Content-Type': 'application/json'} : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let data;
  try { data = await response.json(); }
  catch { throw new Error('Сервис аналитики вернул некорректный ответ.'); }
  if (!response.ok) {
    const msg = str(data?.error?.message || data?.message || '', 220);
    const suffix = msg && response.status !== 401 ? ': ' + msg : '';
    const err = new Error('Pixel Tools HTTP ' + response.status + suffix);
    err.status = response.status === 401 ? 502 : response.status;
    throw err;
  }
  return data;
}
function normalizeProjects(data) {
  return only(data?.data, 60).map((p) => ({
    id: p.id, brand: str(p.brand || p.name, 100),
    name: str(p.name, 100), domain: str(p.domain, 120),
    activities: str(p.activities, 150)
  }));
}
function getSummary(summary, answers, projectId) {
  const stats = summary?.data?.updateStats || {};
  const curves = only(stats.visibility_curve, 14).map((series) => {
    const points = only(series?.data, 100);
    const last = points.length ? points[points.length - 1] : null;
    return {
      system: str(series?.label?.system_name, 50),
      name: str(series?.label?.display_name, 70),
      visibility: last && Number.isFinite(Number(last.y)) ? Number(last.y) : null,
      mentions: last && Number.isFinite(Number(last.z)) ? Number(last.z) : null,
      history: points.map((p) => ({ date: str(p.x, 30), value: Number(p.y) || 0 }))
    };
  });
  const sites = only(stats.site_visibility_curve, 10).map((series) => {
    const pts = only(series?.data, 100);
    return {
      system: str(series?.label?.system_name, 50),
      visibility: pts.length && Number.isFinite(Number(pts[pts.length-1]?.y)) ? Number(pts[pts.length-1].y) : null
    };
  });
  const competitors = only(stats?.competitors?.table, 8).map((c) => ({
    brand: str(c.competitor?.name, 120),
    visibility: Number.isFinite(Number(c?.visibility?.last)) ? Number(c.visibility.last) : null,
    share: Number.isFinite(Number(c?.share_of_voice?.last)) ? Number(c.share_of_voice.last) : null
  }));
  const rows = only(answers?.tableData?.rows, 30);
  const prompts = [];
  for (const row of rows) {
    for (const entry of only(row?.data, 12)) {
      prompts.push({
        prompt: str(row.prompt?.value, 220),
        neural: str(entry.neural?.display_name || entry.neural?.system_name, 75),
        mention: entry.mention === 1 ? true : entry.mention === 0 ? false : null,
        position: Number.isFinite(Number(entry.mention_position)) && Number(entry.mention_position)>0
          ? Number(entry.mention_position) : null,
        answer: str(entry.answer, 1300),
        sources: only(entry.urls, 5).map((u) => {
          const address = str(u.url, 300);
          return /^https:\/\//.test(address) ? address : '';
        }).filter(Boolean)
      });
      if (prompts.length >= 45) break;
    }
    if (prompts.length >= 45) break;
  }
  return {
    projectId,
    brand: str(summary?.project?.brand, 120),
    domain: str(summary?.project?.domain, 160),
    lastUpdate: summary?.lastUpdateDate || null,
    promptCount: Number(summary?.project?.prompts_count) || 0,
    curves, sites, competitors, prompts,
    noData: !summary?.lastUpdateDate && !curves.length
  };
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return result(405, { error: 'Только POST.' });
  if ((event.body || '').length > 12000) return result(413, { error: 'Слишком большой запрос.' });
  let data;
  try { data = JSON.parse(event.body || '{}'); }
  catch { return result(400, { error: 'Неверный формат запроса.' }); }
  if (data.action === 'config') {
    return result(200, { configured: !!(process.env.PIXELTOOLS_API_TOKEN && process.env.MIRVIX_AUDIT_PASSWORD) });
  }
  if (!process.env.PIXELTOOLS_API_TOKEN || !process.env.MIRVIX_AUDIT_PASSWORD) {
    return result(503, { error: 'Для анализа ИИ нужно задать PIXELTOOLS_API_TOKEN и MIRVIX_AUDIT_PASSWORD в Netlify.' });
  }
  if (!authorized(event)) return result(401, { error: 'Неверный пароль кабинета MIRVIX AI.' });
  try {
    switch (data.action) {
      case 'connect': {
        const [projects, neurals] = await Promise.all([pixel('/projects'), pixel('/neurals')]);
        return result(200, {
          projects: normalizeProjects(projects),
          neurals: only(neurals?.data, 30).map((n) => ({
            id:n.id, slug:str(n.system_name,60), name:str(n.display_name,80)
          }))
        });
      }
      case 'draft': {
        const brand = str(data.brand, 120), activities = str(data.activities, 200);
        if (brand.length < 2 || activities.length < 3) return result(422, { error: 'Укажите название компании и чем она занимается.' });
        const neurals = only(data.neurals, 4).map((v) => str(v, 45))
          .filter((v) => /^[a-z0-9-]{2,45}$/.test(v));
        if (!neurals.length) return result(422, { error: 'Выберите хотя бы одну нейросеть.' });
        const region = [2,213,225].includes(Number(data.region)) ? Number(data.region) : 2;
        const d = domain(str(data.domain, 240));
        const created = await pixel('/project-drafts', 'POST', {
          brand, activities: [activities], domain: d || undefined,
          neurals, region, language: 'ru'
        });
        return result(200, {draftId:created.draft_id, state:created.status || 'processing'});
      }
      case 'draft-status': {
        const d = await pixel('/project-drafts/' + draftId(data.draftId));
        return result(200, {
          draftId:d.draft_id, state:d.status, progress:d.progress ?? null,
          prompts:only(d.prompts, 80).map((p)=>({text:str(p.text,300), group:str(p.group,70)}))
        });
      }
      case 'draft-save': {
        const prompts = only(data.prompts, 15).map((x) => str(x, 300)).filter((x)=>x.length>4);
        if (prompts.length < 3) return result(422, { error: 'Выберите минимум 3 запроса для анализа.' });
        await pixel('/project-drafts/' + draftId(data.draftId) + '/prompts', 'PATCH', {prompts});
        return result(200, {saved:prompts.length});
      }
      case 'create-project': {
        const created = await pixel('/project-drafts/' + draftId(data.draftId) + '/project', 'POST');
        return result(200, {projectId:created.project_id, url:str(created.project_url,300)});
      }
      case 'forecast': {
        const dataOut = await pixel('/projects/' + id(data.projectId) + '/limits-forecast');
        const f = dataOut.data || {};
        return result(200, {limits:f.update_limits ?? null, rub:f.update_rub ?? null});
      }
      case 'start': {
        if (data.confirmSpend !== true) return result(422,{error:'Подтвердите платный запуск проверки.'});
        const started = await pixel('/projects/' + id(data.projectId) + '/parse', 'POST', {
          with_recommendations: false, with_frequency: false
        });
        return result(200, {
          state:started?.data?.parse?.status || 'queued',
          progress: started?.data?.parse?.progress ?? 0
        });
      }
      case 'progress': {
        const status = await pixel('/projects/' + id(data.projectId));
        const p = status.data?.parse || {};
        return result(200, {
          state:str(p.status || 'unknown',50),
          inProgress:!!p.in_progress, progress:p.progress ?? null,
          phase:str(p.phase,70), lastCompleted:p.last_completed_at || null
        });
      }
      case 'results': {
        const projectId = id(data.projectId);
        const [sum, answers] = await Promise.all([
          pixel('/projects/' + projectId + '/summary'),
          pixel('/projects/' + projectId + '/answers/visibility')
        ]);
        return result(200, getSummary(sum, answers, projectId));
      }
      default:
        return result(400, {error:'Неизвестная команда.'});
    }
  } catch (err) {
    return result(err.status >= 400 && err.status < 600 ? err.status : 502, {
      error: err?.message || 'Сервис проверки ИИ сейчас недоступен.'
    });
  }
};

export const _test = {authorized, domain, getSummary, id, draftId, normalizeProjects};
