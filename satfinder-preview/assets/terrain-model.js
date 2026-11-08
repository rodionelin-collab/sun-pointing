/* Preliminary spherical-Earth terrain LOS. No refraction or Fresnel clearance.
   DEM heights use their supplied vertical reference; this is not survey accuracy. */
'use strict';
(() => {
  const R = 6371008.8, RAD = Math.PI / 180, ZOOM = 12;
  function check(value, min, max) {
    if (!Number.isFinite(value) || value < min || value > max) throw new Error('INVALID_TERRAIN_INPUT');
  }
  function destination(lat, lon, azimuth, distance) {
    check(lat,-85,85); check(lon,-180,180); check(azimuth,0,360); check(distance,0,100000);
    const p=lat*RAD, l=lon*RAD, a=azimuth*RAD, d=distance/R;
    const p2=Math.asin(Math.max(-1,Math.min(1,Math.sin(p)*Math.cos(d)+Math.cos(p)*Math.sin(d)*Math.cos(a))));
    const l2=l+Math.atan2(Math.sin(a)*Math.sin(d)*Math.cos(p),Math.cos(d)-Math.sin(p)*Math.sin(p2));
    return [p2/RAD,((l2/RAD+180)%360+360)%360-180];
  }
  function tilePoint(lat,lon) {
    check(lat,-85,85);check(lon,-180,180);
    const n=2**ZOOM, px=((lon+180)/360*n*256)%(n*256);
    const py=(1-Math.asinh(Math.tan(lat*RAD))/Math.PI)/2*n*256;
    const x=Math.floor(px/256),y=Math.floor(py/256);
    return {key:`${ZOOM}/${x}/${y}`,x:Math.floor(px)%256,y:Math.floor(py)%256};
  }
  function makePath(lat,lon,azimuth,km) {
    if (![0.5,1,5,10,30].includes(km)) throw new Error('INVALID_TERRAIN_RANGE');
    const distances=[0];
    for(let d=25;d<=Math.min(1000,km*1000);d+=25)distances.push(d);
    for(let d=1100;d<=km*1000;d+=100)distances.push(d);
    const path=distances.map(distance=>{
      const [latitude,longitude]=destination(lat,lon,azimuth,distance);
      return {distance,latitude,longitude,tile:tilePoint(latitude,longitude)};
    });
    if(new Set(path.map(p=>p.tile.key)).size>80)throw new Error('TERRAIN_TOO_MANY_TILES');
    return path;
  }
  function decode(r,g,b,a=255) {
    const height=r*256+g+b/256-32768;
    // Reject nodata and deep bathymetry rather than interpreting seabed as terrain.
    return a===255 && Number.isFinite(height) && height>=-500 && height<=9000 ? height : null;
  }
  function blockedSegments(values) {
    const segments=[];
    const crossing=(a,b)=>{
      const t=a.clearance/(a.clearance-b.clearance),point={};
      for(const key of ['distance','height','x','ground','ray'])point[key]=a[key]+(b[key]-a[key])*t;
      point.clearance=0;
      return point;
    };
    for(let i=1;i<values.length;i++){
      const a=values[i-1],b=values[i];
      // Contact at the installation point alone is not an obstruction.
      if(!(b.clearance<=0||(a.distance>0&&a.clearance<=0)))continue;
      const from=a.clearance>0?crossing(a,b):a;
      const to=b.clearance>0?crossing(a,b):b;
      segments.push({from,to});
    }
    return segments;
  }
  function analyze(samples,elevation,antennaHeight) {
    check(elevation,0.01,89.99);check(antennaHeight,0,100);
    if(!Array.isArray(samples)||samples.length<2||samples[0].distance!==0||
      samples.some((p,i)=>!Number.isFinite(p.height)||p.height< -500||p.height>9000||
        !Number.isFinite(p.distance)||p.distance<0||p.distance>100000||
        (i>0&&p.distance<=samples[i-1].distance))) throw new Error('TERRAIN_INCOMPLETE');
    const origin=samples[0].height, slope=Math.tan(elevation*RAD);
    const values=samples.map(p=>{
      const angle=p.distance/R, x=(R+p.height)*Math.sin(angle);
      // Local tangent frame; y=0 is the model surface at the installation point.
      const ground=(p.height-origin)-2*(R+p.height)*Math.sin(angle/2)**2;
      const ray=antennaHeight+x*slope;
      return {...p,x,ground,ray,clearance:ray-ground,
        horizon:p.distance?Math.atan2(ground-antennaHeight,x)/RAD:null};
    });
    // Include every sampled point ahead of the antenna, including the near field.
    // Only the installation point itself is not a terrain obstruction.
    const assessed=values.filter(p=>p.distance>0);
    if(!assessed.length)throw new Error('TERRAIN_INCOMPLETE');
    const critical=assessed.reduce((a,b)=>a.clearance<b.clearance?a:b);
    // Check the piecewise-linear profile continuously, including the first
    // segment from distance 0. Interpolation adds no new DEM detail.
    const segments=blockedSegments(values);
    const obstruction=segments[0]?.from||null;
    const maxHorizon=Math.max(...assessed.map(p=>p.horizon));
    return {values,origin,critical,obstruction,segments,maxHorizon,
      angularMargin:elevation-maxHorizon,
      state:obstruction?'blocked':critical.clearance<20?'caution':'clear'};
  }
  window.TerrainModel=Object.freeze({R,ZOOM,destination,tilePoint,makePath,decode,analyze,blockedSegments});
})();
