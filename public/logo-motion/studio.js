(() => {
  const {draw, presets, brands, isLight, sprite, setUpload} = window.MotionArt;
  const $ = id => document.getElementById(id);
  const paths = {
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-9v.1"/>',
    upload:'<path d="M12 15V3m-4 4 4-4 4 4M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    expand:'<path d="M4 9V4h5m6 0h5v5m0 6v5h-5M9 20H4v-5"/>',
    collapse:'<path d="M9 4v5H4m11-5v5h5m0 6h-5v5m-6 0v-5H4"/>',
    play:'<path d="M6 3.9c0-.8.8-1.1 1.4-.8L21 11.3a.8.8 0 0 1 0 1.4L7.4 20.9c-.6.4-1.4 0-1.4-.8Z" stroke="none"/>',
    pause:'<path d="M6 4h4v16H6zm8 0h4v16h-4z" stroke="none"/>',
    repeat:'<path d="m16 2 4 4-4 4M4 11V9a3 3 0 0 1 3-3h12M8 22l-4-4 4-4m12-1v2a3 3 0 0 1-3 3H5"/>',
    sliders:'<path d="M3 7h6m4 0h8M3 17h10m4 0h4"/><circle cx="11" cy="7" r="2"/><circle cx="15" cy="17" r="2"/>',
    restart:'<path d="M4 10a8 8 0 1 1 .7 7M4 4v6h6"/>',
    close:'<path d="m5 5 14 14M19 5 5 19"/>',
    soundOff:'<path d="m11 5-5 4H3v6h3l5 4zm5 5 5 5m0-5-5 5"/>',
    soundOn:'<path d="m11 5-5 4H3v6h3l5 4zm4 4a4 4 0 0 1 0 6m3-9a8 8 0 0 1 0 12"/>',
    check:'<path d="m4 12 5 5L20 6"/>',
    plus:'<path d="M12 5v14M5 12h14"/>'
  };
  function icon(name){return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">'+paths[name]+'</svg>'}
  document.querySelectorAll('[data-icon]').forEach(node=>node.outerHTML=icon(node.dataset.icon));
  const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const sceneSettings=new Map(), allowed=['#FF673D','#A69AFF','#79DFCA','#F3C852'];
  let selected=presets[0], brand=brands[0].id, accent=selected.color, seconds=selected.seconds;
  let filter='全部', progress=1, playing=false, loop=false, frameId=0, tickStart=0;
  let custom=null, importVersion=0, toastTimer=0, activeCover=null, coverStart=0;
  const brandButtons=new Map(), covers=new Map(), filters=new Map(), screen=$('screen');
  const timeText=(s,digits=2)=>s.toFixed(digits);
  function message(text){clearTimeout(toastTimer);$('toast').textContent=text;toastTimer=setTimeout(()=>$('toast').textContent='',3200)}
  function remember(){sceneSettings.set(selected.id,{accent,seconds})}
  let soundEnabled=false;
  const impactTrackSeconds=2.6;
  const impactAudio=new Audio('./flash-impact.wav');
  impactAudio.preload='none';
  impactAudio.preservesPitch=false;
  function syncSound(){
    impactAudio.pause();
    if(!soundEnabled||!playing||selected.id!=='impact'||progress>=1)return;
    impactAudio.playbackRate=impactTrackSeconds/seconds;
    impactAudio.currentTime=progress*impactTrackSeconds;
    impactAudio.play().catch(()=>{});
  }
  function offerText(){return $('offer').value.trim()||'开抢'}
  function drawStage(){
    draw(screen,{preset:selected,brand,color:accent,t:progress,headline:offerText()});
    $('seek').value=Math.round(progress*1000);
    $('seek').style.setProperty('--progress',progress*100+'%');
    $('current').textContent=timeText(progress*seconds);
    $('seek').setAttribute('aria-valuetext',timeText(progress*seconds)+' 秒');
  }
  function displayCover(p,t=p.poster){
    const cover=covers.get(p.id);if(!cover||cover.button.hidden||!cover.canvas.clientWidth)return;
    const color=p===selected?accent:sceneSettings.get(p.id)?.accent||p.color;
    draw(cover.canvas,{preset:p,brand,color,t,thumb:true,headline:offerText()});
  }
  function repaint(){drawStage();for(const p of presets)displayCover(p)}
  function playIcon(){
    $('play').innerHTML=icon(playing?'pause':'play');$('play').setAttribute('aria-label',playing?'暂停':'播放');
  }
  function schedule(){if(!frameId)frameId=requestAnimationFrame(tick)}
  function tick(now){
    frameId=0;
    if(playing){
      const elapsed=(now-tickStart)/(seconds*1000);
      progress=Math.min(1,Math.max(0,elapsed));
      if(elapsed>=1){if(loop){if(elapsed>=1.17){progress=0;tickStart=now;syncSound()}}else{playing=false;playIcon()}}
      drawStage();
    }
    if(activeCover){
      const p=activeCover,t=(now-coverStart)/(p.seconds*1000);
      displayCover(p,Math.min(1,Math.max(0,t)));
      if(t>=1)activeCover=null;
    }
    if(playing||activeCover)schedule();
  }
  function pause(){playing=false;impactAudio.pause();playIcon()}
  function start(from=0){
    progress=from;playing=true;tickStart=performance.now()-progress*seconds*1000;playIcon();drawStage();syncSound();schedule();
  }
  function audition(){if(reduceMotion.matches){pause();progress=1;drawStage()}else start()}
  function toggle(){if(playing)pause();else start(progress>=1?0:progress)}
  function setSeconds(value){seconds=value;$('duration').value=value;$('duration-label').textContent=timeText(value,1)+'s';$('total').textContent=timeText(value)+'s';$('duration').style.setProperty('--progress',(value-1)/5*100+'%')}
  function renderSwatches(){
    const box=$('swatches');box.replaceChildren();
    const colors=[...new Set([selected.color,...allowed])].slice(0,4);
    for(const [i,hex] of colors.entries()){
      const b=document.createElement('button');b.className='swatch';b.type='button';b.style.setProperty('--swatch',hex);
      b.setAttribute('aria-label',(i===0?'预设配色 ':'动效色 ')+hex);b.title=b.getAttribute('aria-label');b.setAttribute('aria-pressed',hex===accent);
      b.onclick=()=>changeColor(hex);box.append(b);
    }
    const label=document.createElement('label');label.className='swatch picker';label.title='自定义动效色';label.innerHTML=icon('plus');
    const input=document.createElement('input');input.type='color';input.value=accent;input.setAttribute('aria-label','自定义动效色');
    input.oninput=()=>changeColor(input.value.toUpperCase(),false);input.onchange=()=>renderSwatches();
    label.append(input);box.append(label);$('color-code').textContent=accent;
  }
  function changeColor(hex,renew=true){
    accent=hex;remember();$('color-code').textContent=accent;
    if(renew)renderSwatches();else document.querySelectorAll('button.swatch').forEach(b=>b.setAttribute('aria-pressed',b.style.getPropertyValue('--swatch')===hex));
    drawStage();displayCover(selected);
  }
  function selectPreset(p){
    if(activeCover){displayCover(activeCover);activeCover=null}
    selected=p;accent=sceneSettings.get(p.id)?.accent||p.color;setSeconds(sceneSettings.get(p.id)?.seconds||p.seconds);
    $('stage').dataset.scene=p.id;
    $('offer-field').hidden=p.id!=='impact';$('sound').hidden=p.id!=='impact';
    const n=String(presets.indexOf(p)+1).padStart(2,'0');
    $('scene-number').textContent=n;$('big-index').textContent=n;$('scene-en').textContent=p.en;$('scene-cn').textContent=p.name;
    $('stage').style.color=isLight(p.id)?'#23251f':'#fff6ec';screen.setAttribute('aria-label',(brand==='custom'?custom.name:brands.find(b=>b.id===brand).name)+' · '+p.name+'开屏动画');
    for(const [id,c] of covers)c.button.setAttribute('aria-pressed',id===p.id);
    renderSwatches();audition();displayCover(p);
  }
  function selectBrand(id){
    brand=id;for(const [key,b] of brandButtons)b.setAttribute('aria-pressed',key===id);
    screen.setAttribute('aria-label',(id==='custom'?custom.name:brands.find(b=>b.id===id).name)+' · '+selected.name+'开屏动画');
    for(const p of presets)displayCover(p);
    audition();
  }
  function addBrand(id,name,source){
    let b=brandButtons.get(id);if(!b){b=document.createElement('button');b.type='button';b.className='brand'+(id==='custom'?' imported':'');b.onclick=()=>selectBrand(id);brandButtons.set(id,b);$('brands').append(b)}
    const img=document.createElement('img');img.className='brand-art';img.src=source;img.alt='';
    const label=document.createElement('span');label.textContent=name;b.replaceChildren(img,label);b.title=name;b.setAttribute('aria-label','使用 '+name+' 标志');b.setAttribute('aria-pressed',brand===id);
  }
  function setFilter(f){
    filter=f;
    if(activeCover){displayCover(activeCover);activeCover=null}
    for(const [name,b] of filters)b.setAttribute('aria-pressed',name===filter);
    let count=0;
    for(const p of presets){const visible=f==='全部'||p.type===f,c=covers.get(p.id);c.button.hidden=!visible;
      if(visible){count++;displayCover(p)}}
    $('preset-count').textContent=String(count).padStart(2,'0');
  }
  function makeGallery(){
    for(const [i,p] of presets.entries()){
      const b=document.createElement('button');b.className='preset';b.type='button';
      b.setAttribute('aria-label','预览'+p.name);b.onclick=()=>selectPreset(p);
      b.innerHTML='<div class="cover"><canvas aria-hidden="true"></canvas><span class="no">'+String(i+1).padStart(2,'0')+'</span><span class="card-select">'+icon('check')+'</span></div><div class="preset-info"><div><strong>'+p.name+'</strong><small>'+p.en+'</small></div><time>'+p.seconds.toFixed(1)+'s</time></div>';
      b.querySelector('.no').style.color=isLight(p.id)?'#302f2c':'#fff3e2';
      b.onpointerenter=e=>{if(e.pointerType==='mouse'&&!reduceMotion.matches){activeCover=p;coverStart=performance.now();schedule()}};
      b.onpointerleave=()=>{if(activeCover===p)activeCover=null;displayCover(p)};
      $('gallery').append(b);covers.set(p.id,{button:b,canvas:b.querySelector('canvas')});
    }
    for(const f of ['全部',...new Set(presets.map(p=>p.type))]){
      const b=document.createElement('button');b.type='button';b.className='filter';b.textContent=f;b.setAttribute('aria-pressed',f===filter);b.onclick=()=>setFilter(f);filters.set(f,b);$('filters').append(b);
    }
  }
  async function importFile(file){
    if(!file)return;
    const version=++importVersion;
    if(file.size>10*1024*1024){message('请使用 10 MB 以内的 Logo 图片');return}
    if(!/\.(svg|png|jpe?g|webp)$/i.test(file.name)&&!['image/svg+xml','image/png','image/jpeg','image/webp'].includes(file.type)){message('请选择 SVG、PNG、WebP 或 JPG 图片');return}
    try{
      const data=await new Promise((ok,fail)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=fail;r.readAsDataURL(file)});
      const image=new Image();image.src=data;await image.decode();if(version!==importVersion)return;
      if(!image.naturalWidth||!image.naturalHeight)throw Error('没有可显示尺寸');
      setUpload(image);const name=file.name.replace(/\.[^.]+$/,'')||'我的 Logo';custom={name};
      addBrand('custom',name,data);selectBrand('custom');message('已载入 '+name);
    }catch{if(version===importVersion)message('图片读取失败，请尝试透明 PNG 或带尺寸的 SVG')}
  }
  $('scene-count').textContent=$('preset-count').textContent=String(presets.length).padStart(2,'0');
  $('offer').oninput=()=>{drawStage();displayCover(presets.find(p=>p.id==='impact'))};
  $('sound').innerHTML=icon('soundOff');
  $('sound').onclick=()=>{
    soundEnabled=!soundEnabled;
    $('sound').setAttribute('aria-pressed',soundEnabled);
    $('sound').title=soundEnabled?'关闭促销音效':'开启促销音效';
    $('sound').innerHTML=icon(soundEnabled?'soundOn':'soundOff');
    if(soundEnabled&&!playing)start();else syncSound();
  };
  $('import').onclick=()=>$('logo-file').click();
  $('logo-file').onchange=e=>{importFile(e.target.files[0]);e.target.value=''};
  $('play').onclick=toggle;$('replay').onclick=()=>start();$('loop').onclick=()=>{
    loop=!loop;$('loop').setAttribute('aria-pressed',loop);
    if(loop&&!playing)start(progress>=1?0:progress);
  };
  $('seek').oninput=e=>{pause();progress=Number(e.target.value)/1000;drawStage()};
  $('duration').oninput=e=>{setSeconds(+e.target.value);remember();tickStart=performance.now()-progress*seconds*1000;syncSound();drawStage();covers.get(selected.id).button.querySelector('time').textContent=seconds.toFixed(1)+'s'};
  $('show-guide').onclick=()=>{$('guide').showModal()};
  $('close-guide').onclick=()=>$('guide').close();
  $('guide').onclick=e=>{if(e.target===$('guide')){const r=$('guide').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('guide').close()}};
  function fullState(){
    const on=!!document.fullscreenElement||$('player').classList.contains('fallback-full');
    $('expand').innerHTML=icon(on?'collapse':'expand');$('expand').setAttribute('aria-label',on?'退出全屏':'全屏预览');$('expand').title=on?'退出全屏':'全屏预览';requestAnimationFrame(repaint);
  }
  function fallbackFull(){const on=$('player').classList.toggle('fallback-full');document.body.classList.toggle('has-full',on);fullState()}
  $('expand').onclick=async()=>{
    if($('player').classList.contains('fallback-full')){fallbackFull();return}
    try{if(document.fullscreenElement)await document.exitFullscreen();else await $('player').requestFullscreen()}catch{fallbackFull()}
  };
  document.addEventListener('fullscreenchange',fullState);
  document.addEventListener('keydown',e=>{
    if(e.code==='Escape'&&$('player').classList.contains('fallback-full')){fallbackFull();return}
    if($('guide').open||e.ctrlKey||e.metaKey||e.altKey||e.target.matches('input,textarea,select,[contenteditable=true]'))return;
    if(e.code==='Space'&&!e.target.closest('button')){e.preventDefault();toggle()}
    if(['ArrowLeft','ArrowRight'].includes(e.code)){e.preventDefault();pause();progress=Math.max(0,Math.min(1,progress+(e.code==='ArrowRight'?1:-1)/(seconds*60)));drawStage()}
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden){pause();if(activeCover){displayCover(activeCover);activeCover=null}}});
  reduceMotion.addEventListener('change',()=>{if(reduceMotion.matches){pause();activeCover=null;progress=1;repaint()}});
  for(const b of brands){
    // Keep the controls small, even though the studio uses a high-resolution master.
    const small=document.createElement('canvas');small.width=small.height=64;small.getContext('2d').drawImage(sprite(b.id,'#25251F','flat'),0,0,64,64);
    addBrand(b.id,b.name,small.toDataURL());
  }
  makeGallery();
  new ResizeObserver(()=>{repaint()}).observe($('player'));
  const requestedPreset=new URLSearchParams(location.search).get('preset');
  selectPreset(presets.find(p=>p.id===requestedPreset)||presets[0]);
})();
