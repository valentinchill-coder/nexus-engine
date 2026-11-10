import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const $ = (id) => document.getElementById(id);
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const fmt = (v,d=0) => Number(v).toLocaleString("ru-RU",{maximumFractionDigits:d,minimumFractionDigits:d});
const defaults = {layout:"V",cyl:8,bore:86,stroke:86,compression:10.5,valves:4,cam:260,redline:7200,fuel:"efi",aspiration:"turbo",turbo:"single",boostTarget:1.0,turboSize:2,exhaust:70,gearbox:"manual6",firing:"auto"};
const cfg = {...defaults};
const state = {running:false,rpm:0,throttle:0,brake:0,boost:0,spool:0,coolant:22,oil:22,egt:180,iat:22,gear:0,speed:0,torque:0,power:0,damage:0,knock:0,phase:0,clutch:1,limiter:false,auto:false,bov:false,gearTimer:0,dyno:false,dynoData:[],lastPulse:0};
const ratios = {manual6:[3.45,2.12,1.45,1.00,.82,.68],dct7:[3.10,2.18,1.58,1.22,1,.84,.72],auto8:[4.70,3.13,2.10,1.67,1.29,1,.84,.67],cvt:[3.2,2.7,2.3,1.9,1.6,1.3,1,.8]};
const firingOrders = {4:[1,3,4,2],6:[1,5,3,6,2,4],8:[1,8,4,3,6,5,7,2],10:[1,6,5,10,2,7,3,8,4,9],12:[1,7,5,11,3,9,6,12,2,8,4,10]};
let scene,camera,renderer,orbit,root,crankGroup,parts=[],pistons=[],rods=[],valves=[],cams=[],turboWheels=[],superchargerWheels=[],turboFlap,cutawayParts=[],exploded=false,activeTab="run",ecuMode="fuel";
let audio=null,audioMaster=null,exhaustFilter=null,intakeFilter=null,turboOsc=null,turboGain=null,nextPulse=0,pulseIndex=0,audioLoopActive=false,engineSample=null,turboAssetPromise=null,detailedTurboRotors=[];
const mats = {};
function material(name,color,metal=.7,rough=.3){return mats[name] ||= new THREE.MeshStandardMaterial({color,metalness:metal,roughness:rough});}
const M={block:material("block",0x52616b,.82,.3),head:material("head",0x8998a2,.86,.23),dark:material("dark",0x17232d,.68,.36),steel:material("steel",0xc4cdd2,.92,.2),piston:material("piston",0xb5c0c7,.88,.22),copper:material("copper",0xb56d42,.8,.27),gold:material("gold",0xb59a5a,.84,.23),rubber:material("rubber",0x101519,.05,.82),red:material("red",0x8e3026,.6,.35),blue:material("blue",0x287c9b,.7,.27)};
function mesh(parent,geo,mat,pos=[0,0,0]){const o=new THREE.Mesh(geo,mat);o.position.set(...pos);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;}
function cyl(parent,r1,r2,len,mat,pos=[0,0,0],segments=32){return mesh(parent,new THREE.CylinderGeometry(r1,r2,len,segments),mat,pos);}
function between(parent,a,b,r,mat,r2=r){const v=new THREE.Vector3().subVectors(b,a),o=mesh(parent,new THREE.CylinderGeometry(r2,r,v.length(),14),mat);o.position.copy(a).add(b).multiplyScalar(.5);o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),v.normalize());return o;}
function bolt(parent,p,r=.025){const o=cyl(parent,r,r,.035,M.steel,p,12);o.rotation.x=Math.PI/2;return o;}
function roundedPrism(parent,length,width,height,mat,pos=[0,0,0]){
 const w=width/2,h=height/2,r=Math.min(width,height)*.14,sh=new THREE.Shape();
 sh.moveTo(-w+r,-h);sh.lineTo(w-r,-h);sh.quadraticCurveTo(w,-h,w,-h+r);sh.lineTo(w,h-r);sh.quadraticCurveTo(w,h,w-r,h);sh.lineTo(-w+r,h);sh.quadraticCurveTo(-w,h,-w,h-r);sh.lineTo(-w,-h+r);sh.quadraticCurveTo(-w,-h,-w+r,-h);
 const g=new THREE.ExtrudeGeometry(sh,{depth:length,steps:1,bevelEnabled:true,bevelSegments:3,bevelSize:.025,bevelThickness:.025});
 g.translate(0,0,-length/2);g.rotateY(Math.PI/2);g.computeVertexNormals();
 return mesh(parent,g,mat,pos);
}
function iBeamRod(parent,a,b,mat){
 const w=.115,h=.045,f=.012,web=.012,sh=new THREE.Shape();
 sh.moveTo(-w/2,-h/2);sh.lineTo(w/2,-h/2);sh.lineTo(w/2,-h/2+f);sh.lineTo(web/2,-h/2+f);sh.lineTo(web/2,h/2-f);sh.lineTo(w/2,h/2-f);sh.lineTo(w/2,h/2);sh.lineTo(-w/2,h/2);sh.lineTo(-w/2,h/2-f);sh.lineTo(-web/2,h/2-f);sh.lineTo(-web/2,-h/2+f);sh.lineTo(-w/2,-h/2+f);sh.closePath();
 const len=a.distanceTo(b),g=new THREE.ExtrudeGeometry(sh,{depth:len,steps:1,bevelEnabled:true,bevelSegments:2,bevelSize:.004,bevelThickness:.004});
 g.translate(0,0,-len/2);g.computeVertexNormals();
 const o=mesh(parent,g,mat);o.position.copy(a).add(b).multiplyScalar(.5);o.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),new THREE.Vector3().subVectors(b,a).normalize());return o;
}
function valveSpring(parent,x,y,z){
 const pts=[];for(let i=0;i<=48;i++){const t=i/48*Math.PI*2*6;pts.push(new THREE.Vector3(x+Math.cos(t)*.045,y-.12+i/48*.23,z+Math.sin(t)*.045));}
 return mesh(parent,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),120,.006,6,false),M.gold);
}

function init3D(){
 const c=$("engineView");renderer=new THREE.WebGLRenderer({canvas:c,antialias:true,alpha:false,powerPreference:"high-performance"});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
 scene=new THREE.Scene();scene.background=new THREE.Color(0x0a121b);scene.fog=new THREE.Fog(0x0a121b,9,22);
 camera=new THREE.PerspectiveCamera(38,1,.1,60);camera.position.set(5.4,4.1,6.5);
 orbit=new OrbitControls(camera,c);orbit.enableDamping=true;orbit.dampingFactor=.065;orbit.target.set(0,.25,0);orbit.minDistance=2.5;orbit.maxDistance=12;
 scene.add(new THREE.HemisphereLight(0xd8edff,0x202832,2.0));
 const key=new THREE.DirectionalLight(0xffffff,3.5);key.position.set(4,8,5);scene.add(key);
 const rim=new THREE.DirectionalLight(0x4cc9ec,2.1);rim.position.set(-5,3,-4);scene.add(rim);
 const floor=mesh(scene,new THREE.CircleGeometry(8,80),material("floor",0x101b25,.35,.65),[0,-1.45,0]);floor.rotation.x=-Math.PI/2;
 const grid=new THREE.GridHelper(14,28,0x294151,0x1b2b38);grid.position.y=-1.44;scene.add(grid);
 const resize=()=>{let w=c.clientWidth,h=c.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/Math.max(h,1);camera.updateProjectionMatrix();};new ResizeObserver(resize).observe(c);resize();
 buildEngine();
 function draw(){requestAnimationFrame(draw);const dt=clock.getDelta();animateEngine(dt);orbit.update();renderer.render(scene,camera);}
 const clock=new THREE.Clock();requestAnimationFrame(draw);
}
function loadDetailedTurbo(parent,x,z){
 const fallback=buildTurbo(parent,x,z);
 if(turboAssetPromise===null){
  turboAssetPromise=new Promise(resolve=>{
   new GLTFLoader().load("https://engx3d.com/models/turbo.glb",g=>resolve(g),undefined,()=>resolve(null));
  });
 }
 turboAssetPromise.then(g=>{
  if(!g||parent!==root)return;
  const model=g.scene.clone(true),box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
  const scale=1.08/Math.max(size.x,size.y,size.z);model.scale.setScalar(scale);
  model.position.set(x-center.x*scale,.42-center.y*scale,z-center.z*scale);
  model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}if(/compressor.*wheel|turbine.*wheel|rotor|shaft/i.test(o.name))detailedTurboRotors.push(o);});
  parent.add(model);fallback.visible=false;
 });
 return fallback;
}
function buildRootsSupercharger(parent,x,y,z){
 const housing=roundedPrism(parent,.95,.78,.58,M.blue,[x,y,z]);
 const cover=roundedPrism(parent,.92,.72,.12,M.dark,[x,y+.34,z]);
 for(let i=0;i<2;i++){
  const rotor=new THREE.Group();rotor.position.set(x,y,z+(i?-.19:.19));parent.add(rotor);
  const core=cyl(rotor,.075,.075,.78,M.steel,[0,0,0]);core.rotation.z=Math.PI/2;
  for(let l=0;l<3;l++){
   const points=[];for(let q=0;q<=48;q++){const t=q/48*Math.PI*2*1.15,xx=-.38+q/48*.76,phase=t+l*Math.PI*2/3+(i?Math.PI/3:0);points.push(new THREE.Vector3(xx,Math.cos(phase)*.14,Math.sin(phase)*.14));}
   mesh(rotor,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),100,.045,8,false),i?M.gold:M.steel);
  }
  superchargerWheels.push(rotor);
 }
 for(let i=0;i<2;i++){const gear=mesh(parent,new THREE.TorusGeometry(.13,.035,10,32),M.gold,[x-.58,y-.05,z+(i?-.19:.19)]);gear.rotation.y=Math.PI/2;}
 return housing;
}
function buildTurbo(parent,x,z){
 const g=new THREE.Group();g.position.set(x,.35,z);parent.add(g);
 const shell=mesh(g,new THREE.SphereGeometry(.52,32,24),M.dark,[0,0,0]);shell.scale.set(1,.82,1.05);
 const hot=mesh(g,new THREE.TorusGeometry(.43,.12,18,48),M.copper,[-.32,0,0]);hot.rotation.y=Math.PI/2;
 const cold=mesh(g,new THREE.TorusGeometry(.46,.12,18,48),M.head,[.62,0,0]);cold.rotation.y=Math.PI/2;
 const shaft=cyl(g,.075,.075,1.05,M.gold,[.18,0,0]);shaft.rotation.z=Math.PI/2;
 const compressor=new THREE.Group();compressor.position.set(.88,0,0);g.add(compressor);
 cyl(compressor,.19,.19,.1,M.gold,[0,0,0]).rotation.z=Math.PI/2;
 for(let i=0;i<13;i++){let a=i*Math.PI*2/13,b=mesh(compressor,new THREE.BoxGeometry(.32,.045,.09),M.steel,[Math.cos(a)*.19,Math.sin(a)*.19,0]);b.rotation.z=a+.42;}
 const turbine=new THREE.Group();turbine.position.set(-.46,0,0);g.add(turbine);
 cyl(turbine,.16,.16,.09,M.copper).rotation.z=Math.PI/2;
 for(let i=0;i<11;i++){let a=i*Math.PI*2/11,b=mesh(turbine,new THREE.BoxGeometry(.31,.05,.1),M.copper,[Math.cos(a)*.17,Math.sin(a)*.17,0]);b.rotation.z=a+.3;}
 const actuator=cyl(g,.13,.13,.36,M.head,[.02,.65,.35]);actuator.rotation.x=Math.PI/2;
 const rod=cyl(g,.022,.022,.44,M.steel,[.02,.36,.23]);rod.rotation.x=-.55;
 turboFlap=mesh(g,new THREE.BoxGeometry(.2,.035,.18),M.gold,[-.53,-.12,0]);
 for(let i=0;i<8;i++){let a=i*Math.PI/4;bolt(g,[Math.cos(a)*.49,Math.sin(a)*.49,.05],.018);}
 turboWheels.push(compressor,turbine);
 return g;
}
function buildEngine(){
 if(!scene)return;
 if(root)scene.remove(root);exploded=false;$("cutawayBtn").textContent="РАЗРЕЗ";root=new THREE.Group();scene.add(root);parts=[];pistons=[];rods=[];valves=[];cams=[];turboWheels=[];superchargerWheels=[];detailedTurboRotors=[];cutawayParts=[];turboFlap=null;
 const n=cfg.cyl,per=cfg.layout==="I"?n:Math.ceil(n/2),banks=cfg.layout==="I"?[0]:cfg.layout==="BOXER"?[-1.56,1.56]:[-.48,.48],spacing=clamp(.42+cfg.bore/1000,.46,.56),len=(per-1)*spacing+.9,bankAngle=cfg.layout==="V"?.48:cfg.layout==="BOXER"?1.56:0;
 // Deep sump and crankcase
 const crankcase=roundedPrism(root,len+1,1.4,.58,M.block,[0,-.38,0]);crankcase.material=crankcase.material.clone();cutawayParts.push(crankcase);
 const sump=roundedPrism(root,len+.72,1.28,.38,M.dark,[0,-.76,0]);sump.material=sump.material.clone();cutawayParts.push(sump);
 // crankshaft core
 crankGroup=new THREE.Group();root.add(crankGroup);
 const main=cyl(crankGroup,.13,.13,len+1.2,M.steel,[0,-.45,0]);main.rotation.z=Math.PI/2;
 const throws=[];
 for(let j=0;j<per;j++){const x=(j-(per-1)/2)*spacing;
  for(const z of [-.22,.22]){let web=cyl(crankGroup,.24,.24,.12,M.copper,[x,-.45,z]);web.rotation.z=Math.PI/2;}
  const pin=cyl(crankGroup,.095,.095,.43,M.gold,[x,-.45,.24]);pin.rotation.z=Math.PI/2;throws.push({x,pin,phase:j*Math.PI});
 }
 // banks / cylinders
 banks.forEach((ang,bi)=>{
  const bank=new THREE.Group();bank.rotation.x=ang;bank.position.z=(bi-(banks.length-1)/2)*.18;root.add(bank);
  const zbank=0;
  const headShell=roundedPrism(bank,len,1.05,.42,M.head,[0,.33,zbank]);headShell.material=headShell.material.clone();cutawayParts.push(headShell);
  const headBase=roundedPrism(bank,len,.98,.26,M.dark,[0,.66,zbank]);headBase.material=headBase.material.clone();cutawayParts.push(headBase);
  const valveCover=roundedPrism(bank,len+.12,.82,.19,material("cover"+bi,bi?0x2e5365:0x536c7b,.8,.25),[0,.91,zbank]);valveCover.material=valveCover.material.clone();cutawayParts.push(valveCover);
  // cam shafts on both sides of each head
  for(let ci=0;ci<2;ci++){
   const z=(ci?1:-1)*.3;
   const cam=cyl(bank,.065,.065,len+.28,M.gold,[0,1.12,z]);cam.rotation.z=Math.PI/2;cams.push(cam);
   for(let j=0;j<per;j++){const x=(j-(per-1)/2)*spacing;const lobe=mesh(bank,new THREE.SphereGeometry(.09,16,12),M.copper,[x,1.12,z]);lobe.scale.set(1,.65,1.2);}
  }
  for(let j=0;j<per;j++){
   const x=(j-(per-1)/2)*spacing,idx=bi*per+j,phase=j*Math.PI+(bi?Math.PI:0);
   // liner
   const sleeve=cyl(bank,cfg.bore/2000,cfg.bore/2000,.68,M.dark,[x,-.02,0],48);
   const lip=mesh(bank,new THREE.TorusGeometry(cfg.bore/2000,.018,10,48),M.steel,[x,.33,0]);lip.rotation.x=Math.PI/2;
   // piston with crown, skirt, ring lands and wrist pin
   const pg=new THREE.Group();bank.add(pg);
   cyl(pg,.174,.182,.19,M.piston,[0,0,0],40);
   cyl(pg,.177,.177,.035,M.head,[0,.11,0],40);
   for(let k=0;k<3;k++){const ring=mesh(pg,new THREE.TorusGeometry(.181,.009,8,40),M.steel,[0,.065-k*.04,0]);ring.rotation.x=Math.PI/2;}
   const pin=cyl(pg,.048,.048,.4,M.gold,[0,-.025,0],24);pin.rotation.z=Math.PI/2;
   pistons.push({group:pg,phase,bank,x,bi,j});
   const rod=iBeamRod(bank,new THREE.Vector3(x,-.18,0),new THREE.Vector3(x,-.6,.22),M.copper);
   rods.push({mesh:rod,bank,x,phase,bi,j});
   // four valve stems / heads per cylinder, animate on cam phase
   for(let v=0;v<cfg.valves;v++){
    const vz=(v<cfg.valves/2?-.23:.23),vx=x+(v%2?-.07:.07);
    const stem=cyl(bank,.018,.018,.28,M.steel,[vx,.78,vz],12);
    const head=cyl(bank,.05,.05,.035,M.head,[vx,.64,vz],20);
    valveSpring(bank,vx,.82,vz);
    valves.push({stem,head,phase,v});
   }
   // head bolts
   for(let b=0;b<4;b++)bolt(bank,[x+(b%2?-.17:.17),.78,b<2?-.36:.36],.018);
   // spark plug
   const plug=cyl(bank,.035,.035,.17,M.gold,[x,.76,0],16);plug.rotation.x=Math.PI/2;
  }
  // runners and exhaust primary pipes
  for(let j=0;j<per;j++){
   const x=(j-(per-1)/2)*spacing;
   const intakeCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(x,.7,.22),new THREE.Vector3(x,1.15,.42),new THREE.Vector3(x,.95,.7)]);
   mesh(bank,new THREE.TubeGeometry(intakeCurve,18,.06,12,false),M.blue);
   const exhaustCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(x,.15,-.34),new THREE.Vector3(x,-.15,-.55),new THREE.Vector3(x-.15,-.36,-.78),new THREE.Vector3(-len*.45,-.45,-.9)]);
   mesh(bank,new THREE.TubeGeometry(exhaustCurve,24,.055,10,false),M.copper);
  }
 });
 // Front timing case, gears, accessory drive
 const frontX=-len/2-.52;
 const timing=mesh(root,new THREE.BoxGeometry(.35,1.55,1.35),M.dark,[frontX,-.05,0]);
 for(let i=0;i<3;i++){const g=mesh(root,new THREE.TorusGeometry(.18+i*.06,.035,10,40),i===1?M.gold:M.steel,[frontX-.2,.35-i*.38,.42]);g.rotation.y=Math.PI/2;}
 const pulley=cyl(root,.32,.32,.18,M.steel,[frontX,-.86,.55]);pulley.rotation.z=Math.PI/2;
 const belt=mesh(root,new THREE.TorusGeometry(.43,.035,10,48),M.rubber,[frontX,-.86,.55]);belt.rotation.y=Math.PI/2;
 // Intake plenum, throttle and intercooler
 const plenum=cyl(root,.25,.25,len*.85,M.head,[0,1.38,0]);plenum.rotation.z=Math.PI/2;
 for(let j=0;j<per;j++){const x=(j-(per-1)/2)*spacing;const r=cyl(root,.08,.1,.38,M.steel,[x,1.18,.32]);r.rotation.x=.45;}
 const throttle=cyl(root,.22,.22,.26,M.dark,[len*.45,1.38,0]);throttle.rotation.z=Math.PI/2;
 const intercooler=mesh(root,new THREE.BoxGeometry(1.2,.38,.2),M.head,[len*.42,.48,1.12]);
 for(let i=0;i<14;i++)mesh(root,new THREE.BoxGeometry(.025,.31,.22),M.steel,[len*.42-.56+i*.086,.48,1.12]);
 if(cfg.aspiration!=="na"){
  if(cfg.turbo==="roots"){
   buildRootsSupercharger(root,len*.35,1.72,0);
  }else{
   loadDetailedTurbo(root,len*.58,.85);
   if(cfg.turbo==="twin"||cfg.turbo==="sequential")loadDetailedTurbo(root,-len*.58,.85);
  }
 }
 // Engine mounts, oil filter, oil cap, fuel rail
 for(const x of [-len*.32,len*.32]){mesh(root,new THREE.BoxGeometry(.35,.16,.65),M.dark,[x,-.98,0]);cyl(root,.12,.12,.3,M.red,[x,.78,.52]).rotation.x=Math.PI/2;}
 const filter=cyl(root,.12,.12,.4,M.red,[frontX+.4,-.55,.62]);filter.rotation.x=Math.PI/2;
 const cap=cyl(root,.09,.09,.08,M.gold,[0,1.65,0]);
 root.position.y=-.22;root.rotation.y=-.25;
 $("engineName").textContent=engineTitle();
 updateSpecs();loadEngineSample();
}
function engineTitle(){return cfg.layout==="V"?"V"+cfg.cyl:cfg.layout==="BOXER"?"BOXER "+cfg.cyl:"I"+cfg.cyl;}
function loadEngineSample(){
 const wasPlaying=!!(engineSample&&!engineSample.paused);
 if(engineSample){engineSample.pause();engineSample.src="";}
 let sample;
 if(cfg.cyl===8){sample={name:"V8 · field recording",creator:"overmedium",url:"https://cdn.freesound.org/previews/651/651534_2396512-hq.ogg"};}
 else if(cfg.layout==="BOXER"&&cfg.cyl===4){sample={name:"Flat-4 turbo · Subaru WRX proxy",creator:"ulose2piranha",url:"https://cdn.freesound.org/previews/273/273334_4168822-hq.ogg"};}
 else if(cfg.cyl===12){sample={name:"V12 · Rolls-Royce Merlin",creator:"squashy555",url:"https://cdn.freesound.org/previews/276/276597_1149179-hq.mp3"};}
 else if(cfg.cyl===6&&cfg.aspiration!=="na"){sample={name:"Turbo six · Supra dyno proxy",creator:"editboy23",url:"https://cdn.freesound.org/previews/496/496171_1784475-hq.ogg"};}
 else if(cfg.layout==="I"&&cfg.cyl===4){sample={name:"Inline-4 · Honda Civic proxy",creator:"thepodcastdoctor",url:"https://cdn.freesound.org/previews/487/487553_9945386-hq.mp3"};}
 else if(cfg.cyl===6&&cfg.layout==="BOXER"){sample={name:"Flat-six · Porsche 911 proxy",creator:"mharo",url:"https://cdn.freesound.org/previews/55/55727_267249-hq.mp3"};}
 else {sample={name:"Engine recording · V8 proxy",creator:"overmedium",url:"https://cdn.freesound.org/previews/651/651534_2396512-hq.ogg"};}
 engineSample=new Audio();engineSample.preload="none";engineSample.loop=true;engineSample.playsInline=true;engineSample.volume=0;engineSample.playbackRate=.85;engineSample.onerror=()=>{const label=$("soundSource");if(label)label.textContent="Резервный синтезированный звук";audioLoop();};engineSample.src=sample.url;
 const label=$("soundSource");if(label)label.textContent=sample.name+" · CC0 / "+sample.creator;
 if(wasPlaying)engineSample.play().catch(()=>{});
}

function updateSpecs(){
 $("specLayout").value=cfg.layout;$("specLayoutRead").textContent=engineTitle();$("specGearbox").value=cfg.gearbox;$("specTurboSize").value=cfg.turboSize;$("specFiring").value=cfg.firing;$("specFuel").value=cfg.fuel;$("specExhaust").value=cfg.exhaust;$("exhaustOut").textContent=cfg.exhaust+" см";$("specCyl").value=cfg.cyl;$("specBore").value=cfg.bore;$("specStroke").value=cfg.stroke;$("specComp").value=cfg.compression;$("specValves").value=cfg.valves;$("specCam").value=cfg.cam;$("specRedline").value=cfg.redline;$("specAsp").value=cfg.aspiration;$("specTurbo").value=cfg.turbo;$("specBoost").value=cfg.boostTarget;$("specBoostOut").textContent=cfg.boostTarget.toFixed(1)+" bar";
 $("specDisp").textContent=(Math.PI/4*(cfg.bore/10)**2*(cfg.stroke/10)*cfg.cyl/1000).toFixed(2)+" л";
 $("specMean").textContent=(2*cfg.stroke/1000*cfg.redline/60).toFixed(1)+" м/с";
 $("redlineRead").textContent=fmt(cfg.redline);$("compressionRead").textContent=cfg.compression.toFixed(1)+":1";
}
function animateEngine(dt){
 if(!root)return;
 const a=state.phase;
 crankGroup.rotation.x=a;
 pistons.forEach(p=>{const r=cfg.stroke/2000,l=.145,ang=a+p.phase,travel=r*Math.cos(ang)+Math.sqrt(Math.max(.001,l*l-r*r*Math.sin(ang)**2));p.group.position.set(p.x,.06+travel-r,0);});
 rods.forEach(r=>{const ang=a+r.phase,rad=cfg.stroke/2000;const top=new THREE.Vector3(r.x,.06+rad*Math.cos(ang),0),bot=new THREE.Vector3(r.x,-.45+rad*Math.cos(ang),rad*Math.sin(ang));r.mesh.position.copy(top).add(bot).multiplyScalar(.5);r.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),bot.sub(top).normalize());});
 cams.forEach(c=>c.rotation.x=a*.5);
 valves.forEach(v=>{const lift=Math.max(0,Math.sin(a*.5+v.phase+(v.v%2)*Math.PI/2))*.075;v.stem.position.y=.78-lift;v.head.position.y=.64-lift;});
 turboWheels.forEach((w,i)=>{w.rotation.x+=dt*(state.spool*150)*(i%2?1.02:1);});
 superchargerWheels.forEach((w,i)=>{w.rotation.x+=dt*(state.rpm/60*Math.PI*2*1.8)*(i?-1:1);});
 detailedTurboRotors.forEach((w,i)=>{w.rotation.x+=dt*(state.spool*165)*(i%2?1.02:1);});
 if(turboFlap)turboFlap.rotation.y=state.boost>cfg.boostTarget*.9?.35:0;
 root.scale.setScalar(1);
}
function torqueModel(rpm,boost=state.boost){
 const disp=Math.PI/4*(cfg.bore/10)**2*(cfg.stroke/10)*cfg.cyl/1000;
 const peak=disp*92*(cfg.compression/10.5)**.35*(cfg.cam/260)**.12;
 const x=rpm/Math.max(1,cfg.redline);
 const ve=(.72+.32*Math.exp(-Math.pow((x-.48)/.3,2)))*Math.max(.5,1-state.damage*.45);
 const boostFactor=cfg.aspiration==="na"?1:1+boost*.62;
 const timing=cfg.cam>290?1.05:.98;
 const row=clamp(Math.floor((1-state.throttle)*7),0,7),col=clamp(Math.floor(x*11),0,11);
 const fuelTrim=cfg.ecuFuel?.[row]?.[col]??1;
 const sparkTrim=cfg.ecuSpark?.[row]?.[col]??1;
 const fuelSystem=cfg.fuel==="carb" ? .97 : cfg.fuel==="di" ? 1.035 : 1;
 return peak*ve*boostFactor*timing*fuelSystem*clamp(fuelTrim,.75,1.3)*clamp(sparkTrim,.88,1.08);
}
function tickPhysics(dt){
 const disp=Math.PI/4*(cfg.bore/10)**2*(cfg.stroke/10)*cfg.cyl/1000;
 
 const spoolTarget=state.running&&state.throttle>.05&&cfg.aspiration!=="na"&&cfg.turbo!=="roots"?clamp(state.throttle*(state.rpm/cfg.redline)*1.9,0,1):0;
 const inertia=cfg.turboSize===1?6:cfg.turboSize===2?2.6:1.2;
 state.spool+=(spoolTarget-state.spool)*Math.min(1,dt*(spoolTarget>state.spool?inertia:5));
 const desiredBoost=cfg.aspiration==="na"?0:cfg.turbo==="roots"?cfg.boostTarget*state.throttle*.94:cfg.boostTarget*state.spool;
 state.boost+=(desiredBoost-state.boost)*Math.min(1,dt*(desiredBoost>state.boost?2.8:6));
 if(state.bov)state.boost=Math.max(0,state.boost-dt*3.8);
 const baseTorque=torqueModel(Math.max(800,state.rpm),state.boost);
 const firing=firingOrders[cfg.cyl]||Array.from({length:cfg.cyl},(_,i)=>i+1);
 let combustion=0;
 for(let i=0;i<cfg.cyl;i++){const ph=(state.phase+(i*Math.PI*4/cfg.cyl))%(Math.PI*4);const burn=Math.exp(-Math.pow((((ph+Math.PI*4)%(Math.PI*4))-Math.PI*.18)/.34,2));combustion+=burn;}
 const pulseFactor=.82+.18*combustion/Math.max(1,cfg.cyl/2);
 state.torque=state.running?baseTorque*(.15+.85*state.throttle)*pulseFactor*(1-state.damage*.5):0;
 const gearRatio=state.gear>0?(ratios[cfg.gearbox][state.gear-1]||1):0;
 const load=state.brake*.7+(gearRatio?Math.max(0,state.speed)*.018:0);
 const idleAssist=state.running?clamp((850-state.rpm)*.012,-12,12):0;
 const net=state.running?(state.torque*state.clutch*.035-load*18-(state.rpm*.0025)+idleAssist): -state.rpm*2.2;
 state.rpm=clamp(state.rpm+net*dt,0,cfg.redline*1.05);
 if(state.running&&state.rpm<850&&state.throttle<.04)state.rpm=Math.max(0,state.rpm-dt*180);
 if(state.rpm>cfg.redline){state.limiter=true;state.rpm=cfg.redline-80;state.damage=clamp(state.damage+dt*.001,0,1);}else state.limiter=false;
 if(cfg.aspiration!=="na"&&state.boost>cfg.boostTarget*1.08){state.damage=clamp(state.damage+dt*.004,0,1);state.knock=clamp(state.knock+dt*.1,0,1);}else state.knock=Math.max(0,state.knock-dt*.15);
 const rpmFactor=gearRatio?state.rpm/(gearRatio*3.7):0;const speedTarget=gearRatio?rpmFactor*.00205*60:0;state.speed+=(speedTarget-state.speed)*Math.min(1,dt*2.2);
 state.power=state.torque*state.rpm/7127;
 if(engineSample){engineSample.playbackRate=.72+.72*clamp((state.rpm-700)/Math.max(1,cfg.redline-700),0,1);engineSample.volume=state.running?clamp(.12+state.throttle*.58,0,.7):0;}
 if(audio&&turboOsc&&turboGain){turboOsc.frequency.setTargetAtTime(420+state.spool*3600,audio.currentTime,.06);turboGain.gain.setTargetAtTime(state.spool*.025,audio.currentTime,.08);}
 state.coolant+=(state.running?(88+state.throttle*28-state.coolant)*dt*.022:(22-state.coolant)*dt*.012);
 state.oil+=(state.running?(90+state.throttle*18-state.oil)*dt*.018:(22-state.oil)*dt*.01);
 state.iat+=(22+state.boost*28-state.iat)*dt*.4;
 state.egt+=(state.running?(280+state.throttle*620+state.boost*90-state.egt)*dt*.38:(180-state.egt)*dt*.18);
 if(state.coolant>112)state.damage=clamp(state.damage+dt*.002,0,1);
 state.phase+=dt*state.rpm/60*Math.PI*2;
 if(state.auto&&state.running&&state.gear===0&&state.gearTimer<=0)shift(1);
 if(state.auto&&state.running&&state.gearTimer<=0&&gearRatio){if(state.rpm>cfg.redline*.84&&state.gear<ratios[cfg.gearbox].length)shift(1);else if(state.rpm<1900&&state.gear>1)shift(-1);}
 state.gearTimer=Math.max(0,state.gearTimer-dt);
 if(state.dyno&&state.running&&state.rpm>1000&&Math.floor(performance.now()/140)!==state.lastPulse){state.lastPulse=Math.floor(performance.now()/140);state.dynoData.push({rpm:state.rpm,t:state.torque,p:state.power});drawDyno();}
 updateDashboard();
}
function updateDashboard(){
 $("rpmValue").textContent=fmt(state.rpm);$("powerValue").textContent=fmt(state.power);$("torqueValue").textContent=fmt(state.torque);$("boostValue").textContent=state.boost.toFixed(2);
 $("rpmBar").style.width=(state.rpm/cfg.redline*100)+"%";
 $("coolantValue").textContent=fmt(state.coolant)+"°";$("oilValue").textContent=fmt(state.oil)+"°";$("iatValue").textContent=fmt(state.iat)+"°";$("egtValue").textContent=fmt(state.egt)+"°";
 $("spoolValue").textContent=fmt(state.spool*165000)+" rpm";$("spoolBar").style.width=state.spool*100+"%";$("speedValue").textContent=fmt(state.speed)+" км/ч";$("gearValue").textContent=state.gear===0?"N":state.gear<0?"R":state.gear;
 $("engineStatus").textContent=state.running?(state.limiter?"ОТСЕЧКА":state.damage>.25?"НЕИСПРАВНОСТЬ":"РАБОТАЕТ"):"ОСТАНОВЛЕН";
 $("engineStatus").className=state.running?"status on":"status";
 $("throttleValue").textContent=Math.round(state.throttle*100)+"%";$("throttle").value=state.throttle*100;$("brakeValue").textContent=Math.round(state.brake*100)+"%";
 $("bovStatus").textContent=state.bov?"СБРОС":"ЗАКРЫТ";$("wgStatus").textContent=state.boost>cfg.boostTarget*.92?"ОТКРЫВАЕТСЯ":"ЗАКРЫТ";
}
function shift(dir){if(state.gearTimer>0)return;state.gear=clamp(state.gear+dir,0,ratios[cfg.gearbox].length);state.gearTimer=.28;state.clutch=.25;setTimeout(()=>state.clutch=1,180);$("gearValue").textContent=state.gear||"N";renderGears();}
function renderGears(){const box=$("gearButtons");box.innerHTML="";["N",...ratios[cfg.gearbox].map((_,i)=>String(i+1))].forEach((g,i)=>{const b=document.createElement("button");b.className="gearKey"+((i===state.gear)?" active":"");b.textContent=g;b.onclick=()=>{state.gear=i;renderGears();};box.append(b);});}
function initAudio(){
 if(audio){audio.resume();return;}
 const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
 audio=new AC();audioMaster=audio.createGain();audioMaster.gain.value=.48;audioMaster.connect(audio.destination);
 exhaustFilter=audio.createBiquadFilter();exhaustFilter.type="lowpass";exhaustFilter.frequency.value=850;exhaustFilter.Q.value=.8;exhaustFilter.connect(audioMaster);
 intakeFilter=audio.createBiquadFilter();intakeFilter.type="bandpass";intakeFilter.frequency.value=700;intakeFilter.Q.value=.5;intakeFilter.connect(audioMaster);
 turboOsc=audio.createOscillator();turboOsc.type="triangle";turboGain=audio.createGain();turboGain.gain.value=0;
 const turboFilter=audio.createBiquadFilter();turboFilter.type="bandpass";turboFilter.frequency.value=2200;turboFilter.Q.value=1.2;
 turboOsc.connect(turboFilter);turboFilter.connect(turboGain);turboGain.connect(audioMaster);turboOsc.start();
}
function activeFiringOrder(){
 if(cfg.cyl===8&&cfg.firing==="flatplane")return [1,5,4,8,6,3,7,2];
 if(cfg.cyl===8&&cfg.firing==="crossplane")return [1,8,4,3,6,5,7,2];
 return firingOrders[cfg.cyl]||Array.from({length:cfg.cyl},(_,i)=>i+1);
}
function schedulePulse(time){
 if(!audio||!state.running)return;
 const rpm=Math.max(600,state.rpm),cyl=cfg.cyl,order=activeFiringOrder();
 const cylinder=order[pulseIndex++%order.length],bank=cfg.layout==="I"?0:(cylinder<=Math.ceil(cyl/2)?-.58:.58);
 const osc=audio.createOscillator(),gain=audio.createGain(),filter=audio.createBiquadFilter(),pan=audio.createStereoPanner();
 osc.type="sawtooth";osc.frequency.setValueAtTime(48+rpm*.032,time);osc.frequency.exponentialRampToValueAtTime(32+rpm*.025,time+.075);
 filter.type="lowpass";filter.frequency.value=(420+rpm*.12+state.throttle*950)*(cfg.exhaust/70);
 pan.pan.value=bank;gain.gain.setValueAtTime(.0001,time);gain.gain.exponentialRampToValueAtTime(.11*(.25+state.throttle),time+.004);gain.gain.exponentialRampToValueAtTime(.0001,time+.12);
 osc.connect(filter);filter.connect(gain);gain.connect(pan);pan.connect(exhaustFilter);osc.start(time);osc.stop(time+.13);
}
function playBov(){
 if(!audio)return;
 const length=.42,samples=Math.floor(audio.sampleRate*length),buffer=audio.createBuffer(1,samples,audio.sampleRate),data=buffer.getChannelData(0);
 for(let i=0;i<samples;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/samples,1.8);
 const src=audio.createBufferSource(),filter=audio.createBiquadFilter(),gain=audio.createGain();
 src.buffer=buffer;filter.type="bandpass";filter.frequency.value=1500+state.boost*700;filter.Q.value=.7;
 gain.gain.setValueAtTime(.18,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+length);
 src.connect(filter);filter.connect(gain);gain.connect(audioMaster);src.start();
}
function audioLoop(){
 if(audioLoopActive)return;audioLoopActive=true;
 const frame=()=>{
  if(!audio||!state.running){audioLoopActive=false;return;}
  const now=audio.currentTime,rpm=Math.max(0,state.rpm),hz=Math.max(1,rpm/60*cfg.cyl/2);
  if(nextPulse<now)nextPulse=now+.005;
  while(nextPulse<now+.045){schedulePulse(nextPulse);nextPulse+=1/hz;}
  requestAnimationFrame(frame);
 };
 requestAnimationFrame(frame);
}
function drawDyno(){
 const c=$("dynoCanvas");if(!c)return;const ctx=c.getContext("2d"),w=c.width,h=c.height;ctx.clearRect(0,0,w,h);
 ctx.strokeStyle="#263847";ctx.lineWidth=1;for(let i=0;i<6;i++){let y=20+i*(h-40)/5;ctx.beginPath();ctx.moveTo(44,y);ctx.lineTo(w-12,y);ctx.stroke();}
 const maxR=cfg.redline,maxT=Math.max(200,...state.dynoData.map(p=>p.t)),maxP=Math.max(200,...state.dynoData.map(p=>p.p));
 const draw=(key,max,color)=>{ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=3;state.dynoData.forEach((p,i)=>{let x=44+p.rpm/maxR*(w-58),y=h-20-p[key]/max*(h-40);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();};
 draw("t",maxT,"#f3a45b");draw("p",maxP,"#45d7ed");
 ctx.fillStyle="#9ab0bf";ctx.font="11px system-ui";ctx.fillText("RPM →",w-52,h-5);ctx.fillText("TORQUE",6,14);ctx.fillStyle="#f3a45b";ctx.fillText("Н·м",50,14);ctx.fillStyle="#45d7ed";ctx.fillText("л.с.",94,14);
}
function drawEcu(){
 const c=$("ecuCanvas"),ctx=c.getContext("2d"),w=c.width,h=c.height;ctx.clearRect(0,0,w,h);
 const rows=8,cols=12,cw=w/cols,ch=h/rows,map=ecuMode==="fuel"?cfg.ecuFuel:cfg.ecuSpark;
 for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
  const load=(rows-y)/rows,rpm=x/(cols-1);
  const val=map?.[y]?.[x]??(ecuMode==="fuel"?1+load*.16-rpm*.08:1+load*.035-rpm*.02);
  const norm=ecuMode==="fuel"?val:(val-.88)/.2;
  ctx.fillStyle="hsl("+Math.round((ecuMode==="fuel"?190:28)-norm*(ecuMode==="fuel"?85:20))+" 65% "+Math.round(28+norm*25)+"%)";
  ctx.fillRect(x*cw+1,y*ch+1,cw-2,ch-2);ctx.fillStyle="#e1edf3";ctx.font="11px system-ui";ctx.fillText(val.toFixed(2),x*cw+5,y*ch+ch/2+4);
 }
}
function buildDiagnostic(){const items=[];if(state.damage>.1)items.push(["P0300","Пропуски зажигания / нестабильное сгорание","Высокий"]);if(state.knock>.1)items.push(["P0325","Детонация — проверьте топливо и угол зажигания","Высокий"]);if(state.coolant>112)items.push(["P0217","Перегрев двигателя","Критический"]);if(state.boost>cfg.boostTarget*1.08)items.push(["P0234","Передув турбокомпрессора","Критический"]);if(!items.length)items.push(["NO DTC","Активных неисправностей нет","Норма"]);$("dtcList").innerHTML=items.map(i=>'<div class="dtc"><b>'+i[0]+'</b><span>'+i[1]+'</span><em>'+i[2]+'</em></div>').join("");}
function tab(name){
 activeTab=name;document.querySelectorAll("[data-tab]").forEach(b=>b.classList.toggle("active",b.dataset.tab===name));document.querySelectorAll(".screen").forEach(s=>s.classList.toggle("visible",s.id==="screen-"+name));
 if(name==="ecu")drawEcu();if(name==="dyno")drawDyno();if(name==="diag")buildDiagnostic();
}
function bind(){
 document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>tab(b.dataset.tab));
 $("startBtn").onclick=()=>{state.running=true;state.rpm=Math.max(state.rpm,850);$("startBtn").textContent="ДВИГАТЕЛЬ РАБОТАЕТ";initAudio();audio.resume();if(engineSample){engineSample.play().catch(()=>audioLoop());}};
 $("stopBtn").onclick=()=>{state.running=false;state.throttle=0;state.rpm=0;if(engineSample){engineSample.pause();engineSample.currentTime=0;}$("startBtn").textContent="ЗАПУСТИТЬ ДВИГАТЕЛЬ";};
 $("throttle").oninput=e=>state.throttle=+e.target.value/100;$("brake").oninput=e=>state.brake=+e.target.value/100;
 $("gearUp").onclick=()=>shift(1);$("gearDown").onclick=()=>shift(-1);$("autoMode").onchange=e=>state.auto=e.target.checked;
 $("bovBtn").onclick=()=>{state.bov=true;playBov();setTimeout(()=>state.bov=false,650);};
 $("cutawayBtn").onclick=()=>{exploded=!exploded;$("cutawayBtn").textContent=exploded?"ОБЫЧНЫЙ ВИД":"РАЗРЕЗ";cutawayParts.forEach(o=>{o.material.transparent=exploded;o.material.opacity=exploded ? 0.16 : 1;o.material.depthWrite=!exploded;});};
 $("resetCamera").onclick=()=>{camera.position.set(5.4,4.1,6.5);orbit.target.set(0,.25,0);orbit.update();};
 $("specLayout").onchange=e=>cfg.layout=e.target.value;
 $("specCyl").onchange=e=>cfg.cyl=+e.target.value;
 ["specBore","specStroke","specComp","specValves","specCam","specRedline","specBoost"].forEach(id=>$(id).oninput=e=>{const key={specBore:"bore",specStroke:"stroke",specComp:"compression",specValves:"valves",specCam:"cam",specRedline:"redline",specBoost:"boostTarget"}[id];cfg[key]=+e.target.value;updateSpecs();});
 $("specAsp").onchange=e=>{cfg.aspiration=e.target.value;if(cfg.aspiration==="supercharger"){cfg.turbo="roots";$("specTurbo").value="roots";}};$("specTurbo").onchange=e=>cfg.turbo=e.target.value;$("specTurboSize").onchange=e=>cfg.turboSize=+e.target.value;$("specFiring").onchange=e=>cfg.firing=e.target.value;$("specFuel").onchange=e=>cfg.fuel=e.target.value;$("specExhaust").oninput=e=>{cfg.exhaust=+e.target.value;$("exhaustOut").textContent=cfg.exhaust+" см";};
 $("applyBuild").onclick=()=>{buildEngine();tab("run");};
 $("gearbox").onchange=e=>{cfg.gearbox=e.target.value;state.gear=0;renderGears();};$("specGearbox").onchange=e=>{cfg.gearbox=e.target.value;state.gear=0;renderGears();};
 $("dynoStart").onclick=()=>{state.dyno=true;state.dynoData=[];state.running=true;state.throttle=.3;drawDyno();};
 $("dynoStop").onclick=()=>{state.dyno=false;state.throttle=0;};
 $("dynoClear").onclick=()=>{state.dynoData=[];drawDyno();};
 $("ecuCanvas").onclick=e=>{const r=e.currentTarget.getBoundingClientRect(),x=clamp(Math.floor((e.clientX-r.left)/r.width*12),0,11),y=clamp(Math.floor((e.clientY-r.top)/r.height*8),0,7);if(ecuMode==="fuel"){cfg.ecuFuel??=Array.from({length:8},(_,i)=>Array.from({length:12},(_,j)=>1+(7-i)/8*.16-j/11*.08));cfg.ecuFuel[y][x]=clamp(cfg.ecuFuel[y][x]+.02,.7,1.4);}else{cfg.ecuSpark??=Array.from({length:8},(_,i)=>Array.from({length:12},(_,j)=>1+(7-i)/8*.035-j/11*.02));cfg.ecuSpark[y][x]=clamp(cfg.ecuSpark[y][x]+.01,.88,1.08);}drawEcu();};
 $("ecuFuelBtn").onclick=()=>{ecuMode="fuel";$("ecuFuelBtn").classList.add("primary");$("ecuSparkBtn").classList.remove("primary");drawEcu();};$("ecuSparkBtn").onclick=()=>{ecuMode="spark";$("ecuSparkBtn").classList.add("primary");$("ecuFuelBtn").classList.remove("primary");drawEcu();};
 $("repairBtn").onclick=()=>{state.damage=0;state.knock=0;state.coolant=88;buildDiagnostic();};
}
function loop(){let last=performance.now();function frame(now){const dt=Math.min(.04,(now-last)/1000);last=now;tickPhysics(dt);requestAnimationFrame(frame);}requestAnimationFrame(frame);}
window.addEventListener("DOMContentLoaded",()=>{init3D();bind();renderGears();updateSpecs();loop();tab("run");});
