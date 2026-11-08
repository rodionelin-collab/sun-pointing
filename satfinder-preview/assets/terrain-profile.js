/* Lazy, key-free terrain tiles. Fixed HTTPS origin; transient, bounded caches.
   Data/attribution: https://github.com/tilezen/joerd/blob/master/docs/attribution.md */
'use strict';
(() => {
  const M=window.TerrainModel, tiles=new Map(), pending=new Map(), profiles=new Map(), settings=new Map();
  let mounted=[],active=0;
  const waiters=[];
  const abort=()=>new DOMException('Cancelled','AbortError');
  const assertLive=signal=>{if(signal.aborted)throw abort();};
  async function slot() {
    if(active<4)active++;
    else await new Promise(resolve=>waiters.push(resolve));
  }
  function release(){const next=waiters.shift();if(next)next();else active--;}
  function retain(cache,key,value,max) {
    cache.delete(key);cache.set(key,value);
    while(cache.size>max)cache.delete(cache.keys().next().value);
    return value;
  }
  async function tile(key,signal) {
    assertLive(signal);
    if(tiles.has(key))return retain(tiles,key,tiles.get(key),96);
    if(pending.has(key))return pending.get(key);
    if(pending.size>=32)throw new Error('TERRAIN_BUSY');
    const task=(async()=>{
      // Shared tile work is independent of an individual card's cancellation.
      // Jobs stay bounded; cancelled profiles never update the UI or queue more.
      await slot();
      try {
        const response=await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${key}.png`,{
          mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(12000)
        });
        if(!response.ok)throw new Error('TERRAIN_NETWORK');
        const blob=await response.blob();
        if(blob.size>1500000)throw new Error('TERRAIN_FORMAT');
        const bitmap=await createImageBitmap(blob,{colorSpaceConversion:'none',premultiplyAlpha:'none'});
        try {
          if(bitmap.width!==256||bitmap.height!==256)throw new Error('TERRAIN_FORMAT');
          const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
          const ctx=canvas.getContext('2d',{willReadFrequently:true});
          ctx.drawImage(bitmap,0,0);
          return retain(tiles,key,ctx.getImageData(0,0,256,256).data,96);
        } finally {bitmap.close();}
      } finally {release();}
    })();
    pending.set(key,task);
    try{return await task;}finally{pending.delete(key);}
  }
  async function profile(context,km,signal,progress) {
    const key=[...context.point,context.azimuth,km].join(':');
    if(profiles.has(key))return retain(profiles,key,profiles.get(key),12);
    const samples=M.makePath(...context.point,context.azimuth,km);
    const groups=new Map();
    samples.forEach(p=>{if(!groups.has(p.tile.key))groups.set(p.tile.key,[]);groups.get(p.tile.key).push(p);});
    const keys=[...groups.keys()];let next=0,done=0;
    await Promise.all(Array.from({length:Math.min(4,keys.length)},async()=>{
      while(next<keys.length) {
        assertLive(signal);
        const k=keys[next++],pixels=await tile(k,signal);
        assertLive(signal);
        for(const p of groups.get(k)) {
          const i=4*(p.tile.y*256+p.tile.x);
          p.height=M.decode(pixels[i],pixels[i+1],pixels[i+2],pixels[i+3]);
          if(p.height===null)throw new Error('TERRAIN_INCOMPLETE');
        }
        progress(++done,keys.length);
      }
    }));
    assertLive(signal);
    return retain(profiles,key,samples,12);
  }
  function message(error) {
    if(error.message==='INVALID_TERRAIN_INPUT')return 'Профиль недоступен для этого направления. Поддерживаются широты от 85° ю. ш. до 85° с. ш. и угол места от 0,01° до 89,99°.';
    if(error.message==='TERRAIN_TOO_MANY_TILES')return 'Полная проверка 0–30 км для этого направления превышает лимит загрузки данных. Оценка перекрытий не выполнена.';
    if(error.message==='TERRAIN_INCOMPLETE')return 'Недостаточно данных высот или участок содержит глубокую воду. Оценка перекрытия не выполнена.';
    return 'Не удалось получить данные рельефа. Проверьте интернет и нажмите «Перестроить». Оценка перекрытия не выполнена.';
  }
  function rayLabelAnchor(points,top) {
    const start=points[0];
    let end=points.at(-1);
    for(let i=1;i<points.length;i++) {
      if(points[i].y<=top) {
        const previous=points[i-1],next=points[i];
        const fraction=(previous.y-top)/(previous.y-next.y);
        end={x:previous.x+(next.x-previous.x)*fraction,y:top};
        break;
      }
    }
    return {x:(start.x+end.x)/2,y:(start.y+end.y)/2,angle:Math.atan2(end.y-start.y,end.x-start.x)};
  }
  function attach(container,contexts) {
    mounted.forEach(item=>item.destroy());mounted=[];
    for(const context of contexts) {
      const details=[...container.querySelectorAll('.card-details')].find(el=>el.dataset.satellite===String(context.id));
      if(!details)continue;
      const host=details.querySelector('.terrain-profile');
      if(!host)continue;
      const saved=settings.get(context.id)||{height:1,km:0.5};
      // Only static HTML; coordinates, provider data and names are assigned as text.
      host.innerHTML=`<div class="terrain-heading"><h4>Профиль радиолинии<span class="terrain-obstruction" hidden> (<span class="terrain-obstruction-text">есть перекрытия</span>)</span></h4><span>Предварительная оценка рельефа</span></div>
        <form class="terrain-controls">
          <label>Высота антенны над землёй, м<input class="terrain-height" type="number" min="0" max="100" step="0.1" inputmode="decimal" required></label>
          <label>Дальность графика<select class="terrain-range"><option value="0.5">0,5 км</option><option value="1">1 км</option><option value="5">5 км</option><option value="10">10 км</option><option value="30">30 км</option></select></label>
          <button class="button outline terrain-retry" type="submit">Перестроить</button>
        </form>
        <p class="terrain-check-note">Проверка перекрытий: 0–30 км независимо от дальности графика.</p>
        <p class="terrain-state" role="status" aria-live="polite">Проверка запускается при раскрытии параметров.</p>
        <div class="terrain-plot" hidden><canvas class="terrain-canvas" role="img"></canvas>
          <div class="terrain-legend"><span><i class="terrain-key"></i>Рельеф с поправкой на кривизну</span><span><i class="terrain-ray-key"></i>Направление на спутник</span><span><i class="terrain-block-key"></i>Перекрытие</span></div>
          <p class="terrain-chart-note">Высота относительно поверхности в точке установки; масштабы осей различаются. Линия направления может уходить за верхнюю границу графика.</p>
          <label class="terrain-probe-label">Точка профиля<input class="terrain-probe" type="range" min="0" max="1" value="0" step="1"></label>
          <p class="terrain-readout"></p>
        </div>
        <p class="terrain-meta"></p>
        <p class="terrain-caveat">Проверяется модель профиля от точки установки до 30 км, включая отрезки между отсчётами. Между отсчётами, в том числе на первых 25 м, высота интерполируется: это не добавляет детализации исходным данным. Ближний рельеф, деревья, здания и водные поверхности требуют проверки на месте; небольшие препятствия могут быть пропущены. Высота антенны отсчитывается от поверхности модели. Зона Френеля и атмосферная рефракция не учитываются. Это не гарантия связи.</p>`;
      host.style.setProperty('--terrain-ray',context.color);
      const height=host.querySelector('.terrain-height'),range=host.querySelector('.terrain-range');
      const status=host.querySelector('.terrain-state'),plot=host.querySelector('.terrain-plot');
      const meta=host.querySelector('.terrain-meta'),probe=host.querySelector('.terrain-probe'),readout=host.querySelector('.terrain-readout');
      const canvas=host.querySelector('canvas'),form=host.querySelector('form');
      const warning=host.querySelector('.terrain-obstruction');
      height.value=saved.height;range.value=saved.km;
      let controller=null,result=null,graphValues=[],currentIndex=0,drawFrame=0,destroyed=false;
      const number=value=>Number(value).toLocaleString('ru-RU',{maximumFractionDigits:1});
      const distanceKm=metres=>(metres/1000).toLocaleString('ru-RU',{maximumFractionDigits:3});
      function cancel(){controller?.abort();controller=null;host.removeAttribute('aria-busy');}
      function inspect(index) {
        if(!result||!graphValues.length)return;
        currentIndex=Math.max(0,Math.min(graphValues.length-1,index));
        probe.value=currentIndex;
        const p=graphValues[currentIndex];
        readout.textContent=`${distanceKm(p.distance)} км · Высота модели: ${number(p.height)} м · Просвет до линии: ${number(p.clearance)} м${p.distance===0?' · Точка установки':p.distance<100?' · Ближний участок: проверьте на месте':''}`;
        probe.setAttribute('aria-valuetext',readout.textContent);
      }
      function draw() {
        if(!result||!graphValues.length||!details.open||destroyed)return;
        const width=canvas.getBoundingClientRect().width;
        if(width<100)return;
        const H=270,dpr=Math.min(devicePixelRatio||1,2);
        canvas.width=Math.round(width*dpr);canvas.height=H*dpr;
        const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);
        const css=getComputedStyle(host),color=v=>css.getPropertyValue(v).trim();
        const left=width<420?48:64,right=16,top=32,bottom=40,W=width-left-right,PH=H-top-bottom;
        const vals=graphValues,maxD=vals.at(-1).distance;
        const min=Math.min(0,...vals.map(p=>p.ground)),max=Math.max(40,Number(height.value),...vals.map(p=>p.ground));
        const pad=Math.max(20,(max-min)*.16),lo=min-pad,hi=max+pad;
        const X=d=>left+d/maxD*W,Y=h=>top+(hi-h)/(hi-lo)*PH;
        ctx.fillStyle=color('--text');ctx.font=`12px ${css.fontFamily}`;
        ctx.fillText('Высота, м',left,17);
        ctx.strokeStyle=color('--border');ctx.lineWidth=1;
        for(let i=0;i<=4;i++) {
          const v=lo+(hi-lo)*i/4,y=Y(v);
          ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(width-right,y);ctx.stroke();
          ctx.fillStyle=color('--muted');ctx.textAlign='right';ctx.fillText(Math.round(v).toLocaleString('ru-RU'),left-8,y+4);
        }
        for(let i=0;i<=4;i++) {
          const d=maxD*i/4,x=X(d);
          ctx.fillStyle=color('--muted');ctx.textAlign=i===0?'left':i===4?'right':'center';
          ctx.fillText(distanceKm(d),x,H-21);
        }
        ctx.textAlign='right';ctx.fillText('Расстояние, км',width-right,H-4);
        ctx.save();ctx.beginPath();ctx.rect(left,top,W,PH);ctx.clip();
        ctx.beginPath();ctx.moveTo(X(0),Y(lo));
        vals.forEach(p=>ctx.lineTo(X(p.distance),Y(p.ground)));
        ctx.lineTo(X(maxD),Y(lo));ctx.closePath();
        ctx.fillStyle=color('--terrain-fill');ctx.fill();
        ctx.beginPath();vals.forEach((p,i)=>i?ctx.lineTo(X(p.distance),Y(p.ground)):ctx.moveTo(X(p.distance),Y(p.ground)));
        ctx.strokeStyle=color('--terrain-stroke');ctx.lineWidth=1.5;ctx.stroke();
        ctx.strokeStyle=color('--error');ctx.lineWidth=3;
        for(const {from,to} of result.segments) {
          if(from.distance>maxD)continue;
          ctx.beginPath();ctx.moveTo(X(from.distance),Y(from.ground));ctx.lineTo(X(to.distance),Y(to.ground));ctx.stroke();
        }
        ctx.setLineDash([7,5]);
        ctx.beginPath();vals.forEach((p,i)=>i?ctx.lineTo(X(p.distance),Y(p.ray)):ctx.moveTo(X(0),Y(p.ray)));
        ctx.strokeStyle=color('--terrain-stroke');ctx.lineWidth=3.5;ctx.stroke();
        ctx.strokeStyle=context.color;ctx.lineWidth=2;ctx.stroke();ctx.setLineDash([]);
        ctx.fillStyle=color('--accent');ctx.beginPath();ctx.arc(X(0),Y(Number(height.value)),4,0,2*Math.PI);ctx.fill();
        const p=vals[currentIndex];ctx.strokeStyle=color('--muted');ctx.lineWidth=1;ctx.setLineDash([2,3]);
        ctx.beginPath();ctx.moveTo(X(p.distance),top);ctx.lineTo(X(p.distance),H-bottom);ctx.stroke();ctx.setLineDash([]);
        const anchor=rayLabelAnchor(vals.map(p=>({x:X(p.distance),y:Y(p.ray)})),top);
        const fullName=context.name.replace(/\s*\([^)]*\)/g,'').trim();
        const label=width<420?fullName.replace(/^Экспресс-/,'Э-').replace(/^Ямал-/,'Я-'):fullName;
        ctx.font=`600 12px ${css.fontFamily}`;ctx.textAlign='center';ctx.textBaseline='middle';
        const labelWidth=ctx.measureText(label).width;
        const cosine=Math.cos(anchor.angle),sine=Math.sin(anchor.angle);
        const halfW=Math.abs(cosine)*labelWidth/2+Math.abs(sine)*7;
        const halfH=Math.abs(sine)*labelWidth/2+Math.abs(cosine)*7;
        const labelX=Math.max(left+halfW+4,Math.min(width-right-halfW-4,anchor.x+sine*13));
        const labelY=Math.max(top+halfH+4,Math.min(H-bottom-halfH-4,anchor.y-cosine*13));
        // Keep the direction's hue while making light-theme text legible.
        ctx.fillStyle=document.documentElement.dataset.theme==='dark'?context.color:
          context.color.replace(/[0-9a-f]{2}/gi,hex=>Math.round(parseInt(hex,16)*.55).toString(16).padStart(2,'0'));
        ctx.translate(labelX,labelY);ctx.rotate(anchor.angle);
        ctx.fillText(label,0,0);
        ctx.restore();
        canvas.setAttribute('aria-label',`Профиль рельефа, ${context.name}. ${status.textContent}. ${meta.textContent}`);
      }
      function queueDraw(){cancelAnimationFrame(drawFrame);drawFrame=requestAnimationFrame(draw);}
      function showRange() {
        if(!result)return;
        const km=Number(range.value);
        graphValues=result.values.filter(p=>p.distance<=km*1000);
        warning.hidden=!result.obstruction;
        status.dataset.state=result.state;
        if(result.state==='blocked'){
          status.textContent=`На участке 0–30 км есть возможное перекрытие по модели. Начало перекрытия по интерполяции: ${distanceKm(result.obstruction.distance)} км; наихудшее превышение над линией: ${number(-result.critical.clearance)} м.`;
          if(result.obstruction.distance>km*1000)status.textContent+=' Перекрытие находится за пределами показанного графика. Для просмотра выберите 30 км.';
        }else if(result.state==='caution'){
          status.textContent=`Проверка 0–30 км: малый просвет по модели, ${number(result.critical.clearance)} м на ${distanceKm(result.critical.distance)} км. Требуется проверка на месте.`;
        }else status.textContent='На участке 0–30 км по данным модели перекрытий не обнаружено. Это не гарантия свободной радиолинии.';
        meta.textContent=`Проверено: 0–30 км · На графике: 0–${number(km)} км · Азимут: ${number(context.azimuth)}° · Угол места: ${number(context.elevation)}° · Угловой запас над рельефом: ${number(result.angularMargin)}° · Высота точки по модели: ${number(result.origin)} м. Выборка: 25 м до 1 км, далее 100 м; между отсчётами — интерполяция, не повышение точности.`;
        probe.max=graphValues.length-1;
        const critical=graphValues.slice(1).reduce((a,b)=>a.clearance<b.clearance?a:b);
        plot.hidden=false;inspect(graphValues.indexOf(critical));queueDraw();
      }
      async function load() {
        cancel();plot.hidden=true;result=null;graphValues=[];meta.textContent='';warning.hidden=true;
        if(!height.checkValidity()||height.value.trim()===''){
          status.dataset.state='caution';status.textContent='Укажите высоту антенны от 0 до 100 м.';return;
        }
        const h=Number(height.value),km=Number(range.value);
        settings.set(context.id,{height:h,km});
        if(!Number.isFinite(context.azimuth)||!Number.isFinite(context.elevation)||context.elevation<.01||context.elevation>89.99){
          status.dataset.state='caution';status.textContent='Для этого направления профиль недоступен: азимут или угол места вне области расчёта.';return;
        }
        controller=new AbortController();const own=controller,signal=own.signal;
        host.setAttribute('aria-busy','true');status.dataset.state='loading';status.textContent='Проверяю рельеф на всём участке 0–30 км…';
        try {
          const samples=await profile(context,30,signal,(done,total)=>{
            if(!signal.aborted)status.textContent=`Проверка 0–30 км: загружаю рельеф, ${done} из ${total} участков…`;
          });
          assertLive(signal);if(!host.isConnected)return;
          if(samples[0]?.distance!==0||samples.at(-1)?.distance!==30000)throw new Error('TERRAIN_INCOMPLETE');
          result=M.analyze(samples,context.elevation,h);
          showRange();
        } catch(error) {
          if(!signal.aborted){result=null;graphValues=[];status.dataset.state='unavailable';status.textContent=message(error);plot.hidden=true;warning.hidden=true;}
          own.abort();
        } finally {if(controller===own){controller=null;host.removeAttribute('aria-busy');}}
      }
      function toggle(){
        if(details.open){if(result)queueDraw();else if(!controller)load();}
        else cancel();
      }
      form.addEventListener('submit',event=>{event.preventDefault();load();});
      height.addEventListener('input',()=>{cancel();result=null;graphValues=[];plot.hidden=true;meta.textContent='';warning.hidden=true;status.dataset.state='caution';status.textContent='Высота изменена. Нажмите «Перестроить» для нового расчёта.';});
      range.addEventListener('change',()=>{
        settings.set(context.id,{...(settings.get(context.id)||saved),km:Number(range.value)});
        if(result)showRange();else if(!controller)load();
      });
      probe.addEventListener('input',()=>{inspect(Number(probe.value));queueDraw();});
      canvas.addEventListener('pointermove',event=>{
        if(!result||!graphValues.length)return;
        const rect=canvas.getBoundingClientRect(),left=rect.width<420?48:64;
        const distance=Math.max(0,Math.min(1,(event.clientX-rect.left-left)/(rect.width-left-16)))*graphValues.at(-1).distance;
        let best=0;for(let i=1;i<graphValues.length;i++)if(Math.abs(graphValues[i].distance-distance)<Math.abs(graphValues[best].distance-distance))best=i;
        inspect(best);queueDraw();
      });
      details.addEventListener('toggle',toggle);
      const observer=new ResizeObserver(queueDraw);observer.observe(canvas);
      const theme=new MutationObserver(queueDraw);theme.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
      mounted.push({destroy(){destroyed=true;cancel();observer.disconnect();theme.disconnect();cancelAnimationFrame(drawFrame);details.removeEventListener('toggle',toggle);}});
      if(details.open)load();
    }
  }
  window.TerrainProfile=Object.freeze({attach,rayLabelAnchor});
})();
