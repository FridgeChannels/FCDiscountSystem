/* A deterministic scene renderer. The player and the preset covers share the same clock
   and drawing functions so a paused frame can be reproduced at any resolution. */
const MotionArt = (() => {
  const presets = [
    {id:'impact',name:'爆场开抢',en:'FLASH IMPACT',type:'促销',color:'#FF442E',seconds:1.8,poster:.86},
    {id:'orbit',name:'轨道回响',en:'ORBITAL ECHO',type:'空间',color:'#FF673D',seconds:3.2,poster:.75},
    {id:'chrome',name:'液态铬光',en:'LIQUID CHROME',type:'空间',color:'#A69AFF',seconds:3.6,poster:.48},
    {id:'dust',name:'粒子重组',en:'PARTICLE FIELD',type:'数字',color:'#79DFCA',seconds:2.2,poster:.62},
    {id:'bounce',name:'弹性落印',en:'SOFT IMPACT',type:'图形',color:'#F3C852',seconds:2.4,poster:.58},
    {id:'print',name:'色版套印',en:'COLOR REGISTER',type:'图形',color:'#F29BB5',seconds:2.6,poster:.49},
    {id:'glitch',name:'数字切片',en:'SIGNAL SHIFT',type:'数字',color:'#ADDF6B',seconds:2.2,poster:.44},
    {id:'iris',name:'虹膜开场',en:'IRIS REVEAL',type:'图形',color:'#89B4FF',seconds:3.0,poster:.48},
    {id:'fold',name:'百叶折叠',en:'PLEAT ASSEMBLY',type:'空间',color:'#D99763',seconds:2.8,poster:.47},
  ];
  const brands = [
    {id:'forma',name:'Forma',word:'FORMA'},
    {id:'aster',name:'Aster',word:'Aster'},
    {id:'orbit',name:'Orbit',word:'ORBIT'},
  ];
  const TAU = Math.PI*2;
  const clamp = v => Math.min(1,Math.max(0,v));
  const smooth = (a,b,v) => {const k=clamp((v-a)/(b-a));return k*k*(3-2*k)};
  const out = t => 1-Math.pow(1-clamp(t),3);
  const fade = (t,a,b,c,d) => smooth(a,b,t)*(1-smooth(c,d,t));
  const rgb = hex => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
  const mix = (a,b,k) => a.map((v,i)=>Math.round(v+(b[i]-v)*k));
  const css = (c,a=1) => 'rgba('+c.join(',')+','+a+')';
  const white=[255,250,243], ink=[23,24,22];
  const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const norm = a => {const l=Math.hypot(...a)||1;return a.map(v=>v/l)};
  const sub = (a,b) => a.map((v,i)=>v-b[i]);
  function makeCanvas(w,h=w){const c=document.createElement('canvas');c.width=w;c.height=h;return c}
  function random(i){const v=Math.sin(i*478.131+2.64)*43758.5453;return v-Math.floor(v)}
  function rotate(p,ax,ay,az){
    const [x,y,z]=p, c=Math.cos,s=Math.sin;
    const y1=y*c(ax)-z*s(ax),z1=y*s(ax)+z*c(ax),x1=x*c(ay)+z1*s(ay);
    return [x1*c(az)-y1*s(az),x1*s(az)+y1*c(az),z1*c(ay)-x*s(ay)];
  }
  const materials=new Map(), sprites=new Map(), particles=new Map();
  // Each mark is a swept 3D surface. Interpolate normals and depth per pixel so the
  // overlaps in the trefoil and the two intersecting rings shade in the right order.
  function surface(brand,part,t,v){
    if(brand==='aster'){
      const a=t*TAU,b=v*TAU;
      const r=.68+.12*Math.cos(9*a);
      const section=.25+.035*Math.cos(9*a);
      return rotate([(r+section*Math.cos(b))*Math.cos(a),(r+section*Math.cos(b))*Math.sin(a),.31*Math.sin(b)+.037*Math.cos(9*a)],.34,-.20,.18);
    }
    if(brand==='orbit'){
      const a=t*TAU,b=v*TAU,r=1+.125*Math.cos(b);
      const p=[r*Math.cos(a),r*Math.sin(a),.15*Math.sin(b)];
      return part===0?rotate(p,.88,.25,-.45):rotate(p,-1.08,-.32,.72);
    }
    function center(u){const a=u*TAU;return [Math.sin(a)+2*Math.sin(2*a),Math.cos(a)-2*Math.cos(2*a),.98*Math.sin(3*a)]}
    const p=center(t), tangent=norm(sub(center(t+.0001),center(t-.0001)));
    const side=norm(cross(tangent,[0,0,1])),up=norm(cross(side,tangent));
    const b=v*TAU, twist=.22*Math.sin(t*TAU*3+.6);
    const bevel=x=>Math.sign(x)*Math.pow(Math.abs(x),.82);
    const u=bevel(Math.cos(b))*.67, w=bevel(Math.sin(b))*.58;
    return rotate(p.map((x,i)=>x+side[i]*(u*Math.cos(twist)-w*Math.sin(twist))+up[i]*(u*Math.sin(twist)+w*Math.cos(twist))),.14,-.19,-.26);
  }
  function bake(id){
    if(materials.has(id))return materials.get(id);
    const size=512, vertices=[], faces=[];let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    const U=144,V=32;
    for(let part=0;part<(id==='orbit'?2:1);part++){
      const base=vertices.length;
      for(let i=0;i<U;i++)for(let j=0;j<V;j++){
        const t=i/U,v=j/V,p=surface(id,part,t,v);
        const n=norm(cross(sub(surface(id,part,t+.0001,v),surface(id,part,t-.0001,v)),sub(surface(id,part,t,v+.0001),surface(id,part,t,v-.0001))));
        // Both orientations occur across the parameterizations.
        if(id!=='forma')for(let k=0;k<3;k++)n[k]*=-1;
        vertices.push({p,n});minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);minY=Math.min(minY,p[1]);maxY=Math.max(maxY,p[1]);
      }
      for(let i=0;i<U;i++)for(let j=0;j<V;j++){
        const a=base+i*V+j,b=base+(i+1)%U*V+j,c=base+(i+1)%U*V+(j+1)%V,d=base+i*V+(j+1)%V;
        faces.push([a,b,c],[a,c,d]);
      }
    }
    const scale=(size-14)/Math.max(maxX-minX,maxY-minY);
    for(const {p} of vertices){p[0]=(p[0]-(minX+maxX)/2)*scale+size/2;p[1]=size/2-(p[1]-(minY+maxY)/2)*scale}
    const depth=new Float32Array(size*size).fill(-Infinity);
    const light=new Float32Array(size*size), spec=new Float32Array(size*size);
    for(const face of faces){
      const [a,b,c]=face.map(i=>vertices[i]),[ax,ay,az]=a.p,[bx,by,bz]=b.p,[cx,cy,cz]=c.p;
      const det=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);if(Math.abs(det)<.0001)continue;
      const x0=Math.max(0,Math.floor(Math.min(ax,bx,cx))), x1=Math.min(size-1,Math.ceil(Math.max(ax,bx,cx)));
      const y0=Math.max(0,Math.floor(Math.min(ay,by,cy))), y1=Math.min(size-1,Math.ceil(Math.max(ay,by,cy)));
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
        const u=((by-cy)*(x+.5-cx)+(cx-bx)*(y+.5-cy))/det;
        const v=((cy-ay)*(x+.5-cx)+(ax-cx)*(y+.5-cy))/det,w=1-u-v;
        if(Math.min(u,v,w)<0)continue;
        const z=az*u+bz*v+cz*w,idx=y*size+x;if(z<=depth[idx])continue;depth[idx]=z;
        let nx=a.n[0]*u+b.n[0]*v+c.n[0]*w,ny=a.n[1]*u+b.n[1]*v+c.n[1]*w,nz=a.n[2]*u+b.n[2]*v+c.n[2]*w;
        if(nz<0){nx=-nx;ny=-ny;nz=-nz}
        const dot=clamp(-nx*.49+ny*.7+nz*.35);
        const rx=2*nx*nz,ry=2*ny*nz;
        const softbox=Math.exp(-Math.pow((ry-.53+.31*rx)/.21,2))*(.60+.40*clamp(-rx+.45));
        const edge=Math.pow(1-nz,3)*(.48+.52*clamp(ny-nx*.4));
        const reflected=Math.exp(-Math.pow((rx-.78)/.13,2))*.42;
        light[idx]=clamp(.14+.70*dot+.15*nz+.12*softbox);
        spec[idx]=clamp(softbox*.72+edge*.68+reflected+.065*Math.pow(dot,5));
      }
    }
    // A shallow screen-space contact shadow grounds the over/under crossings.
    for(let y=8;y<size-8;y++)for(let x=8;x<size-8;x++){
      const i=y*size+x;if(depth[i]===-Infinity)continue;
      const step=size/scale*.06;
      const dz=Math.max(depth[i-7*size-3]-depth[i],depth[i-4*size-7]-depth[i]);
      if(dz>step){light[i]*=.75;spec[i]*=.70}
    }
    const result={size,depth,light,spec};materials.set(id,result);return result;
  }
  let upload=null;
  function setUpload(image){
    const max=640,r=max/Math.max(image.naturalWidth,image.naturalHeight);
    const c=makeCanvas(Math.max(1,Math.round(image.naturalWidth*r)),Math.max(1,Math.round(image.naturalHeight*r)));
    c.getContext('2d').drawImage(image,0,0,c.width,c.height);upload=c;
    for(const key of [...sprites.keys()])if(key.startsWith('custom/'))sprites.delete(key);
    particles.delete('custom');
  }
  function sprite(id,hex,style='metal'){
    const key=[id,hex,style].join('/');if(sprites.has(key))return sprites.get(key);
    let c;
    if(id==='custom'){
      c=makeCanvas(upload.width,upload.height);const ctx=c.getContext('2d');ctx.drawImage(upload,0,0);
      if(style==='flat'){ctx.globalCompositeOperation='source-in';ctx.fillStyle=hex;ctx.fillRect(0,0,c.width,c.height)}
    }else{
      const m=bake(id),col=rgb(hex);c=makeCanvas(m.size);const ctx=c.getContext('2d'),img=ctx.createImageData(m.size,m.size);
      const dark=mix(col,[12,6,10],.77),high=mix(col,white,.89);
      for(let i=0;i<m.depth.length;i++){
        if(m.depth[i]===-Infinity)continue;const l=m.light[i],s=m.spec[i],j=i*4;
        for(let k=0;k<3;k++){const base=dark[k]+(col[k]-dark[k])*l;img.data[j+k]=style==='flat'?col[k]:base+(high[k]-base)*s}
        img.data[j+3]=255;
      }
      ctx.putImageData(img,0,0);
    }
    if(sprites.size>90)sprites.delete(sprites.keys().next().value);
    sprites.set(key,c);return c;
  }
  // Sample the actual mark once. Every particle has a home pixel, a flight lane
  // and its own delay; the same clock can be evaluated while playing or scrubbing.
  function samplePoints(id){
    if(particles.has(id))return particles.get(id);
    const logo=sprite(id,'#FFFFFF'), side=124, mask=makeCanvas(side);
    const ctx=mask.getContext('2d'), scale=side/Math.max(logo.width,logo.height);
    ctx.drawImage(logo,(side-logo.width*scale)/2,(side-logo.height*scale)/2,logo.width*scale,logo.height*scale);
    const pixels=ctx.getImageData(0,0,side,side).data, points=[];
    for(let y=0;y<side;y+=2)for(let x=0;x<side;x+=2){
      const index=y*side+x;
      if(pixels[index*4+3]<42)continue;
      const px=(x+.5)/side-.5, py=(y+.5)/side-.5;
      const lane=Math.round(Math.atan2(py,px)/TAU*13);
      const seed=random(index+83), depth=random(index+89);
      points.push({x:px,y:py,depth,seed,
        angle:lane*TAU/13+(random(lane+20)-.5)*.22+(random(index+29)-.5)*(.045+.19*depth),
        reach:.17+.83*Math.pow(random(index+39),.78),
        curl:(lane%2===0?1:-1)*(.18+.50*random(lane+76)),
        delay:seed*.055, tone:Math.floor(random(index+15)*6)});
    }
    particles.set(id,points);return points;
  }

  function flightPoint(p,t,size,spreadX,spreadY){
    const lift=out((t-.075-p.delay)/.25);
    const recall=smooth(.36+p.delay,.665+p.delay,t);
    const distance=lift*(1-recall);
    const angle=p.angle+p.curl*(lift*.6+smooth(.25,.62,t)*1.2)+recall*(1-recall)*3.5;
    const home=.19+.81*recall;
    return [p.x*size*home+Math.cos(angle)*spreadX*p.reach*distance,
            p.y*size*home+Math.sin(angle)*spreadY*p.reach*distance];
  }

  function drawParticleBurst(g,w,h,cx,cy,size,t,brand,col,thumb,stamp){
    const kick=.675;
    const ignition=fade(t,.065,.13,.18,.33), impact=fade(t,.62,kick,.70,.82);
    const flight=fade(t,.07,.16,.63,.73);
    const colHi=mix(col,white,.74), violet=mix(col,[140,98,255],.77);
    const reachX=Math.min(w*.66,h*1.64),reachY=h*.68;
    const tones=[css(col),css(colHi),'#FFFDF1',css(mix(col,[57,129,255],.59)),css(violet),css(mix(col,white,.27))];
    g.save();
    g.translate(cx,cy);
    g.globalCompositeOperation='lighter';
    glow(g,0,0,size*(1.10+flight*.52),css(col,.13+ignition*.38+impact*.31));
    glow(g,-size*.37,size*.06,size*.83,css(violet,.09+flight*.18));

    // Peripheral cinders establish depth and keep the edges moving after the hit.
    for(let i=0;i<(thumb?90:164);i++){
      const depth=random(i+208),direction=random(i+428)*TAU;
      const radial=(.10+.94*random(i+78))*(.79+.22*out((t-.09)/.42));
      const a=direction+.08*smooth(.34,.82,t)*(depth-.5);
      const x=Math.cos(a)*w*.66*radial,y=Math.sin(a)*h*.76*radial;
      const r=(.40+depth*depth*1.2)*Math.min(1.6,size/190);
      g.fillStyle=css(i%5?col:violet,.14+depth*.5);g.fillRect(x,y,r,r);
    }
    for(const when of [.11,kick]){
      const age=(t-when)/(when===kick?.30:.27);
      if(age<=0||age>=1)continue;
      const radius=size*(.09+out(age)*2.10);
      ellipse(g,0,0,radius,radius*.67,-.17,css(col,.69*(1-age)),size*(.003+.030*(1-age)));
      ellipse(g,0,0,radius*1.06,radius*.71,-.17,css(colHi,.55*(1-age)),Math.max(.6,size*.006));
    }

    const points=samplePoints(brand);
    const opacity=1-smooth(.67,.79,t);
    if(opacity>0){
      const streams=tones.map(()=>new Path2D()), cores=tones.map(()=>new Path2D());
      const step=thumb?2:1;
      for(let i=0;i<points.length;i+=step){
        const p=points[i], now=flightPoint(p,t,size,reachX,reachY);
        const before=flightPoint(p,Math.max(0,t-.014-p.depth*.022),size,reachX,reachY);
        const trail=streams[p.tone];trail.moveTo(...before);trail.lineTo(...now);
        const dotSize=Math.max(.6,size*.008*(.37+p.depth));
        cores[p.tone].rect(now[0]-dotSize/2,now[1]-dotSize/2,dotSize,dotSize);
      }
      g.lineCap='round';
      for(let j=0;j<tones.length;j++){
        g.strokeStyle=tones[j];g.fillStyle=tones[j];
        g.globalAlpha=opacity*flight*.095;g.lineWidth=Math.max(1.7,size*.017);g.stroke(streams[j]);
        g.globalAlpha=opacity*(.28+flight*.37);g.lineWidth=Math.max(.6,size*(j===2?.005:.003));g.stroke(streams[j]);
        g.globalAlpha=opacity*.90;g.fill(cores[j]);
      }
      g.globalAlpha=1;
    }
    // A short horizontal flare marks the two impulses without bleaching the full stage.
    const flare=ignition*.87+impact;
    if(flare>.001){
      const width=size*(.45+flare*1.64);
      const beam=g.createLinearGradient(-width,0,width,0);
      beam.addColorStop(0,'transparent');beam.addColorStop(.48,css(col,.64));beam.addColorStop(.5,css(white));beam.addColorStop(.52,css(col,.64));beam.addColorStop(1,'transparent');
      g.globalAlpha=flare;g.fillStyle=beam;g.fillRect(-width,-size*.006,width*2,size*.012);
      glow(g,0,0,size*.28,css(colHi,flare*.75));g.globalAlpha=1;
    }
    g.restore();

    const reveal=smooth(.635,.75,t);
    if(reveal>0){
      const recoil=fade(t,.625,kick,kick,.82);
      stamp(cx,cy,reveal*.12+.88+recoil*.32,-.055*(1-reveal),reveal);
    }
    const after=clamp((t-kick)/.30);
    if(after>0&&after<1){
      g.save();g.translate(cx,cy);g.globalCompositeOperation='lighter';
      for(let i=0;i<(thumb?34:69);i++){
        const a=random(i+821)*TAU, d=.44+random(i+840)*1.40;
        const r=size*(.36+d*out(after)), tail=size*(.03+.15*random(i+903))*(1-after);
        const dx=Math.cos(a),dy=Math.sin(a)*.72;
        line(g,dx*(r-tail),dy*(r-tail),dx*r,dy*r,css(i%4?col:colHi,.82*(1-after)),Math.max(.6,size*.005));
      }
      g.restore();
    }
  }
  function line(g,x1,y1,x2,y2,col,width=1){g.strokeStyle=col;g.lineWidth=width;g.beginPath();g.moveTo(x1,y1);g.lineTo(x2,y2);g.stroke()}
  function ellipse(g,x,y,rx,ry,angle,col,width=1,start=0,end=TAU){
    g.beginPath();g.ellipse(x,y,Math.max(.01,rx),Math.max(.01,ry),angle,start,end);g.lineWidth=width;g.strokeStyle=col;g.stroke();
  }
  function disk(g,x,y,r,col){g.fillStyle=col;g.beginPath();g.arc(x,y,Math.max(0,r),0,TAU);g.fill()}
  function glow(g,x,y,r,col){const gr=g.createRadialGradient(x,y,0,x,y,r);gr.addColorStop(0,col);gr.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=gr;g.fillRect(x-r,y-r,r*2,r*2)}
  const grain=makeCanvas(140),grainCtx=grain.getContext('2d'),grainPixels=grainCtx.createImageData(140,140);
  for(let i=0;i<140*140;i++){const v=random(i)>.5?255:0;grainPixels.data.set([v,v,v,Math.round(random(i+.5)*11)],i*4)}
  grainCtx.putImageData(grainPixels,0,0);
  function isLight(id){return ['chrome','bounce','print','fold'].includes(id)}
  // All beats are normalized to the clip duration, including the debris paths.
  // The thumbnail, scrubber, and exported frames can therefore seek independently.
  function polygon(g, points, fill, stroke, width=1) {
    g.beginPath();
    g.moveTo(...points[0]);
    for (const point of points.slice(1)) g.lineTo(...point);
    g.closePath();
    g.fillStyle=fill;
    g.fill();
    if (stroke) {g.strokeStyle=stroke;g.lineWidth=width;g.stroke()}
  }

  function drawImpact(g,w,h,brand,color,t,headline) {
    const col=rgb(color), black='#171320', cream='#FFF2C8', acid='#F4FF4B';
    const unit=Math.min(h,w*.72), portrait=w/h<1.08;
    const hit=.315, launch=clamp((t-.12)/(hit-.12));
    const charge=smooth(0,.12,t);
    const recoil=out((t-hit)/.22);
    const lock=smooth(.34,.62,t);
    const endX=portrait?w*.5:w*.72, endY=portrait?h*.36:h*.45;
    const x=w*.5+(endX-w*.5)*lock, y=h*.49+(endY-h*.49)*lock;
    const wordY=portrait?h*.69:h*.53;
    const settle=t<hit?0:Math.exp(-18*(t-hit))*(1-smooth(.49,.61,t));
    const punch=Math.sin((t-hit)*81)*settle;
    const base=g.createLinearGradient(w*.05,h,w*.9,0);
    const lift=smooth(.16,.38,t);
    base.addColorStop(0,css(mix([22,13,24],mix(col,[66,2,33],.66),lift)));
    base.addColorStop(.56,css(mix([45,18,27],col,lift)));
    base.addColorStop(1,css(mix([53,22,42],mix(col,[252,107,131],.49),lift)));
    g.fillStyle=base;g.fillRect(0,0,w,h);
    g.save();
    g.translate(unit*.026*punch,unit*.017*Math.cos((t-hit)*69)*settle);
    const diagonal=Math.hypot(w,h);
    // Unequal taper and staggered ends keep the rush directional even at a standstill.
    for(let i=0;i<102;i++) {
      const a=(i+random(i+4)*.62)/102*TAU;
      const c=Math.cos(a),s=Math.sin(a),v=random(i+52);
      const edge=Math.min(w*.65/Math.max(.05,Math.abs(c)),h*.70/Math.max(.05,Math.abs(s)));
      const from=edge*(.36+.72*v)*(1-.30*launch+.24*recoil);
      const tip=from+edge*(.25+random(i+110)*1.25);
      const width=(.002+.021*Math.pow(random(i+181),2))*tip;
      const px=x+c*tip,py=y+s*tip;
      const rayColor=i%9===0?css([255,240,177],.72):i%4===0?css(col,.77):css([28,13,30],.20+.61*random(i+371));
      polygon(g,[[x+c*from,y+s*from],[px-s*width,py+c*width],[px+s*width*.33,py-c*width*.33]],rayColor);
    }
    if(t<hit) {
      const ring=unit*(.52-.38*charge+.53*launch*launch);
      for(let j=0;j<3;j++)ellipse(g,x,y,ring*(1+j*.13),ring*(1+j*.13),0,css(j===0?[255,248,168]:col,.62-j*.15),unit*.0028);
    }
    // A pair of traveling wavefronts, each emitted only once.
    for(const delay of [0,.058]){
      const q=clamp((t-hit-delay)/.39);
      if(q>0&&q<1){
        const r=unit*.1+diagonal*.75*out(q);
        ellipse(g,x,y,r,r*.84,-.09,css([255,246,182],.88*(1-q)),unit*(.004+.032*(1-q)));
      }
    }
    const pop=out((t-.35)/.24);
    const logoSize=Math.min(unit*(portrait?.68:.69),w*(portrait?.56:.32));
    if(pop>0){
      g.save();g.translate(x,y);g.rotate(-.12*(1-pop));g.scale(pop,pop);
      const points=[];
      for(let i=0;i<30;i++){
        const a=i/30*TAU-.14;
        const r=logoSize*(i%2===0?.66+.14*random(i+311):.48+.055*random(i+111));
        points.push([Math.cos(a)*r*1.16,Math.sin(a)*r*.92]);
      }
      g.save();g.translate(logoSize*.027,logoSize*.043);polygon(g,points,black,black,unit*.012);g.restore();
      polygon(g,points,acid,black,unit*.008);
      g.restore();
    }
    // Faceted foil slivers accelerate outward and settle around the poster margins.
    if(t>hit){
      for(let i=0;i<55;i++){
        const delay=random(i+601)*.09,age=clamp((t-hit-delay)/.67);
        if(!age)continue;
        const a=(i+random(i+950)*.75)/55*TAU,dist=out(age);
        const reach=.49+random(i+610)*.60,px=w*.5+Math.cos(a)*w*reach*dist;
        const py=h*.48+Math.sin(a)*h*reach*1.11*dist+h*.22*age*age;
        const l=unit*(.012+.084*Math.pow(random(i+612),2))*smooth(0,.08,age);
        const thick=l*(.10+.28*random(i+630));
        g.save();g.translate(px,py);g.rotate(a+age*(random(i+631)-.5)*5);
        const tint=i%4===0?cream:i%4===1?acid:i%4===2?'#FFAC77':'#372337';
        polygon(g,[[-l,0],[l*.80,-thick],[l,thick*.13],[-l*.62,thick*.40]],tint);
        polygon(g,[[-l,0],[l*.80,-thick],[l*.21,-thick*1.35]],i%2?'#78284A':'#AD771E');
        g.restore();
      }
    }
    const finalBrand=brand==='custom'?null:brands.find(b=>b.id===brand).word;
    const logo=sprite(brand,brand==='custom'?color:'#F0B87C');
    // The mark deliberately overshoots the view, then locks into the campaign artwork.
    const scale=t<hit?.31-.14*charge+3.24*Math.pow(launch,3):1+2.44*(1-recoil)-.10*Math.sin(Math.PI*recoil);
    const maxWidth=brand==='custom'&&logo.width>logo.height*1.5?logoSize*1.15:logoSize;
    const fit=Math.min(maxWidth/logo.width,logoSize/logo.height);
    const tilt=t<hit?-.44+.54*launch:.10*(1-recoil);
    g.save();g.translate(x,y);g.rotate(tilt);g.scale(scale,scale);
    const lw=logo.width*fit,lh=logo.height*fit;
    g.shadowColor='rgba(20,12,28,.72)';g.shadowBlur=unit*.010;g.shadowOffsetX=unit*.009;g.shadowOffsetY=unit*.014;
    g.drawImage(logo,-lw/2,-lh/2,lw,lh);g.restore();

    const typeIn=out((t-.415)/.195);
    if(typeIn>0){
      const text=headline||'开抢';
      const area=portrait?w*.77:w*.46;
      const fontSize=Math.min(unit*(portrait?.34:.52),area/Math.max(1.65,Array.from(text).length*.88));
      const anchorX=portrait?w*.5:w*.319;
      const touch=Math.sin(Math.PI*clamp((t-.5)/.17));
      g.save();
      g.translate(anchorX-(1-typeIn)*w*.84,wordY+(1-typeIn)*unit*.11);
      g.rotate(-.10-.09*(1-typeIn));g.transform(1,0,-.15,1,0,0);
      g.scale(1+touch*.06,1-touch*.035);
      g.textAlign='center';g.textBaseline='middle';g.lineJoin='round';
      g.font='1000 '+fontSize+'px "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif';
      const metrics=g.measureText(text);
      const stretch=Math.min(area/Math.max(1,metrics.width),1.52);
      g.scale(stretch,1);
      g.strokeStyle=black;g.lineWidth=fontSize*.075;
      g.fillStyle=black;
      const depth=fontSize*.075;
      for(let j=4;j>=0;j--){
        const d=depth*j/4;g.strokeText(text,d*.64,d);g.fillText(text,d*.64,d);
      }
      g.strokeStyle='#FFD86C';g.lineWidth=fontSize*.018;g.strokeText(text,0,0);
      g.fillStyle=cream;g.fillText(text,0,-fontSize*.005);
      g.restore();
      // Keep the short sale label and logo signature anchored to their own subjects.
      const badgeH=unit*.087,badgeW=badgeH*4.95;
      g.save();g.globalAlpha=typeIn;g.translate(anchorX-area*.14,wordY-fontSize*.54-unit*.057);g.rotate(-.10);
      g.transform(1,0,-.17,1,0,0);
      g.fillStyle=black;g.fillRect(-badgeW/2+2,-badgeH/2+3,badgeW,badgeH);
      g.fillStyle=acid;g.fillRect(-badgeW/2,-badgeH/2,badgeW,badgeH);
      for(let j=0;j<3;j++){g.fillStyle=black;g.fillRect(-badgeW*.46+j*badgeH*.15,-badgeH*.32,badgeH*.065,badgeH*.64)}
      g.textAlign='center';g.textBaseline='middle';g.fillStyle=black;
      g.font='900 '+badgeH*.61+'px "Avenir Next",Helvetica,sans-serif';g.fillText('FLASH SALE',badgeH*.22,badgeH*.025,badgeW*.78);
      g.restore();
      if(finalBrand){
        g.save();g.globalAlpha=smooth(.51,.66,t);g.translate(endX,endY+logoSize*.68);
        const fs=unit*.052;g.font='900 '+fs+'px "Avenir Next",Helvetica,sans-serif';
        g.textAlign='center';g.textBaseline='middle';if('letterSpacing' in g)g.letterSpacing=fs*.17+'px';
        const labelWidth=g.measureText(finalBrand).width+fs*1.55;
        g.fillStyle=black;g.fillRect(-labelWidth/2,-fs*.77,labelWidth,fs*1.55);g.fillStyle=cream;g.fillText(finalBrand,0,fs*.04);g.restore();
      }
    }
    g.restore();
    g.fillStyle=g.createPattern(grain,'repeat');g.fillRect(0,0,w,h);
  }

  function draw(canvas,{preset:p,brand,color,t,thumb=false,headline='开抢',transparentBackground=false}){
    const g=canvas.getContext('2d'),w=canvas.clientWidth||canvas.width,h=canvas.clientHeight||canvas.height;
    const dpr=Math.min(window.devicePixelRatio||1,thumb?1.6:2);
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.max(1,Math.round(w*dpr));canvas.height=Math.max(1,Math.round(h*dpr))}
    g.setTransform(canvas.width/w,0,0,canvas.height/h,0,0);
    if(p.id==='impact'){drawImpact(g,w,h,brand,color,t,headline);return}
    const col=rgb(color),id=p.id, cx=w*.5, cy=h*(thumb?.50:brand==='custom'?.50:.46);
    const size=Math.min(h*(thumb?.72:.54),w*(thumb?.55:.42))*(brand==='custom'?1.14:1);
    const fg=isLight(id)?ink:white;
    const base=isLight(id)?mix(col,white,.37):mix(col,[4,8,10],.94);
    if (transparentBackground) g.clearRect(0,0,w,h); else { g.fillStyle=css(base);g.fillRect(0,0,w,h); }
    const sx=Math.max(w,h*.9);
    if(id==='orbit'){
      glow(g,w*.68,h*.55,sx*.63,css(mix(col,[25,11,8],.62),.9));
      glow(g,cx,cy,size*1.15,css(col,.13));
      const unit=Math.max(thumb?18:34,h*.12);
      for(let x=cx%unit;x<w;x+=unit)line(g,x,0,x,h,css(col,.053));
      for(let y=cy%unit;y<h;y+=unit)line(g,0,y,w,y,css(col,.052));
      for(let j=0;j<73;j++)disk(g,random(j+11)*w,random(j+113)*h,random(j+41)*.8+.25,css(white,.12+random(j)*.32));
    }else if(id==='chrome'){
      const gr=g.createLinearGradient(0,h,w,0);gr.addColorStop(0,css(mix(col,white,.73)));gr.addColorStop(.58,css(mix(col,white,.32)));gr.addColorStop(1,css(mix(col,ink,.21)));g.fillStyle=gr;g.fillRect(0,0,w,h);
      for(let j=0;j<25;j++){
        g.beginPath();const phase=j*h*.034;
        g.moveTo(-w*.13,h*.35+phase);g.bezierCurveTo(w*.24,-h*.37+phase,w*.54,h*1.09+phase,w*1.1,-h*.30+phase+h*.03*Math.sin(t*TAU));g.strokeStyle=css(white,.22);g.lineWidth=.8;g.stroke();
      }
    }else if(id==='bounce'){
      const horizon=h*.72,shift=h*.05*Math.sin(Math.PI*t);g.fillStyle=css(col,.42);g.fillRect(0,horizon,w,h-horizon);
      for(let i=-10;i<=10;i++)line(g,cx+i*size*.25,horizon,cx+i*size*.64,h,css(ink,.14),.7);
      for(let i=0;i<6;i++){const y=horizon+(h-horizon)*Math.pow(i/5,1.6);line(g,0,y,w,y,css(ink,.18),.7)}
      for(let j=0;j<3;j++)ellipse(g,cx,horizon+size*.13+shift*.18,size*(.26+j*.14),size*(.029+j*.021),0,css(ink,.2-j*.045));
    }else if(id==='print'){
      for(let j=0;j<5;j++){const off=(j-2)*w*.42;g.fillStyle=css(col,.34);g.beginPath();g.moveTo(off,0);g.lineTo(off+w*.18,0);g.lineTo(off+w*.52,h);g.lineTo(off+w*.34,h);g.fill()}
    }else if(id==='glitch'){
      for(let j=0;j<55;j++){const y=random(j+14)*h;line(g,random(j+22)*w*.22,y,w*(.55+random(j+41)*.45),y,css(col,.06+random(j+91)*.11),.5)}
      for(let j=0;j<20;j++){g.fillStyle=css(col,.22);g.fillRect(random(j+481)*w,random(j+331)*h,1+random(j+21)*12,1)}
    }else if(id==='iris'){
      for(let j=13;j>0;j--){const r=(j+(1-out(t))*.7)*size*.135;disk(g,cx,cy,r,css(mix(col,ink,.49+j*.031)));ellipse(g,cx,cy,r,r,0,css(col,.28),.8)}
    }else if(id==='fold'){
      const gap=w/(thumb?15:26);
      for(let i=-4;i<w/gap+1;i++){const x=i*gap;const gr=g.createLinearGradient(x,0,x+gap,0);gr.addColorStop(0,css(ink,.11));gr.addColorStop(1,css(white,.10));g.fillStyle=gr;g.save();g.transform(1,0,-.16,1,0,0);g.fillRect(x,0,gap,h);g.restore()}
    }
    if (!transparentBackground) { g.save();g.fillStyle=g.createPattern(grain,'repeat');g.fillRect(0,0,w,h);g.restore(); }
    const metal=brand==='custom'?sprite(brand,color):sprite(brand,id==='chrome'?'#D3CFE4':color);
    const flatColor=id==='bounce'?'#37372B':id==='print'?'#323537':id==='fold'?'#613D31':color;
    const logo=brand==='custom'?metal:(['bounce','print','glitch'].includes(id)?sprite(brand,flatColor,'flat'):metal);
    const k=size/Math.max(logo.width,logo.height),lw=logo.width*k,lh=logo.height*k;
    function stamp(x=cx,y=cy,scale=1,rotation=0,opacity=1,source=logo,stretch=1){
      if(opacity<=0||scale<=0)return;
      g.save();g.globalAlpha=clamp(opacity);g.translate(x,y);g.rotate(rotation);g.scale(scale*stretch,scale);g.drawImage(source,-lw/2,-lh/2,lw,lh);g.restore();
    }
    if(id==='orbit'){
      const phase=out(t/.77),rx=size*(1.04+(1-phase)*.28),ry=size*.26,ang=-.24;
      ellipse(g,cx,cy,rx,ry,ang,css(col,.57),.85);
      ellipse(g,cx,cy,rx*1.13,ry*1.25,ang+.07,css(col,.24),.8);
      ellipse(g,cx,cy,rx*.93,ry*1.52,.32,css(col,.28),.8);
      ellipse(g,cx,cy,rx*.74,ry*1.06,-.59,css(white,.14),.7);
      const phi=-2.48+t*2.85;
      for(let j=0;j<4;j++){
        const a=phi+j*1.45,x=rx*Math.cos(a),y=ry*Math.sin(a),px=cx+x*Math.cos(ang)-y*Math.sin(ang),py=cy+y*Math.cos(ang)+x*Math.sin(ang);
        disk(g,px,py,j?1.7:2.7,css(mix(col,white,.5)));if(!j)glow(g,px,py,10,css(col,.58));
      }
      const alpha=smooth(.01,.27,t);
      stamp(cx,cy+(1-phase)*size*.12,.64+.36*phase,-.96*(1-phase),alpha);
      ellipse(g,cx,cy,rx,ry,ang,css(mix(col,white,.35),.62),.9,.14,2.49);
      const slash=size*.033;
      for(const sign of [-1,1]){const x=cx+sign*rx*1.18;line(g,x-slash,cy,x+slash,cy,css(col,.54),.7);line(g,x,cy-slash,x,cy+slash,css(col,.54),.7)}
    }else if(id==='chrome'){
      const e=out((t-.02)/.62);const shear=1-e;
      g.save();g.translate(cx,cy);g.transform(1,shear*-.25,shear*.45,1,0,0);
      stamp(0,size*.12*shear,.73+.27*e,-.45*shear,smooth(0,.23,t));g.restore();
      // The traveling specular band is clipped to the exact mark.
      const shine=fade(t,.18,.29,.72,.87);if(shine>.001){
        const overlay=shineLayer(logo, (t-.18)/.69);stamp(cx,cy,1,0,shine*.86,overlay);
      }
    }else if(id==='dust'){
      drawParticleBurst(g,w,h,cx,cy,size,t,brand,col,thumb,stamp);
    }else if(id==='bounce'){
      const settle=1-smooth(.67,.88,t);
      const first=clamp(t/.34), y=t<.34?-(1-first*first)*size*.9:-Math.abs(Math.sin((t-.34)*Math.PI*4.5))*Math.exp(-7*(t-.34))*size*.49*settle;
      const squash=.24*Math.exp(-Math.pow((t-.34)/.055,2))+.09*Math.exp(-Math.pow((t-.56)/.045,2));
      g.save();g.translate(cx,cy+y+size*squash*.4);g.scale(1+squash,1-squash);stamp(0,0,1,-.23*(1-out(t/.6)),smooth(0,.16,t));g.restore();
    }else if(id==='print'){
      const shift=(1-smooth(.28,.78,t))*size*.19;
      const blue=sprite(brand,'#437AA4','flat'),red=sprite(brand,'#EF4A4E','flat');
      stamp(cx-shift,cy+shift*.47,1,0,fade(t,0,.20,.66,.83),blue);
      stamp(cx+shift,cy-shift*.42,1,0,fade(t,.10,.28,.66,.83),red);
      stamp(cx,cy,1,0,smooth(.29,.7,t));
    }else if(id==='glitch'||id==='fold'){
      const count=id==='glitch'?18:8;
      for(let i=0;i<count;i++){
        const k=out((t-random(i+101)*.28)/.50),rem=1-k;
        const left=cx-lw/2,top=cy-lh/2;
        g.save();g.globalAlpha=smooth(.005,.14,t);
        if(id==='glitch'){
          const off=Math.sin(i*73+Math.floor(t*22)*1.7)*rem*size*.66,sh=lh/count;
          if(rem>.04){g.fillStyle=css(col,.38*rem);g.fillRect(left+off-sh,top+i*sh,lw*.8,Math.max(1,sh*.17))}
          g.drawImage(logo,0,i*logo.height/count,logo.width,logo.height/count,left+off,top+i*sh,lw,sh+.13);
        }else{
          const sw=lw/count,x=left+i*sw,y=top+(i%2?1:-1)*rem*size*.24;
          g.translate(x,y);g.transform(.10+.9*k,rem*(i%2?.66:-.66),0,1,0,0);
          g.drawImage(logo,i*logo.width/count,0,logo.width/count,logo.height,0,0,sw+.18,lh);
        }g.restore();
      }
    }else if(id==='iris'){
      const e=smooth(.06,.72,t);g.save();g.beginPath();g.arc(cx,cy,size*.74*e,0,TAU);g.clip();stamp(cx,cy,1.30-.30*e,.17*(1-e));g.restore();
      ellipse(g,cx,cy,size*(.13+.90*e),size*(.13+.90*e),0,css(white,.44*(1-e)),1.4);
    }
    if(!thumb&&brand!=='custom'){
      const brandInfo=brands.find(b=>b.id===brand),a=id==='dust'?smooth(.73,.88,t):smooth(.53,.81,t);
      g.save();g.globalAlpha=a;g.fillStyle=css(fg,.97);g.textAlign='center';g.textBaseline='middle';
      const fs=Math.max(12,Math.min(27,size*.129));
      g.font=brand==='aster'?'italic 600 '+fs*1.14+'px Georgia,serif':'650 '+fs+'px "Avenir Next",Helvetica,sans-serif';
      const by=cy+size*.65+(1-a)*6;
      if('letterSpacing' in g)g.letterSpacing=(brand==='aster'?.03:.22)*fs+'px';
      g.fillText(brandInfo.word,cx,by);g.restore();
    }
  }
  const sheenCanvas=makeCanvas(1);
  function shineLayer(logo,t){
    const w=Math.min(420,logo.width),h=Math.max(1,Math.round(w*logo.height/logo.width));
    if(sheenCanvas.width!==w||sheenCanvas.height!==h){sheenCanvas.width=w;sheenCanvas.height=h}
    const g=sheenCanvas.getContext('2d');g.clearRect(0,0,w,h);g.drawImage(logo,0,0,w,h);g.globalCompositeOperation='source-in';
    const x=(-.6+2.1*t)*w,gr=g.createLinearGradient(x,0,x+w*.6,h*.26);
    gr.addColorStop(0,'transparent');gr.addColorStop(.4,'rgba(255,255,255,.05)');gr.addColorStop(.52,'rgba(255,255,255,.94)');gr.addColorStop(.65,'rgba(255,255,255,.18)');gr.addColorStop(1,'transparent');g.fillStyle=gr;g.fillRect(0,0,w,h);g.globalCompositeOperation='source-over';return sheenCanvas;
  }
  return {draw,presets,brands,setUpload,sprite,isLight};
})();

export default MotionArt;
