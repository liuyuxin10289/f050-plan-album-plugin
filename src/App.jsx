import React, { useCallback, useEffect, useRef, useState } from 'react';
import { bitable, dashboard, DashboardState, SourceType } from '@lark-base-open/js-sdk';

// 存储表：运行时按名称自动查找，不存在则自动创建（不硬编码表 ID，适配任意 Base）
const STORAGE_TABLE_NAME = '产测方案画册草稿';
const STORAGE_FIELD = '画册数据';
const TEXT_FIELD_TYPE = 1; // FieldType.Text

// 封面渐变色池（画册卡片封面，蓝白主调 + 少量辅助色）
const COVER_GRADIENTS = [
  ['#185FA5', '#4A9BD9'],
  ['#0C447C', '#2E7CB8'],
  ['#1D6FB8', '#5BA6DE'],
  ['#534AB7', '#8A82E0'],
  ['#0E7C86', '#3AA8B2'],
];

// CORS 代理链（标题抓取失败时的降级方案）
const CORS_PROXIES = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

// 兼容文本字段值
function getText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((seg) => (seg && seg.text) || '').join('');
  if (typeof v === 'object') return v.text || v.name || v.value || '';
  return String(v);
}

// 是否为飞书链接（需登录鉴权，无法跨域抓标题）
function isFeishuLink(url) {
  try {
    return /(feishu\.cn|larksuite\.com)$/.test(new URL(url).hostname);
  } catch (e) {
    return false;
  }
}

// 识别链接来源类型（用于封面徽章）
function sourceTypeOf(url) {
  try {
    const u = new URL(url);
    const h = u.hostname;
    if (/feishu\.cn$/.test(h) || /larksuite\.com$/.test(h)) {
      if (/\/wiki\//.test(u.pathname)) return '飞书知识库';
      if (/\/mindnotes\//.test(u.pathname)) return '飞书思维笔记';
      if (/\/(sheet|sheets|base)\//.test(u.pathname)) return '飞书表格';
      if (/\/docx\//.test(u.pathname)) return '飞书文档';
      return '飞书';
    }
    return '网页链接';
  } catch (e) {
    return '网页链接';
  }
}

// 格式化添加时间：同年「MM-DD HH:mm」，跨年「YYYY-MM-DD」
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const mmdd = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (d.getFullYear() === now.getFullYear()) {
    return `${mmdd} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return `${d.getFullYear()}-${mmdd}`;
}

// 由卡片 id 生成稳定的封面颜色序号（拖动排序后颜色不随位置乱跳）
function colorIndexOf(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % COVER_GRADIENTS.length;
}

// 尽力抓取页面标题：直连 → CORS 代理，均失败返回 null（交由手填）
async function fetchTitle(url) {
  const attempts = [
    { url, direct: true },
    ...CORS_PROXIES.map((p) => ({ url: p(url), direct: false })),
  ];
  for (const a of attempts) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(a.url, { signal: ctrl.signal, redirect: 'follow' });
      clearTimeout(timer);
      if (!res.ok) continue;
      const text = await res.text();
      const m = text.match(/<title[^>]*>([^<]*)<\/title>/i);
      if (m && m[1] && m[1].trim()) return m[1].trim();
    } catch (e) {
      /* 继续下一个 */
    }
  }
  return null;
}

// 获取存储表：按名称查找，不存在则自动创建（含文本字段）
async function ensureStorageTable() {
  let table = null;
  try {
    table = await bitable.base.getTableByName(STORAGE_TABLE_NAME);
  } catch (e) {
    table = null;
  }
  if (!table) {
    const res = await bitable.base.addTable({
      name: STORAGE_TABLE_NAME,
      fields: [{ name: STORAGE_FIELD, type: TEXT_FIELD_TYPE }],
    });
    table = await bitable.base.getTableById(res.tableId);
  }
  return table;
}

// 读取卡片列表
async function readCards() {
  const table = await ensureStorageTable();
  const field = await table.getFieldByName(STORAGE_FIELD);
  const ids = await table.getRecordIdList();
  if (!ids || !ids.length) return [];
  const rec = await table.getRecordById(ids[0]);
  const raw = rec && rec.fields ? rec.fields[field.id] : null;
  const json = getText(raw);
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

// 将卡片列表写入飞书表
async function writeCards(cards) {
  const table = await ensureStorageTable();
  const field = await table.getFieldByName(STORAGE_FIELD);
  const json = JSON.stringify(cards);
  const seg = [{ type: 'text', text: json }];
  const ids = await table.getRecordIdList();
  if (ids && ids.length) {
    await table.setRecord(ids[0], { fields: { [field.id]: seg } });
  } else {
    await table.addRecord({ fields: { [field.id]: seg } });
  }
}

// 文档封面图标
function DocIcon() {
  return (
    <svg className="card-icon" viewBox="0 0 24 24" width="34" height="34" aria-hidden="true">
      <path d="M7 2.5h7.2l4.3 4.3V21.5H7V2.5z" fill="rgba(255,255,255,0.30)" />
      <path d="M14 2.5v4.5h4.5" fill="rgba(255,255,255,0.45)" />
      <rect x="9.2" y="11" width="5.6" height="1.5" rx="0.75" fill="#ffffff" />
      <rect x="9.2" y="14" width="5.6" height="1.5" rx="0.75" fill="#ffffff" />
      <rect x="9.2" y="17" width="3.4" height="1.5" rx="0.75" fill="#ffffff" />
    </svg>
  );
}

export default function App() {
  const [dashState, setDashState] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cards, setCards] = useState([]);
  const [msg, setMsg] = useState('');
  const [dirty, setDirty] = useState(false); // 是否有未保存的更改

  // 拖拽排序状态
  const [dragId, setDragId] = useState(null);

  // 添加卡片面板状态
  const [addOpen, setAddOpen] = useState(false);
  const [addUrl, setAddUrl] = useState('');
  const [addName, setAddName] = useState('');
  const [addPhase, setAddPhase] = useState('idle'); // idle | fetching | need-name

  // 编辑卡片面板状态
  const [editing, setEditing] = useState(null); // { id, name, url }

  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const dragIndexRef = useRef(null);
  const justDraggedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const list = await readCards();
      setCards(list);
      setDirty(false);
      setLoading(false);
      setError(null);
      setMsg(list.length ? `已加载 ${list.length} 个产测方案 · 拖动卡片可排序` : '暂无卡片，点击「添加卡片」填入产测方案链接');
    } catch (e) {
      setLoading(false);
      setError(String((e && e.message) || e));
    }
  }, []);

  useEffect(() => {
    try {
      setDashState(dashboard.state);
    } catch (e) {
      setDashState('');
    }
    load();
  }, [load]);

  const commitAdd = useCallback((name, url) => {
    const card = { id: `c${Date.now()}`, name, url, addedAt: Date.now() };
    setCards((cur) => [...cur, card]);
    setDirty(true);
    setAddOpen(false);
    setAddUrl('');
    setAddName('');
    setAddPhase('idle');
    setMsg(`已添加「${name}」（记得点保存）`);
  }, []);

  const handleAdd = useCallback(async () => {
    const url = addUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      setMsg('请输入有效的 http(s) 链接');
      return;
    }
    const name = addName.trim();
    if (name) {
      commitAdd(name, url);
      return;
    }
    if (addPhase === 'need-name') {
      setMsg('请先填写文档名称');
      return;
    }
    if (isFeishuLink(url)) {
      setAddPhase('need-name');
      setMsg('飞书文档链接需登录鉴权，无法自动读取标题，请手动填写文档名称');
      return;
    }
    setAddPhase('fetching');
    const title = await fetchTitle(url);
    if (title) {
      commitAdd(title, url);
    } else {
      setAddPhase('need-name');
      setMsg('无法自动获取标题，请手动填写文档名称');
    }
  }, [addUrl, addName, addPhase, commitAdd]);

  const removeCard = useCallback((id) => {
    setCards((cur) => cur.filter((c) => c.id !== id));
    setDirty(true);
    setMsg('已删除卡片（记得点保存）');
  }, []);

  const openEdit = useCallback((card) => {
    setEditing({ id: card.id, name: card.name, url: card.url });
  }, []);

  const commitEdit = useCallback(() => {
    if (!editing) return;
    const url = editing.url.trim();
    if (!/^https?:\/\//i.test(url)) {
      setMsg('链接无效');
      return;
    }
    const name = editing.name.trim();
    if (!name) {
      setMsg('请填写文档名称');
      return;
    }
    setCards((cur) => cur.map((c) => (c.id === editing.id ? { ...c, name, url } : c)));
    setDirty(true);
    setEditing(null);
    setMsg('已修改卡片（记得点保存）');
  }, [editing]);

  const save = useCallback(async () => {
    try {
      await writeCards(cardsRef.current);
      setDirty(false);
      setMsg('已保存到飞书表');
    } catch (e) {
      setMsg('保存失败：' + String((e && e.message) || e));
    }
  }, []);

  const reload = useCallback(async () => {
    if (dirty) {
      const ok = window.confirm('有未保存的更改，刷新将丢弃这些更改，确定继续？');
      if (!ok) return;
    }
    await load();
    setMsg('已重新加载');
  }, [dirty, load]);

  const openAdd = useCallback(() => {
    setAddUrl('');
    setAddName('');
    setAddPhase('idle');
    setAddOpen(true);
    setMsg('');
  }, []);

  // —— 拖拽排序（本地重排，保存时才写表）——
  const onDragStart = useCallback((e, idx, id) => {
    dragIndexRef.current = idx;
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', String(idx));
    } catch (err) {
      /* ignore */
    }
  }, []);

  const onDragOver = useCallback((e, targetIdx) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const from = dragIndexRef.current;
    if (from == null || from === targetIdx) return;
    const cur = cardsRef.current;
    if (from < 0 || from >= cur.length || targetIdx < 0 || targetIdx >= cur.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const before = (e.clientX - rect.left) < rect.width / 2;
    const to = before ? targetIdx : targetIdx + 1;
    const next = [...cur];
    const [moved] = next.splice(from, 1);
    const ins = to > from ? to - 1 : to;
    next.splice(ins, 0, moved);
    if (ins === from) return;
    cardsRef.current = next;
    dragIndexRef.current = ins;
    setCards(next);
  }, []);

  const onDrop = useCallback(() => {
    dragIndexRef.current = null;
    setDragId(null);
    setDirty(true);
    setMsg('已调整顺序（记得点保存）');
  }, []);

  const onDragEnd = useCallback(() => {
    dragIndexRef.current = null;
    setDragId(null);
    justDraggedRef.current = true;
    setTimeout(() => {
      justDraggedRef.current = false;
    }, 120);
  }, []);

  const handleConfirm = useCallback(async () => {
    try {
      const table = await ensureStorageTable();
      await dashboard.saveConfig({
        dataConditions: {
          tableId: table.id,
          dataRange: { type: SourceType.ALL },
          series: 'COUNTA',
          groups: [],
        },
      });
    } catch (e) {
      setMsg('保存配置失败：' + String((e && e.message) || e));
    }
  }, []);

  const isConfig = dashState === DashboardState.Create || dashState === DashboardState.Config;

  if (loading) return <div className="tip">正在加载产测方案画册…</div>;
  if (error) return <div className="tip error">加载失败：{error}</div>;

  if (isConfig) {
    return (
      <div className="app">
        <div className="config-panel">
          <div className="config-title">F050 产测方案画册</div>
          <div className="config-desc">卡片手动增删改，每张卡片绑定一个产测方案链接并显示文档名称，点击跳转查阅。点击右下角「确定」添加到仪表盘。</div>
        </div>
        <button className="config-confirm" onClick={handleConfirm}>确定</button>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="header">
        <span className="h-title">F050 产测方案画册</span>
        <div className="h-actions">
          <button className="btn" onClick={reload}>刷新</button>
          <button className="btn btn-primary" onClick={openAdd}>＋ 添加卡片</button>
          <button className={`btn${dirty ? ' btn-save-dirty' : ''}`} onClick={save}>
            {dirty ? '● 保存' : '保存'}
          </button>
        </div>
      </div>
      <div className="t-msg">{dirty ? '有未保存的更改，点击「保存」写入飞书表 · ' : ''}{msg}</div>

      <div className="album">
        {cards.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">📄</div>
            <div className="empty-text">暂无产测方案卡片</div>
            <div className="empty-sub">点击右上角「添加卡片」，填入产测方案链接即可</div>
          </div>
        ) : (
          cards.map((card, idx) => {
            const [g0, g1] = COVER_GRADIENTS[colorIndexOf(card.id)];
            return (
              <div
                className={`card${dragId === card.id ? ' dragging' : ''}`}
                key={card.id}
                draggable
                onDragStart={(e) => onDragStart(e, idx, card.id)}
                onDragOver={(e) => onDragOver(e, idx)}
                onDrop={onDrop}
                onDragEnd={onDragEnd}
              >
                <a
                  className="card-link"
                  href={card.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`打开：${card.name}`}
                  draggable={false}
                  onClick={(e) => {
                    if (justDraggedRef.current) e.preventDefault();
                  }}
                >
                  <div
                    className="card-cover"
                    style={{ background: `linear-gradient(135deg, ${g0}, ${g1})` }}
                  >
                    <DocIcon />
                    <span className="card-type">{sourceTypeOf(card.url)}</span>
                    <span className="card-open" aria-hidden="true">↗</span>
                  </div>
                  <div className="card-body">
                    <div className="card-title">{card.name}</div>
                    <div className="card-meta">添加于 {fmtTime(card.addedAt)}</div>
                  </div>
                </a>
                <div className="card-actions">
                  <button
                    className="card-btn"
                    title="编辑卡片"
                    draggable={false}
                    onDragStart={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openEdit(card);
                    }}
                  >
                    ✎
                  </button>
                  <button
                    className="card-btn card-btn-del"
                    title="删除卡片"
                    draggable={false}
                    onDragStart={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      removeCard(card.id);
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {addOpen && (
        <div className="add-mask" onClick={() => setAddOpen(false)}>
          <div className="add-panel" onClick={(e) => e.stopPropagation()}>
            <div className="add-title">添加产测方案卡片</div>
            <label>产测方案链接（必填）</label>
            <input
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
              placeholder="https://…"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            />
            {(addPhase === 'need-name' || addName) && (
              <>
                <label>文档名称（用于卡片显示）</label>
                <input
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="请输入文档名称"
                  autoFocus={addPhase === 'need-name'}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
                />
              </>
            )}
            <div className="add-hint">
              {addPhase === 'fetching'
                ? '正在抓取页面标题…'
                : '填链接后点「添加」：网页链接自动抓标题；飞书文档需手动填名称'}
            </div>
            <div className="add-btns">
              <button className="btn" onClick={() => setAddOpen(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleAdd} disabled={addPhase === 'fetching'}>
                {addPhase === 'fetching' ? '抓取中…' : addPhase === 'need-name' ? '确认添加' : '添加'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="add-mask" onClick={() => setEditing(null)}>
          <div className="add-panel" onClick={(e) => e.stopPropagation()}>
            <div className="add-title">编辑产测方案卡片</div>
            <label>文档名称</label>
            <input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="请输入文档名称"
              autoFocus
            />
            <label>产测方案链接</label>
            <input
              value={editing.url}
              onChange={(e) => setEditing({ ...editing, url: e.target.value })}
              placeholder="https://…"
              onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); }}
            />
            <div className="add-btns">
              <button className="btn" onClick={() => setEditing(null)}>取消</button>
              <button className="btn btn-primary" onClick={commitEdit}>确定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
