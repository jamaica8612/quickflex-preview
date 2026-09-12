import {createLedger,nativeDraft} from './commercial-ledger.js';
import * as metrics from './commercial-metrics.js';
import {mountExpenses,listExpenses} from './commercial-expenses.js';
import {routeColorSlot} from '../ui/instrument-month.js';
import {HOLIDAYS,holidayCoverage} from './commercial-holidays.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = value => typeof value==='bigint'?value.toLocaleString('ko-KR'):Number.isFinite(value) ? Math.round(value).toLocaleString('ko-KR') : '—';
const money = value => `${typeof value==='bigint'?value.toLocaleString('ko-KR'):typeof value==='string'&&/^-?\d+$/.test(value)?BigInt(value).toLocaleString('ko-KR'):num(value)}<small class="metric-unit">원</small>`;
const sumExpense = rows => rows.reduce((sum,row)=>sum+BigInt(row.amount),0n);
const remainder = (revenue,spent) => typeof revenue==='bigint'?revenue-spent:Number.isSafeInteger(revenue)?BigInt(revenue)-spent:NaN;
const averageMoney = (value,days) => !days?null:typeof value==='bigint'?(value+BigInt(Math.floor(days/2)))/BigInt(days):value/days;
const compactMoney = value => typeof value==='bigint'?`${num(value/10000n)}만`:value>=10000?`${(value/10000).toFixed(1)}만`:num(value);
const shiftLabel = value => value==='night'?'야간':'주간';
const iso = date => date.toISOString().slice(0,10);
const add = (date,days) => { const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return iso(d); };
const stateLabel = {confirmed:'확정',off:'휴무',planned:'근무 예정','in-progress':'진행 중'};
const field = (name,label,value,type='number',extra='') => `<label>${label}<input name="${name}" type="${type}" value="${escape(value)}" ${extra}></label>`;

export function mountCommercial({calculate,entries,seeded,today,getRates,saveRates,getPreferences,openMeasurement,openSettings,notify}) {
  const initial=Object.entries(entries).map(([date,record])=>{
    const amount=calculate(record), status=record.off?'off':date>today?'planned':'confirmed';
    return {id:`preview-import:${date}`,revision:1,workDate:date,shift:'day',status,amount:amount.revenue,freshAmount:amount.freshRevenue,allowanceAmount:amount.backupRevenue,sourceKind:seeded?'example':'legacy-import',syncStatus:'local-only',record,
      freshCount:amount.freshCount,returnCount:amount.returnCount,cancelCount:amount.cancellationCount,
      rows:record.rows.map(row=>({route:row.route,settlementCount:Number(row.count)||0,unit:Number(row.unit)||0,amount:(Number(row.count)||0)*(Number(row.unit)||0),normalItems:seeded&&status==='confirmed'?Number(row.count)||0:null,source:seeded?'example':'unknown',routeState:'confirmed',recordRow:row})),measurement:null};
  });
  let ledger;
  try { ledger=createLedger(localStorage,initial); } catch(error) { document.getElementById('app').innerHTML=`<section class="commercial-page"><h1>기록을 열지 못했습니다</h1><p>${escape(error.message)}</p><p>기존 데이터는 보존했습니다. 저장 공간을 확인한 뒤 새로고침해 주세요.</p></section>`;return null; }
  let selected=today, month=today.slice(0,7), periodKind='settlement', expenses=[], view='home', draft=null, requestId=null, reportId=null, statsTab='revenue', statsRoute='',statsShift='',weeks=4;
  const app=document.getElementById('app');
  app.classList.add('commercial-active');
  const home=document.createElement('div');home.id='commercialHome';home.className='commercial-page';document.querySelector('.view-home').append(home);
  const stats=document.createElement('div');stats.id='commercialStats';stats.className='commercial-page';document.querySelector('.view-stats').append(stats);
  const expenseView=document.createElement('section');expenseView.className='view view-expenses';expenseView.innerHTML='<div id="commercialExpenses" class="commercial-page"></div>';app.append(expenseView);
  const editor=document.createElement('dialog');editor.className='commercial-dialog';editor.setAttribute('aria-label','배송 수량과 단가 확인');document.body.append(editor);
  const report=document.createElement('dialog');report.className='commercial-dialog';report.setAttribute('aria-label','업무 결과 보고서');document.body.append(report);
  const nav=document.querySelector('.bottom-nav');
  const expenseTab=nav.querySelector('[data-view="measurement"]'); expenseTab.dataset.view='expenses';expenseTab.innerHTML='<span aria-hidden="true">▤</span><span>지출</span>';
  // Keep the native bridge as a home action. The four primary roles remain stable.
  nav.addEventListener('click',event=>{const tab=event.target.closest('[data-view]');if(!tab)return;event.preventDefault();event.stopImmediatePropagation();show(tab.dataset.view);},true);
  function show(next) {
    view=next;app.dataset.view=next;
    nav.querySelectorAll('[data-view]').forEach(tab=>{const active=tab.dataset.view===next;tab.classList.toggle('active',active);active?tab.setAttribute('aria-current','page'):tab.removeAttribute('aria-current');});
    if(next==='home')renderHome(); if(next==='stats')renderStats(); if(next==='settings')openSettings();
    window.scrollTo(0,0);
  }
  function range() {
    const [y,m]=month.split('-').map(Number);
    return periodKind==='settlement'?metrics.settlementRange(y,m):{start:`${month}-01`,end:iso(new Date(Date.UTC(y,m,0)))};
  }
  function eligible(bounds=range()) { return ledger.works().filter(w=>w.status==='confirmed'&&w.workDate<=today&&w.workDate>=bounds.start&&w.workDate<=bounds.end); }
  function total(works) {const value=works.reduce((sum,w)=>sum+BigInt(w.amount),0n);return value<=BigInt(Number.MAX_SAFE_INTEGER)?Number(value):value;}
  function dateExpenses(date) {return expenses.filter(e=>e.date===date);}
  function periodExpenses(bounds=range(),works=null) { const ids=works?new Set(works.map(w=>w.id)):null;return expenses.filter(e=>e.date<=today&&e.date>=bounds.start&&e.date<=bounds.end&&(!ids||ids.has(e.workId))); }
  function periodControls() { const r=range();return `<div class="commercial-period"><label>집계 기준<select data-control="period"><option value="settlement" ${periodKind==='settlement'?'selected':''}>정산월 · 26일~25일</option><option value="calendar" ${periodKind==='calendar'?'selected':''}>달력월 · 1일~말일</option></select></label><label>선택 월<input data-control="month" type="month" value="${month}"></label></div><p class="commercial-note">${r.start} — ${r.end} · 저장된 업무일 기준</p>`; }
  function renderHome() {
    const works=eligible(),r=range(),revenue=total(works),spent=sumExpense(periodExpenses(r));
    const days=new Set(works.map(w=>w.workDate)).size;
    const deliveryCount=works.reduce((s,w)=>s+w.rows.reduce((sum,row)=>sum+Number(row.settlementCount),0),0);
    const dayWorks=ledger.works().filter(w=>w.workDate===selected),confirmed=dayWorks.filter(w=>w.status==='confirmed');
    home.innerHTML=`<header class="home-top"><div><p class="commercial-eyebrow">플렉스코어</p><h1>매출관리</h1></div><button class="secondary-btn" data-action="measure">배송 수량 자동 입력</button></header>${periodControls()}
      <section class="revenue-hero summary-card"><span>확정 매출 · 기기 내 미리보기</span><strong class="commercial-hero">${money(revenue)}</strong><p>${days}일 근무 · ${works.length}회 업무</p><div class="commercial-summary"><span>입력 지출 <b>${money(spent)}</b></span><span>지출 차감 잔액 <b>${money(remainder(revenue,spent))}</b></span></div></section>
      ${ledger.drafts().length?`<button class="commercial-pending" data-action="resume">미저장 초안 ${ledger.drafts().length}건 · 확인 이어하기</button>`:''}
      <section class="calendar-panel"><div class="commercial-four"><span>배송건수<strong>${num(deliveryCount)}<small>개</small></strong></span><span>평균건수<strong>${num(days?deliveryCount/days:null)}<small>개/일</small></strong></span><span>일평균 매출<strong>${money(averageMoney(revenue,days))}</strong></span><span>근무일<strong>${days}<small>일</small></strong></span></div><p class="commercial-note">위 4대 지표는 선택 집계 기간의 확정 정산 수량·매출입니다.</p><div class="calendar-toolbar"><button class="round-btn" data-action="prev" aria-label="이전 달">‹</button><strong>${month.replace('-','년 ')}월</strong><button class="round-btn" data-action="next" aria-label="다음 달">›</button><button class="today-btn" data-action="today">오늘</button></div><p class="commercial-note">달력은 ${month}-01부터 말일까지 표시 · 구역과 ${getPreferences().calendarMetric==='count'?'정산 수량':'매출'}</p>${calendarHtml()}<p class="commercial-note">테두리: 오늘 · 채운 날짜: 선택일<br>확정 0원은 근무일에 포함됩니다. 예정·진행 중은 제외됩니다.</p></section>
      <section class="commercial-day"><h2>${selected} 기록</h2><p class="commercial-note">${confirmed.length?`확정 ${confirmed.length}회 · ${money(total(confirmed))}`:dayWorks.map(w=>stateLabel[w.status]).join(' · ')||'미입력'}</p>${dayWorks.map(w=>`<button class="commercial-record" data-report="${escape(w.id)}"><span>${shiftLabel(w.shift)} · ${stateLabel[w.status]}<small>${escape(w.rows.map(row=>row.route).join(' · '))||'구역 없음'}</small></span><strong>${w.status==='confirmed'?money(w.amount):'상세'}<small>${w.status==='confirmed'?'기기 저장 · 서버 미연결':''}</small></strong></button>`).join('')}
      <p>당일 지출 ${money(sumExpense(dateExpenses(selected)))}</p><div class="commercial-actions"><button class="primary-pill" data-action="new">수량 확인·매출 입력</button><button class="secondary-btn" data-action="expense">지출 기록</button></div><details><summary>근무 상태 설정</summary><p class="commercial-note">확정 업무는 보존하며 일정 상태만 기록합니다.</p><button class="secondary-btn" data-mark="off">휴무</button> <button class="secondary-btn" data-mark="planned">근무 예정</button> <button class="secondary-btn" data-mark="in-progress">진행 중</button></details></section>`;
  }
  function calendarHtml() {
    const [y,m]=month.split('-').map(Number),last=new Date(Date.UTC(y,m,0)).getUTCDate(),offset=new Date(`${month}-01T12:00:00Z`).getUTCDay();
    const list=getPreferences().monthView==='list';
    const cells=Array.from({length:last},(_,i)=>{
      const date=`${month}-${String(i+1).padStart(2,'0')}`,all=ledger.works().filter(w=>w.workDate===date),done=all.filter(w=>w.status==='confirmed'),label=done.length?`${num(total(done))}원`:all.map(w=>stateLabel[w.status]).join(' · ')||'미입력';
      const count=done.reduce((s,w)=>s+w.rows.reduce((a,row)=>a+row.settlementCount,0),0);
      const routes=[...new Set(done.flatMap(w=>w.rows.map(row=>row.route)))];
      const weekday=new Date(`${date}T12:00:00Z`).getUTCDay(),holiday=HOLIDAYS[date];
      return `<button class="commercial-date ${date===selected?'selected':''} ${date===today?'today':''}" data-date="${date}" aria-label="${date} ${escape(holiday||'')} ${escape(label)} ${escape(routes.join(' '))}" aria-pressed="${date===selected}"><span class="${holiday||weekday===0?'commercial-sun':weekday===6?'commercial-sat':''}">${i+1}${list?`일 (${['일','월','화','수','목','금','토'][weekday]})`:''}</span>${holiday?`<small class="commercial-holiday">${escape(holiday)}</small>`:''}<small>${routes.map(route=>routeName(route)).join(list?' · ':'<br>')}</small><b>${done.length?(getPreferences().calendarMetric==='count'?`${num(count)}개`:list?`${num(total(done))}원`:compactMoney(total(done))):escape(label)}</b></button>`;
    });
    if(list)return `<div class="commercial-list">${cells.reverse().join('')}</div>`;
    return `<div class="week-head">${['일','월','화','수','목','금','토'].map((d,i)=>`<span class="${i===0?'commercial-sun':i===6?'commercial-sat':''}">${d}</span>`).join('')}</div><div class="commercial-calendar">${'<span></span>'.repeat(offset)}${cells.join('')}</div><p class="commercial-note">공휴일은 이름으로 구분합니다. ${holidayCoverage}</p>`;
  }
  function routeName(route) {return `<span class="commercial-route" style="--route-color:var(--s-r${routeColorSlot(route)})">${escape(route)}</span>`;}
  function newDraft() {
    const rates=getRates();draft={id:crypto.randomUUID(),revision:0,workDate:selected>today?today:selected,shift:'day',status:'in-progress',sourceKind:'manual',rows:rates.slice(0,2).map(row=>({route:row.route,settlementCount:0,normalItems:null,unit:row.unit,routeState:'confirmed',source:'manual'})),freshCount:0,returnCount:0,cancelCount:0,measurement:null,record:{driverType:'fixed',freshUnit:100},modifiedFields:[]};
    if(!draft.rows.length)draft.rows.push({route:'',settlementCount:0,unit:'',normalItems:null,routeState:'unresolved',source:'manual'});
    requestId=crypto.randomUUID();persistDraft();renderEditor();editor.showModal();
  }
  function persistDraft() {try { ledger.stage({...draft,requestId}); return true; }catch(error){notify(`초안 저장 실패 · ${error.message}`,'error');return false;}}
  function resume(work) {draft=structuredClone(work);requestId=work.status==='confirmed'?crypto.randomUUID():work.requestId||crypto.randomUUID();renderEditor();if(!editor.open)editor.showModal();}
  function renderEditor() {
    editor.innerHTML=`<form id="commercialReview"><header class="commercial-dialog-head"><div><p class="commercial-eyebrow">배송 수량 → 단가 → 저장</p><h2>수량과 매출 확인</h2></div><button type="button" class="round-btn" data-close="editor" aria-label="초안 유지하고 닫기">×</button></header><p class="commercial-note">기기 내 초안입니다. 자동 수량과 수정 내역을 구분하며, 서버에 전송하지 않습니다.</p><div class="commercial-fields">${field('workDate','업무일',draft.workDate,'date',`max="${today}"`)}<label>근무조<select name="shift"><option value="day" ${draft.shift==='day'?'selected':''}>주간</option><option value="night" ${draft.shift==='night'?'selected':''}>야간</option></select></label></div><p class="commercial-note">야간도 저장된 업무일을 유지합니다. 날짜를 수정해도 같은 업무 기록입니다.</p>
      <div class="commercial-review-rows">${draft.rows.map((row,i)=>`<fieldset><legend>${routeName(row.route || '구역 확인 필요')}</legend><div class="commercial-fields">${field(`route-${i}`,'구역',row.route,'text','maxlength="128" required')}${field(`count-${i}`,'정산 수량 · 개',row.settlementCount,'number','min="0" step="1" required inputmode="numeric"')}${field(`unit-${i}`,'이번 업무 단가 · 원',row.unit,'number','min="1" step="1" required inputmode="numeric"')}<label>정상 배송 · 개<input name="normal-${i}" type="number" min="0" step="1" value="${row.normalItems ?? ''}" placeholder="구분 자료 없으면 비워두기"></label></div><p class="commercial-note">${row.source==='preview-measurement'?'자동 수집 예시':'사용자 입력'} · 정산 수량과 정상 배송은 별도입니다.</p><label class="commercial-check"><input type="checkbox" name="confirmed-${i}" ${row.routeState!=='unresolved'?'checked':''}> 이 구역의 수량을 확인했습니다</label><label class="commercial-check"><input type="checkbox" name="default-${i}"> 이 단가를 앞으로 사용할 기본 단가로도 저장</label></fieldset>`).join('')}</div><button type="button" class="secondary-btn" data-action="add-route">구역 추가</button><div class="commercial-fields">${field('freshCount','프레시백 · 개',draft.freshCount,'number','min="0" step="1"')}${field('returnCount','반품 · 개',draft.returnCount,'number','min="0" step="1"')}${field('cancelCount','취소 · 개',draft.cancelCount,'number','min="0" step="1"')}</div><p class="commercial-note">취소·반품은 분리 표시하며 정산 합계에 다시 더하지 않습니다. 프레시백·수당은 기존 산식을 적용합니다.</p><p id="commercialSaveStatus" role="status" aria-live="polite">미저장 초안 · 확인 후 기기에 저장</p><button type="submit" class="full-btn">확인하고 기기에 저장</button></form>`;
    updateQuote();
  }
  function updateQuote() {
    let quote=editor.querySelector('#commercialQuote');
    if(!quote){quote=document.createElement('p');quote.id='commercialQuote';quote.className='commercial-quote';editor.querySelector('#commercialSaveStatus').before(quote);}
    try {
      const missing=draft.rows.some(row=>!row.route||row.unit===''||Number(row.unit)<=0||row.settlementCount==='');
      if(missing){quote.textContent='단가와 수량을 확인하면 저장할 매출이 표시됩니다.';return;}
      const result=calculate({...draft.record,off:false,rows:draft.rows.map(row=>({...row.recordRow,route:row.route,count:row.settlementCount,unit:row.unit})),freshCount:draft.freshCount,returnCount:draft.returnCount,cancellationCount:draft.cancelCount});
      quote.innerHTML=`확인할 매출 <strong>${money(result.revenue)}</strong>`;
    }catch(_){quote.textContent='입력값을 확인해 주세요.';}
  }
  function readEditor() {
    const form=new FormData(editor.querySelector('form'));
    const next={...draft,workDate:form.get('workDate'),shift:form.get('shift'),freshCount:form.get('freshCount'),returnCount:form.get('returnCount'),cancelCount:form.get('cancelCount'),rows:draft.rows.map((row,i)=>({...row,route:form.get(`route-${i}`),settlementCount:form.get(`count-${i}`),unit:form.get(`unit-${i}`),normalItems:form.get(`normal-${i}`)===''?null:form.get(`normal-${i}`),routeState:form.has(`confirmed-${i}`)?'confirmed':'unresolved',saveDefault:form.has(`default-${i}`)}))};
    next.modifiedFields=[...new Set([...(draft.modifiedFields||[]),...['workDate','shift','freshCount','returnCount','cancelCount','rows'].filter(key=>JSON.stringify(next[key])!==JSON.stringify(draft[key]))])];
    next.rows=next.rows.map((row,i)=>({...row,source:String(row.normalItems)!==String(draft.rows[i]?.normalItems)?'user-confirmed':row.source}));
    draft=next;updateQuote();
  }
  editor.addEventListener('input',()=>{readEditor();persistDraft();});
  editor.addEventListener('change',()=>{readEditor();persistDraft();});
  editor.addEventListener('cancel',()=>{readEditor();persistDraft();renderHome();});
  editor.addEventListener('click',event=>{if(event.target.closest('[data-close]')){readEditor();persistDraft();editor.close();renderHome();}if(event.target.closest('[data-action="add-route"]')){readEditor();draft.rows.push({route:'',settlementCount:0,normalItems:null,unit:'',source:'manual',routeState:'unresolved'});persistDraft();renderEditor();}});
  editor.addEventListener('submit',event=>{
    event.preventDefault();readEditor();const status=editor.querySelector('#commercialSaveStatus');
    try {
      const saved=ledger.confirm(draft,{expectedRevision:draft.revision || 0,requestId,today,calculate});
      const defaults=draft.rows.filter(row=>row.saveDefault).map(row=>({route:row.route,unit:Number(row.unit)}));
      if(defaults.length) {try{saveRates(defaults);}catch(error){notify(`매출은 기기에 저장했습니다. 기본 단가는 저장하지 못했습니다: ${error.message}`,'error');}}
      editor.close();selected=saved.workDate;month=selected.slice(0,7);renderHome();renderReport(saved.id);notify('기기 저장 완료 · 서버 미연결','info');
    }catch(error){status.textContent=`저장 실패 · ${error.message} 입력은 유지됩니다. 같은 요청으로 재시도할 수 있습니다.`;}
  });
  function renderReport(id) {
    const work=ledger.works().find(w=>w.id===id);if(!work)return;
    if(work.status!=='confirmed'){selected=work.workDate;newDraft();return;}
    reportId=id;const linked=expenses.filter(e=>e.workId===id&&e.date<=today),spent=sumExpense(linked),known=work.rows.every(row=>row.normalItems!=null),normal=work.rows.reduce((s,row)=>s+Number(row.normalItems||0),0),measurement=work.measurement;
    report.innerHTML=`<header class="commercial-dialog-head"><h2>오늘도 수고했어요.</h2><button class="round-btn" data-close="report" aria-label="보고서 닫기">×</button></header><p>${work.workDate} · ${shiftLabel(work.shift)} · 수정 ${work.revision}</p><p class="commercial-note">사용자 확정 · 기기 저장 · 서버 미연결</p><span>확정 매출</span><strong class="commercial-hero">${money(work.amount)}</strong><div class="commercial-summary"><span>정상 배송 <b>${known?num(normal):'구분 자료 없음'}<small>개</small></b></span><span>정산 수량 <b>${num(work.rows.reduce((s,row)=>s+Number(row.settlementCount),0))}<small>개</small></b></span></div>
      <h3>구역별 확정 내역</h3>${work.rows.map(row=>`<div class="commercial-record"><span>${routeName(row.route)}<small>${escape(row.routeState==='unresolved'?'구역 확인 필요':row.source==='user-confirmed'?'사용자 확인·수정':'구역 확정')} · ${escape(row.source)}</small></span><span>${num(row.settlementCount)}개 × ${num(Number(row.unit))}원<strong>${money(row.amount)}</strong><small>정상 ${row.normalItems==null?'자료 없음':`${num(Number(row.normalItems))}개`}</small></span></div>`).join('')}
      <dl class="commercial-dl"><dt>프레시백</dt><dd>${num(Number(work.freshCount||0))}개 · ${money(work.freshAmount)}</dd><dt>수당 (매출에 포함)</dt><dd>${money(work.allowanceAmount)}</dd><dt>반품 / 취소</dt><dd>${num(Number(work.returnCount||0))}개 / ${num(Number(work.cancelCount||0))}개</dd><dt>연결한 지출</dt><dd>${money(spent)} · ${linked.length}건</dd><dt>지출 차감 잔액</dt><dd>${money(remainder(work.amount,spent))}</dd></dl><p class="commercial-note">이 업무에 연결한 지출만 차감합니다. 미연결 당일 지출은 날짜별 지출에서 확인하세요.</p>
      <details><summary>측정·수정 출처</summary>${measurement?`<p>이 폰의 완료 처리 ${num(measurement.completedHouseholds)}가구 · ${num(measurement.completedItems)}개<br>활성시간 ${num(measurement.activeSeconds)}초 · ${measurement.activeSeconds>0?num(measurement.completedHouseholds*3600/measurement.activeSeconds):'기록 없음'}타/시간</p>`:'<p>측정 기록 없음 · 매출 기록은 유효합니다.</p>'}<p>스캔 후 배송 · 정상 물량은 구분 자료가 있는 값만 표시합니다.</p><p>수정 항목: ${escape((work.modifiedFields||[]).join(', ')||'없음')}</p><p class="commercial-note">업무 ${escape(work.id)} · 원본 버전 ${work.sourceRevision || '해당 없음'}</p></details><div class="commercial-actions"><button class="secondary-btn" data-action="edit-work">기록 수정</button><button class="secondary-btn" data-action="report-expenses">날짜별 지출</button></div>`;
    if(!report.open)report.showModal();
  }
  report.addEventListener('click',event=>{if(event.target.closest('[data-close]'))report.close();if(event.target.closest('[data-action="edit-work"]')){report.close();resume(ledger.works().find(w=>w.id===reportId));}if(event.target.closest('[data-action="report-expenses"]')){report.close();show('expenses');}});

  function renderStats() {try{renderStatsContent();}catch(error){stats.innerHTML=`<h1>통계 계산을 확인해 주세요</h1><p>${escape(error.message)}</p><p>기록은 보존했습니다. 정확한 원 단위 금액은 달력과 내역에서 확인할 수 있습니다.</p>`;}}
  function renderStatsContent() {
    const r=range(),filters={...r,asOfDate:today,route:statsRoute||undefined,shift:statsShift||undefined};
    const works=metrics.selectConfirmedWorks(ledger.works(),filters).works, revenue=statsRoute?works.reduce((s,w)=>s+w.rows.reduce((a,row)=>a+row.amount,0),0):total(works),days=new Set(works.map(w=>w.workDate)).size;
    const routes=[...new Set(ledger.works().flatMap(w=>w.rows.map(row=>row.route)))].sort();
    stats.innerHTML=`<header><p class="commercial-eyebrow">플렉스코어</p><h1>매출과 물량 통계</h1></header>${periodControls()}<div class="commercial-fields"><label>구역<select data-control="route"><option value="">전체 구역</option>${routes.map(route=>`<option ${statsRoute===route?'selected':''}>${escape(route)}</option>`).join('')}</select></label><label>근무조<select data-control="shift"><option value="">주간·야간 전체</option><option value="day" ${statsShift==='day'?'selected':''}>주간</option><option value="night" ${statsShift==='night'?'selected':''}>야간</option></select></label></div><p class="commercial-note">확정 원장 ${days}일 · ${works.length}회 · ${r.start} — ${r.end}</p><div class="commercial-tabs" role="group" aria-label="통계 영역">${[['revenue','매출'],['volume','물량·구역'],['expenses','비용'],['measurement','측정']].map(([key,label])=>`<button data-stats="${key}" aria-pressed="${key===statsTab}">${label}</button>`).join('')}</div><div id="commercialStatsBody"></div><details><summary>집계한 업무 내역</summary>${works.map(w=>`<button class="commercial-record" data-report="${escape(w.id)}"><span>${w.workDate} · ${shiftLabel(w.shift)}</span><b>${money(w.amount)}</b></button>`).join('')||'<p>계산할 기록 없음</p>'}</details>`;
    const body=stats.querySelector('#commercialStatsBody');
    if(statsTab==='revenue') {
      const spent=sumExpense(periodExpenses(r,statsRoute||statsShift?works:null));
      const [y,m]=month.split('-').map(Number),p=new Date(Date.UTC(y,m-2,1)),previousRange=periodKind==='settlement'?metrics.settlementRange(p.getUTCFullYear(),p.getUTCMonth()+1):{start:iso(p),end:iso(new Date(Date.UTC(y,m-1,0)))};
      const comparison=metrics.compareSameWorkdays(ledger.works(),{range:r,previousRange,...filters});
      body.innerHTML=`<section class="summary-card"><h2>확정 매출 ${money(revenue)}</h2><p>입력 지출 ${money(spent)} · 지출 차감 잔액 ${money(remainder(revenue,spent))}</p><p class="commercial-note">${statsRoute||statsShift?'지출도 선택한 업무에 명시적으로 연결된 내역만 반영했습니다. 미연결 지출은 제외합니다.':'같은 기간의 원장 매출과 실제 입력한 지출입니다.'}</p></section><h2>전월과 같은 근무일 수 비교</h2><div id="comparisonChart"></div><p class="commercial-note">저장된 업무일을 중복 없이 셉니다. 같은 날 주간·야간은 1일, 업무 횟수는 2회입니다. 근무조 구성·단가 차이는 효율의 증거가 아닙니다.</p>`;
      renderComparison(body.querySelector('#comparisonChart'),comparison,works,previousRange,filters);
    } else if(statsTab==='volume') {
      const start=add(today,-(weeks*7-1)),volumeFilters={...filters,start,end:today};
      const weekday=metrics.holidayNormalDeliveryStats(ledger.works(),{...volumeFilters,holidayDates:Object.keys(HOLIDAYS)});
      const groups=metrics.routeShiftStats(ledger.works(),filters);
      body.innerHTML=`<h2>내 기록의 요일별 평균 물량</h2><label>최근 기간<select data-control="weeks"><option value="4" ${weeks===4?'selected':''}>최근 4주</option><option value="12" ${weeks===12?'selected':''}>최근 12주</option></select></label><p class="commercial-note">${start} — ${today} · 정상 완료 상품 / 유효 근무일 · 구역·근무조 필터 동일 적용</p><div id="weekdayChart"></div><h2>구역·근무조 비교</h2><div id="routeChart"></div><p class="commercial-note">유형 없는 과거 합산 정산 수량은 정상 물량에서 제외합니다. 묶음 구역은 나누지 않습니다.</p>`;
      renderVolume(body,weekday,groups);
    } else if(statsTab==='expenses') {
      if(expenses.some(e=>!Number.isSafeInteger(Number(e.amount)))||sumExpense(expenses)>BigInt(Number.MAX_SAFE_INTEGER)){body.innerHTML=`<h2>입력한 지출 ${money(sumExpense(periodExpenses(r,statsRoute||statsShift?works:null)))}</h2><p>금액이 그래프의 정수 계산 범위를 초과합니다. 원 단위 금액은 지출 내역에 정확히 보관되어 있습니다.</p><button class="secondary-btn" data-action="expense">지출 내역 확인</button>`;return;}
      const expense=metrics.expenseStats(expenses.map(e=>({...e,amount:Number(e.amount)})),{...r,asOfDate:today,...(statsRoute||statsShift?{workIds:new Set(works.map(w=>w.id)),previousWorkIds:new Set(ledger.works().filter(w=>(!statsShift||w.shift===statsShift)&&(!statsRoute||w.rows.some(row=>row.route===statsRoute))).map(w=>w.id))}:{})});
      renderExpenseStats(body,expense,r);
    } else {
      const measured=metrics.measurementStats(ledger.works(),filters);
      renderMeasurementStats(body,measured);
    }
  }
  // Numeric models are deliberately rendered through explicit known properties below.
  // No guessed values or copied chart fixture numbers are used.
  function renderComparison(container,model,works,previousRange,filters) {
    const n=model.requiredWorkDays;
    if(!n){container.innerHTML='<p>계산할 기록 없음 · 확정된 근무일이 없습니다.</p>';return;}
    if(!model.available){container.innerHTML=`<p>비교 보류 · 이번 ${n}일 / 전월 ${model.availablePreviousWorkDays}일</p><p class="commercial-note">전월 ${previousRange.start} — ${previousRange.end}에 ${n}일의 확정 기록이 필요합니다.</p>`;return;}
    let a=0,b=0;const series=model.current.days.map((day,i)=>({index:i+1,current:a+=day.amount,previous:b+=model.previous.days[i].amount}));
    container.innerHTML=`<p>첫 ${n}근무일 · 증감액 ${money(model.amountDelta)} · ${model.amountDeltaRate!=null?`${(model.amountDeltaRate*100).toFixed(1)}%`:'증감률 비교 불가 (전월 0원)'}</p><p class="commercial-note">이번 ${model.current.workSessions}회 (주간 ${model.current.shiftComposition.day} / 야간 ${model.current.shiftComposition.night})<br>전월 ${model.previous.workSessions}회 (주간 ${model.previous.shiftComposition.day} / 야간 ${model.previous.shiftComposition.night})<br>전월 ${previousRange.start} — ${model.matchedPreviousThrough}</p>${lineChart(series)}<details><summary>근무일별 비교 금액</summary>${series.map(p=>`<p>${p.index}번째 · 이번 ${money(p.current)} / 전월 ${money(p.previous)}</p>`).join('')}</details>`;
  }
  function lineChart(points) {
    const max=Math.max(1,...points.flatMap(p=>[p.current,p.previous])), coords=key=>points.map((p,i)=>`${20+i*280/Math.max(1,points.length-1)},${125-p[key]/max*105}`).join(' ');
    return `<figure class="commercial-chart"><svg viewBox="0 0 320 150" role="img" aria-label="근무일 순서별 누적 매출 비교"><path d="M20 10V125H305" fill="none" stroke="var(--s-line)"/><polyline points="${coords('previous')}" fill="none" stroke="var(--s-muted)" stroke-dasharray="4 4" stroke-width="2"/><polyline points="${coords('current')}" fill="none" stroke="var(--s-state-normal)" stroke-width="3"/><text x="20" y="146" fill="var(--s-muted)">1번째 근무일</text><text x="230" y="146" fill="var(--s-muted)">${points.length}번째</text></svg><figcaption>세로: 누적 매출(원), 0 — ${num(max)} · 실선 이번 / 점선 전월</figcaption></figure>`;
  }
  function renderVolume(body,weekday,groups) {
    // Updated alongside the pure metric model contract; unknown fields never imply zero.
    body.querySelector('#weekdayChart').textContent='집계 중';
    body.querySelector('#routeChart').textContent='집계 중';
    renderMetricVolumes(body,weekday,groups);
  }
  function renderMetricVolumes(body,weekday,groups) {
    const max=Math.max(1,...weekday.weekdays.map(row=>row.averageNormalItems||0));
    body.querySelector('#weekdayChart').innerHTML=`<div class="commercial-weekdays">${weekday.weekdays.map(row=>`<div><b>${num(row.averageNormalItems)}<small>개</small></b><div class="commercial-vtrack"><i style="height:${(row.averageNormalItems||0)/max*100}%;background:var(--s-${row.weekday===0?'state-bad':row.weekday===6?'state-normal':'muted'})"></i></div><strong class="${row.weekday===0?'commercial-sun':row.weekday===6?'commercial-sat':''}">${row.label}</strong><small>${row.workDays}일 표본</small></div>`).join('')}</div><p class="commercial-note">정상 물량 자료가 없는 ${weekday.excludedUnknownRows}개 행 제외 · 표본이 적으면 순위를 단정하지 않습니다.</p><details open><summary>공휴일 물량 따로 보기</summary><p>근무일당 평균 ${num(weekday.holiday.averageNormalItems)}개 · ${weekday.holiday.workDays}일 표본</p><p class="commercial-note">공휴일은 위 요일 통계에도 포함된 별도 표본입니다. ${holidayCoverage}</p>${weekday.holiday.dates.map(date=>`<p>${date} · ${escape(HOLIDAYS[date])}</p>`).join('')}</details>`;
    const weekdayDetail=document.createElement('details');weekdayDetail.innerHTML=`<summary>요일별 평균 매출과 표본</summary>${weekday.weekdays.map(row=>`<p>${row.label}요일 · 평균 매출 ${money(row.averageRevenuePerWorkday)} · 매출 ${row.revenueWorkDays}일 / 정상 물량 ${row.workDays}일 표본</p>`).join('')}`;body.querySelector('#weekdayChart').append(weekdayDetail);
    const maxAmount=Math.max(1,...groups.byRoute.map(row=>row.amount));
    const groupRow=row=>`<div class="commercial-record"><span>${row.route?routeName(row.route):shiftLabel(row.shift)}${row.grouped?' · 묶음 기록':''}<small>${row.workDays}일 · ${row.workSessions}회 · 정상 자료 ${row.normalSampleWorkDays}일</small></span><span><b>${money(row.amount)}</b><small>정상 ${num(row.normalItems)}개 · 일평균 ${num(row.averageNormalItemsPerWorkday)}개</small><small>일평균 매출 ${money(row.averageAmountPerWorkday)}</small></span></div>${row.route?`<div class="commercial-htrack"><i style="width:${row.amount/maxAmount*100}%;background:var(--s-r${routeColorSlot(row.route)})"></i></div>`:''}`;
    body.querySelector('#routeChart').innerHTML=`${groups.byRoute.map(groupRow).join('')}<h3>주간·야간</h3>${groups.byShift.map(groupRow).join('')}<details><summary>구역별 근무조 상세</summary>${groups.byRouteShift.map(row=>`<p>${escape(row.route)} · ${shiftLabel(row.shift)} · ${money(row.amount)} · ${row.workDays}일 · 정상 ${num(row.normalItems)}개</p>`).join('')}</details>`;
  }
  function renderExpenseStats(body,expense,r) {
    const labels={fuel:'주유',ev:'충전',maintenance:'정비',toll:'통행료·주차',other:'기타'},current=expense.current;
    body.innerHTML=`<h2>입력한 지출 ${money(current.amount)}</h2><p>${current.count}건 · 실제 결제일 기준</p>${current.categories.map(row=>`<div class="commercial-record"><span>${labels[row.category]||escape(row.category)}</span><span>${money(row.amount)} · ${row.share==null?'—':(row.share*100).toFixed(1)}%</span></div>`).join('')||'<p>지출 기록 없음</p>'}<p>이전 같은 길이 기간 대비 ${money(expense.amountDelta)} · ${expense.amountDeltaRate==null?'증감률 비교 불가':(expense.amountDeltaRate*100).toFixed(1)+'%'}</p><p class="commercial-note">이번 ${expense.range.start} — ${expense.range.end}<br>이전 ${expense.previousRange.start} — ${expense.previousRange.end}</p><dl class="commercial-dl"><dt>수량을 적은 주유</dt><dd>${num(current.unitCosts.wonPerLiter)}원/L</dd><dt>수량을 적은 충전</dt><dd>${num(current.unitCosts.wonPerKwh)}원/kWh</dd></dl><p class="commercial-note">L·kWh가 기록된 지출만 단가에 반영합니다. 일회성 정비비도 결제한 날짜에 전액 반영합니다.</p><button class="secondary-btn" data-action="expense">지출 내역 확인</button>`;
  }
  function renderMeasurementStats(body,measured) {
    if(measured.reason==='multiple_devices'||measured.reason==='unknown_device'){body.innerHTML=`<h2>측정 출처 확인 필요</h2><p>${measured.reason==='multiple_devices'?'여러 기기의 측정은 자동 합산하지 않습니다.':'기기 출처가 없는 측정은 합산하지 않습니다.'}</p><p class="commercial-note">출처와 중복 검증 후 기기별 통계를 제공합니다. 매출 원장은 그대로 유지됩니다.</p>`;return;}
    body.innerHTML=`<h2>이 폰의 완료 처리 기록</h2>${measured.available?`<strong class="commercial-hero">${num(measured.householdsPerHour)}<small class="metric-unit">타/시간</small></strong><dl class="commercial-dl"><dt>완료 처리 가구</dt><dd>${num(measured.completedHouseholds)}가구</dd><dt>완료 처리 상품</dt><dd>${num(measured.completedItems)}개</dd><dt>활성시간 합계</dt><dd>${num(measured.activeSeconds)}초</dd><dt>표본</dt><dd>${measured.sampleCount}회</dd></dl>`:'<p>계산할 측정 기록 없음</p>'}<p class="commercial-note">완료 처리 횟수 합계 ÷ 활성시간 합계. 고유 주소 가구 수나 공유 쿠팡 누계가 아닙니다. 측정 누락 ${measured.missingMeasurements}회 · 구역 상세 근거 부족 ${measured.excludedAmbiguousRouteMeasurements}회는 제외했습니다. 정산 수정값으로 측정을 덮어쓰지 않습니다.</p>`;
  }

  async function refreshExpenses() { try{expenses=(await listExpenses()).map(e=>({...e,workId:e.workId||undefined,liters:e.fuelLiters==null||e.fuelLiters===''?undefined:Number(e.fuelLiters),kwh:e.chargeKwh==null||e.chargeKwh===''?undefined:Number(e.chargeKwh)}));if(view==='home')renderHome();if(view==='stats')renderStats();}catch(error){notify(`지출을 불러오지 못했습니다: ${error.message}`,'error');} }
  mountExpenses(expenseView.querySelector('#commercialExpenses'),{today,getWorks:()=>ledger.works().filter(w=>w.status==='confirmed'),onChange:refreshExpenses});
  app.addEventListener('change',event=>{const control=event.target.dataset.control;if(!control)return;if(control==='month')month=event.target.value;if(control==='period')periodKind=event.target.value;if(control==='route')statsRoute=event.target.value;if(control==='shift')statsShift=event.target.value;if(control==='weeks')weeks=Number(event.target.value);view==='stats'?renderStats():renderHome();});
  app.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.date){selected=button.dataset.date;renderHome();}
    if(button.dataset.report)renderReport(button.dataset.report);
    if(button.dataset.stats){statsTab=button.dataset.stats;renderStats();}
    if(button.dataset.mark){try{ledger.markDate(selected,button.dataset.mark);renderHome();}catch(error){notify(error.message,'error');}}
    const action=button.dataset.action;
    if(action==='new')newDraft(); if(action==='resume')resume(ledger.drafts()[0]);
    if(action==='measure'){openMeasurement(selected);view='measurement';}
    if(action==='expense')show('expenses');
    if(action==='today'){selected=today;month=today.slice(0,7);renderHome();}
    if(action==='prev'||action==='next'){const[y,m]=month.split('-').map(Number);month=iso(new Date(Date.UTC(y,m-1+(action==='next'?1:-1),1))).slice(0,7);renderHome();}
  });
  window.addEventListener('beforeunload',()=>{if(editor.open&&draft){readEditor();persistDraft();}});
  window.addEventListener('storage',event=>{if(event.key==='quickflex-public-preview-commercial-v1')notify('다른 창에서 기록이 변경되었습니다. 열려 있는 수정본은 저장 시 충돌을 확인합니다.','info');});
  new MutationObserver(()=>{const next=app.dataset.view;if(next===view)return;view=next;if(next==='home')renderHome();if(next==='stats')renderStats();}).observe(app,{attributes:true,attributeFilter:['data-view']});
  refreshExpenses();show('home');
  return {receive(detail){try{const result=nativeDraft(detail,ledger.works(),today);if(result.existing){renderReport(result.existing.id);}else{draft=result.draft;requestId=`native:${detail.workId}:${detail.revision}`;if(!persistDraft())return false;resume({...draft,requestId});}window.QuickFlexPreview?.postMessage?.(JSON.stringify({type:'resultReceived',workId:detail.workId,revision:detail.revision}));return true;}catch(error){notify(error.message,'error');return false;}},show,works:ledger.works};
}
