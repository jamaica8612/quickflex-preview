// Isolated preview ledger. Production remains DB-first; this module never calls a server.
export const LEDGER_KEY = 'quickflex-public-preview-commercial-v1';
export const validDate = value => {if(!/^\d{4}-\d{2}-\d{2}$/.test(value || ''))return false;const date=new Date(`${value}T00:00:00Z`);return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;};
export function integer(value, label, {positive=false}={}) {
  if (value === '' || value == null || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > 1e12 || (positive && Number(value) === 0)) throw new Error(`${label}을 올바른 정수로 입력해 주세요.`);
  return Number(value);
}
export function validateWork(work, today) {
  if (!work.id || !validDate(work.workDate) || work.workDate > today) throw new Error('확정할 업무일을 확인해 주세요. 미래 실적은 저장할 수 없습니다.');
  if (!['day','night'].includes(work.shift)) throw new Error('주간 또는 야간을 선택해 주세요.');
  if (!Array.isArray(work.rows) || work.rows.length === 0) throw new Error('확인할 구역을 입력해 주세요.');
  const seen = new Set();
  for (const row of work.rows) {
    if (!row.route?.trim() || row.route.length > 128 || row.routeState === 'unresolved') throw new Error('구역 확인 필요 항목을 먼저 확인해 주세요.');
    if (seen.has(row.route.trim())) throw new Error('같은 구역의 중복 행을 합쳐 주세요.');
    seen.add(row.route.trim());
    integer(row.settlementCount, '정산 수량');
    integer(row.unit, `${row.route} 단가`, {positive:true});
    if (row.normalItems != null) integer(row.normalItems,'정상 배송 수량');
  }
  for (const key of ['freshCount','returnCount','cancelCount']) integer(work[key] ?? 0, key);
  return work;
}
export function createLedger(storage, seed=[]) {
  const raw = storage.getItem(LEDGER_KEY);
  let data = raw ? JSON.parse(raw) : {version:1,works:seed,drafts:[],requests:{}};
  if (data.version !== 1 || !Array.isArray(data.works) || !Array.isArray(data.drafts)) throw new Error('미리보기 저장 형식을 읽지 못했습니다. 기존 데이터를 보존했습니다.');
  const clone = value => JSON.parse(JSON.stringify(value));
  const refresh = () => {const value=storage.getItem(LEDGER_KEY);if(value)data=JSON.parse(value);};
  const write = next => { storage.setItem(LEDGER_KEY, JSON.stringify(next)); data=next; };
  if (!raw) write(data);
  return {
    works: () => {refresh();return clone(data.works);}, drafts: () => {refresh();return clone(data.drafts);},
    stage(draft) { refresh();const next=clone(data); next.drafts=next.drafts.filter(w=>w.id!==draft.id); next.drafts.push(clone(draft)); write(next); return clone(draft); },
    discard(id) { refresh();const next=clone(data); next.drafts=next.drafts.filter(w=>w.id!==id); write(next); },
    confirm(work,{expectedRevision=0,requestId,today,calculate}) {
      validateWork(work,today);
      if (!requestId) throw new Error('저장 요청 식별자가 없습니다.');
      // Refresh before compare-and-swap so a second tab cannot silently overwrite newer data.
      const latest = storage.getItem(LEDGER_KEY);
      if (latest) data=JSON.parse(latest);
      const fingerprint=JSON.stringify(work);
      const previous=data.requests[requestId];
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new Error('같은 저장 요청의 내용이 달라졌습니다. 기록을 다시 열어 주세요.');
        return clone(data.works.find(w=>w.id===previous.id));
      }
      const existing=data.works.find(w=>w.id===work.id);
      if ((existing?.revision || 0) !== expectedRevision) throw new Error('다른 수정 내용이 먼저 저장되었습니다. 최신 기록을 다시 열어 확인해 주세요.');
      const record = {...work.record, off:false, rows:work.rows.map(row=>({...row.recordRow,route:row.route,count:row.settlementCount,unit:row.unit})), freshCount:work.freshCount || 0, returnCount:work.returnCount || 0, cancellationCount:work.cancelCount || 0};
      const totals=calculate(record);
      if (!Number.isSafeInteger(totals.revenue) || totals.revenue < 0) throw new Error('매출 계산 결과를 확인할 수 없습니다.');
      const saved={...clone(work), record, status:'confirmed', revision:expectedRevision+1, amount:totals.revenue, freshAmount:totals.freshRevenue, allowanceAmount:totals.backupRevenue, syncStatus:'local-only', rows:work.rows.map(row=>({...row,settlementCount:Number(row.settlementCount),unit:Number(row.unit),normalItems:row.normalItems==null?null:Number(row.normalItems),amount:row.settlementCount*row.unit}))};
      const next=clone(data);
      next.works=next.works.filter(w=>w.id!==saved.id); next.works.push(saved);
      next.drafts=next.drafts.filter(w=>w.id!==saved.id);
      next.requests[requestId]={id:saved.id,fingerprint};
      write(next);
      return clone(saved);
    },
    markDate(workDate,status,shift='day') {
      if (!validDate(workDate) || !['off','planned','in-progress'].includes(status)) throw new Error('날짜 상태를 확인해 주세요.');
      refresh();const next=clone(data), id=`preview-date:${workDate}:${shift}`;
      next.works=next.works.filter(w=>w.id!==id);
      next.works.push({id,revision:1,workDate,shift,status,rows:[],amount:0}); write(next);
    }
  };
}
export function nativeDraft(detail, works, today) {
  if (!detail?.workId || !validDate(detail.workDate) || detail.workDate>today || !['day','night'].includes(detail.shift)) throw new Error('측정 결과의 업무 식별자·날짜·근무조를 확인할 수 없습니다.');
  const sourceRevision=integer(detail.revision,'측정 버전',{positive:true});
  const existing=works.find(w=>w.id===detail.workId);
  if (existing && (existing.sourceRevision || 0)>=sourceRevision) return {existing};
  if (!Array.isArray(detail.rows) || detail.rows.length>100) throw new Error('측정 구역 내역을 확인할 수 없습니다.');
  const rows=detail.rows.map(row=>({route:String(row.route || '').trim(), settlementCount:integer(row.count,'정산 수량'), unit:row.unit == null ? '' : integer(row.unit,'단가'), normalItems:row.normalItems==null?null:integer(row.normalItems,'정상 수량'), source:'preview-measurement', routeState:row.routeState || 'confirmed'})).sort((a,b)=>a.route.localeCompare(b.route,'ko'));
  return {draft:{id:detail.workId,revision:existing?.revision || 0,sourceRevision,workDate:detail.workDate,shift:detail.shift,sourceKind:'preview-measurement',status:'in-progress',rows,freshCount:detail.freshCount || 0,returnCount:detail.returnCount || 0,cancelCount:detail.cancelCount || 0,measurement:detail.measurement || null,record:{driverType:'fixed',freshUnit:100},modifiedFields:[]}};
}
