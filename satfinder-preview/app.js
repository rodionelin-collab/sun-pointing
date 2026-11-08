/* Satellite coverage map. Calculations run in the browser. */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  // One asset, size and tip anchor shared by every map provider.
  window.LOCATION_PIN = {
    url:new URL('assets/location-pin.svg?v=20260923',document.baseURI).href,
    size:[28,36],anchor:[14,35]
  };
  // Midpoint by visible screen-space arc length, not by geographic endpoints.
  window.visibleDirectionMidpoint = (points,width,height) => {
    const pieces=[];
    let total=0;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],dx=b.x-a.x,dy=b.y-a.y;
      let low=0,high=1,valid=true;
      for(const [p,q] of [[-dx,a.x],[dx,width-a.x],[-dy,a.y],[dy,height-a.y]]){
        if(Math.abs(p)<1e-9){if(q<0){valid=false;break;}continue;}
        const ratio=q/p;
        if(p<0)low=Math.max(low,ratio);else high=Math.min(high,ratio);
        if(low>high){valid=false;break;}
      }
      if(!valid)continue;
      const from={x:a.x+low*dx,y:a.y+low*dy},to={x:a.x+high*dx,y:a.y+high*dy};
      const length=Math.hypot(to.x-from.x,to.y-from.y);
      if(length>1e-6){pieces.push({from,to,length});total+=length;}
    }
    let distance=total/2;
    for(const piece of pieces){
      if(distance<=piece.length){
        const t=distance/piece.length;
        return {x:piece.from.x+t*(piece.to.x-piece.from.x),y:piece.from.y+t*(piece.to.y-piece.from.y)};
      }
      distance-=piece.length;
    }
    return null;
  };
  // The geographic dot never moves. Only the caption can follow the visible line.
  window.positionSatelliteLabel = (element, container, points=[]) => {
    const label=element?.querySelector('.satellite-endpoint-label');
    if(!label||!container)return;
    const dot=element.getBoundingClientRect(), bounds=container.getBoundingClientRect();
    if(!bounds.width||!bounds.height)return;
    const end=points[points.length-1]||{x:dot.left-bounds.left,y:dot.top-bounds.top};
    const visible=end.x>=0&&end.x<=bounds.width&&end.y>=0&&end.y<=bounds.height;
    element.querySelector('.satellite-endpoint-dot').style.display=visible?'':'none';
    label.style.display='';
    if(!visible){
      const middle=window.visibleDirectionMidpoint(points,bounds.width,bounds.height);
      element.dataset.labelMode=middle?'line':'hidden';
      if(!middle){label.style.display='none';return;}
      // Clamp only the caption box at the edge, retaining its midpoint anchor.
      const halfWidth=label.offsetWidth/2,halfHeight=label.offsetHeight/2;
      const x=Math.max(halfWidth+8,Math.min(bounds.width-halfWidth-8,middle.x));
      const y=Math.max(halfHeight+8,Math.min(bounds.height-halfHeight-40,middle.y));
      label.style.left=`${x-end.x}px`;label.style.right='auto';
      label.style.top=`${y-end.y}px`;
      label.dataset.baseTop=label.style.top;
      label.style.transform='translate(-50%,-50%)';
      return;
    }
    element.dataset.labelMode='endpoint';
    label.style.transform='translateY(-50%)';
    const flip=dot.left+10+label.offsetWidth>bounds.right-8;
    label.style.left=flip?'auto':'10px';
    label.style.right=flip?'10px':'auto';
    let y=0;
    if(dot.top>=bounds.top&&dot.top<=bounds.bottom){
      const half=label.offsetHeight/2;
      y=Math.max(bounds.top+8+half-dot.top,Math.min(0,bounds.bottom-40-half-dot.top));
    }
    label.style.top=`${Math.round(y)}px`;
    label.dataset.baseTop=label.style.top;
  };
  window.createSatelliteLabel = direction => {
    const shortNames={
      '422':'Я-401','423':'Я-300К','express103-ku':'Э-103',
      '1221':'Э-АМУ7','426':'Я-601','425':'Э-АМ5'
    };
    const element=document.createElement('div');
    element.className='satellite-endpoint';
    element.dataset.satellite=direction.id;
    element.style.setProperty('--direction-color',direction.color);
    const dot=document.createElement('i');
    dot.className='satellite-endpoint-dot';dot.setAttribute('aria-hidden','true');
    const label=document.createElement('span');
    label.className='satellite-endpoint-label';
    label.setAttribute('aria-label',direction.name);
    const fullName=document.createElement('span');
    fullName.className='satellite-name-full';fullName.textContent=direction.name;
    const shortName=document.createElement('span');
    shortName.className='satellite-name-short';shortName.textContent=shortNames[direction.id]||direction.name;
    label.append(fullName,shortName);
    element.append(dot,label);
    return element;
  };
  // Keep geographic dots fixed; only separate nearby captions in screen space.
  window.arrangeSatelliteLabels = (elements,container) => {
    const bounds=container.getBoundingClientRect(),placed=[];
    const pin=container.querySelector('img.location-pin,img[src*="location-pin.svg"],[style*="location-pin.svg"]');
    if(pin){
      const box=pin.getBoundingClientRect();
      if(box.width&&box.height)placed.push({left:box.left-5,right:box.right+5,top:box.top-5,bottom:box.bottom+5});
    }
    for(const element of elements){
      const label=element?.querySelector('.satellite-endpoint-label');
      if(!label||element.dataset.labelMode==='hidden')continue;
      const base=parseFloat(label.dataset.baseTop)||0;
      label.style.top=`${base}px`;
      const box=label.getBoundingClientRect();
      if(!box.width||!box.height)continue;
      const step=box.height+5;
      let best=0,bestScore=Infinity;
      for(const multiple of [0,-1,1,-2,2,-3,3,-4,4,-5,5]){
        const dy=multiple*step,top=box.top+dy,bottom=box.bottom+dy;
        if(top<bounds.top+6||bottom>bounds.bottom-36)continue;
        const score=placed.reduce((sum,p)=>sum+
          Math.max(0,Math.min(box.right,p.right)-Math.max(box.left,p.left)+4)*
          Math.max(0,Math.min(bottom,p.bottom)-Math.max(top,p.top)+4),0);
        if(score<bestScore){bestScore=score;best=dy;}
        if(!score)break;
      }
      label.style.top=`${base+best}px`;
      placed.push({left:box.left,right:box.right,top:box.top+best,bottom:box.bottom+best});
    }
  };
  if (!window.LOCAL_DATA || !window.L) {
    $('map-status').textContent = 'Не удалось загрузить данные карты. Проверьте соединение и обновите страницу.';
    return;
  }
  // A single allowlist governs filters, contours, cards, exports and URL state.
  const visibleSatelliteNames = {
    '422':'Ямал-401 (Ku)',
    '423':'Ямал-300К (Ku)',
    '425':'Экспресс-АМ5 (Ka)',
    '426':'Ямал-601 (Ka)',
    '1221':'Экспресс-АМУ7 (Ku)',
    'express103-ku':'Экспресс-103 (Ku)'
  };
  // Explicit order: integer-like object keys are otherwise sorted numerically.
  const visibleSatelliteIds = ['422','423','express103-ku','1221','426','425'];
  const directionColors = {
    '422':'#ffff00','423':'#ff9d00','express103-ku':'#00d9ff',
    '1221':'#ff5ca8','426':'#75ed54','425':'#bf97ff'
  };
  const source = window.LOCAL_DATA;
  const data = {
    ...source,
    satellites: Object.fromEntries(visibleSatelliteIds.filter(id=>source.satellites[id]).map(id=>[
      id,{...source.satellites[id],name:visibleSatelliteNames[id]}
    ])),
    beams: source.beams.filter(beam=>visibleSatelliteIds.includes(beam.satellite))
  };
  const satellites = visibleSatelliteIds.map(id=>data.satellites[id]).filter(Boolean);
  const selected = new Set();
  const RAD = Math.PI / 180;
  const n = value => Number(String(value).trim().replace(',', '.'));
  const normLon = lon => ((lon + 180) % 360 + 360) % 360 - 180;
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let point = [52.254735, 104.242159], rows = [], rasterMode = null, esriType = 'satellite', tileWarning = false;
  let exporting=false, excelLibrary=null;
  let activeProvider = null, providerRequest = 0;
  // null: fresh/manual selection; -1: hidden; 'all': final all step; 0..N-1: one.
  let pinCycleIndex = null, restoreAfterReset = false, pinDragUntil = 0;
  const yandex = new window.YandexCoverageLayer('yandex-map', (lat,lon) => setPoint(lat,lon,false), cyclePinSelection);
  const google = new window.GoogleCoverageLayer('google-map', (lat,lon) => setPoint(lat,lon,false), () => {
    if(activeProvider==='google'){
      setMode('esri');
      showProviderError('google');
    }
  }, cyclePinSelection);
  const providers={yandex,google};
  const providerNames={yandex:'Яндекс.Карты',google:'Google.Карты'};
  const qs = new URLSearchParams(location.search);
  const initialLat = n(qs.get('lat')), initialLng = n(qs.get('lng'));
  if (qs.has('lat') && qs.has('lng') && Number.isFinite(initialLat) && Number.isFinite(initialLng) && Math.abs(initialLat)<=90 && Math.abs(initialLng)<=180) point = [initialLat,initialLng];
  (qs.get('satellite') || '').split(',').forEach(id => { if(data.satellites[id]) selected.add(id); });
  const map = L.map('map', {worldCopyJump:false, minZoom:2, maxZoom:17, zoomControl:true, attributionControl:true}).setView([Math.max(-85,Math.min(85,point[0])),point[1]],2);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  // Raster providers are lazy: creating a layer makes no requests until selected.
  map.createPane('referenceLabels');
  map.getPane('referenceLabels').style.zIndex='450';
  map.getPane('referenceLabels').style.pointerEvents='none';
  const tileOptions={maxZoom:17,updateWhenIdle:true,keepBuffer:1};
  const esriURL=name=>`https://server.arcgisonline.com/ArcGIS/rest/services/${name}/MapServer/tile/{z}/{y}/{x}`;
  const imagery=L.tileLayer(esriURL('World_Imagery'),{...tileOptions,attribution:'Imagery © <a href="https://goto.arcgisonline.com/maps/World_Imagery" target="_blank" rel="noopener">Esri</a>, Vantor, Earthstar Geographics, GIS User Community'});
  const labels=L.tileLayer(esriURL('Reference/World_Boundaries_and_Places'),{...tileOptions,maxNativeZoom:16,pane:'referenceLabels',attribution:'Labels © Esri, HERE, Garmin, FAO, NOAA, USGS, OpenStreetMap contributors'});
  const roads=L.tileLayer(esriURL('Reference/World_Transportation'),{...tileOptions,pane:'referenceLabels'});
  const topographic=L.tileLayer(esriURL('World_Topo_Map'),{...tileOptions,attribution:'Tiles © <a href="https://goto.arcgisonline.com/maps/World_Topo_Map" target="_blank" rel="noopener">Esri</a>, USGS, EPA, NPS, FAO, NRCAN, GeoBase, Agriculture and Agri-Food Canada, Garmin, HERE, GIS User Community · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'});
  const opentopo=L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',{...tileOptions,subdomains:'abc',maxNativeZoom:17,attribution:'Данные © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>, <a href="https://viewfinderpanoramas.org/" target="_blank" rel="noopener">SRTM</a> · Картография © <a href="https://opentopomap.org/" target="_blank" rel="noopener">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener">CC BY-SA</a>)'});
  const rasterLayers=[imagery,labels,roads,topographic,opentopo];
  const esriTypeNames={satellite:'Спутник',hybrid:'Гибрид',topographic:'Топографическая'};
  function rasterName(){return rasterMode==='esri'?`Карты.Ersi · ${esriTypeNames[esriType]}`:rasterMode==='opentopo'?'Топокарта · OpenTopoMap':'Загрузка основы карты';}
  function clearRaster(){rasterLayers.forEach(layer=>map.removeLayer(layer));}
  rasterLayers.forEach(layer=>layer.on('tileerror',()=>{
    if(!activeProvider&&map.hasLayer(layer)&&!tileWarning){
      tileWarning=true;
      $('map-status').textContent=`${rasterName()}: часть карты не загрузилась. Попробуйте другой масштаб или другую основу карты.`;
    }
  }));
  const polygons = L.layerGroup().addTo(map);
  const directions = L.layerGroup().addTo(map);
  let directionMarkers=[];
  const positionDirectionLabel=()=>{
    directionMarkers.forEach(({marker,path})=>{
      window.positionSatelliteLabel(marker.getElement(),$('map'),path.map(p=>map.latLngToContainerPoint(p)));
    });
    window.arrangeSatelliteLabels(directionMarkers.map(({marker})=>marker.getElement()),$('map'));
  };
  map.on('move moveend zoomend resize',positionDirectionLabel);
  const marker = L.marker(point,{draggable:true,keyboard:true,bubblingMouseEvents:false,title:'Нажмите для переключения спутников. Перетащите для выбора точки.',icon:L.icon({className:'location-pin',iconUrl:window.LOCATION_PIN.url,iconSize:window.LOCATION_PIN.size,iconAnchor:window.LOCATION_PIN.anchor})}).addTo(map);
  L.control.scale({imperial:false,position:'bottomleft'}).addTo(map);
  // Unwrap longitude around each satellite so a dateline-crossing footprint is continuous.
  const beams = data.beams.map(b=>{
    let previous = n(data.satellites[b.satellite].degree);
    const points = b.points.map(([lat,lon])=>{
      while(lon-previous>180)lon-=360;
      while(lon-previous< -180)lon+=360;
      previous=lon;
      return [lat,lon];
    });
    return {...b,points,center:points.reduce((s,p)=>s+p[1],0)/points.length};
  });
  function inside(p,beam){
    let x=p[1], y=p[0], hit=false;
    while(x-beam.center>180)x-=360;
    while(x-beam.center< -180)x+=360;
    const ring=beam.points;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const [yi,xi]=ring[i],[yj,xj]=ring[j];
      const cross=(x-xi)*(yj-yi)-(y-yi)*(xj-xi);
      if(Math.abs(cross)<1e-8 && x>=Math.min(xi,xj)-1e-9 && x<=Math.max(xi,xj)+1e-9 && y>=Math.min(yi,yj)-1e-9 && y<=Math.max(yi,yj)+1e-9)return true;
      if((yi>y)!==(yj>y) && x<(xj-xi)*(y-yi)/(yj-yi)+xi)hit=!hit;
    }
    return hit;
  }
  function calculate(satellite){
    const phi=point[0]*RAD, delta=normLon(n(satellite.degree)-point[1])*RAD;
    const cosine=Math.cos(phi)*Math.cos(delta);
    const elevation=Math.atan2(cosine-.1513,Math.sqrt(Math.max(0,1-cosine*cosine)))/RAD;
    const azimuth=(Math.atan2(Math.sin(delta),-Math.sin(phi)*Math.cos(delta))/RAD+360)%360;
    const polarity=Math.atan(Math.sin(-delta)/Math.tan(phi))/RAD;
    const distance=Math.trunc(6378.16*Math.sqrt((42164/6378)**2+1-2*(42164/6378)*cosine));
    const undefinedAzimuth=Math.abs(Math.sin(delta))+Math.abs(Math.sin(phi)*Math.cos(delta))<1e-10 || Math.abs(point[0])===90;
    return {elevation,azimuth:undefinedAzimuth?null:azimuth,polarity:Number.isFinite(polarity)?polarity:null,distance};
  }
  function diameter(beam,elevation){
    const options=data.diapasons[beam.diapason]?.possibility||[];
    const valid=options.filter(a=>n(a.degree_from)<=elevation&&elevation<=n(a.degree_to)).map(a=>n(a.diametr));
    return valid.length?Math.min(...valid):null;
  }
  const degrees = value => value===null?'Не определён':`${value.toFixed(2)}°`;
  const polarity = (beam,c) => beam.polarity && ['1216','190','1349','1350','1398'].includes(beam.diapason) ? beam.polarity : degrees(c.polarity);
  let converterValue=null, converterErrorTimer=null;
  function updateConverter(showError=false){
    clearTimeout(converterErrorTimer);
    converterValue=null;
    $('converter-error').textContent='';
    $('converter-status').textContent='';
    $('coordinate-input').setAttribute('aria-invalid','false');
    $('coordinate-output').textContent='';
    try{
      converterValue=window.CoordinateConverter.convert($('coordinate-input').value);
      $('coordinate-output').textContent=converterValue.text;
    }catch(error){
      if(showError){
        $('converter-error').textContent=error.message;
        $('coordinate-input').setAttribute('aria-invalid','true');
      }
    }
    document.querySelector('[data-copy-source="coordinate-output"]').disabled=!converterValue;
    return converterValue;
  }
  let copyStatusTimer=null,copyRequest=0;
  function legacyCopy(text){
    const previous=document.activeElement,field=document.createElement('textarea');
    field.value=text;field.readOnly=true;
    field.style.cssText='position:fixed;left:0;top:0;opacity:0;pointer-events:none';
    document.body.append(field);
    let copied=false;
    try{field.focus({preventScroll:true});field.select();copied=document.execCommand('copy');}
    catch{/* Clipboard may be blocked by browser permissions. */}
    finally{field.remove();previous?.focus({preventScroll:true});}
    return copied;
  }
  async function copyCoordinates(button){
    const text=$(button.dataset.copySource)?.textContent.trim();
    if(!text)return;
    const request=++copyRequest;
    clearTimeout(copyStatusTimer);
    $('coordinate-copy-status').textContent='';
    let copied=false;
    try{
      if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);copied=true;}
    }catch{/* Try the selection-based fallback for restricted previews. */}
    if(!copied)copied=legacyCopy(text);
    if(request!==copyRequest)return;
    $('coordinate-copy-status').textContent=copied?'Скопировано':'Не удалось скопировать. Выделите координаты и скопируйте вручную.';
    copyStatusTimer=setTimeout(()=>$('coordinate-copy-status').textContent='',copied?2200:6000);
  }
  document.querySelectorAll('.coordinate-copy').forEach(button=>{
    button.addEventListener('click',()=>copyCoordinates(button));
  });
  function setInstallationVisible(visible){
    const view=currentView();
    document.querySelector('.workspace-grid').classList.toggle('compact-panel',!visible);
    $('installation-panel').hidden=!visible;
    $('installation-toggle').setAttribute('aria-expanded',String(visible));
    $('installation-toggle').textContent=visible?'Скрыть ввод':'Показать ввод';
    $('installation-toggle').title=visible?'Скрыть панель «Точка установки» и расширить карту':'Показать панель «Точка установки»';
    // Resize without recalculating selections, moving the pin or resetting zoom.
    map.invalidateSize({pan:false});
    if(activeProvider)providers[activeProvider].show(view.center,view.zoom);
    else map.setView(view.center,view.zoom,{animate:false});
    positionDirectionLabel();
  }
  $('installation-toggle').addEventListener('click',()=>{
    setInstallationVisible($('installation-panel').hidden);
  });
  $('coordinate-focus-link').addEventListener('click',event=>{
    event.preventDefault();
    if($('installation-panel').hidden)setInstallationVisible(true);
    const input=$('coordinate-input');
    input.focus({preventScroll:true});
    input.setSelectionRange(input.value.length,input.value.length);
    input.scrollIntoView({block:'center',behavior:'instant'});
  });
  $('coordinate-input').addEventListener('input',()=>{
    updateConverter();
    if(!converterValue&&$('coordinate-input').value.trim()){
      converterErrorTimer=setTimeout(()=>updateConverter(true),650);
    }
  });
  $('coordinate-input').addEventListener('keydown',event=>{
    if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){
      event.preventDefault();$('coordinate-converter').requestSubmit();
    }
  });
  $('coordinate-converter').addEventListener('submit',event=>{
    event.preventDefault();
    const result=updateConverter(true);
    if(!result)return;
    setPoint(result.latitude,result.longitude,true);
    $('converter-status').textContent='Точка на карте обновлена.';
  });
  function setPoint(lat,lon,pan,autoSelect=true){
    point=[Number(lat.toFixed(6)),Number(normLon(lon).toFixed(6))];
    const displayLon=point[1]+360*Math.round((map.getCenter().lng-point[1])/360);
    marker.setLatLng([point[0],displayLon]);
    $('coordinate-input').value=`${point[0].toFixed(6)}, ${point[1].toFixed(6)}`;
    updateConverter();
    $('point-label').textContent=`${Math.abs(point[0]).toFixed(6)}° ${point[0]>=0?'N':'S'}, ${Math.abs(point[1]).toFixed(6)}° ${point[1]>=0?'E':'W'}`;
    $('point-dms').textContent=window.CoordinateConverter.formatDMS(...point);
    if(pan)map.panTo([Math.max(-85,Math.min(85,point[0])),displayLon]);
    if(pan&&activeProvider)providers[activeProvider].panTo(point);
    if(autoSelect)selectAvailableAtPoint();
    render();
  }
  function stateURL(){
    try{
      const url=new URL(location.href);
      url.searchParams.set('lat',point[0].toFixed(6));url.searchParams.set('lng',point[1].toFixed(6));
      // An explicit empty value means no beams, not the default automatic selection.
      url.searchParams.set('satellite',[...selected].join(','));
      history.replaceState(null,'',url);
    }catch{/* file:// and sandboxed previews may not allow history changes */}
  }
  function greatCircle(endLon){
    const phi=point[0]*RAD,lam=point[1]*RAD,delta=normLon(endLon-point[1])*RAD;
    const end=(point[1]*RAD)+delta;
    const a=[Math.cos(phi)*Math.cos(lam),Math.cos(phi)*Math.sin(lam),Math.sin(phi)];
    const b=[Math.cos(end),Math.sin(end),0];
    const omega=Math.acos(Math.max(-1,Math.min(1,a.reduce((s,v,i)=>s+v*b[i],0))));
    if(Math.abs(Math.sin(omega))<1e-8)return [point,[0,point[1]+delta/RAD]];
    let previous=point[1];
    return Array.from({length:51},(_,i)=>{
      const t=i/50, k1=Math.sin((1-t)*omega)/Math.sin(omega),k2=Math.sin(t*omega)/Math.sin(omega);
      const v=a.map((v,j)=>v*k1+b[j]*k2);
      let lon=Math.atan2(v[1],v[0])/RAD;
      while(lon-previous>180)lon-=360;while(lon-previous< -180)lon+=360;previous=lon;
      return [Math.atan2(v[2],Math.hypot(v[0],v[1]))/RAD,lon];
    });
  }
  function beamsAtPoint(){
    return beams.filter(b=>inside(point,b)&&calculate(data.satellites[b.satellite]).elevation>0);
  }
  // 85% transparency means 15% opacity, shared by all four map providers.
  const beamFillOpacity=.15;
  function render(){
    polygons.clearLayers();directions.clearLayers();
    directionMarkers=[];
    const pointMatches=beamsAtPoint();
    const matching=pointMatches.filter(b=>selected.has(b.satellite));
    const visible=$('all-coverage').checked?beams:matching;
    visible.forEach(b=>{
      const offset=360*Math.round((marker.getLatLng().lng-b.center)/360);
      L.polygon(b.points.map(([lat,lon])=>[lat,lon+offset]),{color:b.color,weight:2,opacity:.8,fillOpacity:beamFillOpacity,bubblingMouseEvents:true})
        .addTo(polygons);
    });
    rows=[];
    for(const s of satellites){
      const c=calculate(s);
      const matches=matching.filter(b=>b.satellite===s.id);
      if(!matches.length)continue;
      matches.sort((a,b)=>(diameter(a,c.elevation)??Infinity)-(diameter(b,c.elevation)??Infinity)||n(b.signal)-n(a.signal));
      rows.push({satellite:s,calc:c,beam:matches[0],matches,diameter:diameter(matches[0],c.elevation)});
    }
    rows.sort((a,b)=>b.calc.elevation-a.calc.elevation);
    const directionIds=new Set(($('all-coverage').checked?pointMatches:matching).map(beam=>beam.satellite));
    const satelliteDirections=satellites.filter(s=>directionIds.has(s.id)).map(s=>({
      id:s.id,name:s.name.replace(/\s*\([^)]*\)\s*$/,'').trim(),
      color:directionColors[s.id],line:greatCircle(n(s.degree))
    }));
    satelliteDirections.forEach(direction=>{
      const offset=marker.getLatLng().lng-point[1];
      const path=direction.line.map(([lat,lon])=>[lat,lon+offset]);
      L.polyline(path,{color:direction.color,weight:1,opacity:1,dashArray:'7 6',interactive:false}).addTo(directions);
      const directionMarker=L.marker(path[path.length-1],{
        interactive:false,keyboard:false,zIndexOffset:800,
        icon:L.divIcon({
          className:'satellite-endpoint',iconSize:[0,0],iconAnchor:[0,0],
          html:window.createSatelliteLabel(direction).innerHTML
        })
      }).addTo(directions);
      const element=directionMarker.getElement();
      element.dataset.satellite=direction.id;
      element.style.setProperty('--direction-color',direction.color);
      directionMarkers.push({marker:directionMarker,path});
    });
    positionDirectionLabel();
    if(activeProvider)providers[activeProvider].render(point,visible.map(b=>({
      points:b.points,
      color:b.color,opacity:beamFillOpacity
    })),satelliteDirections);
    $('filter-count').textContent=`Выбрано: ${selected.size} из ${satellites.length}`;
    $('result-count').textContent=`- ${rows.length} шт.`;
    $('export-button').disabled=exporting||!rows.length;
    $('export-button').style.opacity=$('export-button').disabled?'.45':'1';
    if(!tileWarning)$('map-status').textContent=`${activeProvider?providerNames[activeProvider]:rasterName()} · Показано контуров: ${visible.length} · Нажмите на карту, чтобы переместить точку`;
    const emptyTitle=!selected.size&&pointMatches.length
      ?($('all-coverage').checked?'Спутники для расчёта не выбраны':'Отображение лучей выключено')
      :'В этой точке покрытие не найдено';
    const emptyText=pointMatches.length
      ?'Включите нужные спутники галочками. После расчёта координат или перемещения пина доступные спутники будут выбраны автоматически.'
      :'В сохранённых контурах нет подходящих спутников для этой точки. Проверьте координаты или выберите другое место. Отсутствие контура в этом наборе данных не означает отсутствия спутниковой связи.';
    const openDetails=new Set([...$('results').querySelectorAll('.card-details[open]')].map(el=>el.dataset.satellite));
    $('results').innerHTML=rows.length?rows.map(renderCard).join(''):`<div class="empty-state"><h3>${emptyTitle}</h3><p>${emptyText}</p></div>`;
    $('results').querySelectorAll('.card-details').forEach(el=>{el.open=openDetails.has(el.dataset.satellite);});
    window.TerrainProfile.attach($('results'),rows.map(r=>({
      id:r.satellite.id,name:r.satellite.name,point:[...point],
      azimuth:r.calc.azimuth,elevation:r.calc.elevation,
      color:directionColors[r.satellite.id]||'#5040b5'
    })));
    stateURL();
  }
  function renderCard({satellite:s,calc:c,beam:b,diameter:d}){
    const detail=(label,value)=>`<div class="detail-row"><span>${label}</span><span>${escape(value)}</span></div>`;
    const degree=n(s.degree),displayLon=degree>180?`${degree}° в.д. (${360-degree}° з.д.)`:`${degree}° в.д.`;
    return `<article class="result-card">
      <div class="card-top">
        <div><span class="metric-label">Спутник</span><h3 class="sat-title">${escape(s.name)}</h3></div>
        <div><span class="metric-label">Угол места</span><span class="metric-value">${degrees(c.elevation)}</span></div>
        <div><span class="metric-label">Поляризация</span><span class="metric-value polarization">${escape(polarity(b,c))}</span></div>
        <div><span class="metric-label">Азимут</span><span class="metric-value">${degrees(c.azimuth)}</span></div>
        <div><span class="metric-label">Луч</span><span class="metric-value beam-name">${escape(b.name)}</span></div>
      </div>
      <a class="card-aim" href="pointing/?lat=${point[0].toFixed(5)}&lon=${point[1].toFixed(5)}&satLon=${encodeURIComponent(s.degree)}&sat=${encodeURIComponent(s.name)}">Как навести антенну: по солнцу, по компасу, видео для клиента →</a>
      <details class="card-details" data-satellite="${escape(s.id)}"><summary>Параметры</summary>
        <div class="details-grid">
          ${detail('Точка стояния',displayLon)}${detail('Расстояние',`${c.distance.toLocaleString('ru-RU')} км`)}
          ${detail('Широта',`${point[0].toFixed(6)}°`)}${detail('Долгота',`${point[1].toFixed(6)}°`)}
          ${detail('Рекомендованный диаметр антенны',d===null?'Уточняется у оператора':`${d} м`)}
          ${s.id==='423'?`${detail('Диапазон','Ku')}${detail('Поляризация луча','Линейная вертикальная')}${detail('Обозначение у владельца','Северный луч 1')}${detail('Транспондеры луча','6 × 72 МГц')}`:''}
          ${s.id==='express103-ku'?`${detail('Диапазон','Ku')}${detail('Поляризация луча','Горизонтальная')}`:''}
        </div>
        <section class="terrain-profile" aria-label="Профиль рельефа в направлении на спутник"></section>
      </details>
    </article>`;
  }
  $('satellite-filters').innerHTML=satellites.map(s=>{
    const color=beams.find(b=>b.satellite===s.id)?.color||'#666';
    const shortName=s.name.replace(/\s*\([^)]*\)/g,'').trim().replace(/^Экспресс-/,'Э-').replace(/^Ямал-/,'Я-');
    return `<label class="satellite-label" title="${escape(s.name)}" style="--sat-color:${escape(color)}"><input type="checkbox" aria-label="${escape(s.name)}" value="${s.id}" ${selected.has(s.id)?'checked':''}><span class="sat-dot"></span><span class="filter-name-full">${escape(s.name)}</span><span class="filter-name-short" aria-hidden="true">${escape(shortName)}</span></label>`;
  }).join('');
  $('satellite-filters').addEventListener('change',event=>{
    const el=event.target;if(el.tagName!=='INPUT')return;
    pinCycleIndex=null;restoreAfterReset=false;
    el.checked?selected.add(el.value):selected.delete(el.value);render();
  });
  function rankedAvailableAtPoint(){
    const ids=new Set(beamsAtPoint().map(beam=>beam.satellite));
    return satellites.filter(s=>ids.has(s.id))
      .sort((a,b)=>calculate(b).elevation-calculate(a).elevation);
  }
  function applySatelliteSelection(ids){
    selected.clear();
    ids.forEach(id=>selected.add(id));
    document.querySelectorAll('#satellite-filters input').forEach(el=>el.checked=selected.has(el.value));
    $('all-coverage').checked=false;
  }
  function selectAvailableAtPoint(){
    pinCycleIndex=null;restoreAfterReset=false;
    applySatelliteSelection(rankedAvailableAtPoint().map(s=>s.id));
  }
  function cyclePinSelection(){
    if(performance.now()<pinDragUntil)return;
    const available=rankedAvailableAtPoint();
    if(restoreAfterReset){
      selectAvailableAtPoint();
      pinCycleIndex='all';
    }else if(!available.length){
      pinCycleIndex=null;
      applySatelliteSelection([]);
    }else if(pinCycleIndex==='all'){
      pinCycleIndex=-1;
      applySatelliteSelection([]);
    }else if(pinCycleIndex===null||pinCycleIndex===-1){
      pinCycleIndex=0;
      applySatelliteSelection([available[0].id]);
    }else if(pinCycleIndex<available.length-1){
      pinCycleIndex++;
      applySatelliteSelection([available[pinCycleIndex].id]);
    }else{
      selectAvailableAtPoint();
      pinCycleIndex='all';
    }
    render();
  }
  $('reset-filter').addEventListener('click',()=>{
    pinCycleIndex=null;restoreAfterReset=true;
    applySatelliteSelection([]);
    render();
  });
  map.on('click',event=>setPoint(event.latlng.lat,event.latlng.lng,false));
  marker.on('click',event=>{
    if(event.originalEvent)L.DomEvent.stopPropagation(event.originalEvent);
    cyclePinSelection();
  });
  marker.on('dragend',()=>{
    pinDragUntil=performance.now()+250;
    const p=marker.getLatLng();setPoint(Math.max(-90,Math.min(90,p.lat)),p.lng,false);
  });
  $('all-coverage').addEventListener('change',()=>{
    pinCycleIndex=null;restoreAfterReset=false;render();
  });
  $('fit-button').addEventListener('click',()=>{
    if(activeProvider){
      providers[activeProvider].panTo(point);
      return;
    }
    map.panTo(marker.getLatLng());
  });
  function setMode(mode){
    providerRequest++;
    $('provider-message').hidden=true;
    const view=currentView();
    activeProvider=null;
    for(const id of Object.keys(providers)){
      $(`${id}-button`).removeAttribute('aria-busy');
      $(`${id}-button`).textContent=providerNames[id];
      $(`${id}-button`).setAttribute('aria-pressed','false');
      $(`${id}-map`).hidden=true;
      $(`${id}-map`).classList.remove('provider-loading');
    }
    $('google-types').hidden=true;
    $('yandex-types').hidden=true;
    $('esri-types').hidden=mode!=='esri';
    clearRaster();
    $('map').hidden=false;
    map.invalidateSize({pan:false});
    map.setView(view.center,Math.min(17,view.zoom),{animate:false});
    rasterMode=mode;tileWarning=false;
    if(mode==='esri'){
      if(esriType==='topographic')topographic.addTo(map);
      else{
        imagery.addTo(map);
        if(esriType==='hybrid'){roads.addTo(map);labels.addTo(map);}
      }
    }else if(mode==='opentopo')opentopo.addTo(map);
    for(const id of ['esri','opentopo'])$(`${id}-button`).setAttribute('aria-pressed',String(mode===id));
    render();
  }
  $('esri-button').addEventListener('click',()=>setMode('esri'));
  $('opentopo-button').addEventListener('click',()=>setMode('opentopo'));
  $('esri-types').addEventListener('click',event=>{
    const button=event.target.closest('[data-esri-type]');
    if(!button||!Object.hasOwn(esriTypeNames,button.dataset.esriType))return;
    esriType=button.dataset.esriType;
    $('esri-types').querySelectorAll('button').forEach(el=>el.setAttribute('aria-pressed',String(el===button)));
    setMode('esri');
  });
  function currentView(){
    if(activeProvider)return providers[activeProvider].getView();
    const center=map.getCenter();
    return {center:[center.lat,center.lng],zoom:map.getZoom()};
  }
  function showProviderError(id){
    $('provider-message').hidden=false;
    if(!window.MapProviderConfig.hasKey(id)){
      $('provider-message').textContent=`Для ${providerNames[id]} не настроен ключ API. Можно использовать Карты.Ersi или Топокарту.`;
      return;
    }
    $('provider-message').textContent=`${providerNames[id]} не загрузились. Проверьте доступность API, разрешённый домен${id==='google'?' и биллинг Google Cloud':', подключение ключа'}. Остальные подложки продолжают работать.`;
  }
  async function setProviderMode(id){
    if(activeProvider===id||$(`${id}-button`).getAttribute('aria-busy')==='true')return;
    const request=++providerRequest;
    const view=currentView();
    for(const other of Object.keys(providers)){
      $(`${other}-button`).removeAttribute('aria-busy');
      $(`${other}-button`).textContent=providerNames[other];
      if(other!==activeProvider){
        $(`${other}-map`).hidden=true;
        $(`${other}-map`).classList.remove('provider-loading');
      }
    }
    $('provider-message').hidden=false;
    $('provider-message').textContent=`Загружаю ${providerNames[id]}…`;
    $(`${id}-button`).setAttribute('aria-busy','true');
    $(`${id}-button`).textContent=`${id==='google'?'Google':'Яндекс'} · загрузка…`;
    // The provider container must have nonzero dimensions during initialization.
    $(`${id}-map`).classList.add('provider-loading');
    $(`${id}-map`).hidden=false;
    try{
      await providers[id].ready(view.center,view.zoom);
      if(request!==providerRequest)return;
      const latestView=currentView();
      activeProvider=id;tileWarning=false;
      clearRaster();
      $('map').hidden=true;
      for(const other of Object.keys(providers)){
        $(`${other}-map`).hidden=other!==id;
        $(`${other}-map`).classList.remove('provider-loading');
        $(`${other}-button`).setAttribute('aria-pressed',String(other===id));
      }
      $('google-types').hidden=id!=='google';
      $('yandex-types').hidden=id!=='yandex';
      $('esri-types').hidden=true;
      for(const raster of ['esri','opentopo'])$(`${raster}-button`).setAttribute('aria-pressed','false');
      $('provider-message').hidden=true;
      providers[id].show(latestView.center,latestView.zoom);
      render();
    }catch{
      if(request===providerRequest){
        $(`${id}-map`).hidden=true;
        // With the offline base removed, use imagery only if no base is active.
        if(!activeProvider&&!rasterMode)setMode('esri');
        showProviderError(id);
      }
    }finally{
      if(request===providerRequest){
        $(`${id}-map`).classList.remove('provider-loading');
        $(`${id}-button`).removeAttribute('aria-busy');
        $(`${id}-button`).textContent=providerNames[id];
      }
    }
  }
  $('yandex-button').addEventListener('click',()=>setProviderMode('yandex'));
  $('google-button').addEventListener('click',()=>setProviderMode('google'));
  $('yandex-types').addEventListener('click',event=>{
    const button=event.target.closest('[data-yandex-type]');
    if(!button||!['yandex#map','yandex#satellite','yandex#hybrid'].includes(button.dataset.yandexType))return;
    yandex.setType(button.dataset.yandexType);
    $('yandex-types').querySelectorAll('button').forEach(el=>el.setAttribute('aria-pressed',String(el===button)));
  });
  $('google-types').addEventListener('click',event=>{
    const button=event.target.closest('[data-map-type]');
    if(!button)return;
    google.setType(button.dataset.mapType);
    $('google-types').querySelectorAll('button').forEach(el=>el.setAttribute('aria-pressed',String(el===button)));
  });
  function loadExcelLibrary(){
    if(window.XLSX)return Promise.resolve(window.XLSX);
    if(excelLibrary)return excelLibrary;
    excelLibrary=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      const finish=error=>{
        clearTimeout(timer);script.onload=script.onerror=null;
        if(error){script.remove();reject(error);}else resolve(window.XLSX);
      };
      const timer=setTimeout(()=>finish(new Error('EXCEL_TIMEOUT')),15000);
      script.src=new URL('vendor/xlsx.full.min.js?v=0.20.3',document.baseURI).href;
      script.onload=()=>finish(window.XLSX?null:new Error('EXCEL_UNAVAILABLE'));
      script.onerror=()=>finish(new Error('EXCEL_UNAVAILABLE'));
      document.head.appendChild(script);
    }).catch(error=>{excelLibrary=null;throw error;});
    return excelLibrary;
  }
  $('export-button').addEventListener('click',async()=>{
    if(exporting||!rows.length)return;
    const exportPoint=[...point];
    const header=['Дата снимка','Широта','Долгота','Спутник','Точка стояния °E','Угол места °','Азимут ° от истинного севера','Поляризация','Луч','Расстояние км','Рекомендованный диаметр антенны м','Диапазон','Поляризация луча','Метка контура (исходные данные)'];
    // Freeze the visible result before the optional library download.
    const lines=[header,...rows.map(r=>['2026-09-22',exportPoint[0],exportPoint[1],r.satellite.name,n(r.satellite.degree),Number(r.calc.elevation.toFixed(2)),r.calc.azimuth===null?null:Number(r.calc.azimuth.toFixed(2)),polarity(r.beam,r.calc),r.beam.name,r.calc.distance,r.diameter??'Уточняется',data.diapasons[r.beam.diapason]?.name||'',r.beam.polarity||'',r.beam.signal||''])];
    const button=$('export-button');
    exporting=true;button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='Подготовка XLS…';
    $('export-message').hidden=true;
    try{
      const XLSX=await loadExcelLibrary();
      const workbook=XLSX.utils.book_new();
      const sheet=XLSX.utils.aoa_to_sheet(lines);
      sheet['!cols']=[16,16,16,26,22,20,34,42,28,20,42,16,28,38].map(wch=>({wch}));
      for(let row=1;row<lines.length;row++){
        for(const col of [1,2])sheet[XLSX.utils.encode_cell({r:row,c:col})].z='0.000000';
        for(const col of [5,6]){
          const cell=sheet[XLSX.utils.encode_cell({r:row,c:col})];
          if(cell)cell.z='0.00';
        }
      }
      XLSX.utils.book_append_sheet(workbook,sheet,'Спутники');
      workbook.Props={Title:'Доступные спутники в выбранной точке',Subject:'Параметры наведения спутниковой антенны'};
      // BIFF8 in an OLE container is genuine Excel 97–2003, not renamed CSV/HTML.
      const bytes=XLSX.write(workbook,{bookType:'biff8',type:'array'});
      const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.ms-excel'}));
      const a=document.createElement('a');a.href=url;a.download=`satellites_${exportPoint[0].toFixed(6)}_${exportPoint[1].toFixed(6)}.xls`;
      a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
    }catch{
      $('export-message').textContent='Не удалось подготовить файл Excel. Проверьте соединение и повторите скачивание.';
      $('export-message').hidden=false;
    }finally{
      exporting=false;button.disabled=!rows.length;button.removeAttribute('aria-busy');button.textContent='Скачать XLS';
      button.style.opacity=rows.length?'1':'.45';
    }
  });
  const help=$('help-dialog');
  $('help-button').addEventListener('click',()=>help.showModal());$('about-button').addEventListener('click',()=>help.showModal());$('close-help').addEventListener('click',()=>help.close());
  help.addEventListener('click',e=>{if(e.target===help){const r=help.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)help.close();}});
  function setTheme(theme){document.documentElement.dataset.theme=theme;}
  setTheme(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');
  $('theme-button').addEventListener('click',()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
  // Plain links auto-select; explicitly shared filters (including empty) are preserved.
  setPoint(...point,false,!qs.has('satellite'));
  // Use Yandex when configured; the key-free default is Esri imagery.
  if((location.protocol==='https:' || location.protocol==='http:')&&window.MapProviderConfig.hasKey('yandex'))setProviderMode('yandex');
  else setMode('esri');
})();
