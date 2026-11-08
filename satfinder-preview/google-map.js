/* Official Maps JavaScript API. Loaded only on explicit provider selection. */
'use strict';
window.GoogleCoverageLayer = class {
  constructor(container, onPoint, onFailure, onPinClick = () => {}) {
    this.container = container;
    this.onPoint = onPoint;
    this.onFailure = onFailure;
    this.onPinClick = onPinClick;
    this.pinDragUntil = 0;
    this.map = null;
    this.loading = null;
    this.layers = [];
    this.authFailed = false;
    window.gm_authFailure = () => {
      this.authFailed = true;
      this.rejectLoad?.(new Error('GOOGLE_AUTH_FAILED'));
      this.onFailure();
    };
  }
  async ready(center, zoom) {
    if (this.authFailed) throw new Error('GOOGLE_AUTH_FAILED');
    if (this.map) return;
    if (this.loading) return this.loading;
    this.loading = this.initialize(center, zoom).catch(error => {
      this.loading = null;
      throw error;
    });
    return this.loading;
  }
  async initialize(center, zoom) {
    if (!window.google?.maps?.Map) {
      const apiURL = window.MapProviderConfig.scriptURL('google');
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        let completed = false;
        const finish = error => {
          if (completed) return;
          completed = true;
          clearTimeout(timer);
          this.rejectLoad = null;
          script.onerror = null;
          if (error) { script.remove(); reject(error); } else resolve();
        };
        const timer = setTimeout(() => finish(new Error('GOOGLE_TIMEOUT')), 25000);
        this.rejectLoad = finish;
        window.dtkGoogleReady = () => finish(
          window.google?.maps?.Map ? null : new Error('GOOGLE_UNAVAILABLE')
        );
        script.async = true;
        script.src = apiURL;
        script.referrerPolicy = 'strict-origin-when-cross-origin';
        script.onerror = () => finish(new Error('GOOGLE_UNAVAILABLE'));
        document.head.appendChild(script);
      });
    }
    if (this.authFailed) throw new Error('GOOGLE_AUTH_FAILED');
    const api = window.google.maps;
    // HTML overlay gives the endpoint an exact 10 CSS-pixel dot at every zoom.
    this.EndpointOverlay = class extends api.OverlayView {
      constructor(direction, map, onPosition) {
        super();
        this.direction=direction;
        this.line=direction.line;
        this.onPosition=onPosition;
        this.setMap(map);
      }
      onAdd() {
        this.element=window.createSatelliteLabel(this.direction);
        this.getPanes().floatPane.append(this.element);
      }
      draw() {
        const projection=this.getProjection(),container=this.getMap().getDiv();
        if(!projection||!this.element||!this.line.length)return;
        const world=projection.getWorldWidth();
        let previous=container.clientWidth/2;
        const points=this.line.map(([lat,lon])=>{
          const p=projection.fromLatLngToContainerPixel(new api.LatLng(lat,lon));
          p.x+=world*Math.round((previous-p.x)/world);previous=p.x;
          return p;
        });
        const first=new api.LatLng(...this.line[0]);
        const div=projection.fromLatLngToDivPixel(first),local=projection.fromLatLngToContainerPixel(first);
        const end=points[points.length-1];
        this.element.style.left=`${end.x+div.x-local.x}px`;
        this.element.style.top=`${end.y+div.y-local.y}px`;
        window.positionSatelliteLabel(this.element,container,points);
        this.onPosition();
      }
      onRemove() {
        this.element?.remove();
        this.element=null;
      }
    };
    this.map = new api.Map(document.getElementById(this.container), {
      center: {lat:center[0], lng:center[1]}, zoom,
      mapTypeId:'roadmap', minZoom:2, maxZoom:19,
      mapTypeControl:false, streetViewControl:false,
      fullscreenControl:false, zoomControl:true, scaleControl:true,
      clickableIcons:false, gestureHandling:'cooperative'
    });
    // Legacy Marker needs no additional Map ID and retains a draggable pin.
    this.marker = new api.Marker({
      map:this.map, position:{lat:center[0],lng:center[1]},
      draggable:true, title:'Нажмите для переключения спутников. Перетащите для выбора точки.',
      zIndex:1000,
      icon:{
        url:window.LOCATION_PIN.url,
        size:new api.Size(...window.LOCATION_PIN.size),
        scaledSize:new api.Size(...window.LOCATION_PIN.size),
        anchor:new api.Point(...window.LOCATION_PIN.anchor)
      }
    });
    const selectPoint = event => {
      // Rebuilding contours during a marker press must not turn the same
      // physical event into a click on the newly created polygon/map.
      if(event.domEvent?.target?.closest?.('[title="Нажмите для переключения спутников. Перетащите для выбора точки."]'))return;
      if (event.latLng) this.onPoint(event.latLng.lat(),event.latLng.lng());
    };
    this.selectPoint=selectPoint;
    this.map.addListener('click',selectPoint);
    const cyclePin = event => {
      event.stop?.();
      event.domEvent?.stopPropagation();
      event.domEvent?.preventDefault();
      if(performance.now()>=this.pinDragUntil)this.onPinClick();
    };
    this.marker.addListener('click',cyclePin);
    // On touch screens Maps may report the second tap only as dblclick.
    this.marker.addListener('dblclick',cyclePin);
    // Handle real DOM presses before the Maps hit-testing dispatcher.
    // Otherwise replacing polygons during a click can dispatch that same
    // press again to a newly created contour. Mouse/touch dragging still
    // uses the native Marker handlers; its trailing click is ignored.
    const pinSelector='[role="button"][title="Нажмите для переключения спутников. Перетащите для выбора точки."]';
    for(const type of ['click','dblclick']){
      this.map.getDiv().addEventListener(type,event=>{
        if(!event.target?.closest?.(pinSelector))return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if(type==='click'&&performance.now()>=this.pinDragUntil)this.onPinClick();
      },true);
    }
    this.marker.addListener('dragend',event=>{
      this.pinDragUntil=performance.now()+250;
      if(event.latLng)this.onPoint(event.latLng.lat(),event.latLng.lng());
    });
  }
  show(center, zoom) {
    window.google.maps.event.trigger(this.map,'resize');
    this.map.setCenter({lat:center[0],lng:center[1]});
    this.map.setZoom(zoom);
  }
  getView() {
    const center=this.map.getCenter();
    return {center:[center.lat(),center.lng()],zoom:this.map.getZoom()};
  }
  panTo(point) {
    this.map?.panTo({lat:point[0],lng:point[1]});
  }
  setType(type) {
    if (['roadmap','satellite','hybrid','terrain'].includes(type)) this.map?.setMapTypeId(type);
  }
  render(point, contours, satelliteDirections) {
    if (!this.map) return;
    const api=window.google.maps;
    this.layers.forEach(layer=>{api.event.clearInstanceListeners(layer);layer.setMap(null);});
    this.layers=[];
    this.directionLabels=[];
    const arrangeLabels=()=>{
      cancelAnimationFrame(this.labelFrame);
      this.labelFrame=requestAnimationFrame(()=>window.arrangeSatelliteLabels(
        this.directionLabels.map(label=>label.element),this.map.getDiv()
      ));
    };
    const current=this.marker.getPosition();
    if(!current||current.lat()!==point[0]||current.lng()!==point[1]){
      this.marker.setPosition({lat:point[0],lng:point[1]});
    }
    // Google connects adjacent wrapped longitudes across the antimeridian.
    // noClampNoWrap would clip the >180° half of an unwrapped footprint.
    const path=points=>points.map(([lat,lon])=>new api.LatLng(lat,lon));
    contours.forEach(contour=>{
      const polygon=new api.Polygon({
        map:this.map,paths:path(contour.points),geodesic:false,
        strokeColor:contour.color,strokeWeight:2,strokeOpacity:0.8,
        fillColor:contour.color,fillOpacity:contour.opacity
      });
      polygon.addListener('click',this.selectPoint);
      this.layers.push(polygon);
    });
    satelliteDirections.forEach(direction=>{
      this.layers.push(new api.Polyline({
        map:this.map,path:path(direction.line),geodesic:false,clickable:false,
        strokeOpacity:0,icons:[{
          icon:{path:'M 0,-1 0,1',strokeOpacity:1,strokeColor:direction.color,strokeWeight:2,scale:3},
          offset:'0',repeat:'14px'
        }]
      }));
      const label=new this.EndpointOverlay(direction,this.map,arrangeLabels);
      this.directionLabels.push(label);
      this.layers.push(label);
    });
  }
  fit(bounds) {
    if(!bounds){this.show([55,78],3);return;}
    this.map.fitBounds({
      south:bounds[0][0],west:bounds[0][1],
      north:bounds[1][0],east:bounds[1][1]
    },28);
    window.google.maps.event.addListenerOnce(this.map,'idle',()=>{
      if(this.map.getZoom()>6)this.map.setZoom(6);
    });
  }
};
