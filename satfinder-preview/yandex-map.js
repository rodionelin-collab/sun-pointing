/* Official browser API, loaded directly using a domain-restricted client key. */
'use strict';
// Cache the provider's own projection at zoom 0. Zoom/pan then require only
// scaling and translation, not rebuilding native geometry or projecting vertices.
window.YandexOverlayGeometry = Object.freeze({
  project(coordinates,projection) {
    let previous=null;
    const points=coordinates.map(coord=>{
      const pixel=projection.toGlobalPixels(coord,0);
      let x=pixel[0];
      if(previous!==null)x+=256*Math.round((previous-x)/256);
      previous=x;
      return {x,y:pixel[1]};
    });
    return {points,minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),
      minY:Math.min(...points.map(p=>p.y)),maxY:Math.max(...points.map(p=>p.y))};
  },
  copies(geometry,view) {
    const {scale,center,width,height}=view,world=256*scale;
    if(geometry.maxY*scale<center[1]-height/2-3||geometry.minY*scale>center[1]+height/2+3)return [];
    const first=Math.ceil((center[0]-width/2-3-geometry.maxX*scale)/world);
    const last=Math.floor((center[0]+width/2+3-geometry.minX*scale)/world);
    return Array.from({length:Math.max(0,last-first+1)},(_,i)=>(first+i)*world);
  },
  screenPoints(geometry,view) {
    const {scale,center,width,height}=view,world=256*scale;
    const shift=world*Math.round((center[0]-geometry.points[0].x*scale)/world);
    return geometry.points.map(p=>({x:p.x*scale+shift-center[0]+width/2,y:p.y*scale-center[1]+height/2}));
  },
  clippedSegments(geometry,view,shift) {
    // Keep canvas stroke coordinates and widths in screen pixels. Huge world
    // transforms plus sub-pixel world widths are unstable at maximum zoom.
    const {scale,center,width,height}=view,segments=[];
    const screen=p=>({x:p.x*scale+shift-center[0]+width/2,y:p.y*scale-center[1]+height/2});
    let a=screen(geometry.points[0]),travelled=0;
    for(let i=1;i<geometry.points.length;i++){
      const b=screen(geometry.points[i]),dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
      let low=0,high=1,visible=true;
      // A small gutter avoids cut-off antialiasing at the viewport edges.
      for(const [p,q] of [[-dx,a.x+8],[dx,width+8-a.x],[-dy,a.y+8],[dy,height+8-a.y]]){
        if(Math.abs(p)<1e-12){if(q<0){visible=false;break;}continue;}
        const t=q/p;
        if(p<0)low=Math.max(low,t);else high=Math.min(high,t);
        if(low>high){visible=false;break;}
      }
      if(visible&&length>0)segments.push({
        from:{x:a.x+dx*low,y:a.y+dy*low},
        to:{x:a.x+dx*high,y:a.y+dy*high},
        dashOffset:(travelled+length*low)%13
      });
      travelled=(travelled+length)%13;a=b;
    }
    return segments;
  }
});
window.YandexCoverageLayer = class {
  constructor(container, onPoint, onPinClick = () => {}) {
    this.container = container;
    this.onPoint = onPoint;
    this.onPinClick = onPinClick;
    this.pinDragUntil = 0;
    this.map = null;
    this.loading = null;
    this.pathCache = new WeakMap();
    this.contours = [];
    this.directionLabels = [];
    this.frame = null;
  }
  async ready(center, zoom) {
    if (this.map) return;
    if (this.loading) return this.loading;
    this.loading = this.initialize(center, zoom).catch(error => {
      this.loading = null;
      throw error;
    });
    return this.loading;
  }
  async initialize(center, zoom) {
    if (!window.ymaps) {
      const apiURL = window.MapProviderConfig.scriptURL('yandex');
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        let completed = false;
        const finish = (error) => {
          if (completed) return;
          completed = true;
          clearTimeout(timer);
          script.onload = script.onerror = null;
          if (error) { script.remove(); reject(error); } else resolve();
        };
        const timer = setTimeout(() => finish(new Error('YANDEX_TIMEOUT')), 20000);
        script.src = apiURL;
        script.async = true;
        script.referrerPolicy = 'strict-origin-when-cross-origin';
        script.onload = () => window.ymaps ? finish() : finish(new Error('YANDEX_UNAVAILABLE'));
        script.onerror = () => finish(new Error('YANDEX_UNAVAILABLE'));
        document.head.appendChild(script);
      });
    }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('YANDEX_TIMEOUT')), 20000);
      window.ymaps.ready(() => { clearTimeout(timer); resolve(); }, () => {
        clearTimeout(timer); reject(new Error('YANDEX_UNAVAILABLE'));
      });
    });
    const api = window.ymaps;
    this.map = new api.Map(this.container, {
      center, zoom, type: 'yandex#map',
      controls: ['zoomControl']
    }, {
      minZoom: 2, maxZoom: 17,
      suppressMapOpenBlock: true
    });
    // A single non-interactive canvas replaces native polygons/polylines.
    // Pane 250 is above area tiles but below the native pin (places: 400).
    this.coveragePane = new api.pane.StaticPane(this.map,{zIndex:250,overflow:'hidden'});
    this.map.panes.append('coverageCanvas',this.coveragePane);
    this.coveragePane.getElement().style.pointerEvents='none';
    this.canvas=document.createElement('canvas');
    this.canvas.className='yandex-coverage-canvas';
    this.canvas.setAttribute('aria-hidden','true');
    this.coveragePane.getElement().append(this.canvas);
    this.context=this.canvas.getContext('2d');
    this.map.events.add(['boundschange','actiontick','actionend'],()=>this.queueFrame());
    this.map.container.events.add('sizechange',()=>{this.labelSizeKey=null;this.queueFrame();});
    document.fonts?.ready.then(()=>{this.labelSizeKey=null;this.queueFrame();});
    this.marker = new api.Placemark(center, {hintContent: 'Нажмите для переключения спутников. Перетащите для выбора точки.'}, {
      iconLayout:'default#image',
      iconImageHref:window.LOCATION_PIN.url,
      iconImageSize:window.LOCATION_PIN.size,
      iconImageOffset:window.LOCATION_PIN.anchor.map(value=>-value),
      draggable:true
    });
    this.map.geoObjects.add(this.marker);
    const selectPoint = event => {
      const coords = event.get('coords');
      if (coords) this.onPoint(coords[0], coords[1]);
    };
    this.map.events.add('click', selectPoint);
    this.marker.events.add('click', event => {
      event.stopPropagation();
      if(performance.now()>=this.pinDragUntil)this.onPinClick();
    });
    this.marker.events.add('dragend', () => {
      this.pinDragUntil=performance.now()+250;
      const coords = this.marker.geometry.getCoordinates();
      this.onPoint(coords[0], coords[1]);
    });
  }
  show(center, zoom) {
    this.map.container.fitToViewport();
    this.map.setCenter(center, zoom, {duration: 0});
    this.queueFrame();
  }
  getView() {
    return {center: this.map.getCenter(), zoom: this.map.getZoom()};
  }
  panTo(point) {
    if (this.map) this.map.panTo(point, {duration: 150, flying: false});
  }
  setType(type) {
    if (['yandex#map','yandex#satellite','yandex#hybrid'].includes(type)) this.map?.setType(type);
  }
  preparePath(coordinates) {
    const projection=this.map.options.get('projection');
    if(this.projection!==projection){this.projection=projection;this.pathCache=new WeakMap();}
    if(this.pathCache.has(coordinates))return this.pathCache.get(coordinates);
    const geometry=window.YandexOverlayGeometry.project(coordinates,projection);
    const path=new Path2D();
    geometry.points.forEach((p,i)=>i?path.lineTo(p.x,p.y):path.moveTo(p.x,p.y));
    geometry.path=path;
    this.pathCache.set(coordinates,geometry);
    return geometry;
  }
  queueFrame() {
    if(this.frame!==null)return;
    this.frame=requestAnimationFrame(()=>{this.frame=null;this.drawFrame();});
  }
  getScreenView() {
    const container=document.getElementById(this.container);
    const width=container.clientWidth,height=container.clientHeight;
    if(!width||!height||container.hidden)return null;
    const action=this.map.action.getCurrentState();
    const zoom=action?.zoom??this.map.getZoom();
    const center=action?.globalPixelCenter??this.map.getGlobalPixelCenter();
    return {container,width,height,zoom,center,scale:2**zoom,animating:!!action?.isTicking};
  }
  drawFrame() {
    if(!this.map||!this.context)return;
    const view=this.getScreenView();
    if(!view)return;
    const {width,height,scale,center}=view,dpr=Math.min(window.devicePixelRatio||1,2),ctx=this.context;
    const w=Math.round(width*dpr),h=Math.round(height*dpr);
    if(this.canvas.width!==w||this.canvas.height!==h){
      this.canvas.width=w;this.canvas.height=h;
      this.canvas.style.width=`${width}px`;this.canvas.style.height=`${height}px`;
    }
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,w,h);
    const draw=(geometry,color,opacity,polygon)=>{
      for(const shift of window.YandexOverlayGeometry.copies(geometry,view)){
        ctx.setTransform(dpr*scale,0,0,dpr*scale,
          dpr*(shift-center[0]+width/2),dpr*(-center[1]+height/2));
        if(polygon){
          ctx.globalAlpha=opacity;ctx.fillStyle=color;ctx.fill(geometry.closedPath);
          ctx.globalAlpha=.8;ctx.strokeStyle=color;ctx.lineWidth=2/scale;ctx.setLineDash([]);
          ctx.stroke(geometry.closedPath);
        }
      }
    };
    for(const contour of this.contours){
      const geometry=this.preparePath(contour.points);
      if(!geometry.closedPath){geometry.closedPath=new Path2D(geometry.path);geometry.closedPath.closePath();}
      draw(geometry,contour.color,contour.opacity,true);
    }
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.globalAlpha=1;ctx.lineWidth=1;ctx.setLineDash([7,6]);
    for(const direction of this.directionLabels){
      const geometry=this.preparePath(direction.line);
      ctx.strokeStyle=direction.color;
      for(const shift of window.YandexOverlayGeometry.copies(geometry,view)){
        for(const segment of window.YandexOverlayGeometry.clippedSegments(geometry,view,shift)){
          ctx.lineDashOffset=segment.dashOffset;
          ctx.beginPath();ctx.moveTo(segment.from.x,segment.from.y);ctx.lineTo(segment.to.x,segment.to.y);ctx.stroke();
        }
      }
    }
    ctx.globalAlpha=1;ctx.setLineDash([]);ctx.lineDashOffset=0;ctx.setTransform(1,0,0,1,0,0);
    this.positionDirectionLabel(view);
    // Follow the provider's interpolated camera throughout an animation, not
    // only its starting/ending bounds. No perpetual idle RAF loop.
    if(view.animating)this.queueFrame();
  }
  positionDirectionLabel(view=this.getScreenView()){
    if(!view||!this.directionLabels.length)return;
    const {width,height}=view;
    const sizeKey=`${width}:${window.innerWidth}`;
    if(this.labelSizeKey!==sizeKey){
      // Batch all layout reads before any placement writes.
      for(const item of this.directionLabels)item.size={width:item.caption.offsetWidth,height:item.caption.offsetHeight};
      this.labelSizeKey=sizeKey;
    }
    const pin=window.YandexOverlayGeometry.screenPoints(this.preparePath([this.marker.geometry.getCoordinates()]),view)[0];
    const placed=[{left:pin.x-19,right:pin.x+19,top:pin.y-40,bottom:pin.y+6}];
    const placements=this.directionLabels.map(item=>{
      const points=window.YandexOverlayGeometry.screenPoints(this.preparePath(item.line),view);
      const end=points.at(-1),visible=end.x>=0&&end.x<=width&&end.y>=0&&end.y<=height;
      const anchor=visible?end:window.visibleDirectionMidpoint(points,width,height);
      if(!anchor)return {item,hidden:true};
      const w=item.size.width,h=item.size.height;
      let left,top;
      if(visible){
        left=end.x+10+w>width-8?end.x-10-w:end.x+10;
        top=Math.max(8,Math.min(height-40-h,end.y-h/2));
      }else{
        left=Math.max(8,Math.min(width-w-8,anchor.x-w/2));
        top=Math.max(8,Math.min(height-h-40,anchor.y-h/2));
      }
      let best=0,bestScore=Infinity;
      for(const multiple of [0,-1,1,-2,2,-3,3,-4,4,-5,5]){
        const dy=multiple*(h+5),t=top+dy,b=t+h;
        if(t<6||b>height-36)continue;
        const score=placed.reduce((sum,p)=>sum+
          Math.max(0,Math.min(left+w,p.right)-Math.max(left,p.left)+4)*
          Math.max(0,Math.min(b,p.bottom)-Math.max(t,p.top)+4),0);
        if(score<bestScore){bestScore=score;best=dy;}
        if(!score)break;
      }
      top+=best;
      placed.push({left,right:left+w,top,bottom:top+h});
      return {item,hidden:false,left,top,end,visible};
    });
    for(const p of placements){
      p.item.element.style.visibility=p.hidden?'hidden':'';
      if(p.hidden){p.item.element.dataset.labelMode='hidden';continue;}
      p.item.element.dataset.labelMode=p.visible?'endpoint':'line';
      p.item.element.style.transform=`translate3d(${p.left}px,${p.top}px,0)`;
      p.item.dot.style.display=p.visible?'':'none';
      p.item.dot.style.left=`${p.end.x-p.left-5}px`;
      p.item.dot.style.top=`${p.end.y-p.top-5}px`;
    }
  }
  render(point, contours, satelliteDirections) {
    if (!this.map) return;
    this.contours=contours;
    this.directionLabels.forEach(({element})=>element.remove());
    this.directionLabels=[];
    this.marker.geometry.setCoordinates(point);
    satelliteDirections.forEach(direction=>{
      const element=window.createSatelliteLabel(direction);
      element.classList.add('satellite-yandex-label');
      const caption=element.querySelector('.satellite-endpoint-label');
      caption.style.left='0';caption.style.top='0';caption.style.transform='none';
      document.getElementById(this.container).append(element);
      this.directionLabels.push({element,caption,dot:element.querySelector('.satellite-endpoint-dot'),
        line:direction.line,color:direction.color});
    });
    this.labelSizeKey=null;
    this.drawFrame();
  }
  fit(bounds) {
    if (bounds) this.map.setBounds(bounds, {checkZoomRange: true, zoomMargin: 28, duration: 200});
    else this.map.setCenter([55, 78], 3);
  }
};
