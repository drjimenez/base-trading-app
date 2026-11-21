// Laboratorio de estrategias (Agente 7) + gráficos de los reportes.
// Generado desde el dashboard del laboratorio: motor de backtest, referencias de cada estrategia,
// reportes estilo Edgeful y gráfico del último caso de cada reporte (Lightweight Charts de TradingView).
(function(){
"use strict";
// ===== Motor de backtest CISD + FVG (ICT) — compartido por el dashboard y las pruebas =====
const NYFMT = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'});
function nyParts(sec){ const p={}; for(const x of NYFMT.formatToParts(new Date(sec*1000))) p[x.type]=x.value; return {day:`${p.year}-${p.month}-${p.day}`, mod:(+p.hour)*60+(+p.minute)}; }

function makeBars(rows, factor){ // rows: [{t(sec),o,h,l,c}] ordenadas
  rows = rows.filter(r=>isFinite(r.t)&&isFinite(r.o)&&isFinite(r.h)&&isFinite(r.l)&&isFinite(r.c)).sort((a,b)=>a.t-b.t);
  const n=rows.length, B={t:new Float64Array(n),o:new Float64Array(n),h:new Float64Array(n),l:new Float64Array(n),c:new Float64Array(n),v:new Float64Array(n),mod:new Int16Array(n),day:new Array(n)};
  for(let i=0;i<n;i++){ const r=rows[i], p=nyParts(r.t); B.t[i]=r.t; B.o[i]=r.o*factor; B.h[i]=r.h*factor; B.l[i]=r.l*factor; B.c[i]=r.c*factor; B.v[i]=+r.v||0; B.mod[i]=p.mod; B.day[i]=p.day; }
  return B;
}

// Sesgo 1H: dirección del último CISD en velas de 1 hora ya cerradas
function computeBias(B,minRun){
  const n=B.o.length, out=new Int8Array(n); let bk=null, hb=null, dir=0, run=0, rd=0, lb=null, ls=null; const H=[];
  function fin(x){
    if(x.c<x.o && lb && x.c<lb.open){dir=-1; lb=null;}
    else if(x.c>x.o && ls && x.c>ls.open){dir=1; ls=null;}
    const d=x.c>x.o?1:x.c<x.o?-1:0;
    if(d===rd && d) run++; else {run=d?1:0; rd=d;}
    H.push(x);
    if(run>=minRun){ const r={open:H[H.length-run].o}; if(rd>0) lb=r; else ls=r; }
  }
  for(let i=0;i<n;i++){
    const key=B.day[i]+'|'+Math.floor(B.mod[i]/60);
    if(key!==bk){ if(hb) fin(hb); hb={o:B.o[i],h:B.h[i],l:B.l[i],c:B.c[i]}; bk=key; }
    else { if(B.h[i]>hb.h) hb.h=B.h[i]; if(B.l[i]<hb.l) hb.l=B.l[i]; hb.c=B.c[i]; }
    out[i]=dir;
  }
  return out;
}

function backtest(B,P){
  const {o,h,l,c,mod,day}=B, n=o.length;
  const bias=computeBias(B,P.minRun);
  const sigs=[], trades=[], days=[]; let cisdRaw=0;
  let curDay=null, dayStart=0, dst=null, run=0, runDir=0, lastBull=null, lastBear=null, setup=null, pos=null;
  const proj=(s,k)=>s.cisd + s.dir*k*s.range;

  function exitPos(i,px,why){
    const p=pos; p.exitIdx=i; p.exit=px; p.reason=why;
    p.R=(px-p.entry)*p.dir/p.riskPts;
    p.pnl=(px-p.entry)*p.dir*P.ptVal*p.qty - P.comm*p.qty;
    p.sig.stage = why==='Objetivo'?'Ganadora': why==='Stop'?'Perdedora':'Cerrada por horario';
    p.dayIdx=days.length-1; dst.pnl+=p.pnl; dst.pnls.push(p.pnl); trades.push(p); pos=null;
  }
  function manage(i,fillBar){
    const p=pos, d=p.dir, adv=d<0?h[i]:l[i], fav=d<0?l[i]:h[i];
    if((adv-p.stop)*d<=0){ exitPos(i,p.stop,'Stop'); return; }
    if((c[i]-p.far)*(-d)>0) p.broken=true;          // cierre a través del FVG = no respetado
    if(fillBar) return;                               // en la vela de entrada no se asume recorrido a favor
    const f=(fav-p.entry)*d; if(f>p.mfe) p.mfe=f;
    if((fav-p.proj2)*d>=0) p.reach2=true;
    if(f>=2*p.riskPts) p.reach2R=true;
    if((fav-p.tp)*d>=0){ exitPos(i,p.tp,'Objetivo'); return; }
    if(mod[i]>=P.flat) exitPos(i,c[i],'Horario');
  }
  function setFvg(s,j,z,i){
    const d=s.dir; s.fvg={top:z.top,bot:z.bot,j}; s.sig.fvg=s.fvg;
    const entry=d<0?z.bot:z.top, far=d<0?z.top:z.bot;
    let stop = P.stopMode==='swing' ? s.swing - d*P.stopBuf : far - d*P.stopBuf;
    if((entry-stop)*d < P.minStop) stop = entry - d*P.minStop;   // stop mínimo en puntos
    const riskPts=(entry-stop)*d;
    const tp = P.tgtMode==='R' ? entry + d*P.rMult*riskPts : proj(s,P.projK);
    const tpR=(tp-entry)*d/riskPts, qty=Math.min(P.maxQty, Math.floor(P.risk/(riskPts*P.ptVal)));
    Object.assign(s,{entry,far,stop,riskPts,tp,tpR,qty,proj2:proj(s,2),readyIdx:Math.max(j,i),state:'ready'});
    Object.assign(s.sig,{entry,stop,tp,tpR,qty,riskPts});
    if(!(riskPts>0)){ s.sig.stage='FVG inválido'; return null; }
    if(qty<1){ s.sig.stage='Stop excede el riesgo'; return null; }
    if(tpR<P.minR){ s.sig.stage='Objetivo < R mínimo'; return null; }
    s.sig.stage='Esperando retest'; return s;
  }
  function onCisd(i,d,r){
    cisdRaw++;
    if(mod[i]<P.sigStart || mod[i]>P.entryEnd) return;
    if(dst.n>=P.maxTrades || dst.pnl<=-P.dayLoss || dst.pnl>=P.dayLock) return;
    if(pos) return;
    let swing=d<0?-Infinity:Infinity, swingIdx=r.start;
    for(let k=r.start;k<=i;k++){ if(d<0? h[k]>swing : l[k]<swing){ swing=d<0?h[k]:l[k]; swingIdx=k; } }
    if(P.reqSweep){
      const a=Math.max(dayStart, r.start-P.sweepLook); if(a>r.start-1) return;
      let prior=d<0?-Infinity:Infinity; for(let k=a;k<r.start;k++) prior=d<0?Math.max(prior,h[k]):Math.min(prior,l[k]);
      if(d<0? swing<=prior : swing>=prior) return;
    }
    const range=Math.abs(swing-r.open); if(range<P.minRange) return;
    if(setup){ if(setup.dir===d) return; setup.sig.stage='Cancelada por CISD contrario'; setup=null; }
    const sig={idx:i,t:B.t[i],day:day[i],dir:d,swing,swingIdx,cisd:r.open,range,stage:'',fvg:null,trade:null,bias:bias[i]};
    sigs.push(sig);
    if(P.useBias && bias[i]!==d){ sig.stage='Contra sesgo 1H'; return; }
    const s={dir:d,sig,cisdIdx:i,swing,swingIdx,cisd:r.open,range,state:'fvg'};
    for(let j=i;j>=swingIdx+2;j--){
      const g=d<0? l[j-2]-h[j] : l[j]-h[j-2];
      if(g>=P.minFvg){ setup=setFvg(s,j,d<0?{top:l[j-2],bot:h[j]}:{top:l[j],bot:h[j-2]},i); return; }
    }
    sig.stage='Buscando FVG'; setup=s;
  }

  for(let i=0;i<n;i++){
    if(day[i]!==curDay){
      if(pos) exitPos(i-1,c[i-1],'Horario');
      if(setup){ setup.sig.stage = setup.state==='fvg'?'Sin FVG':'Expiró sin retest'; setup=null; }
      curDay=day[i]; dayStart=i; dst={key:curDay,pnl:0,n:0,pnls:[]}; days.push(dst);
      run=0; runDir=0; lastBull=lastBear=null;
    }
    if(pos) manage(i,false);
    else if(setup){
      const s=setup, d=s.dir;
      if(s.state==='fvg'){
        if(i-s.cisdIdx>P.fvgLook){ s.sig.stage='Sin FVG'; setup=null; }
        else if(i-2>=s.swingIdx){ const g=d<0? l[i-2]-h[i] : l[i]-h[i-2];
          if(g>=P.minFvg) setup=setFvg(s,i,d<0?{top:l[i-2],bot:h[i]}:{top:l[i],bot:h[i-2]},i); }
      } else if(i>s.readyIdx){
        if(mod[i]>P.entryEnd || i-s.readyIdx>P.retestMax){ s.sig.stage='Expiró sin retest'; setup=null; }
        else if(d<0? h[i]>=s.entry : l[i]<=s.entry){
          pos={dir:d,entry:s.entry,stop:s.stop,tp:s.tp,far:s.far,riskPts:s.riskPts,qty:s.qty,proj2:s.proj2,tpR:s.tpR,
               entryIdx:i,sig:s.sig,mfe:0,reach2:false,reach2R:false,broken:false,fvg:s.fvg,cisd:s.cisd,range:s.range,swing:s.swing,swingIdx:s.swingIdx,cisdIdx:s.cisdIdx};
          s.sig.trade=pos; s.sig.stage='Abierta'; setup=null; dst.n++; manage(i,true);
        } else if(((d<0?l[i]:h[i])-s.tp)*d>=0){ s.sig.stage='Se fue sin retest'; setup=null; }
      }
    }
    if(c[i]<o[i] && lastBull && c[i]<lastBull.open && i-lastBull.end<=P.maxGap){ const r=lastBull; lastBull=null; onCisd(i,-1,r); }
    else if(c[i]>o[i] && lastBear && c[i]>lastBear.open && i-lastBear.end<=P.maxGap){ const r=lastBear; lastBear=null; onCisd(i,1,r); }
    const db=c[i]>o[i]?1:c[i]<o[i]?-1:0;
    if(db===runDir && db) run++; else { run=db?1:0; runDir=db; }
    if(run>=P.minRun){ const st=i-run+1, r={start:st,end:i,open:o[st]}; if(runDir>0) lastBull=r; else lastBear=r; }
  }
  if(pos) exitPos(n-1,c[n-1],'Horario');
  if(setup){ setup.sig.stage='Fin de datos'; }

  for(const s of sigs){
    s.c1=true; s.c2=!!(s.fvg && s.trade && !s.trade.broken); s.c3=!!s.trade; s.c4=!!(s.trade && s.trade.reach2);
  }
  return {sigs,trades,days,cisdRaw,stats:stats(trades,sigs,days,cisdRaw)};
}

function stats(T,S,D,cisdRaw){
  const w=T.filter(t=>t.pnl>0), lo=T.filter(t=>t.pnl<=0);
  const gw=w.reduce((a,t)=>a+t.pnl,0), gl=-lo.reduce((a,t)=>a+t.pnl,0);
  let eq=0,pk=0,dd=0; for(const t of T){ eq+=t.pnl; pk=Math.max(pk,eq); dd=Math.max(dd,pk-eq); }
  return {n:T.length, win:T.length?w.length/T.length:0, net:gw-gl, R:T.reduce((a,t)=>a+t.R,0),
    avgR:T.length?T.reduce((a,t)=>a+t.R,0)/T.length:0, pf:gl>0?gw/gl:(gw>0?Infinity:0), dd,
    funnel:{raw:cisdRaw, c1:S.length, fvg:S.filter(s=>s.fvg).length, c3:S.filter(s=>s.c3).length, c2:S.filter(s=>s.c2).length, c4:S.filter(s=>s.c4).length, win:w.length},
    days:D.length, daysTraded:D.filter(d=>d.n>0).length};
}

// ===== Simulación de la cuenta Lucid =====
function attempt(D,s,maxD,P){
  let bal=P.acct, hw=P.acct, mll=P.acct-P.mll; const dps=[];
  for(let d=s; d<D.length && d-s<maxD; d++){
    let dp=0;
    for(const x of D[d].pnls){ bal+=x; dp+=x;
      if(bal<=mll) return {status:'fail',days:d-s+1,endDay:d,bal};
      if(bal>=P.acct+P.target){ dps.push(dp); const tot=bal-P.acct, mx=Math.max(...dps); return {status:'pass',days:d-s+1,endDay:d,bal,cons:mx<=P.cons*tot}; }
    }
    dps.push(dp); hw=Math.max(hw,bal); mll=Math.max(mll, Math.min(hw-P.mll, P.acct+100));
  }
  const used=Math.min(maxD, D.length-s); return {status:'open',days:used,endDay:s+used-1,bal};
}
function lucid(D,P){
  const W={pass:0,passCons:0,fail:0,open:0,n:0,list:[]};
  for(let s=0;s+P.days<=D.length;s++){ const r=attempt(D,s,P.days,P); W.n++; W[r.status]++; if(r.status==='pass'&&r.cons) W.passCons++; r.start=D[s].key; W.list.push(r); }
  const seq=[]; let s=0;
  while(s<D.length){ const r=attempt(D,s,Infinity,P); r.start=D[s].key; r.end=D[r.endDay].key; seq.push(r); if(r.status==='open') break; s=r.endDay+1; }
  return {W,seq};
}


// ===== Aprendizaje: rasgos de cada operación y hallazgos estables =====
const DIAS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const hhmm = m => String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');

// Contexto por día: apertura regular, cierre/máx./mín. del día previo (horario regular), rango de apertura 15 min
function contextoDias(B){
  const n=B.o.length, D=new Map(); let prev=null;
  for(let i=0;i<n;i++){
    const k=B.day[i]; let d=D.get(k);
    if(!d){ d={key:k, open:null, hi:-Infinity, lo:Infinity, close:null, orH:-Infinity, orL:Infinity, prev}; D.set(k,d); prev=d; }
    const m=B.mod[i];
    if(m>=570 && m<960){
      if(d.open===null) d.open=B.o[i];
      d.hi=Math.max(d.hi,B.h[i]); d.lo=Math.min(d.lo,B.l[i]); d.close=B.c[i];
      if(m<585){ d.orH=Math.max(d.orH,B.h[i]); d.orL=Math.min(d.orL,B.l[i]); }
    }
  }
  return D;
}
function atrSerie(B,len=14){
  const n=B.o.length, a=new Float64Array(n); let s=0; const q=[];
  for(let i=0;i<n;i++){
    const tr = i? Math.max(B.h[i]-B.l[i], Math.abs(B.h[i]-B.c[i-1]), Math.abs(B.l[i]-B.c[i-1])) : B.h[i]-B.l[i];
    q.push(tr); s+=tr; if(q.length>len) s-=q.shift(); a[i]=s/q.length;
  }
  return a;
}

// Rasgos comunes a cualquier operación (también a las importadas de TradingView)
function rasgosBase(B,ctx,bias,i,dir,price){
  const d=ctx.get(B.day[i]), r={};
  const m=B.mod[i]; r.hora = hhmm(Math.floor(m/30)*30)+'–'+hhmm(Math.floor(m/30)*30+30);
  r.dia = DIAS[new Date(B.day[i]+'T12:00:00Z').getUTCDay()];
  r.lado = dir>0?'Compra':'Venta';
  r.sesgo_1h = bias[i]===0?'Sin sesgo': bias[i]===dir?'A favor':'En contra';
  if(d && d.open!==null && d.prev && d.prev.close!==null){
    const g=(d.open/d.prev.close-1)*100;
    r.gap = Math.abs(g)<0.15?'Sin gap (<0.15%)': (g>0)===(dir>0)?'Gap a favor':'Gap en contra';
  }
  if(d && d.open!==null) r.dia_en_curso = (price-d.open)*dir>0?'El día ya va a favor':'El día va en contra';
  if(d && isFinite(d.orH) && m>=585){
    const pos = price>d.orH?'Sobre el rango 15 min': price<d.orL?'Bajo el rango 15 min':'Dentro del rango 15 min';
    r.rango_apertura = pos;
  }
  return r;
}

// Rasgos de una operación del motor CISD+FVG
function rasgosCisd(B,ctx,bias,atr,t){
  const r=rasgosBase(B,ctx,bias,t.cisdIdx,t.dir,t.entry);
  const d=ctx.get(B.day[t.cisdIdx]);
  if(d && d.prev && isFinite(d.prev.hi)){
    r.liquidez = t.dir<0 ? (t.swing>d.prev.hi?'Barre el máx. del día previo': isFinite(d.orH)&&t.swing>d.orH&&B.mod[t.swingIdx]>=585?'Barre el máx. del rango 15 min':'Barre un máx. local')
                         : (t.swing<d.prev.lo?'Barre el mín. del día previo': isFinite(d.orL)&&t.swing<d.orL&&B.mod[t.swingIdx]>=585?'Barre el mín. del rango 15 min':'Barre un mín. local');
  }
  const a=atr[t.cisdIdx]||1;
  r['#rango_cisd_atr']=t.range/a;
  r['#fvg_atr']=t.fvg?(t.fvg.top-t.fvg.bot)/a:0;
  r['#stop_pts']=t.riskPts;
  r['#velas_hasta_retest']=t.fvg? t.entryIdx-t.fvg.j : 0;
  return r;
}

const NOMBRES={hora:'Hora de entrada (NY)',dia:'Día de la semana',lado:'Dirección',sesgo_1h:'Sesgo de 1 hora',gap:'Gap de apertura',
  dia_en_curso:'Dirección del día al entrar',rango_apertura:'Posición vs. rango de 15 min',liquidez:'Liquidez barrida',
  rango_cisd_atr:'Tamaño del rango CISD (en ATR)',fvg_atr:'Tamaño del FVG (en ATR)',stop_pts:'Distancia del stop (pts)',velas_hasta_retest:'Velas hasta el retest'};

// ops: [{dia, r, win, rasgos}]  → hallazgos
function hallazgos(ops, opts={}){
  const minHalf=opts.minHalf??5, minDif=opts.minDif??0.1, minVal=opts.minVal??20, unidad=opts.unidad??'R';
  if(ops.length<8) return [];
  const sorted=[...ops].sort((a,b)=>a.dia<b.dia?-1:a.dia>b.dia?1:0);
  const corte=sorted[Math.floor(sorted.length/2)].dia;
  const half=o=>o.dia<corte?1:2;
  const avg=a=>a.length?a.reduce((s,o)=>s+o.r,0)/a.length:0;
  const base=avg(ops), baseW=ops.filter(o=>o.win).length/ops.length;
  const b1=avg(ops.filter(o=>half(o)===1)), b2=avg(ops.filter(o=>half(o)===2));
  // valores por rasgo (numéricos → terciles)
  const keys=new Set(); ops.forEach(o=>Object.keys(o.rasgos||{}).forEach(k=>keys.add(k)));
  const out=[];
  for(const k of keys){
    const num=k.startsWith('#'), name=num?k.slice(1):k;
    let label;
    if(num){
      const vals=ops.map(o=>o.rasgos[k]).filter(v=>isFinite(v)).sort((a,b)=>a-b);
      if(vals.length<9) continue;
      const q1=vals[Math.floor(vals.length/3)], q2=vals[Math.floor(2*vals.length/3)];
      if(q1===q2) continue;
      const f=v=>v<1?v.toFixed(2):v<10?v.toFixed(1):v.toFixed(0);
      label=o=>{ const v=o.rasgos[k]; if(!isFinite(v)) return null; return v<q1?`Bajo (< ${f(q1)})`: v<q2?`Medio (${f(q1)}–${f(q2)})`:`Alto (≥ ${f(q2)})`; };
    } else label=o=>o.rasgos[k]??null;
    const grupos=new Map();
    for(const o of ops){ const v=label(o); if(v==null) continue; if(!grupos.has(v)) grupos.set(v,[]); grupos.get(v).push(o); }
    if(grupos.size<2) continue;
    for(const [v,g] of grupos){
      const g1=g.filter(o=>half(o)===1), g2=g.filter(o=>half(o)===2);
      const rp=avg(g), dif=rp-base, d1=g1.length?avg(g1)-b1:null, d2=g2.length?avg(g2)-b2:null;
      const estable = g1.length>=minHalf && g2.length>=minHalf && d1!==null && d2!==null && Math.sign(d1)===Math.sign(d2) && Math.abs(d1)>=minDif && Math.abs(d2)>=minDif;
      const estado = estable && g.length>=minVal ? 'validado' : estable ? 'observacion' : 'sin_ventaja';
      const efecto = !estable ? 'neutro' : dif>0 ? 'favorable' : 'desfavorable';
      const acierto=g.filter(o=>o.win).length/g.length;
      const fx=x=>(x>=0?'+':'')+x.toFixed(2)+' '+unidad;
      const texto = (efecto==='favorable'?'Favorece: ':efecto==='desfavorable'?'Evitar: ':'')+`${NOMBRES[name]||name} = ${v}: ${fx(rp)} por operación vs ${fx(base)} en general, ${Math.round(acierto*100)} % de acierto (n=${g.length}).`
        + (estable?` Se repite en las dos mitades del periodo (${fx(d1)} y ${fx(d2)} frente a la media).`:'');
      out.push({rasgo:NOMBRES[name]||name, valor:v, n:g.length, acierto, r_prom:rp, r_total:g.reduce((s,o)=>s+o.r,0),
        base_acierto:baseW, base_r:base, dif_r:dif, n_m1:g1.length, n_m2:g2.length, dif_m1:d1, dif_m2:d2, estable, estado, efecto, texto});
    }
  }
  return out.sort((a,b)=>(b.estable-a.estable) || Math.abs(b.dif_r)*Math.sqrt(b.n) - Math.abs(a.dif_r)*Math.sqrt(a.n));
}

// ===== Núcleo del laboratorio: corrida base, grilla, walk-forward y hallazgos =====
const GRILLA_TG=[['proj',1,'Proyección −1'],['proj',1.5,'Proyección −1.5'],['proj',2,'Proyección −2'],['proj',2.5,'Proyección −2.5'],['proj',4,'Proyección −4'],['R',2,'2 R'],['R',3,'3 R']];

function resumenLucid(L){
  const W=L.W, p=L.seq.filter(r=>r.status==='pass');
  return {ventanas:W.n, pasa:W.pass, quema:W.fail, abiertas:W.open, pasa_consistente:W.passCons,
    pct_pasa:W.n?W.pass/W.n:0, pct_quema:W.n?W.fail/W.n:0,
    intentos:L.seq.length, aprobadas:p.length, quemadas:L.seq.filter(r=>r.status==='fail').length,
    dias_prom_aprobar:p.length?p.reduce((a,r)=>a+r.days,0)/p.length:null};
}
function metricas(T){
  const w=T.filter(t=>t.pnl>0), gw=w.reduce((a,t)=>a+t.pnl,0), gl=-T.filter(t=>t.pnl<=0).reduce((a,t)=>a+t.pnl,0);
  let eq=0,pk=0,dd=0; for(const t of T){ eq+=t.pnl; pk=Math.max(pk,eq); dd=Math.max(dd,pk-eq); }
  return {n:T.length, acierto:T.length?w.length/T.length:0, pnl:gw-gl, r_total:T.reduce((a,t)=>a+t.R,0),
    r_prom:T.length?T.reduce((a,t)=>a+t.R,0)/T.length:0, factor:gl>0?gw/gl:null, max_dd:dd};
}
function etiquetaConfig(P){
  return `Stop ${P.stopMode==='fvg'?'FVG':'swing'} · ${P.tgtMode==='proj'?'Proyección −'+P.projK:P.rMult+' R'}${P.useBias?' · sesgo 1H':''}`;
}

function analizarActivo(B, P){
  const bias=computeBias(B,P.minRun), atr=atrSerie(B), ctx=contextoDias(B);
  const res=backtest(B,P), L=lucid(res.days,P);
  const ops=res.trades.map((t,k)=>({k, dia:t.sig.day, r:t.R, win:t.pnl>0, rasgos:rasgosCisd(B,ctx,bias,atr,t)}));
  const hall=hallazgos(ops,{unidad:'R'});

  // grilla y walk-forward (elige con el 70 % inicial de los días, comprueba en el 30 % final)
  const dias=res.days.map(d=>d.key), corte=dias[Math.floor(dias.length*0.7)] ?? dias[dias.length-1];
  const grid=[];
  for(const sm of ['fvg','swing']) for(const [tm,v,lab] of GRILLA_TG) for(const ub of [false,true]){
    const Q={...P,stopMode:sm,tgtMode:tm,useBias:ub}; if(tm==='proj') Q.projK=v; else Q.rMult=v;
    const r=backtest(B,Q), l=lucid(r.days,Q);
    const ins=r.trades.filter(t=>t.sig.day<corte), oos=r.trades.filter(t=>t.sig.day>=corte);
    grid.push({P:Q, etiqueta:etiquetaConfig(Q), metricas:metricas(r.trades), lucid:resumenLucid(l), is:metricas(ins), oos:metricas(oos), embudo:r.stats.funnel});
  }
  const cand=grid.filter(g=>g.is.n>=8).sort((a,b)=>b.is.r_total-a.is.r_total);
  const mejor=cand[0]||null;
  let rec=null;
  if(mejor){
    const ok = mejor.oos.n>=5 && mejor.oos.r_total>0;
    const actual=grid.find(g=>g.P.stopMode===P.stopMode&&g.P.tgtMode===P.tgtMode&&g.P.useBias===P.useBias&&(P.tgtMode==='proj'?g.P.projK===P.projK:g.P.rMult===P.rMult));
    rec={P:mejor.P, etiqueta:mejor.etiqueta, is:mejor.is, oos:mejor.oos, lucid:mejor.lucid, aprobada:ok, corte,
      texto: (ok?'Recomendada: ':'Sin recomendación firme: ')+`${mejor.etiqueta} fue la mejor antes del ${corte} (${mejor.is.r_total.toFixed(1)} R en ${mejor.is.n} operaciones)`
        +` y después del corte dio ${mejor.oos.r_total>=0?'+':''}${mejor.oos.r_total.toFixed(1)} R en ${mejor.oos.n} operaciones`
        +(ok?'.':(mejor.oos.n<5?', muestra fuera de muestra insuficiente.':', no se sostuvo fuera de muestra.'))
        +(actual?` Configuración actual (${actual.etiqueta}): ${actual.metricas.r_total.toFixed(1)} R en ${actual.metricas.n}.`:'')};
  }
  return {res, L, ops, hall, grid, rec};
}

// Operaciones importadas de TradingView: R aproximado = P&L / pérdida media
function analizarImportadas(B, filas){
  const perd=filas.filter(f=>f.pnl<0), unidad=perd.length? -perd.reduce((a,f)=>a+f.pnl,0)/perd.length : 1;
  let bias=null, ctx=null;
  if(B && B.o.length){ bias=computeBias(B,2); ctx=contextoDias(B); }
  const ops=filas.map(f=>{
    let rasgos;
    if(B && B.o.length){
      // vela de entrada: la última vela con ts <= entrada
      let lo=0, hi=B.t.length-1, i=-1; while(lo<=hi){ const m=(lo+hi)>>1; if(B.t[m]<=f.entrada_ts){ i=m; lo=m+1; } else hi=m-1; }
      rasgos = i>=0 && f.entrada_ts-B.t[i] < 3600 ? rasgosBase(B,ctx,bias,i,f.lado,f.entrada) : null;
    }
    if(!rasgos){ const p=nyParts(f.entrada_ts), m=p.mod; rasgos={hora:hhmm(Math.floor(m/30)*30)+'–'+hhmm(Math.floor(m/30)*30+30), dia:DIAS[new Date(p.day+'T12:00:00Z').getUTCDay()], lado:f.lado>0?'Compra':'Venta'}; }
    return {dia:nyParts(f.entrada_ts).day, r:(f.pnl??0)/unidad, win:(f.pnl??0)>0, rasgos, f};
  });
  return {ops, unidad, hall:hallazgos(ops,{unidad:'R*'})};
}

// ===== Varias estrategias × temporalidades: remuestreo, indicadores, ejecutor común y comparativa =====
function tfBase(B){ const d=[]; for(let i=1;i<Math.min(B.t.length,2000);i++){ const x=B.t[i]-B.t[i-1]; if(x>0) d.push(x); } d.sort((a,b)=>a-b); return Math.max(1,Math.round((d[Math.floor(d.length/2)]||300)/60)); }
function soloRTH(B){ let f=0; for(let i=0;i<B.mod.length;i++) if(B.mod[i]<570||B.mod[i]>=960) f++; return f < B.mod.length*0.01; }
function alinear(tf,rth){ if(tf>=1440) return 0; if(rth && tf>=60) return 570%tf; if(tf===240) return 120; return 0; } // 4H de futuros: 18:00, 22:00, 02:00…

function resample(B, tf, off){
  const n=B.o.length, R={t:[],o:[],h:[],l:[],c:[],v:[],mod:[],day:[]}; let key=null, k=-1;
  for(let i=0;i<n;i++){
    const b=tf>=1440?0:Math.floor((B.mod[i]-off)/tf), kk=B.day[i]+'|'+b;
    if(kk!==key){ key=kk; k++; R.t.push(B.t[i]); R.o.push(B.o[i]); R.h.push(B.h[i]); R.l.push(B.l[i]); R.c.push(B.c[i]); R.v.push(B.v?B.v[i]:0); R.mod.push(tf>=1440?0:b*tf+off); R.day.push(B.day[i]); }
    else { if(B.h[i]>R.h[k]) R.h[k]=B.h[i]; if(B.l[i]<R.l[k]) R.l[k]=B.l[i]; R.c[k]=B.c[i]; R.v[k]+=B.v?B.v[i]:0; }
  }
  return {t:Float64Array.from(R.t),o:Float64Array.from(R.o),h:Float64Array.from(R.h),l:Float64Array.from(R.l),c:Float64Array.from(R.c),
          v:Float64Array.from(R.v),mod:Int16Array.from(R.mod),day:R.day,tf};
}
// índice de la vela mayor (HTF) de cada vela menor
function mapaHTF(B,tf,off){ const m=new Int32Array(B.o.length); let key=null,k=-1;
  for(let i=0;i<B.o.length;i++){ const b=tf>=1440?0:Math.floor((B.mod[i]-off)/tf), kk=B.day[i]+'|'+b; if(kk!==key){key=kk;k++;} m[i]=k; } return m; }

function ema(a,n){ const k=2/(n+1), out=new Float64Array(a.length); let e=a[0]; for(let i=0;i<a.length;i++){ e=i?a[i]*k+e*(1-k):a[0]; out[i]=e; } return out; }
function rsi(c,n=14){ const out=new Float64Array(c.length).fill(50); let g=0,l=0;
  for(let i=1;i<c.length;i++){ const d=c[i]-c[i-1], up=Math.max(d,0), dn=Math.max(-d,0);
    if(i<=n){ g+=up/n; l+=dn/n; } else { g=(g*(n-1)+up)/n; l=(l*(n-1)+dn)/n; }
    out[i]= i<n?50 : l===0?100 : 100-100/(1+g/l); } return out; }
function vwapDia(B){ const n=B.o.length, out=new Float64Array(n); let d=null, pv=0, vv=0, sp=0, k=0;
  for(let i=0;i<n;i++){ if(B.day[i]!==d){ d=B.day[i]; pv=0; vv=0; sp=0; k=0; }
    const tp=(B.h[i]+B.l[i]+B.c[i])/3, v=B.v?B.v[i]:0; pv+=tp*v; vv+=v; sp+=tp; k++; out[i]= vv>0? pv/vv : sp/k; } return out; }

// Ejecutor común: setups = [{i, dir, tipo:'mercado'|'limite', entry, stop, tp, validez}] evaluados al cierre de la vela i
function ejecutar(B,P,setups){
  const {o,h,l,c,mod,day}=B, n=o.length, trades=[], days=[]; let dst=null, cur=null, pos=null, pend=null, si=0;
  setups.sort((a,b)=>a.i-b.i);
  const salir=(i,px,why)=>{ const p=pos; p.exitIdx=i; p.exit=px; p.reason=why; p.R=(px-p.entry)*p.dir/p.riskPts;
    p.pnl=(px-p.entry)*p.dir*P.ptVal*p.qty-P.comm*p.qty; dst.pnl+=p.pnl; dst.pnls.push(p.pnl); trades.push(p); pos=null; };
  const abrir=(s,i,px)=>{ let stop=s.stop; if((px-stop)*s.dir<P.minStop) stop=px-s.dir*P.minStop;
    const riskPts=(px-stop)*s.dir; if(!(riskPts>0)) return false;
    const tp = s.tpR ? px+s.dir*s.tpR*riskPts : s.tp;
    if(!((tp-px)*s.dir/riskPts>=P.minR)) return false;
    const qty=Math.min(P.maxQty,Math.floor(P.risk/(riskPts*P.ptVal))); if(qty<1) return false;
    pos={dir:s.dir,entry:px,stop,tp,riskPts,qty,entryIdx:i,day:day[i],mfe:0,meta:s.meta||null}; dst.n++;
    const adv=s.dir<0?h[i]:l[i]; if((adv-stop)*s.dir<=0) salir(i,stop,'Stop');   // la misma vela toca el stop
    return true; };
  for(let i=0;i<n;i++){
    if(day[i]!==cur){ if(pos) salir(i-1,c[i-1],'Horario'); pend=null; cur=day[i]; dst={key:cur,pnl:0,n:0,pnls:[]}; days.push(dst); }
    if(pos && pos.entryIdx<i){ const d=pos.dir, adv=d<0?h[i]:l[i], fav=d<0?l[i]:h[i];
      if((adv-pos.stop)*d<=0) salir(i,pos.stop,'Stop');
      else { const f=(fav-pos.entry)*d; if(f>pos.mfe) pos.mfe=f;
        if((fav-pos.tp)*d>=0) salir(i,pos.tp,'Objetivo'); else if(mod[i]>=P.flat) salir(i,c[i],'Horario'); } }
    if(!pos && pend){
      if(i>pend.hasta || mod[i]>P.entryEnd) pend=null;
      else if(pend.tipo==='mercado'){ abrir(pend,i,o[i]); pend=null; }
      else { const toca=pend.dir>0? l[i]<=pend.entry : h[i]>=pend.entry;
        if(toca){ abrir(pend,i,pend.dir>0?Math.min(o[i],pend.entry):Math.max(o[i],pend.entry)); pend=null; }
        else if(!pend.tpR && ((pend.dir>0?h[i]:l[i])-pend.tp)*pend.dir>=0) pend=null; } }
    while(si<setups.length && setups[si].i<i) si++;
    while(si<setups.length && setups[si].i===i){ const s=setups[si++];
      if(pos||pend) continue; if(mod[i]<P.sigStart||mod[i]>P.entryEnd) continue;
      if(dst.n>=P.maxTrades||dst.pnl<=-P.dayLoss||dst.pnl>=P.dayLock) continue;
      pend={...s, hasta: s.tipo==='mercado'? i+1 : i+(s.validez||12)}; }
  }
  if(pos) salir(n-1,c[n-1],'Horario');
  return {trades,days};
}

// --- ORB (Londres / Nueva York): rango de apertura, ruptura por cierre, entrada en el retest o al cierre, objetivo Fibonacci del rango
function estORB(B,P,V){
  const out=[], tf=B.tf; if(tf>V.orLen) return out;
  let d=null, orH=-Infinity, orL=Infinity, listo=false, hecho=false;
  for(let i=0;i<B.o.length;i++){
    if(B.day[i]!==d){ d=B.day[i]; orH=-Infinity; orL=Infinity; listo=false; hecho=false; }
    const m=B.mod[i];
    if(m>=V.orStart && m<V.orStart+V.orLen){ orH=Math.max(orH,B.h[i]); orL=Math.min(orL,B.l[i]); listo=true; continue; }
    if(!listo||hecho||m<V.orStart+V.orLen||m>P.entryEnd) continue;
    const dir=B.c[i]>orH?1:B.c[i]<orL?-1:0; if(!dir) continue; hecho=true;
    const rng=orH-orL; if(!(rng>0)) continue;
    const nivel=dir>0?orH:orL, base=dir>0?orL:orH;
    const stop=(V.stop==='opuesto'?base:(orH+orL)/2)-dir*P.stopBuf;
    const s={i,dir,tipo:V.entrada==='retest'?'limite':'mercado',entry:nivel,stop,validez:Math.max(1,Math.round(60/tf)),meta:{or_rango:rng}};
    if(V.obj==='2R') s.tpR=2; else s.tp=base+dir*V.obj*rng;
    out.push(s);
  }
  return out;
}
// --- TT Fractal: la vela mayor C2 barre el extremo de C1 y cierra dentro; en C3 se espera un CISD en la vela menor
function estFractal(B,P,V){
  const out=[], rth=soloRTH(B), htf=V.htf, off=alinear(htf,rth), H=resample(B,htf,off), mp=mapaHTF(B,htf,off);
  const ini=new Int32Array(H.o.length).fill(-1), fin=new Int32Array(H.o.length).fill(-1);
  for(let i=0;i<B.o.length;i++){ if(ini[mp[i]]<0) ini[mp[i]]=i; fin[mp[i]]=i; }
  for(let k=1;k+1<H.o.length;k++){
    if(H.day[k]!==H.day[k-1] && htf<1440) continue;     // C1 y C2 del mismo día de calendario
    const bear=H.h[k]>H.h[k-1] && H.c[k]<H.h[k-1], bull=H.l[k]<H.l[k-1] && H.c[k]>H.l[k-1];
    if(bear===bull) continue; const dir=bear?-1:1;
    // CISD en la vela menor durante C3 (series contrarias desde el inicio de C2)
    let run=0, rd=0, serie=null;
    for(let i=ini[k]; i<=fin[k+1] && i>=0; i++){
      if(mp[i]===k+1 && serie && (dir<0? B.c[i]<serie.open : B.c[i]>serie.open) && (dir<0? B.c[i]<B.o[i] : B.c[i]>B.o[i])){
        const stop=(dir<0?H.h[k]:H.l[k])-dir*P.stopBuf;
        const tp=V.obj==='C1'?(dir<0?H.l[k-1]:H.h[k-1]):(dir<0?H.l[k]:H.h[k]);
        out.push(V.entrada==='retest'? {i,dir,tipo:'limite',entry:serie.open,stop,tp,validez:6,meta:{c2:k}} : {i,dir,tipo:'mercado',stop,tp,meta:{c2:k}});
        break;
      }
      const db=B.c[i]>B.o[i]?1:B.c[i]<B.o[i]?-1:0;
      if(db===rd&&db) run++; else { run=db?1:0; rd=db; }
      if(run>=2 && rd===-dir) serie={open:B.o[i-run+1]};   // serie en contra de la dirección esperada
    }
  }
  return out;
}
// --- Cruce de EMAs con filtro de tendencia EMA 200
function estEMA(B,P,V){
  const out=[], c=B.c, ef=ema(c,V.rapida), es=ema(c,V.lenta), e200=ema(c,200), atr=atrSerie(B);
  for(let i=Math.max(200,V.lenta+1);i<c.length;i++){
    const up=ef[i-1]<=es[i-1]&&ef[i]>es[i], dn=ef[i-1]>=es[i-1]&&ef[i]<es[i]; if(!up&&!dn) continue;
    const dir=up?1:-1; if(V.filtro && (c[i]-e200[i])*dir<=0) continue;
    let ext=dir>0?Infinity:-Infinity; for(let k=Math.max(0,i-5);k<=i;k++) ext=dir>0?Math.min(ext,B.l[k]):Math.max(ext,B.h[k]);
    const stop=V.stop==='atr'? c[i]-dir*1.5*atr[i] : ext-dir*P.stopBuf;
    out.push({i,dir,tipo:'mercado',stop,tpR:V.obj});
  }
  return out;
}
// --- Combinación de indicadores: VWAP + EMA 20/50 + RSI 14 (retroceso en tendencia)
function estCombo(B,P,V){
  const out=[], c=B.c, vw=vwapDia(B), e20=ema(c,20), e50=ema(c,50), r=rsi(c,14), atr=atrSerie(B);
  for(let i=51;i<c.length;i++){
    let dir=0;
    if(c[i]>vw[i] && e20[i]>e50[i] && r[i-1]<V.bajo && r[i]>=V.bajo) dir=1;
    else if(c[i]<vw[i] && e20[i]<e50[i] && r[i-1]>V.alto && r[i]<=V.alto) dir=-1;
    if(!dir) continue;
    out.push({i,dir,tipo:'mercado',stop:c[i]-dir*1.5*atr[i],tpR:V.obj});
  }
  return out;
}
// --- CISD + FVG dentro de la comparativa (usa su propio motor)
function estCisd(B,P,V){
  const tf=B.tf, Q={...P,...V,retestMax:Math.max(3,Math.round(60/tf)),sweepLook:Math.max(6,Math.round(120/tf))};
  const r=backtest(B,Q);
  return {trades:r.trades.map(t=>({dir:t.dir,entry:t.entry,stop:t.stop,tp:t.tp,riskPts:t.riskPts,qty:t.qty,entryIdx:t.entryIdx,exitIdx:t.exitIdx,
    exit:t.exit,reason:t.reason,R:t.R,pnl:t.pnl,mfe:t.mfe,day:t.sig.day})), days:r.days};
}

const CATALOGO={
  orb_ny:{nombre:'ORB Nueva York (15 min)', tfs:[1,5,15], gen:estORB,
    variantes:()=>{ const v=[]; for(const entrada of ['retest','cierre']) for(const stop of ['opuesto','medio']) for(const obj of [1.618,2,'2R'])
      v.push({V:{orStart:570,orLen:15,entrada,stop,obj},et:`${entrada==='retest'?'Retest':'Cierre'} · stop ${stop==='opuesto'?'lado opuesto':'mitad'} · ${obj==='2R'?'2 R':'Fibo '+obj}`}); return v; }},
  orb_londres:{nombre:'ORB Londres (15 min)', tfs:[1,5,15], gen:estORB,
    variantes:()=>{ const v=[]; for(const entrada of ['retest','cierre']) for(const stop of ['opuesto','medio']) for(const obj of [1.618,2,'2R'])
      v.push({V:{orStart:180,orLen:15,entrada,stop,obj},et:`${entrada==='retest'?'Retest':'Cierre'} · stop ${stop==='opuesto'?'lado opuesto':'mitad'} · ${obj==='2R'?'2 R':'Fibo '+obj}`}); return v; }},
  tt_fractal:{nombre:'TT Fractal (C2 + CISD)', tfs:[1,5,15,60], gen:estFractal,
    variantes:(tf)=>{ const htf=tf<=1?15:tf<=5?60:tf<=15?240:1440, v=[];
      for(const entrada of ['cisd','retest']) for(const obj of ['C1','C2']) v.push({V:{htf,entrada,obj},et:`Vela mayor ${htf>=1440?'diaria':htf>=60?htf/60+' h':htf+' min'} · entrada ${entrada==='cisd'?'al CISD':'retest del CISD'} · objetivo ${obj}`}); return v; }},
  ema_cruce:{nombre:'Cruce de EMAs', tfs:[1,5,15,60], gen:estEMA,
    variantes:()=>{ const v=[]; for(const [a,b] of [[9,21],[20,50]]) for(const filtro of [true,false]) for(const stop of ['swing','atr'])
      v.push({V:{rapida:a,lenta:b,filtro,stop,obj:2},et:`EMA ${a}/${b}${filtro?' + EMA 200':''} · stop ${stop==='atr'?'1.5 ATR':'swing'} · 2 R`}); return v; }},
  combo_vwap_rsi:{nombre:'VWAP + EMA 20/50 + RSI', tfs:[1,5,15,60], gen:estCombo,
    variantes:()=>{ const v=[]; for(const [bajo,alto] of [[40,60],[30,70]]) for(const obj of [1.5,2]) v.push({V:{bajo,alto,obj},et:`RSI ${bajo}/${alto} · ${obj} R`}); return v; }},
  cisd_fvg:{nombre:'CISD + FVG (ICT)', tfs:[1,5,15,60], gen:null,
    variantes:()=>[['fvg','proj',2],['swing','proj',2],['fvg','R',2],['swing','R',2]].map(([sm,tm,k])=>({V:{stopMode:sm,tgtMode:tm,projK:2,rMult:k},et:`Stop ${sm==='fvg'?'FVG':'swing'} · ${tm==='proj'?'proyección −2':'2 R'}`}))},
};

function compararEstrategia(Bb,P,codigo){
  const def=CATALOGO[codigo]; if(!def) throw new Error('estrategia desconocida: '+codigo);
  const tb=tfBase(Bb), rth=soloRTH(Bb); Bb.tf=tb;
  const tfs=[...new Set([tb,5,15,60].filter(t=>t>=tb && t<=60 && def.tfs.includes(t)))];
  const filas=[];
  for(const tf of tfs){
    const B=tf===tb?Bb:resample(Bb,tf,alinear(tf,rth));
    let mejor=null; const todas=[];
    for(const {V,et} of def.variantes(tf)){
      const r = codigo==='cisd_fvg'? estCisd(B,P,V) : ejecutar(B,P,def.gen(B,P,V));
      const dias=r.days.map(d=>d.key); if(!dias.length) continue;
      const corte=dias[Math.floor(dias.length*0.7)]??dias[dias.length-1];
      const T=r.trades, ins=T.filter(t=>t.day<corte), oos=T.filter(t=>t.day>=corte), L=lucid(r.days,P);
      const x={tf,V,et,trades:T,B,corte,metricas:metricas(T),is:metricas(ins),oos:metricas(oos),lucid:resumenLucid(L)};
      todas.push(x);
      const k=v=>v.is.n>=5? v.is.r_total : -1e9+v.metricas.r_total;
      if(!mejor || k(x)>k(mejor)) mejor=x;
    }
    if(mejor) filas.push({...mejor, variantes:todas.map(t=>({variante:t.et,n:t.metricas.n,r_total:t.metricas.r_total,oos_r:t.oos.r_total,pasa:t.lucid.pct_pasa}))});
  }
  return {nombre:def.nombre, filas, rth};
}

// Rasgos y hallazgos de la mejor variante de una fila de la comparativa
function aprenderFila(f){
  const B=f.B, bias=computeBias(B,2), ctx=contextoDias(B);
  const ops=f.trades.map(t=>({dia:t.day, r:t.R, win:t.pnl>0, rasgos:rasgosBase(B,ctx,bias,t.entryIdx,t.dir,t.entry)}));
  return {ops, hall:hallazgos(ops,{unidad:'R'})};
}

// ===== Ejemplos gráficos: referencias de cada estrategia sobre una operación real =====
const EXPLICA={
  orb_ny:'Rango de apertura de Nueva York (9:30–9:45): líneas azules = máximo y mínimo del rango; gris = mitad del rango (stop en la variante "mitad"); verde punteado = extensiones Fibonacci 1.618 y 2.0 medidas desde el lado opuesto del rango. La entrada llega tras el primer cierre fuera del rango.',
  orb_londres:'Rango de apertura de Londres (3:00–3:15 hora de NY): líneas azules = máximo y mínimo del rango; gris = mitad; verde punteado = Fibonacci 1.618 y 2.0. La entrada llega tras el primer cierre fuera del rango.',
  tt_fractal:'TT Fractal: naranja = máximo y mínimo de la vela mayor C1; morado = máximo y mínimo de C2. C2 barre un extremo de C1 y cierra de vuelta dentro de su rango; durante C3 se espera el cambio de dirección (CISD) en la temporalidad menor. Stop en el extremo de C2; objetivo en el extremo opuesto de C1 o C2.',
  ema_cruce:'Cruce de EMAs: azul = EMA rápida, naranja = EMA lenta, gris = EMA 200 (filtro de tendencia, si la variante lo usa). Se entra a la apertura siguiente al cruce.',
  combo_vwap_rsi:'Combinación de indicadores: morado = VWAP del día, azul = EMA 20, naranja = EMA 50. Compra cuando el precio está sobre el VWAP, la EMA 20 sobre la EMA 50 y el RSI 14 vuelve a subir del nivel bajo (al revés para ventas). El RSI de la vela de señal aparece en el texto.',
  cisd_fvg:'CISD + FVG: ámbar = borde superior e inferior del FVG que dejó el desplazamiento tras la barrida y el cambio de dirección. La entrada es el retest del borde del FVG; morado punteado = proyecciones −1 y −2 del rango CISD cuando se pueden reconstruir.',
};
// devuelve {B, T, lineas:[{t0,t1,p,color,estilo,titulo}], series:[{color,datos,titulo}], marcas:[{t,pos,color,forma,texto}], nota}
function referencias(sel, op, B0){
  const tf=+sel.temporalidad, rth=soloRTH(B0); B0.tf=tfBase(B0);
  const B = tf===B0.tf? B0 : resample(B0, tf, alinear(tf,rth));
  const reloj=t=>{ const p=nyParts(t); const [y,m,d]=p.day.split('-').map(Number); return Date.UTC(y,m-1,d,Math.floor(p.mod/60),p.mod%60)/1000; };
  const T=Array.from(B.t, reloj);
  const idx=x=>{ let lo=0,hi=B.t.length-1,r=0; while(lo<=hi){ const m=(lo+hi)>>1; if(B.t[m]<=x){ r=m; lo=m+1; } else hi=m-1; } return r; };
  const iE=idx(+op.te), iX=Math.max(iE, idx(+op.tx)), dir=+op.lado, P=typeof sel.params==='string'?JSON.parse(sel.params):(sel.params||{});
  const tX=T[iX]+(iX===iE?tf*60:0), lineas=[], series=[], marcas=[]; let nota='';
  const seg=(t0,p,color,titulo,estilo=2)=>lineas.push({t0,t1:tX,p,color,titulo,estilo});
  const e=sel.estrategia;
  if(e==='orb_ny'||e==='orb_londres'){
    const ini=P.orStart??(e==='orb_ny'?570:180), len=P.orLen??15, dia=B0.day[idx2(B0,+op.te)];
    let h=-Infinity,l=Infinity,t0=null;
    for(let i=0;i<B0.o.length;i++) if(B0.day[i]===dia && B0.mod[i]>=ini && B0.mod[i]<ini+len){ h=Math.max(h,B0.h[i]); l=Math.min(l,B0.l[i]); if(t0===null) t0=reloj(B0.t[i]); }
    if(isFinite(h)){
      const rng=h-l, base=dir>0?l:h;
      seg(t0,h,'#2a78d6','Máx. rango',0); seg(t0,l,'#2a78d6','Mín. rango',0); seg(t0,(h+l)/2,'#8a887f','Mitad',1);
      seg(t0,base+dir*1.618*rng,'#1baf7a','Fibo 1.618',1); seg(t0,base+dir*2*rng,'#1baf7a','Fibo 2.0',1);
      for(let i=0;i<=iE;i++) if(B.day[i]===dia && B.mod[i]>=ini+len && (B.c[i]>h||B.c[i]<l)){ marcas.push({t:T[i],pos:B.c[i]>h?'aboveBar':'belowBar',color:'#2a78d6',forma:'circle',texto:'Ruptura'}); break; }
      nota=`Rango de ${len} min: ${rng.toFixed(2)} pts.`;
    }
  } else if(e==='tt_fractal'){
    const htf=P.htf??60, off=alinear(htf,rth), H=resample(B0,htf,off);
    let k3=0; for(let k=0;k<H.t.length;k++) if(H.t[k]<=+op.te) k3=k;
    const c2=k3-1, c1=k3-2;
    if(c1>=0){
      seg(reloj(H.t[c1]),H.h[c1],'#eb6834','C1 máx.',0); seg(reloj(H.t[c1]),H.l[c1],'#eb6834','C1 mín.',0);
      seg(reloj(H.t[c2]),H.h[c2],'#6250d6','C2 máx.',0); seg(reloj(H.t[c2]),H.l[c2],'#6250d6','C2 mín.',0);
      for(const [k,txt] of [[c1,'C1'],[c2,'C2'],[k3,'C3']]){ const i=idx(H.t[k]); marcas.push({t:T[i],pos:'aboveBar',color:'#6250d6',forma:'square',texto:txt}); }
      nota=`Vela mayor de ${htf>=1440?'1 día':htf>=60?htf/60+' h':htf+' min'}.`;
    }
  } else if(e==='ema_cruce'){
    const a=P.rapida??9, b=P.lenta??21, ea=ema(B.c,a), eb=ema(B.c,b);
    series.push({color:'#2a78d6',titulo:'EMA '+a,datos:ea},{color:'#eb6834',titulo:'EMA '+b,datos:eb});
    if(P.filtro) series.push({color:'#8a887f',titulo:'EMA 200',datos:ema(B.c,200)});
    marcas.push({t:T[Math.max(0,iE-1)],pos:dir>0?'belowBar':'aboveBar',color:'#2a78d6',forma:'circle',texto:'Cruce'});
  } else if(e==='combo_vwap_rsi'){
    series.push({color:'#6250d6',titulo:'VWAP',datos:vwapDia(B)},{color:'#2a78d6',titulo:'EMA 20',datos:ema(B.c,20)},{color:'#eb6834',titulo:'EMA 50',datos:ema(B.c,50)});
    const r=rsi(B.c,14); nota=`RSI 14 en la vela de señal: ${r[Math.max(0,iE-1)].toFixed(1)} (niveles ${P.bajo??40}/${P.alto??60}).`;
  } else if(e==='cisd_fvg'){
    const tol=Math.abs(+op.entrada)*1e-6+1e-6;
    for(let j=iE-1;j>=Math.max(2,iE-60);j--){
      const top=dir<0?B.l[j-2]:B.l[j], bot=dir<0?B.h[j]:B.h[j-2];
      if(top>bot && Math.abs((dir<0?bot:top)-(+op.entrada))<tol){
        seg(T[j-2],top,'#eda100','FVG sup.',0); seg(T[j-2],bot,'#eda100','FVG inf.',0);
        marcas.push({t:T[j-1],pos:dir<0?'aboveBar':'belowBar',color:'#eda100',forma:'square',texto:'FVG'});
        let ext=dir<0?-Infinity:Infinity, ie=j; for(let k=Math.max(0,j-15);k<=j;k++){ if(dir<0?B.h[k]>ext:B.l[k]<ext){ ext=dir<0?B.h[k]:B.l[k]; ie=k; } }
        marcas.push({t:T[ie],pos:dir<0?'aboveBar':'belowBar',color:'#8a887f',forma:dir<0?'arrowDown':'arrowUp',texto:'Barrida'});
        nota=`FVG de ${(top-bot).toFixed(2)} pts.`; break;
      }
    }
  }
  seg(T[iE],+op.entrada,'#2a78d6','Entrada',0); seg(T[iE],+op.stop,'#c93a3a','Stop',0); seg(T[iE],+op.objetivo,'#0f8a4f','Objetivo',0);
  marcas.push({t:T[iE],pos:dir>0?'belowBar':'aboveBar',color:'#2a78d6',forma:dir>0?'arrowUp':'arrowDown',texto:dir>0?'Compra':'Venta'});
  marcas.push({t:T[iX],pos:dir>0?'aboveBar':'belowBar',color:+op.r>0?'#0f8a4f':'#c93a3a',forma:'circle',texto:`${op.motivo} ${(+op.r>=0?'+':'')+(+op.r).toFixed(2)} R`});
  marcas.sort((a,b)=>a.t-b.t);
  return {B,T,iE,iX,lineas,series,marcas,nota};
}
function idx2(B,x){ let lo=0,hi=B.t.length-1,r=0; while(lo<=hi){ const m=(lo+hi)>>1; if(B.t[m]<=x){ r=m; lo=m+1; } else hi=m-1; } return r; }

// ===== Reportes estilo Edgeful: titular, viñetas, gráfico de barras oscuro y conclusión =====
const EF_COL=['#3374f0','#c9c9c9','#1baf7a','#eda100'];
const efEsc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function efBarras(o){ // {titulo, subtitulo, categorias, series:[{nombre, valores}], fmt, ref:{valor,etiqueta}, fuente}
  const W=1200,H=660,ml=96,mr=150,mt=150,mb=110, n=o.categorias.length, k=o.series.length;
  const vals=o.series.flatMap(s=>s.valores).filter(v=>v!=null&&isFinite(v)); if(o.ref) vals.push(o.ref.valor);
  let mn=Math.min(0,...vals), mx=Math.max(0,...vals); if(mx===mn) mx=mn+1;
  const paso=niceStep((mx-mn)/6); mn=Math.floor(mn/paso)*paso; mx=Math.ceil(mx*1.12/paso)*paso;
  const Y=v=>mt+(mx-v)*(H-mt-mb)/(mx-mn), grupo=(W-ml-mr)/n, bw=Math.min(68,grupo*0.8/k), gap=Math.min(10,bw*0.15);
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${efEsc(o.titulo)}" style="display:block;width:100%;height:auto">
  <rect width="${W}" height="${H}" fill="#0b0b0f"/>
  <text x="${ml}" y="62" fill="#fff" font-size="27" font-weight="600">${efEsc(o.titulo)}</text>
  <text x="${ml}" y="96" fill="#9a9aa3" font-size="15">${efEsc(o.subtitulo)}</text>`;
  o.series.forEach((se,j)=>{ const x=W-mr-140+j*110; s+=`<rect x="${x}" y="48" width="14" height="14" fill="${EF_COL[j]}"/><text x="${x+22}" y="60" fill="#d6d6dc" font-size="15">${efEsc(se.nombre)}</text>`; });
  for(let v=mn; v<=mx+1e-9; v+=paso){ s+=`<line x1="${ml}" x2="${W-mr}" y1="${Y(v)}" y2="${Y(v)}" stroke="#1d1d24"/><text x="${ml-14}" y="${Y(v)+5}" fill="#8b8b94" font-size="13" text-anchor="end">${efEsc(o.fmtEje?o.fmtEje(v):o.fmt(v))}</text>`; }
  s+=`<line x1="${ml}" x2="${W-mr}" y1="${Y(0)}" y2="${Y(0)}" stroke="#3a3a44"/>`;
  o.categorias.forEach((c,i)=>{
    const cx=ml+grupo*(i+0.5), x0=cx-(k*bw+(k-1)*gap)/2;
    o.series.forEach((se,j)=>{ const v=se.valores[i]; if(v==null||!isFinite(v)) return;
      const x=x0+j*(bw+gap), y=Math.min(Y(v),Y(0)), h=Math.max(1,Math.abs(Y(v)-Y(0)));
      s+=`<rect x="${x}" y="${y}" width="${bw}" height="${h}" fill="${EF_COL[j]}"><title>${efEsc(se.nombre+' · '+c+': '+o.fmt(v))}</title></rect>`;
      s+=`<text x="${x+bw/2}" y="${v>=0?Y(v)-10:Y(v)+22}" fill="#fff" stroke="#0b0b0f" stroke-width="5" paint-order="stroke" font-size="15" font-weight="600" text-anchor="middle">${efEsc(o.fmt(v))}</text>`; });
    const lines=String(c).split('\n'); lines.forEach((ln,q)=>{ s+=`<text x="${cx}" y="${H-mb+34+q*19}" fill="#d6d6dc" font-size="15" text-anchor="middle">${efEsc(ln)}</text>`; });
  });
  if(o.ref){ s+=`<line x1="${ml}" x2="${W-mr+10}" y1="${Y(o.ref.valor)}" y2="${Y(o.ref.valor)}" stroke="#e8e8ee" stroke-dasharray="8 6" stroke-width="1.4"/>
    <text x="${W-mr+18}" y="${Y(o.ref.valor)+5}" fill="#e8e8ee" font-size="15">${efEsc(o.ref.etiqueta)}</text>`; }
  s+=`<text x="${ml}" y="${H-24}" fill="#7c7c86" font-size="13">${efEsc(o.fuente)}</text></svg>`;
  return s;
}
function efTarjeta(r){ // {titular, intro, vinetas:[], grafico:{...}, cierre}
  return `<article class="ef"><h3>${efEsc(r.titular)}</h3><p>${efEsc(r.intro)}</p>
    ${r.vinetas&&r.vinetas.length?'<ul>'+r.vinetas.map(v=>`<li>${efEsc(v)}</li>`).join('')+'</ul>':''}
    <div class="ef-panel">${efBarras(r.grafico)}</div><p>${efEsc(r.cierre)}</p></article>`;
}
const pl=(n,a,b)=>`${n} ${+n===1?a:b}`;
const efR=v=>(v>=0?'+':'')+v.toFixed(1)+' R', efP=v=>Math.round(v)+'%';
const efCorto={orb_ny:'ORB\nNueva York',orb_londres:'ORB\nLondres',tt_fractal:'TT Fractal',ema_cruce:'Cruce\nde EMAs',combo_vwap_rsi:'VWAP + EMA\n+ RSI',cisd_fvg:'CISD + FVG'};

// filas: lab_clasificacion de cada activo con su referencia (ref = SPY/QQQ) · embudo: base CISD · horas: operaciones del #1 de cada referencia
function construirReportes(filas, embudo, horas){
  const nomRef=r=>r==='SPY'?'ES':r==='QQQ'?'NQ':r;
  // un conjunto de datos por referencia (prioridad TradingView)
  const porRef=new Map(); for(const f of filas){ const a=porRef.get(f.ref); if(!a || (f.fuente==='tradingview' && a.fuente!=='tradingview')) porRef.set(f.ref,{fuente:f.fuente,simbolo:f.simbolo}); }
  const refs=[...porRef.keys()].sort((a,b)=>(a==='SPY'?0:a==='QQQ'?1:2)-(b==='SPY'?0:b==='QQQ'?1:2)).slice(0,2);
  const F=filas.filter(f=>porRef.get(f.ref)?.simbolo===f.simbolo);
  horas=horas.filter(h=>porRef.get(h.ref)?.simbolo===h.simbolo); embudo=embudo.filter(h=>porRef.get(h.ref)?.simbolo===h.simbolo);
  const datos=r=>{ const d=porRef.get(r); return d.fuente==='tradingview'? d.simbolo : `${d.simbolo}×${r==='SPY'?10:41}`; };
  const series=refs.map(r=>({ref:r,nombre:nomRef(r)}));
  const desde=F.reduce((a,f)=>!a||f.desde<a?f.desde:a,null), hasta=F.reduce((a,f)=>!a||f.hasta>a?f.hasta:a,null);
  const periodo=`${desde} a ${hasta}`, fuenteTxt=`fuente: laboratorio de estrategias (Agente 7) · datos ${refs.map(datos).join(' y ')}`;
  const top=r=>F.filter(f=>f.ref===r).sort((a,b)=>a.puesto-b.puesto)[0];
  const out=[];

  // 1 · ¿Qué estrategia funciona mejor?
  const estrategias=['orb_ny','orb_londres','tt_fractal','ema_cruce','combo_vwap_rsi','cisd_fvg'];
  const mejorDe=(r,e)=>F.filter(f=>f.ref===r&&f.estrategia===e&&+f.n>0).sort((a,b)=>a.puesto-b.puesto)[0];
  const t0=top(refs[0]);
  const rec0=t0 && t0.estado==='Recomendable';
  out.push({
    titular: rec0? `${t0.nombre} en ${t0.temporalidad} min es la estrategia más sólida en ${nomRef(refs[0])}` : 'Ninguna estrategia muestra ventaja clara todavía',
    intro: `Seis estrategias en 5, 15 y 60 min, ${periodo}. Cada barra es la mejor temporalidad de cada estrategia; la variante se eligió con el 70 % inicial del periodo:`,
    vinetas: refs.map(r=>{ const t=top(r); return t? `${nomRef(r)}: ${t.nombre} ${t.temporalidad} min — ${efR(+t.r_total)} en ${pl(t.n,'operación','operaciones')}, ${Math.round(t.acierto*100)}% de acierto; en el 30 % final ${efR(+t.oos_r)} en ${t.oos_n} (${t.estado.toLowerCase()}).` : `${nomRef(r)}: sin datos.`; }),
    grafico:{titulo:'R total por estrategia', subtitulo:`Mejor temporalidad de cada una · riesgo de $200 por operación · ${periodo}`,
      categorias:estrategias.map(e=>efCorto[e]), series:series.map(s=>({nombre:s.nombre, valores:estrategias.map(e=>{ const m=mejorDe(s.ref,e); return m? +m.r_total : null; })})),
      fmt:efR, fmtEje:v=>v.toFixed(0)+' R', ref:{valor:0,etiqueta:'sin ganancia'}, fuente:fuenteTxt},
    cierre: rec0? `${t0.nombre} ganó también en el tramo final que no se usó para elegirla (${efR(+t0.oos_r)} en ${pl(t0.oos_n,'operación','operaciones')}). Las barras altas sin ese respaldo pueden ser casualidad.` :
      'Las barras altas todavía no se sostienen en el tramo final del periodo; hace falta más historia para separar ventaja de casualidad.'});

  // 2 · ¿En qué temporalidad?
  if(t0){
    const e=t0.estrategia, tfs=[...new Set(F.filter(f=>f.estrategia===e).map(f=>+f.temporalidad))].sort((a,b)=>a-b);
    const fila=(r,tf)=>F.find(f=>f.ref===r&&f.estrategia===e&&+f.temporalidad===tf);
    const mejorTf=tfs.slice().sort((a,b)=>(+(fila(refs[0],b)?.r_total??-1e9))-(+(fila(refs[0],a)?.r_total??-1e9)))[0];
    out.push({
      titular:`${t0.nombre}: ${mejorTf} min es la temporalidad que mejor funciona`,
      intro:`Misma estrategia en cada temporalidad, ${periodo}:`,
      vinetas: refs.flatMap(r=>tfs.map(tf=>{ const x=fila(r,tf); return x&&+x.n>0? `${nomRef(r)} ${tf} min: ${efR(+x.r_total)} en ${pl(x.n,'operación','operaciones')}, ${Math.round(x.acierto*100)}% de acierto` : `${nomRef(r)} ${tf} min: sin operaciones`; })),
      grafico:{titulo:`${t0.nombre} por temporalidad`, subtitulo:`R total con la mejor variante de cada temporalidad · ${periodo}`,
        categorias:tfs.map(tf=>tf+' min'), series:series.map(s=>({nombre:s.nombre, valores:tfs.map(tf=>{ const x=fila(s.ref,tf); return x&&+x.n>0? +x.r_total : null; })})),
        fmt:efR, fmtEje:v=>v.toFixed(0)+' R', ref:{valor:0,etiqueta:'sin ganancia'}, fuente:fuenteTxt},
      cierre:`Las temporalidades más altas dan menos operaciones: con pocas, un par de aciertos o fallos cambian mucho el resultado.`});
  }

  // 3 · ¿A qué hora?
  if(t0) horas=horas.filter(h=>h.estrategia===t0.estrategia && +h.temporalidad===+t0.temporalidad);
  if(horas.length){
    const hs=[...new Set(horas.map(h=>h.hora))].sort();
    const v=(r,h)=>{ const x=horas.find(q=>q.ref===r&&q.hora===h); return x&&+x.n>=1? 100*x.ganadoras/x.n : null; };
    const tot=r=>{ const xs=horas.filter(q=>q.ref===r); const n=xs.reduce((a,q)=>a+ +q.n,0); return n? 100*xs.reduce((a,q)=>a+ +q.ganadoras,0)/n : null; };
    const g0=tot(refs[0]); const mejorH=hs.slice().sort((a,b)=>(v(refs[0],b)??-1)-(v(refs[0],a)??-1))[0];
    out.push({
      titular:`${t0.nombre} ${t0.temporalidad} min: la mejor media hora para entrar es ${mejorH} (hora de NY)`,
      intro:`Acierto por media hora de entrada de ${t0.nombre} en ${t0.temporalidad} min, misma estrategia en los dos activos, ${periodo}:`,
      vinetas: refs.map(r=>{ const xs=horas.filter(q=>q.ref===r).sort((a,b)=>b.ganadoras/b.n-a.ganadoras/a.n); const b=xs[0]; return b? `${nomRef(r)}: mejor ${b.hora} con ${Math.round(100*b.ganadoras/b.n)}% (${pl(b.n,'operación','operaciones')}); promedio ${Math.round(tot(r))}%` : `${nomRef(r)}: sin datos`; }),
      grafico:{titulo:'Acierto por hora de entrada', subtitulo:`${t0.nombre} ${t0.temporalidad} min · hora de Nueva York · ${periodo}`,
        categorias:hs, series:series.map(s=>({nombre:s.nombre, valores:hs.map(h=>v(s.ref,h))})), fmt:efP, ref:g0!=null?{valor:g0,etiqueta:'promedio'}:null, fuente:fuenteTxt},
      cierre:`Las horas con pocas operaciones pueden verse muy bien o muy mal por azar; fíjate en las que tienen más casos.`});
  }

  // 4 · Los 4 criterios de CISD + FVG
  if(embudo.length){
    const pasos=[['c1','1 · CISD\ncon barrida'],['fvg','2 · Forma\nun FVG'],['c3','3 · Entrada\nen el retest'],['c2','2 · FVG\nrespetado'],['c4','4 · Llega a\nproyección −2'],['win','Ganadoras']];
    const e0=r=>{ const x=embudo.find(q=>q.ref===r); return x? (typeof x.embudo==='string'?JSON.parse(x.embudo):x.embudo) : null; };
    out.push({
      titular:`CISD + FVG: ${(()=>{ const e=e0(refs[0]); return e&&e.c1? Math.round(100*e.c4/e.c1)+'% de las señales llegan a la proyección −2 en '+nomRef(refs[0]) : 'sin señales todavía'; })()}`,
      intro:'Cuántas señales con barrida y cambio de dirección cumplen cada uno de los 4 criterios (100% = todas las señales del criterio 1):',
      vinetas: refs.map(r=>{ const e=e0(r); return e? `${nomRef(r)}: ${e.c1} señales → ${e.fvg} con FVG → ${e.c3} entradas → ${e.c4} ${+e.c4===1?'llega':'llegan'} a −2 → ${pl(e.win,'ganadora','ganadoras')}` : `${nomRef(r)}: sin datos`; }),
      grafico:{titulo:'Los 4 criterios de CISD + FVG', subtitulo:`% de las señales del criterio 1 · ${periodo}`, categorias:pasos.map(p=>p[1]),
        series:series.map(s=>({nombre:s.nombre, valores:pasos.map(([k])=>{ const e=e0(s.ref); return e&&e.c1? 100*e[k]/e.c1 : null; })})), fmt:efP, ref:{valor:50,etiqueta:'50%'}, fuente:fuenteTxt},
      cierre:'El mayor filtro está entre la señal y la entrada: muchas veces el precio no vuelve al FVG dentro del tiempo permitido.'});
  }
  return out;
}

// ===== Gráfico del último caso de cada reporte de la app, con sus niveles de referencia =====
function niceStep(x){ const p=Math.pow(10,Math.floor(Math.log10(x||1))); const m=x/p; return (m<1.5?1:m<3?2:m<7?5:10)*p; }
const relojNY=t=>{ const p=nyParts(t); const [y,m,d]=p.day.split('-').map(Number); return Date.UTC(y,m-1,d,Math.floor(p.mod/60),p.mod%60)/1000; };
const hm=m=>String(Math.floor(((m%1440)+1440)%1440/60)).padStart(2,'0')+':'+String(((m%60)+60)%60).padStart(2,'0');
let DEC=2; const f2=v=>(+v).toFixed(DEC);

const REP_INTRADIA={orb_5:5,orb_15:15,orb_30:30,or_falla_15:15,or_falla_20:20,vela_apertura_15:15,vela_apertura_30:30};
const REP_IB=['balance_inicial','ib_fibonacci','ib_horas_rango','ib_ruptura','ib_rechazo','ib_retroceso','vela_apertura'];
const REP_DIARIO=['gap_fill','rango_previo','dia_interior','apertura_fuera','alto_bajo_semana','rango_diario','envolventes','apertura_semanal'];
function soportaCaso(rep){ return rep in REP_INTRADIA || REP_IB.includes(rep) || REP_DIARIO.includes(rep) ||
  ['rango_previo_sesion','gap_sesion','pivotes','power_hour','medianoche','sesiones'].includes(rep); }

function casoReporte(rep, d){
  if(REP_DIARIO.includes(rep)) return casoDiario(rep,d);
  const rows=(d.velas||[]).map(v=>({t:+v[0],o:+v[1],h:+v[2],l:+v[3],c:+v[4]}));
  const B=makeBars(rows,1); if(B.o.length<5) return null; DEC=B.c[0]<20?5:2;
  const T=Array.from(B.t,relojNY), fecha=d.fecha, prev=d.previo, s=+d.sesion.apertura, ci=+d.sesion.cierre, ibm=+d.sesion.ib;
  const lineas=[], marcas=[]; let texto='';
  const idxDia=B.day.map((x,i)=>x===fecha?i:-1).filter(i=>i>=0); if(!idxDia.length) return null;
  const fin=T[idxDia[idxDia.length-1]];
  const rango=(dia,a,b)=>{ let h=-Infinity,l=Infinity,i0=-1,i1=-1; for(let i=0;i<B.o.length;i++) if(B.day[i]===dia && B.mod[i]>=a && B.mod[i]<b){ if(i0<0) i0=i; i1=i; h=Math.max(h,B.h[i]); l=Math.min(l,B.l[i]); } return i0<0?null:{h,l,i0,i1,o:B.o[i0],c:B.c[i1]}; };
  const seg=(i0,p,color,titulo,estilo=0)=>lineas.push({t0:T[i0],t1:fin,p,color,titulo,estilo});
  const primeraSalida=(R,desde,cierre=true)=>{ for(let i=0;i<B.o.length;i++){ if(B.day[i]!==fecha||B.mod[i]<desde) continue;
      const v=cierre?B.c[i]:null; if(cierre? (v>R.h||v<R.l) : (B.h[i]>R.h||B.l[i]<R.l)) return {i,dir:(cierre?v>R.h:B.h[i]>R.h)?1:-1}; } return null; };
  const AZ='#60a5fa', GR='#8a9bb8', VE='#22c55e', RO='#ef4444', NA='#f59e0b', MO='#a78bfa';
  let desde=s-60;

  if(rep in REP_INTRADIA){
    const N=REP_INTRADIA[rep], R=rango(fecha,s,s+N); if(!R) return null;
    seg(R.i0,R.h,AZ,`Máx. ${N} min`); seg(R.i0,R.l,AZ,`Mín. ${N} min`);
    if(rep.startsWith('vela_apertura')){ seg(R.i0,R.o,GR,'Apertura',2); marcas.push({t:T[R.i0],pos:'aboveBar',color:R.c>=R.o?VE:RO,forma:'square',texto:`Vela ${N} min ${R.c>=R.o?'verde':'roja'}`});
      texto=`Vela de los primeros ${N} min (${hm(s)}–${hm(s+N)}): abre ${f2(R.o)}, cierra ${f2(R.c)} (${R.c>=R.o?'verde':'roja'}). El reporte mide si el día cierra del mismo color.`; }
    else if(rep.startsWith('or_falla')){
      const sal=primeraSalida(R,s+N,false);
      if(sal){ marcas.push({t:T[sal.i],pos:sal.dir>0?'aboveBar':'belowBar',color:NA,forma:'circle',texto:'Sale del rango'});
        for(let i=sal.i+1;i<B.o.length;i++) if(B.day[i]===fecha && B.c[i]<=R.h && B.c[i]>=R.l){ marcas.push({t:T[i],pos:sal.dir>0?'belowBar':'aboveBar',color:MO,forma:'circle',texto:'Cierra dentro'}); break; } }
      texto=`Rango de ${hm(s)} a ${hm(s+N)}: máx. ${f2(R.h)}, mín. ${f2(R.l)}. Falsa ruptura = una vela sale del rango y luego otra cierra de vuelta dentro.`; }
    else { const r=primeraSalida(R,s+N); if(r){ marcas.push({t:T[r.i],pos:r.dir>0?'aboveBar':'belowBar',color:r.dir>0?VE:RO,forma:r.dir>0?'arrowUp':'arrowDown',texto:`Ruptura ${r.dir>0?'arriba':'abajo'}`});
        const k=1, rng=R.h-R.l; seg(R.i0,r.dir>0?R.h+rng:R.l-rng,VE,'Extensión 1×',1); }
      texto=`Rango de apertura de ${N} min (${hm(s)}–${hm(s+N)}): máx. ${f2(R.h)}, mín. ${f2(R.l)}, rango ${f2(R.h-R.l)}. La ruptura es el primer cierre fuera del rango.`; }
  } else if(REP_IB.includes(rep)){
    const R=rango(fecha,s,s+ibm); if(!R) return null; const rng=R.h-R.l;
    seg(R.i0,R.h,AZ,'IB máx.'); seg(R.i0,R.l,AZ,'IB mín.');
    if(rep==='vela_apertura'){ seg(R.i0,R.o,GR,'Apertura',2); texto=`Primera hora (${hm(s)}–${hm(s+ibm)}): ${R.c>=R.o?'verde':'roja'}, de ${f2(R.o)} a ${f2(R.c)}. El reporte mide si el día continúa en la misma dirección.`; }
    else {
      const sal=primeraSalida(R,s+ibm,false);
      const lados = sal? [sal.dir] : [1,-1];
      for(const dir of lados){ const borde=dir>0?R.h:R.l;
        for(const [k,col] of [[0.382,'#94a3b8'],[0.618,'#94a3b8'],[1,VE],[1.618,VE]]) seg(R.i0,borde+dir*k*rng,col,`${dir>0?'+':'−'}${(k*100).toFixed(1)} %`,1);
        if(rep==='ib_retroceso') seg(R.i0,borde-dir*0.382*rng,'#94a3b8',`38.2 % dentro`,1); }
      if(sal) marcas.push({t:T[sal.i],pos:sal.dir>0?'aboveBar':'belowBar',color:sal.dir>0?VE:RO,forma:sal.dir>0?'arrowUp':'arrowDown',texto:`Rompe ${sal.dir>0?'arriba':'abajo'} · ${hm(B.mod[sal.i])}`});
      if(rep==='ib_rechazo'){ let im=R.i0,il=R.i0; for(let i=R.i0;i<=R.i1;i++){ if(B.h[i]>=R.h) im=i; if(B.l[i]<=R.l) il=i; }
        let a=-1,b=-1; for(let i=R.i0;i<=R.i1;i++){ if(a<0&&B.h[i]===R.h) a=i; if(b<0&&B.l[i]===R.l) b=i; }
        if(a>=0) marcas.push({t:T[a],pos:'aboveBar',color:NA,forma:'circle',texto:'Máximo del IB'}); if(b>=0) marcas.push({t:T[b],pos:'belowBar',color:NA,forma:'circle',texto:'Mínimo del IB'}); }
      texto=`Balance inicial = primera hora (${hm(s)}–${hm(s+ibm)}): máx. ${f2(R.h)}, mín. ${f2(R.l)}, rango ${f2(rng)}. Las líneas punteadas son extensiones Fibonacci medidas desde el borde roto (+38.2 %, +61.8 %, +100 %, +161.8 % del rango).`; }
  } else if(rep==='rango_previo_sesion' || rep==='pivotes' || rep==='gap_sesion'){
    const P=rango(prev,s,ci), H=rango(fecha,s,ci); if(!P||!H) return null; desde=s-120;
    if(rep==='rango_previo_sesion'){ lineas.push({t0:T[P.i0],t1:fin,p:P.h,color:AZ,titulo:'Máx. sesión previa',estilo:0},{t0:T[P.i0],t1:fin,p:P.l,color:AZ,titulo:'Mín. sesión previa',estilo:0});
      texto=`Sesión previa (${prev}): máx. ${f2(P.h)}, mín. ${f2(P.l)}. El reporte mide si hoy rompe uno o ambos extremos y dónde cierra.`; desde=-1; }
    else if(rep==='pivotes'){ const pp=(P.h+P.l+P.c)/3, r1=2*pp-P.l, s1=2*pp-P.h, r2=pp+(P.h-P.l), s2=pp-(P.h-P.l);
      for(const [v,t,c] of [[r2,'R2',RO],[r1,'R1',RO],[pp,'P',GR],[s1,'S1',VE],[s2,'S2',VE]]) seg(H.i0,v,c,t,t==='P'?0:2);
      texto=`Pivotes clásicos con la sesión previa (máx. ${f2(P.h)}, mín. ${f2(P.l)}, cierre ${f2(P.c)}): P = (máx + mín + cierre)/3; R1 = 2P − mín; S1 = 2P − máx; R2/S2 = P ± rango.`; }
    else { seg(H.i0,P.c,GR,'Cierre previo'); seg(H.i0,H.o,AZ,'Apertura',2);
      const g=H.o-P.c; for(const k of [0.25,0.5]) seg(H.i0,H.o-g*k,'#94a3b8',`Llena ${k*100} %`,1);
      texto=`Gap de sesión: apertura ${f2(H.o)} vs. cierre previo ${f2(P.c)} (${(g/P.c*100).toFixed(2)} %). Llenar el 100 % = volver a tocar el cierre previo.`; }
  } else if(rep==='power_hour'){
    const A=rango(fecha,s,ci-60), PH=rango(fecha,ci-60,ci); if(!A||!PH) return null;
    seg(A.i0,A.h,AZ,'Máx. antes de la última hora'); seg(A.i0,A.l,AZ,'Mín. antes de la última hora');
    marcas.push({t:T[PH.i0],pos:'aboveBar',color:NA,forma:'square',texto:'Power hour'}); desde=ci-240;
    texto=`Última hora (${hm(ci-60)}–${hm(ci)}): el reporte mide si rompe el máximo o el mínimo del día hasta ese momento.`;
  } else if(rep==='medianoche'){
    const M=rango(fecha,0,1440); if(!M) return null; seg(M.i0,M.o,MO,'Apertura de medianoche'); desde=0;
    texto=`Apertura de medianoche (00:00 NY): ${f2(M.o)}. ICT la usa como referencia de precio "justo" del día.`;
  } else if(rep==='sesiones'){
    const As=rango(prev,1140,1440)||rango(fecha,0,180), Lo=rango(fecha,180,480); desde=-300;
    if(As){ lineas.push({t0:T[As.i0],t1:fin,p:As.h,color:MO,titulo:'Máx. Asia',estilo:0},{t0:T[As.i0],t1:fin,p:As.l,color:MO,titulo:'Mín. Asia',estilo:0}); }
    if(Lo){ seg(Lo.i0,Lo.h,NA,'Máx. Londres'); seg(Lo.i0,Lo.l,NA,'Mín. Londres'); }
    if(!As&&!Lo) return null;
    texto='Rangos de Asia (19:00–03:00 NY) y Londres (03:00–08:00 NY). El reporte mide qué sesión marca el máximo y el mínimo del día.';
  } else return null;

  marcas.sort((a,b)=>a.t-b.t);
  const iDesde=(()=>{ if(desde===-1) return 0; for(let i=0;i<B.o.length;i++) if(B.day[i]===fecha && B.mod[i]>=desde) return i; return idxDia[0]; })();
  const iFin=idxDia[idxDia.length-1], iIni=desde===-1?0:Math.max(0,iDesde-6);
  return {B,T,lineas,series:[],marcas,texto,logico:{from:iIni,to:iFin+4},intervalo:d.intervalo};
}

function casoDiario(rep,d){
  const D=(d.diario||[]).map(r=>({f:r[0],o:+r[1],h:+r[2],l:+r[3],c:+r[4]})); if(D.length<3) return null; DEC=D[0].c<20?5:2;
  let k=D.findIndex(x=>x.f>=d.fecha); if(k<0) k=D.length-1; if(k<1) return null;
  const T=D.map(x=>Date.UTC(+x.f.slice(0,4),+x.f.slice(5,7)-1,+x.f.slice(8,10))/1000);
  const B={o:D.map(x=>x.o),h:D.map(x=>x.h),l:D.map(x=>x.l),c:D.map(x=>x.c)};
  const p=D[k-1], h=D[k], lineas=[], marcas=[], fin=T[Math.min(D.length-1,k+1)]; let texto='';
  const seg=(i0,v,color,titulo,estilo=0)=>lineas.push({t0:T[i0],t1:fin,p:v,color,titulo,estilo});
  if(rep==='apertura_semanal'){ seg(k,h.o,'#a78bfa','Apertura semanal'); marcas.push({t:T[k],pos:'aboveBar',color:'#a78bfa',forma:'square',texto:'Inicio de semana'});
    texto=`Apertura de la semana del ${h.f}: ${f2(h.o)}. El reporte mide si el precio vuelve a ella y dónde cierra la semana.`; }
  else {
    seg(k-1,p.h,'#60a5fa','Máx. previo'); seg(k-1,p.l,'#60a5fa','Mín. previo'); seg(k-1,p.c,'#8a9bb8','Cierre previo',2);
    marcas.push({t:T[k],pos:'aboveBar',color:'#f59e0b',forma:'arrowDown',texto:'Último caso'});
    const g=(h.o/p.c-1)*100;
    texto={gap_fill:`Gap de ${g.toFixed(2)} %: abre en ${f2(h.o)} contra el cierre previo ${f2(p.c)}. Se "llena" si el día vuelve a tocar ese cierre.`,
      rango_previo:`Rango del día previo: máx. ${f2(p.h)}, mín. ${f2(p.l)}. El reporte mide si hoy rompe uno o ambos extremos y si cierra más allá.`,
      dia_interior:`Día interior: el día previo quedó dentro del rango del anterior. El reporte mide hacia qué lado rompe el siguiente.`,
      apertura_fuera:`Apertura fuera del rango previo (${f2(p.l)}–${f2(p.h)}): el reporte mide si el precio vuelve a entrar y si cierra dentro.`,
      alto_bajo_semana:`Velas diarias de la semana del caso: el reporte mide qué día marca el máximo y el mínimo semanal.`,
      rango_diario:`Rango del día: ${f2(h.h-h.l)} (${((h.h-h.l)/p.c*100).toFixed(2)} % del cierre previo).`,
      envolventes:`Vela envolvente: el cuerpo del día cubre el cuerpo del anterior. El reporte mide si llega al objetivo antes que al stop.`}[rep]||'';
  }
  return {B,T,lineas,series:[],marcas,texto,logico:{from:Math.max(0,k-15),to:k+4},diario:true};
}

// Dibuja con Lightweight Charts (la misma librería de TradingView)
function dibujar(el, R, opt={}){
  el.innerHTML='';
  const css=getComputedStyle(document.documentElement), v=(n,d)=>(css.getPropertyValue(n).trim()||d);
  const ch=LightweightCharts.createChart(el,{autoSize:true,layout:{background:{color:opt.fondo||v('--panel','#111a2e')},textColor:opt.texto||v('--mut','#8a9bb8'),fontSize:11},
    grid:{vertLines:{color:opt.rejilla||v('--line','#22304d')},horzLines:{color:opt.rejilla||v('--line','#22304d')}},
    timeScale:{timeVisible:!R.diario,secondsVisible:false,borderVisible:false},rightPriceScale:{borderVisible:false},crosshair:{mode:0},
    handleScroll:true,handleScale:true});
  const ok=[]; let last=-Infinity; for(let i=0;i<R.T.length;i++){ if(R.T[i]>last){ ok.push(i); last=R.T[i]; } }
  const velas=ch.addCandlestickSeries({upColor:'#22c55e',downColor:'#ef4444',borderVisible:false,wickUpColor:'#22c55e',wickDownColor:'#ef4444',priceLineVisible:false,lastValueVisible:false});
  velas.setData(ok.map(i=>({time:R.T[i],open:R.B.o[i],high:R.B.h[i],low:R.B.l[i],close:R.B.c[i]})));
  for(const s of (R.series||[])){ const ls=ch.addLineSeries({color:s.color,lineWidth:2,priceLineVisible:false,lastValueVisible:false,title:s.titulo,crosshairMarkerVisible:false});
    ls.setData(ok.map(i=>({time:R.T[i],value:s.datos[i]}))); }
  for(const L of R.lineas){ if(!(L.t1>L.t0)) continue; const ls=ch.addLineSeries({color:L.color,lineWidth:L.estilo===0?2:1,lineStyle:L.estilo,priceLineVisible:false,lastValueVisible:true,title:L.titulo,crosshairMarkerVisible:false});
    ls.setData([{time:L.t0,value:L.p},{time:L.t1,value:L.p}]); }
  velas.setMarkers((R.marcas||[]).map(m=>({time:m.t,position:m.pos,color:m.color,shape:m.forma,text:m.texto})));
  if(R.logico) ch.timeScale().setVisibleLogicalRange(R.logico); else if(R.rango) ch.timeScale().setVisibleRange(R.rango);
  return ch;
}

window.LAB={makeBars,referencias,EXPLICA,construirReportes,efTarjeta,casoReporte,soportaCaso,dibujar};
})();
