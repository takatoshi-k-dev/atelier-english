/* ==========================================================
   Atelier English — 共通の動き
   ・Apple Pencil で描く / 指でタップして答えを出す
   ・答えは1つずつ、順番自由に開閉できる
   ・ページごとに書き込みを保持
   これ1つを直せば、全レッスンの動作が変わります。
   ========================================================== */
(function(){
  const stage = document.getElementById('stage');
  const fit   = document.getElementById('fit');
  const cv    = document.getElementById('ink');
  const ctx   = cv.getContext('2d');
  const slides= [...document.querySelectorAll('.slide')];
  const bar   = document.getElementById('bar');
  const pageno= document.getElementById('pageno');
  let cur = 0;
  let swipedAt = 0;          // 直近のページ送り（払い）の時刻

  /* ---------- 画面サイズに合わせて拡大縮小 ---------- */
  function layout(){
    // Safari の上下バーが出入りしても崩れないよう、実際の表示領域を使う
    const vv = window.visualViewport;
    const W = vv ? vv.width  : innerWidth;
    const H = vv ? vv.height : innerHeight;
    const k = Math.min(W/720, H/405);
    stage.style.transform = `scale(${k})`;
    fit.style.width  = (720*k)+'px';
    fit.style.height = (405*k)+'px';
    const S = 3;                      // 描画用の内部解像度（2160x1215）
    if(cv.width !== 720*S){
      cv.width = 720*S; cv.height = 405*S;
      ctx.setTransform(S,0,0,S,0,0);
    }
    setStroke();
  }
  addEventListener('resize', layout);
  addEventListener('orientationchange', ()=>setTimeout(layout,250));
  if(window.visualViewport){
    visualViewport.addEventListener('resize', layout);
    visualViewport.addEventListener('scroll', reset);
  }
  addEventListener('scroll', ()=>scrollTo(0,0), {passive:true});

  // 表示がずれた・拡大された時に一発で戻す
  function reset(){
    scrollTo(0,0);
    if(document.activeElement && document.activeElement.blur) document.activeElement.blur();
    layout();
  }

  /* ---------- Apple Pencil で描く ---------- */
  let mode='pen', drawing=false, last=null, color='#C0392B';
  const saved = {};

  function setStroke(){
    ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.strokeStyle = color;
    ctx.globalCompositeOperation = (mode==='era') ? 'destination-out' : 'source-over';
  }
  function pt(e){
    const r = cv.getBoundingClientRect();
    return { x:(e.clientX-r.left)/r.width*720, y:(e.clientY-r.top)/r.height*405 };
  }
  function width(e){ return (mode==='era') ? 17 : 0.8 + (e.pressure||.5)*2.0; }

  function down(e){
    if(e.pointerType!=='pen') return;          // 指・マウスはタップとして通す
    e.preventDefault(); e.stopPropagation();
    drawing=true; last=pt(e); setStroke();
    ctx.lineWidth=width(e);
    ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(last.x+0.01,last.y); ctx.stroke();
  }
  function move(e){
    if(!drawing || e.pointerType!=='pen') return;
    e.preventDefault(); e.stopPropagation();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for(const ev of evs){
      const p = pt(ev);
      ctx.lineWidth = width(ev);
      ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke();
      last = p;
    }
  }
  function up(e){ if(e.pointerType==='pen'){ drawing=false; last=null; } }

  stage.addEventListener('pointerdown', down, {capture:true, passive:false});
  window.addEventListener('pointermove', move, {capture:true, passive:false});
  window.addEventListener('pointerup', up, {capture:true});
  window.addEventListener('pointercancel', up, {capture:true});
  stage.addEventListener('touchmove', e=>{ if(drawing) e.preventDefault(); }, {passive:false});

  /* ---------- 答えを1つずつ開く ---------- */
  // .rv        … タップで出る／消える
  // .holder    … 点線の解答欄。タップで中身が出る
  // .group     … 分類ボード。1回目=答え、2回目=品詞名、3回目=消える
  // .seq … 左から順に出す。画面のどこを触っても次が1つ出る。
  //          出ているものをもう一度触ると、それだけ消える。
  function bindSeq(root){
    root.querySelectorAll('.seq').forEach(box=>{
      if(box.dataset.seqBound) return; box.dataset.seqBound=1;
      const slide = box.closest('.slide') || document;
      const items = [...box.querySelectorAll('.rv')];
      items.forEach(el=>{ el.dataset.bound=1; });   // 個別タップは無効にする
      slide.addEventListener('click', ev=>{
        if(Date.now()-swipedAt < 400) return;       // ページ送りの払いは無視
        const hit = ev.target.closest('.seq .rv');
        if(hit && hit.classList.contains('open')){ hit.classList.remove('open'); return; }
        const next = items.find(el=>!el.classList.contains('open'));
        if(next) next.classList.add('open');
      });
    });
  }

  function bindReveals(root){
    root.querySelectorAll('.rv').forEach(el=>{
      if(el.dataset.bound) return; el.dataset.bound=1;
      el.classList.add('rv-hint');
      el.addEventListener('click', ev=>{ ev.stopPropagation(); el.classList.toggle('open'); });
    });
    root.querySelectorAll('.holder').forEach(el=>{
      if(el.dataset.bound) return; el.dataset.bound=1;
      el.addEventListener('click', ev=>{ ev.stopPropagation(); el.classList.toggle('open'); });
    });
  }
  bindStep(document);
  bindGroup(document);
  bindHl(document);
  bindTr(document);
  bindSeq(document);
  bindReveals(document);
  bindDrag(document);
  bindGoto(document);
  bindOrder(document);
  bindMove(document);

  /* ---------- ドラッグで分ける ---------- */
  // .dcard を .drop の上へ運ぶ。data-accept と data-kind が一致するものだけ入る。
  // data-mirror が付いた入れ物は、そのページを開いたとき別ページの中身を写し取る。
  let drag=null;
  function kscale(){ const r=stage.getBoundingClientRect(); return r.width/720 || 1; }

  function bindDrag(root){
    root.querySelectorAll('.dcard').forEach(c=>{
      if(c.dataset.dbound) return; c.dataset.dbound=1;
      c.addEventListener('pointerdown', dstart, {passive:false});
    });
  }
  function dropAt(x,y){
    let hit=null;
    slides[cur].querySelectorAll('.drop').forEach(d=>{
      const r=d.getBoundingClientRect();
      if(x>=r.left && x<=r.right && y>=r.top && y<=r.bottom) hit=d;
    });
    return hit;
  }
  function dstart(e){
    if(e.pointerType==='pen') return;              // ペンは書き込み
    e.preventDefault(); e.stopPropagation();       // ページ送りの払いと衝突させない
    const el=e.currentTarget;
    drag={el, x:e.clientX, y:e.clientY, k:kscale(),
          home:el.parentNode, next:el.nextElementSibling};
    el.classList.add('flying');
    try{ el.setPointerCapture(e.pointerId); }catch(_){}
    el.addEventListener('pointermove', dmove);
    el.addEventListener('pointerup', dend);
    el.addEventListener('pointercancel', dend);
  }
  function dmove(e){
    if(!drag) return; e.preventDefault();
    drag.el.style.transform =
      'translate('+((e.clientX-drag.x)/drag.k)+'px,'+((e.clientY-drag.y)/drag.k)+'px)';
    const t=dropAt(e.clientX, e.clientY);
    slides[cur].querySelectorAll('.drop.over').forEach(d=>d.classList.remove('over'));
    if(t && t.dataset.accept===drag.el.dataset.kind) t.classList.add('over');
  }
  function dend(e){
    if(!drag) return;
    const el=drag.el, t=dropAt(e.clientX, e.clientY);
    el.removeEventListener('pointermove', dmove);
    el.removeEventListener('pointerup', dend);
    el.removeEventListener('pointercancel', dend);
    el.classList.remove('flying');
    el.style.transform='';
    slides[cur].querySelectorAll('.drop.over').forEach(d=>d.classList.remove('over'));
    if(t && t.dataset.accept===el.dataset.kind && t!==el.parentNode){
      if(t.classList.contains('head')) t.innerHTML='';   // 見出しは1枚だけ
      t.appendChild(el);
    }else if(t && t===el.parentNode){
      /* そのまま */
    }else{
      drag.home.insertBefore(el, drag.next);             // 枠の外なら元へ戻す
    }
    slides[cur].querySelectorAll('.bin .head').forEach(h=>
      h.classList.toggle('filled', !!h.querySelector('.dcard')));
    drag=null;
  }

  // 別ページで分けた中身を写し取る（動かせない控えとして）
  function mirror(sl){
    sl.querySelectorAll('[data-mirror]').forEach(dst=>{
      const src=document.querySelector(dst.dataset.mirror);
      if(!src) return;
      dst.innerHTML='';
      src.querySelectorAll('.dcard').forEach(c=>{
        const n=c.cloneNode(true);
        n.className='card'; n.style.transform=''; n.removeAttribute('data-dbound');
        dst.appendChild(n);
      });
    });
  }

  // .step … その中をタップするたび1段階ずつ進む。
  //   例文：その回で足した語を左から1つずつ→全部そろうとピリオド→最後に和訳
  //   解答欄：1回目=英文／2回目=和訳
  //   状態はDOMを見て判断するので「答えを隠す」で最初に戻る。
  function bindStep(root){
    root.querySelectorAll('.step').forEach(box=>{
      if(box.dataset.stbound) return; box.dataset.stbound=1;
      const isHolder = box.classList.contains('holder');
      const en  = box.querySelector('.en');
      const jp  = box.querySelector('.jp');
      const dot = box.querySelector('.dot');
      const words = en ? [...en.querySelectorAll('.rv')] : [];

      box.dataset.bound=1;                       // 個別タップは付けない
      words.forEach(w=>w.dataset.bound=1);
      if(jp) jp.dataset.bound=1;
      if(!words.length && dot) dot.classList.add('open');   // 既に完成している文

      box.addEventListener('click', ev=>{
        ev.stopPropagation();
        if(isHolder && !box.classList.contains('open')){ box.classList.add('open'); return; }
        const next = words.find(w=>!w.classList.contains('open'));
        if(next){                                  // 左から1つずつ出す
          next.classList.add('open');
          if(words.every(w=>w.classList.contains('open')) && dot) dot.classList.add('open');
          return;
        }
        if(jp) jp.classList.add('open');
      });
    });
  }

  // カードをタップ＝そのカードの訳だけ出す
  // 見出し(.showall)をタップ＝そのページの訳をまとめて出す／もう一度で全部隠す
  // .mgroup … 観点と答えの2段階。他の仕組みには依存せず、ここだけで完結させる。
  //   何もない所をタップ → 観点(.q)が一気に出る／もう一度で一気に消える
  //   観点が出ている間だけ → 答え(.a)を1つずつタップで開閉できる
  function bindGroup(root){
    root.querySelectorAll('.mgroup').forEach(g=>{
      if(g.dataset.ggbound) return; g.dataset.ggbound=1;
      const qs=[...g.querySelectorAll('.q')], as=[...g.querySelectorAll('.a')];
      [...qs,...as].forEach(el=>{ el.dataset.bound=1; });   // 個別バインドを使わない

      function shown(){ return qs.length>0 && qs.every(q=>q.classList.contains('open')); }
      function sync(){ if(!shown()) as.forEach(a=>a.classList.remove('open')); }

      as.forEach(a=>{
        a.addEventListener('click', ev=>{
          ev.stopPropagation();
          if(!shown()) return;                    // 観点が出るまでは反応しない
          a.classList.toggle('open');
        });
      });

      const slide=g.closest('.slide') || g;
      slide.addEventListener('click', ev=>{
        if(ev.target.closest('.a')) return;
        const want=!shown();
        qs.forEach(q=>q.classList.toggle('open', want));
        sync();
      });
      sync();
    });
  }

  // .hlgroup … 本文の語(.hl)をタップすると色が付く。
  //            全部に色が付いたあと、他の場所をタップすると .after が出る。
  function bindHl(root){
    root.querySelectorAll('.hlgroup').forEach(g=>{
      if(g.dataset.hlbound) return; g.dataset.hlbound=1;
      const hs=[...g.querySelectorAll('.hl')];
      const after=g.querySelector('.after');
      if(after) after.dataset.bound=1;
      hs.forEach(el=>{
        el.dataset.bound=1;
        el.addEventListener('click', ev=>{
          ev.stopPropagation();
          el.classList.toggle('on');
          if(after && !hs.every(x=>x.classList.contains('on'))) after.classList.remove('open');
        });
      });
      const slide=g.closest('.slide')||g;
      slide.addEventListener('click', ev=>{
        if(ev.target.closest('.hl') || !after) return;
        if(hs.every(x=>x.classList.contains('on'))) after.classList.toggle('open');
      });
    });
  }

  function bindTr(root){
    root.querySelectorAll('.card').forEach(c=>{
      const s=c.querySelector('s.rv'); if(!s) return;
      if(c.dataset.tbound) return; c.dataset.tbound=1;
      s.dataset.bound=1;
      c.addEventListener('click', ev=>{ ev.stopPropagation(); s.classList.toggle('open'); });
    });
    root.querySelectorAll('.showall').forEach(el=>{
      if(el.dataset.abound) return; el.dataset.abound=1;
      el.addEventListener('click', ev=>{
        ev.stopPropagation();
        const sl=el.closest('.slide'); if(!sl) return;
        const all=[...sl.querySelectorAll('.rv')];
        const done=all.every(x=>x.classList.contains('open'));
        all.forEach(x=>x.classList.toggle('open', !done));
      });
    });
  }

  // data-goto="#id" … そのページへ一発で飛ぶ（レベル選択・戻り用）
  function jump(i){
    if(i<0 || i>=slides.length || i===cur) return;
    store();
    slides[cur].classList.remove('on');
    cur=i; slides[cur].classList.add('on');
    enter(slides[cur]); recall(); mark();
  }
  function bindGoto(root){
    root.querySelectorAll('[data-goto]').forEach(el=>{
      if(el.dataset.gtbound) return; el.dataset.gtbound=1;
      el.addEventListener('click', ev=>{
        ev.stopPropagation();
        const t=document.querySelector(el.dataset.goto);
        const i=slides.indexOf(t);
        if(i>=0) jump(i);
      });
    });
  }

  // .ord … その枠を触るたび、中の .rv を上から順に1つずつ出す（枠ごとに独立）
  //        全部出たあと、data-last があれば枠の色を変えて、その要素も出す
  function bindOrder(root){
    root.querySelectorAll('.ord').forEach(box=>{
      if(box.dataset.obound) return; box.dataset.obound=1;
      const items=[...box.querySelectorAll('.rv')];
      items.forEach(el=>{ el.dataset.bound=1; });
      const last = box.dataset.last ? document.querySelector(box.dataset.last) : null;
      if(last) last.dataset.bound=1;
      box.addEventListener('click', ev=>{
        ev.stopPropagation();
        const next=items.find(el=>!el.classList.contains('open'));
        if(next){ next.classList.add('open'); return; }
        if(last){
          const on=!box.classList.contains('done');
          box.classList.toggle('done', on);
          last.classList.toggle('open', on);
        }
      });
    });
  }

  // .movebox … 文中の語(.mv)を前へドラッグして動かす。
  //   受け皿(.slot-front)に入れると、data-swap を持つ要素が入れ替わる
  //   （the→The、ピリオド→? など）。枠外で離すと元に戻る。
  function bindMove(root){
    root.querySelectorAll('.movebox').forEach(box=>{
      if(box.dataset.mvbound) return; box.dataset.mvbound=1;
      const mv=box.querySelector('.mv'), slot=box.querySelector('.drop-front');
      if(!mv || !slot) return;
      const home=mv.parentNode, next=mv.nextSibling;
      let d=null;
      const k=()=>{ const r=stage.getBoundingClientRect(); return r.width/720 || 1; };
      const swap=on=>{
        box.querySelectorAll('[data-swap]').forEach(el=>{
          if(el.dataset.orig===undefined) el.dataset.orig=el.textContent;
          el.textContent = on ? el.dataset.swap : el.dataset.orig;
        });
        box.classList.toggle('moved', on);
      };
      mv.addEventListener('pointerdown', e=>{
        if(e.pointerType==='pen') return;
        e.preventDefault(); e.stopPropagation();
        d={x:e.clientX, y:e.clientY, k:k()};
        box.classList.add('dragging');
        mv.classList.add('flying');
        try{ mv.setPointerCapture(e.pointerId); }catch(_){}
      }, {passive:false});
      mv.addEventListener('pointermove', e=>{
        if(!d) return; e.preventDefault();
        mv.style.transform='translate('+((e.clientX-d.x)/d.k)+'px,'+((e.clientY-d.y)/d.k)+'px)';
        const r=slot.getBoundingClientRect();
        slot.classList.toggle('over',
          e.clientX>=r.left && e.clientX<=r.right && e.clientY>=r.top && e.clientY<=r.bottom);
      });
      const end=e=>{
        if(!d) return;
        const r=slot.getBoundingClientRect();
        const hit = e.clientX>=r.left && e.clientX<=r.right && e.clientY>=r.top && e.clientY<=r.bottom;
        mv.classList.remove('flying'); mv.style.transform='';
        box.classList.remove('dragging');
        slot.classList.remove('over'); d=null;
        if(hit){ slot.appendChild(mv); swap(true); }
        else   { home.insertBefore(mv,next); swap(false); }
      };
      mv.addEventListener('pointerup', end);
      mv.addEventListener('pointercancel', end);
    });
  }

  function enter(sl){ stopAudio(); bindPlay(sl); mirror(sl); bindStep(sl); bindGroup(sl); bindHl(sl); bindTr(sl); bindSeq(sl); bindReveals(sl); bindDrag(sl); bindGoto(sl); bindOrder(sl); bindMove(sl); }

  /* ---------- ページ送り ---------- */
  function store(){
    const c=document.createElement('canvas');
    c.width=cv.width; c.height=cv.height;
    c.getContext('2d').drawImage(cv,0,0);
    saved[cur]=c;
  }
  function recall(){
    ctx.save(); ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,cv.width,cv.height);
    if(saved[cur]) ctx.drawImage(saved[cur],0,0);
    ctx.restore(); setStroke();
  }
  function go(d){
    const n = Math.max(0, Math.min(slides.length-1, cur+d));
    if(n===cur) return;
    store();
    slides[cur].classList.remove('on');
    cur=n;
    slides[cur].classList.add('on');
    enter(slides[cur]);
    recall(); mark();
  }
  function mark(){ if(pageno) pageno.textContent = (cur+1)+' / '+slides.length; }

  /* ---------- ツールバー ---------- */
  function setBar(show){
    bar.classList.toggle('gone', !show);
    const v=document.getElementById('ver');
    if(v) v.classList.toggle('gone', !show);
    if(pageno) pageno.classList.toggle('gone', !show);
    document.body.classList.toggle('barhidden', !show);
  }
  const $=id=>document.getElementById(id);
  $('prev').onclick=()=>go(-1);
  $('next').onclick=()=>go(1);
  $('pen').onclick=()=>{mode='pen';$('pen').classList.add('act');$('era').classList.remove('act');setStroke();};
  $('era').onclick=()=>{mode='era';$('era').classList.add('act');$('pen').classList.remove('act');setStroke();};
  $('clr').onclick=()=>{ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,cv.width,cv.height);ctx.restore();delete saved[cur];setStroke();};
  $('rst').onclick=()=>slides[cur].querySelectorAll('.open,.shown,.named')
      .forEach(x=>x.classList.remove('open','shown','named'));
  if(document.getElementById('fix')) $('fix').onclick=reset;
  if(document.getElementById('home')) $('home').onclick=()=>{ location.href='index.html'; };
  $('hide').onclick=()=>{ setBar(false); };
  const peek=$('peek');
  if(peek) peek.addEventListener('click',()=>{ setBar(true); });

  // 色の切り替え（iPadでの取りこぼしを防ぐため pointerup で拾う）
  const swatches=[...document.querySelectorAll('[data-color]')];
  swatches.forEach(b=>{
    const pick=ev=>{
      ev.preventDefault(); ev.stopPropagation();
      color=b.dataset.color; mode='pen';
      $('pen').classList.add('act'); $('era').classList.remove('act');
      swatches.forEach(o=>o.classList.remove('act')); b.classList.add('act');
      setStroke();
    };
    b.addEventListener('pointerup', pick);
    b.addEventListener('click', ev=>{ev.preventDefault();});
  });

  /* ---------- 指のジェスチャー（バーを消したまま操作できる） ---------- */
  // 左右スワイプ＝ページ送り／二本指タップ＝バーの表示切替
  let sw=null;
  stage.addEventListener('pointerdown', e=>{
    if(e.pointerType==='pen') return;           // ペンは描画なので対象外
    sw={x:e.clientX, y:e.clientY, t:Date.now(), id:e.pointerId};
  }, {passive:true});
  stage.addEventListener('pointerup', e=>{
    if(!sw || e.pointerType==='pen' || e.pointerId!==sw.id) return;
    const dx=e.clientX-sw.x, dy=e.clientY-sw.y, dt=Date.now()-sw.t;
    sw=null;
    if(dt<700 && Math.abs(dx)>60 && Math.abs(dx)>Math.abs(dy)*1.6){
      swipedAt = Date.now();                    // 直後のタップを無視するため記録
      go(dx<0 ? 1 : -1);                        // 左へ払う＝次、右へ払う＝前
    }
  }, {passive:true});

  // 二本指タップでバーを出し入れ（指を動かさず短く触れたときだけ）
  let multi=0, mStart=null, mMoved=false, mTime=0;
  stage.addEventListener('touchstart', e=>{
    multi=Math.max(multi, e.touches.length);
    if(e.touches.length===2){
      mStart={x:e.touches[0].clientX, y:e.touches[0].clientY};
      mMoved=false; mTime=Date.now();
    }
  }, {passive:true});
  stage.addEventListener('touchmove', e=>{
    if(mStart && e.touches.length){
      const dx=e.touches[0].clientX-mStart.x, dy=e.touches[0].clientY-mStart.y;
      if(Math.hypot(dx,dy)>14) mMoved=true;     // 少しでも払ったらタップ扱いにしない
    }
  }, {passive:true});
  stage.addEventListener('touchend', e=>{
    if(e.touches.length===0){
      if(multi===2 && !mMoved && Date.now()-mTime<450){
        setBar(bar.classList.contains('gone'));
      }
      multi=0; mStart=null; mMoved=false;
    }
  }, {passive:true});

  /* ---------- キーボード（Mac確認用） ---------- */
  addEventListener('keydown',e=>{
    if(e.key==='ArrowRight'||e.key===' ') { e.preventDefault(); go(1); }
    if(e.key==='ArrowLeft') go(-1);
  });

  /* ---------- ページ一覧（番号を押して飛ぶ） ---------- */
  const idx=document.getElementById('index');
  if(idx){
    const grid=document.getElementById('indexGrid');
    slides.forEach((sl,i)=>{
      const lab=(sl.querySelector('h1')||sl.querySelector('.big')||sl.querySelector('.title-jp'));
      const eye=sl.querySelector('.eyebrow span');
      const cell=document.createElement('button');
      cell.className='ix';
      cell.innerHTML='<b>'+(i+1)+'</b><span>'+
        ((lab&&lab.textContent.trim()) || (eye&&eye.textContent.trim()) || '')+'</span>';
      cell.addEventListener('click', ev=>{
        ev.stopPropagation();
        store();
        slides[cur].classList.remove('on');
        cur=i; slides[cur].classList.add('on');
        enter(slides[cur]);
        recall(); mark(); idx.classList.remove('open');
      });
      grid.appendChild(cell);
    });
    $('list').onclick=()=>idx.classList.toggle('open');
    idx.addEventListener('click', e=>{ if(e.target===idx) idx.classList.remove('open'); });
  }

  /* ---------- 版の表示（制作中だけ・完成したら外す） ---------- */
  // ファイルを差し替えたのに反映されていないのか、動きが違うのかを切り分けるための目印。
  const VER = 'v.0818-4';
  (function(){
    const el=document.createElement('div');
    el.id='ver'; el.textContent=VER;
    document.body.appendChild(el);
  })();

  /* ---------- 音声 ---------- */
  // 鳴っているのは常に1つだけ。同じボタンをもう一度押すと止まる。
  // ページを移ると自動で止まる。
  let snd=null, sndBtn=null;
  function stopAudio(){
    if(snd){ snd.pause(); snd=null; }
    if(sndBtn){ sndBtn.classList.remove('on'); sndBtn=null; }
  }
  function bindPlay(root){
    root.querySelectorAll('.play').forEach(b=>{
      if(b.dataset.pbound) return; b.dataset.pbound=1;
      b.addEventListener('click', ev=>{
        ev.stopPropagation();
        const src=b.dataset.src; if(!src) return;
        const same=(sndBtn===b);
        stopAudio();
        if(same) return;                       // 同じボタン＝停止だけ
        const a=new Audio(src);
        a.addEventListener('ended', stopAudio);
        a.play().catch(()=>{});
        snd=a; sndBtn=b; b.classList.add('on');
      });
    });
  }
  bindPlay(document);

  // ピンチ・ダブルタップによる拡大を抑止
  document.addEventListener('gesturestart', e=>e.preventDefault());
  document.addEventListener('gesturechange', e=>e.preventDefault());
  document.addEventListener('gestureend', e=>e.preventDefault());
  let lastTouch=0;
  document.addEventListener('touchend', e=>{
    const now=Date.now();
    if(now-lastTouch<320) e.preventDefault();
    lastTouch=now;
  }, {passive:false});
  document.addEventListener('touchmove', e=>{ if(e.touches.length>1) e.preventDefault(); }, {passive:false});

  layout(); mark();
})();
