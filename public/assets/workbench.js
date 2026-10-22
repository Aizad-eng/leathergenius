/* Leather Genius: leather workbench (/workbench/).
   One WebGL2 fragment shader renders a leather panel on a wooden bench.
   Grain, dye, stamps, cuts and the zip are all lit per pixel from height data.
   Piece space: 1400 x 1000 units (1 unit is roughly 0.25 mm). */
(function () {
  'use strict';

  var PW = 1400, PH = 1000, ZY = 300, ZA = 232, ZB = 1168, SLOT = 16;
  var PIECE = { x0: 70, y0: 60, x1: 1330, y1: 940, r: 56 };
  var ZIPBAND = { x0: 176, y0: 256, x1: 1224, y1: 344 };
  var DYE_R = 46;

  var stage = document.querySelector('.wb-stage');
  if (!stage) return;
  var canvas = stage.querySelector('.wb-canvas');
  var overlay = stage.querySelector('.wb-overlay');
  var octx = overlay.getContext('2d');
  var hintEl = document.querySelector('.wb-hint');
  var zipBtn = document.querySelector('[data-action="zip"]');

  var gl = null;
  try { gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, alpha: false }); } catch (e) { gl = null; }
  if (!gl) {
    stage.querySelector('.wb-fallback').hidden = false;
    var tools = document.querySelector('.wb-tools');
    if (tools) tools.hidden = true;
    return;
  }

  /* ---------------------------------------------------------------- GLSL */
  var NOISE = [
    'float h1(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }',
    'vec2 h2(vec2 p){ vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3+=dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }',
    'float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);',
    '  return mix(mix(h1(i),h1(i+vec2(1,0)),f.x), mix(h1(i+vec2(0,1)),h1(i+vec2(1,1)),f.x), f.y); }',
    'float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*vn(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return s/.96875; }',
    'float sdRB(vec2 p, vec2 b, float r){ vec2 q=abs(p)-b+r; return length(max(q,0.))+min(max(q.x,q.y),0.)-r; }'
  ].join('\n');

  var VS = '#version 300 es\nin vec2 aPos; uniform vec4 uRect; out vec2 vC;\n' +
    'void main(){ vec2 c=uRect.xy+aPos*uRect.zw; vC=c; gl_Position=vec4(c,0.,1.); }';

  // Grain bake. Pass 0: slope.xy, height, pore. Pass 1: mottle, absorb, fine, unused.
  var FS_GRAIN = '#version 300 es\nprecision highp float;\nuniform vec2 uSize; uniform int uPass; out vec4 o;\n' + NOISE + '\n' + [
    'vec3 vor(vec2 x){ vec2 n=floor(x), f=fract(x), mg, mr; float md=8.;',
    '  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 g=vec2(i,j); vec2 oo=h2(n+g); vec2 r=g+oo-f; float d=dot(r,r); if(d<md){md=d; mr=r; mg=g;} }',
    '  float bd=8.;',
    '  for(int j=-2;j<=2;j++) for(int i=-2;i<=2;i++){ vec2 g=mg+vec2(i,j); vec2 oo=h2(n+g); vec2 r=g+oo-f; if(dot(mr-r,mr-r)>1e-5) bd=min(bd, dot(.5*(mr+r), normalize(r-mr))); }',
    '  return vec3(bd, h1(n+mg), sqrt(md)); }',
    'float pores(vec2 p){ float m=0.; vec2 c=floor(p/3.2);',
    '  float dens=smoothstep(.35,.75,vn(p*.02));',
    '  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 g=c+vec2(i,j); float h=h1(g*1.37+.5);',
    '    if(h<.10+.16*dens){ vec2 pp=(g+h2(g+3.1))*3.2; float rr=.55+.5*h1(g+9.); m=max(m, smoothstep(rr, rr*.35, length(p-pp))); } }',
    '  return m; }',
    'float H(vec2 p, out float pr){',
    '  vec2 w=vec2(fbm(p*.008), fbm(p*.008+vec2(5.2,1.3)));',
    '  vec2 q=p+(w-.5)*7.;',
    '  float a=0.;',
    '  mat2 R=mat2(cos(a),-sin(a),sin(a),cos(a));',
    '  vec2 qa=q;',
    '  float region=smoothstep(.3,.72,fbm(p*.0028+7.));',
    '  vec3 v=vor(qa/(6.2+1.6*region));',
    '  float peb=smoothstep(0.,.36,v.x); peb=sqrt(peb)*(.82+.36*v.y);',
    '  vec3 v2=vor(q/2.9+31.);',
    '  float fine=smoothstep(0.,.32,v2.x);',
    '  float micro=vn(p*.9)*.6+vn(p*2.3)*.4;',
    '  float rid=1.-abs(2.*fbm(R*q*vec2(.005,.017))-1.);',
    '  float crease=smoothstep(.93,.998,rid);',
    '  pr=pores(p);',
    '  return (.42+.22*region)*peb+.2*fine+.09*micro-.16*crease-.5*pr; }',
    'void main(){',
    '  vec2 p=gl_FragCoord.xy/uSize*vec2(1400.,1000.);',
    '  if(uPass==0){',
    '    float pr, d1, d2; float e=.45;',
    '    float h=H(p,pr); float hx=H(p+vec2(e,0.),d1); float hy=H(p+vec2(0.,e),d2);',
    '    vec2 sl=vec2(hx-h,hy-h)/e*.42;',
    '    o=vec4(clamp(sl*2.+.5,0.,1.), clamp(h*.85+.12,0.,1.), pr);',
    '  } else {',
    '    float mot=fbm(p*.0022)*.75+fbm(p*.012+4.)*.25;',
    '    float ab=fbm(p*.022+3.)*.65+vn(p*.18)*.35;',
    '    o=vec4(mot, ab, vn(p*.5)*.6+vn(p*1.7)*.4, 1.);',
    '  }',
    '}'
  ].join('\n');

  // Bench bake: oiled walnut planks. rgb = sqrt(linear albedo), a = height.
  var FS_BENCH = '#version 300 es\nprecision highp float;\nuniform vec2 uSize; out vec4 o;\n' + NOISE + '\n' + [
    'void main(){',
    '  vec2 p=vec2(-700.,-500.)+gl_FragCoord.xy/uSize*vec2(2800.,2000.);',
    '  float pw=360.; float yy=p.y+150.; float pid=floor(yy/pw); float ly=yy-pid*pw;',
    '  float r=h1(vec2(pid*7.1,3.7));',
    '  float joint=floor((p.x+r*1800.)/2300.); float jx=p.x+r*1800.-joint*2300.;',
    '  float r2=h1(vec2(pid,joint)+.3);',
    '  float gy=p.y+r2*600.+38.*fbm(vec2(p.x*.0011,p.y*.006)+r2*10.);',
    '  float ring=gy/(16.+10.*r2)+2.4*fbm(vec2(p.x*.0009,p.y*.004)+r2*3.);',
    '  float fr=fract(ring);',
    '  float late=smoothstep(.45,.85,fr)*(1.-smoothstep(.88,1.,fr))*(.4+.6*fbm(vec2(p.x*.004,p.y*.02)));',
    '  float pore=smoothstep(.72,.95,vn(vec2(p.x*.11,p.y*1.6)+r2*40.))*(.5+.5*vn(p*.02));',
    '  float fine=vn(vec2(p.x*.006,p.y*.12))*.5+vn(vec2(p.x*.03,p.y*.9))*.15;',
    '  vec3 lt=vec3(.11,.058,.030), dk=vec3(.045,.022,.012);',
    '  vec3 alb=mix(lt,dk,late*.75+fine*.25);',
    '  alb*=.82+.36*r2; alb*=1.-.22*pore;',
    '  alb*=.78+.44*fbm(p*.0035+r2);',
    '  float scr=0.;',
    '  for(int i=0;i<10;i++){ vec2 a=vec2(h1(vec2(float(i),1.)),h1(vec2(float(i),2.)))*vec2(2800.,2000.)+vec2(-700.,-500.);',
    '    float an=(h1(vec2(float(i),3.))-.5)*2.6; vec2 d=vec2(cos(an),sin(an)); float L=60.+220.*h1(vec2(float(i),4.));',
    '    vec2 pa=p-a; float t=clamp(dot(pa,d),0.,L); float dist=length(pa-d*t);',
    '    scr=max(scr,(1.-smoothstep(.3,1.3,dist))*(.4+.6*vn(vec2(t*.05,float(i))))); }',
    '  alb*=1.+.5*scr;',
    '  float sd=min(ly,pw-ly); float js=min(jx,2300.-jx); float seam=min(sd,js);',
    '  alb*=mix(.25,1.,smoothstep(0.,4.,seam));',
    '  float h=.25*late+.08*fine-.12*pore-.6*scr-1.6*(1.-smoothstep(0.,5.,seam));',
    '  o=vec4(sqrt(alb), h*.25+.5);',
    '}'
  ].join('\n');

  // Splat into dye / wet buffers.
  var FS_SPLAT = '#version 300 es\nprecision highp float;\nin vec2 vC; uniform vec2 uC; uniform float uR, uA; uniform vec3 uCol; uniform int uMode; out vec4 o;\n' + NOISE + '\n' + [
    'void main(){',
    '  vec2 w=(vC*.5+.5)*vec2(1400.,1000.);',
    '  float d=length(w-uC)/uR;',
    '  float n=vn(w*.07)*.55+vn(w*.21)*.3+vn(w*.6)*.15;',
    '  float f=smoothstep(1.,.15,d+(n-.5)*.55);',
    '  if(uMode==0) o=vec4(uCol,uA*f); else if(uMode==1) o=vec4(uA*f); else o=vec4(uA);',
    '}'
  ].join('\n');

  var FS_MAIN = '#version 300 es\nprecision highp float;\n' + [
    'uniform vec2 uRes; uniform float uScale; uniform vec2 uCenter;',
    'uniform sampler2D uGA, uGB, uMask, uImp, uDecor, uDye, uWet, uBench, uMark;',
    'uniform vec3 uL; uniform vec2 uLC;',
    'uniform float uS, uGap, uTab, uBump;',
    'uniform vec4 uOff[3]; uniform vec2 uPiv[3];',
    'out vec4 o;',
    'const vec2 PS=vec2(1400.,1000.);',
    'const float ZY=300., ZA=232., SLOT=16., TH=5.;',
    'const vec2 B0=vec2(-700.,-500.), BS=vec2(2800.,2000.);'
  ].join('\n') + '\n' + NOISE + '\n' + [
    'float mk(vec2 s, int ch, float lod){ vec4 m=textureLod(uMask, s/PS, lod); return ch==0?m.r:(ch==1?m.g:(ch==2?m.b:m.a)); }',
    'float gapAt(float x){ if(uGap<.01||x<=ZA||x>=uS) return 0.; float t=(x-ZA)/(uS-ZA); return uGap*pow(sin(3.14159*t),.7); }',
    'float zipOff(vec2 p){ float g=gapAt(p.x); if(g<=0.) return 0.; float dy=max(abs(p.y-ZY)-SLOT-.5*g,0.); return .5*g/(1.+dy*dy/(150.*150.)); }',
    'vec2 zmap(vec2 p){ float o=zipOff(p); return p.y<ZY?vec2(p.x,min(p.y+o,ZY)):vec2(p.x,max(p.y-o,ZY)); }',
    'float pool(vec2 wp){ return 1.1-.42*smoothstep(0.,1.25,length((wp-uLC)/vec2(1900.,1500.))); }',
    'vec3 envMap(vec3 R){ float d=dot(R,uL);',
    '  vec3 e=vec3(.04,.036,.03)+vec3(.16,.15,.14)*smoothstep(-.1,1.,R.z);',
    '  e+=vec3(3.4,3.2,2.9)*smoothstep(.82,.985,d)+vec3(.5,.46,.4)*smoothstep(.45,.85,d);',
    '  e*=1.-.6*smoothstep(.2,-.6,R.y)*0.;',
    '  return e; }',
    'vec3 lit(vec3 alb, vec3 N, float spk, float shin, float ao, vec2 wp){',
    '  float diff=max(dot(N,uL),0.); vec3 Hh=normalize(uL+vec3(0,0,1));',
    '  float sp=pow(max(dot(N,Hh),0.),shin)*spk*(shin+8.)/30.;',
    '  float pl=pool(wp); vec3 key=vec3(1.,.94,.86)*1.32*pl;',
    '  vec3 amb=vec3(.52,.55,.62)*.30*(.45+.55*N.z)*pl;',
    '  return alb*(diff*key+amb)*ao+sp*key; }',
    'vec3 metal(vec3 F0, vec3 N, float ao, vec2 wp){ vec3 R=reflect(vec3(0,0,-1),N);',
    '  return (F0*envMap(R)*ao+F0*.12*max(dot(N,uL),0.))*pool(wp); }',
    'vec3 bench(vec2 p){ vec2 uv=(p-B0)/BS; vec2 e=vec2(1.6)/BS; vec4 b=texture(uBench,uv);',
    '  float hx=texture(uBench,uv+vec2(e.x,0)).a-texture(uBench,uv-vec2(e.x,0)).a;',
    '  float hy=texture(uBench,uv+vec2(0,e.y)).a-texture(uBench,uv-vec2(0,e.y)).a;',
    '  vec3 N=normalize(vec3(-vec2(hx,hy)*1.4,1.)); return lit(b.rgb*b.rgb,N,.22,26.,1.,p); }',
    'vec3 dyeT(vec2 uv, float a, float pore, float hh, out float ce, out float wet){',
    '  vec4 d=texture(uDye,uv); float thr=.04+.5*a; ce=smoothstep(thr,thr+.3,d.a);',
    '  wet=texture(uWet,uv).r*ce; vec3 sc=clamp(1.-(1.-d.rgb)/max(d.a,.02),0.,1.); vec3 t=sc*sc;',
    '  return pow(max(t,vec3(.0005)), vec3((.8+.35*a+.6*pore+.2*(1.-hh))*(.7+.45*d.a))); }',
    'vec3 leather(vec2 s, int ch, vec2 xs, vec2 wp){',
    '  vec2 uv=s/PS; vec4 ga=texture(uGA,uv), gb=texture(uGB,uv);',
    '  vec2 slope=(ga.rg-.5)*.5*uBump; float hh=ga.b, pore=ga.a;',
    '  vec3 imp=texture(uImp,uv).rgb;',
    '  vec2 ex=vec2(1.1/PS.x,0.), ey=vec2(0.,1.1/PS.y);',
    '  vec2 gi=vec2(texture(uImp,uv+ex).r-texture(uImp,uv-ex).r, texture(uImp,uv+ey).r-texture(uImp,uv-ey).r)/2.2;',
    '  float dep=imp.r, foil=imp.g, raw=imp.b;',
    '  slope=slope*(1.-.8*dep)-gi*1.25;',
    '  vec4 dc=texture(uDecor,uv);',
    '  vec2 gt=vec2(texture(uDecor,uv+ex).r-texture(uDecor,uv-ex).r, texture(uDecor,uv+ey).r-texture(uDecor,uv-ey).r)/2.2;',
    '  vec2 gg=vec2(texture(uDecor,uv+ex).b-texture(uDecor,uv-ex).b, texture(uDecor,uv+ey).b-texture(uDecor,uv-ey).b)/2.2;',
    '  slope+=gt*1.3-gg*.8;',
    '  float lod=mix(1.7,.6,raw);',
    '  vec2 gm=vec2(mk(s+vec2(2.,0),ch,lod)-mk(s-vec2(2.,0),ch,lod), mk(s+vec2(0,2.),ch,lod)-mk(s-vec2(0,2.),ch,lod))/4.;',
    '  float mb=mk(s,ch,2.2);',
    '  slope+=gm*mix(3.2,1.4,raw)+xs;',
    '  vec3 N=normalize(vec3(-slope,1.));',
    '  vec3 alb=vec3(.52,.30,.15);',
    '  alb*=.9+.2*gb.r; alb*=.86+.14*smoothstep(.15,.75,hh); alb*=1.-.3*pore;',
    '  float ce, wet; vec3 tt=dyeT(uv,gb.g,pore,hh,ce,wet);',
    '  float thread=smoothstep(.1,.6,dc.g);',
    '  vec3 thc=vec3(.50,.40,.26)*(.7+.4*dc.r);',
    '  alb=mix(alb,thc,thread);',
    '  alb*=mix(vec3(1.),tt,ce*(1.-.8*thread));',
    '  alb*=1.-.32*dep*(1.-foil);',
    '  alb*=1.-.3*dc.b*(1.-thread);',
    '  alb*=mix(1.,.62,(1.-smoothstep(.5,.95,mb))*(1.-raw));',
    '  alb*=1.-.22*wet;',
    '  if(raw>.01){ float rim=(1.-smoothstep(.35,.8,mk(s,ch,.6)))*raw; float lum=dot(tt,vec3(.3,.5,.2));',
    '    vec3 fibc=vec3(.60,.44,.27)*(.8+.3*gb.b); fibc=mix(fibc,vec3(.04,.035,.03),ce*(1.-smoothstep(.01,.06,lum))*.8);',
    '    alb=mix(alb,fibc,rim*.85); }',
    '  float ao=mix(.76,1.,smoothstep(.1,.7,hh))*(1.-.25*dc.b*(1.-thread));',
    '  float spk=.045+.05*hh+.12*dep+.14*wet+.05*thread;',
    '  float shin=mix(13.,45.,max(dep*.8,wet));',
    '  vec3 c=lit(alb,N,spk,shin,ao,wp)+lit(vec3(0.),N,.025,3.,1.,wp);',
    '  if(foil>.02){ float fc=smoothstep(.35,.7,foil*(.82+.36*gb.b));',
    '    vec3 Nf=normalize(vec3(-slope*1.1+(gb.b-.5)*.12,1.));',
    '    c=mix(c, metal(vec3(1.,.64,.20),Nf,ao,wp)*1.15, fc); }',
    '  return c; }',
    'vec3 wall(vec2 s, float fr, float raw, vec2 wp){',
    '  vec2 uv=s/PS; vec4 gb=texture(uGB,uv); float ce, wet; vec3 tt=dyeT(uv,gb.g,0.,.5,ce,wet);',
    '  vec3 alb, N; float spk, shin;',
    '  if(raw>.5){',
    '    float fib=vn(vec2(s.x*1.5+s.y*1.5, fr*2.5))*.55+vn(vec2(s.x*4.5+s.y*4.5, fr*7.))*.45;',
    '    alb=vec3(.64,.47,.29)*(.72+.45*fib);',
    '    float top=1.-smoothstep(.1,.32,fr);',
    '    alb*=mix(vec3(1.),tt,ce*(top*.95+.12));',
    '    float lum=dot(tt,vec3(.3,.5,.2));',
    '    float core=smoothstep(.32,.45,fr)*(1.-smoothstep(.58,.72,fr));',
    '    alb*=mix(1.,.32,core*ce*(1.-smoothstep(.01,.06,lum)));',
    '    N=normalize(vec3((fib-.5)*.5,.5,.86)); spk=.01; shin=6.;',
    '  } else {',
    '    alb=vec3(.56,.36,.20)*.5*mix(vec3(1.),tt,ce);',
    '    float an=mix(.1,1.4,fr); N=normalize(vec3(0.,sin(an),cos(an))); spk=.2; shin=30.;',
    '  }',
    '  return lit(alb,N,spk,shin,.8,wp); }',
    'vec4 layer(vec2 s, int ch, vec2 up, vec2 xs, vec2 wp){',
    '  float m=mk(s,ch,0.); vec4 res=vec4(0.);',
    '  if(m<.98){ for(int k=1;k<=5;k++){ float t=float(k)*TH/5.; vec2 su=s+up*t;',
    '    if(mk(su,ch,0.)>.5){ float raw=texture(uImp,su/PS).b; res=vec4(wall(su,t/TH,step(.5,raw),wp),1.); res*=smoothstep(TH+.6,TH-.6,t); break; } } }',
    '  if(m>.01){ float a=smoothstep(.25,.75,m); res=res*(1.-a)+vec4(leather(s,ch,xs,wp),1.)*a; }',
    '  return res; }',
    'vec2 mainSrc(vec2 p){ return zmap(p); }',
    'vec4 tooth(vec2 q, float side){',
    '  float off=side<0.?0.:6.;',
    '  float k=clamp(floor((q.x-214.-off)/12.+.5),0.,80.);',
    '  vec2 l=vec2(q.x-(214.+off+k*12.), q.y-(ZY+side*3.2));',
    '  float sd=sdRB(l,vec2(3.4,6.3),2.3);',
    '  if(sd>.8) return vec4(9.);',
    '  vec2 e=vec2(.5,0.);',
    '  float h0=sqrt(clamp(-sdRB(l+e.xy,vec2(3.4,6.3),2.3)/2.2,0.,1.))-sqrt(clamp(-sdRB(l-e.xy,vec2(3.4,6.3),2.3)/2.2,0.,1.));',
    '  float h1v=sqrt(clamp(-sdRB(l+e.yx,vec2(3.4,6.3),2.3)/2.2,0.,1.))-sqrt(clamp(-sdRB(l-e.yx,vec2(3.4,6.3),2.3)/2.2,0.,1.));',
    '  float cup=smoothstep(1.6,.4,length(l-vec2(0.,-side*2.2)))*.5;',
    '  vec3 N=normalize(vec3(-vec2(h0,h1v)*1.5+vec2(0.,side*cup*.6),1.));',
    '  return vec4(sd,N); }',
    'vec3 tape(vec2 q, float dEdge, float g, vec2 wp){',
    '  float wv=vn(q*vec2(.9,2.6))*.5+vn(q*vec2(2.4,.9))*.5;',
    '  vec3 alb=vec3(.05,.036,.026)*(.75+.5*wv);',
    '  vec3 N=normalize(vec3(cos(q.x*2.7)*.18,(wv-.5)*.2,1.));',
    '  float curl=g>0.?mix(.35,1.,smoothstep(0.,6.,dEdge)):1.;',
    '  return lit(alb,N,.08,14.,curl,wp); }',
    'vec3 lining(vec2 p, float hf, vec2 wp){',
    '  vec2 sc=vec2(.012,.03); float e=1.5;',
    '  float f0=fbm(p*sc), fx=fbm((p+vec2(e,0.))*sc), fy=fbm((p+vec2(0.,e))*sc);',
    '  float tw=sin((p.x*1.+p.y*1.8)*2.3);',
    '  vec3 N=normalize(vec3(-vec2(fx-f0,fy-f0)/e*6.+vec2(.5,-.3)*tw*.05,1.));',
    '  float ao=smoothstep(0.,max(hf,1.),hf-abs(p.y-ZY))*.75+.08;',
    '  return lit(vec3(.15,.028,.034),N,.18,24.,ao,wp)*.6; }',
    'vec3 interior(vec2 p, vec2 wp){',
    '  float g=gapAt(p.x), hf=.5*g; float yu=p.y+hf, yl=p.y-hf;',
    '  vec3 c=lining(p,hf,wp);',
    '  bool inX=p.x>198.&&p.x<1202.;',
    '  if(inX&&yu<ZY-.3&&yu>ZY-46.) c=tape(vec2(p.x,yu),ZY-.3-yu,g,wp);',
    '  if(inX&&yl>ZY+.3&&yl<ZY+46.) c=tape(vec2(p.x,yl),yl-ZY-.3,g,wp);',
    '  if(p.x>207.&&p.x<1193.){',
    '    vec4 tu=tooth(vec2(p.x,yu),-1.); vec4 tl=tooth(vec2(p.x,yl),1.);',
    '    vec3 brass=vec3(.70,.52,.28);',
    '    if(tu.x<.6) c=mix(c, metal(brass,tu.yzw,1.,wp), smoothstep(.6,-.6,tu.x));',
    '    if(tl.x<.6) c=mix(c, metal(brass,tl.yzw,1.,wp), smoothstep(.6,-.6,tl.x));',
    '  }',
    '  vec2 sh=uL.xy/uL.z;',
    '  float occ=mk(mainSrc(p+sh*4.5),0,1.2);',
    '  c*=1.-.6*occ;',
    '  return c; }',
    'float metalH(vec2 p, out float cov){',
    '  vec2 piv=vec2(uS,ZY+4.); vec2 d=vec2(sin(uTab),cos(uTab)); vec2 pr=vec2(d.y,-d.x);',
    '  vec2 r=p-piv; float u=dot(r,d), v=dot(r,pr);',
    '  float st=sdRB(vec2(v,u-37.),vec2(8.6,30.),6.6);',
    '  st=max(st,-sdRB(vec2(v,u-13.),vec2(4.8,2.3),1.9));',
    '  float sb=sdRB(p-vec2(uS,ZY),vec2(12.5,13.5),5.5);',
    '  float lug=sdRB(p-vec2(uS,ZY+5.),vec2(5.,5.),2.5);',
    '  float ht=sqrt(clamp(-st/2.3,0.,1.))*(1.5+2.6*clamp(1.-(u-6.)/62.,0.,1.));',
    '  vec2 muv=vec2(v/20.+.5,(u-45.)/20.+.5);',
    '  if(muv.x>0.&&muv.x<1.&&muv.y>0.&&muv.y<1.) ht-=.3*texture(uMark,muv).r*step(st,-1.);',
    '  float hb=sqrt(clamp(-sb/4.5,0.,1.))*5.6;',
    '  float hl=sqrt(clamp(-lug/2.,0.,1.))*6.4;',
    '  cov=max(max(smoothstep(.6,-.6,st),smoothstep(.6,-.6,sb)),smoothstep(.6,-.6,lug));',
    '  return max(max(ht,hb),hl); }',
    'void main(){',
    '  vec2 fc=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y);',
    '  vec2 p=(fc-uRes*.5)/uScale+uCenter;',
    '  vec2 sh=uL.xy/uL.z;',
    '  vec3 col=bench(p);',
    '  float occ=mk(p+sh*9.,0,3.6), aow=mk(p+sh*3.,0,5.2);',
    '  col*=(1.-.55*occ)*(1.-.32*aow);',
    '  float zo=zipOff(p); float side=p.y<ZY?1.:-1.;',
    '  vec2 s=zmap(p);',
    '  if(p.x>186.&&p.x<1214.&&abs(p.y-ZY)<SLOT+zo+8.){ if(mk(s,0,0.)<.99) col=interior(p,p); }',
    '  vec2 xs=vec2(0.);',
    '  if(zo>0.){ float d1=zipOff(p+vec2(0.,1.5)), d0=zipOff(p-vec2(0.,1.5)); xs.y=-(d1-d0)/3.*2.; }',
    '  vec4 L0=layer(s,0,vec2(0.,-1.),xs,p);',
    '  col=col*(1.-L0.a)+L0.rgb;',
    '  for(int i=0;i<3;i++){',
    '    if(uOff[i].w<.5) continue;',
    '    float a=uOff[i].z; float ca=cos(a), sa=sin(a);',
    '    mat2 Ri=mat2(ca,-sa,sa,ca);',
    '    vec2 q=Ri*(p-uPiv[i]-uOff[i].xy)+uPiv[i];',
    '    vec2 qs=Ri*(p+sh*9.-uPiv[i]-uOff[i].xy)+uPiv[i];',
    '    float oc=mk(qs,i+1,3.6), ao2=mk(Ri*(p+sh*3.-uPiv[i]-uOff[i].xy)+uPiv[i],i+1,5.2);',
    '    col*=(1.-.55*oc)*(1.-.32*ao2);',
    '    vec4 Li=layer(q,i+1,Ri*vec2(0.,-1.),vec2(0.),p);',
    '    col=col*(1.-Li.a)+Li.rgb;',
    '  }',
    '  if(abs(p.x-uS)<95.&&abs(p.y-ZY)<95.){',
    '    float c1, c2, c3; metalH(p+sh*3.,c1); metalH(p+sh*5.5,c2); metalH(p+sh*8.,c3);',
    '    col*=1.-.22*(c1+c2+c3);',
    '    float cov; float h=metalH(p,cov);',
    '    if(cov>0.){ float dmy; vec2 e=vec2(.6,0.);',
    '      float hx=metalH(p+e.xy,dmy)-metalH(p-e.xy,dmy), hy=metalH(p+e.yx,dmy)-metalH(p-e.yx,dmy);',
    '      vec3 N=normalize(vec3(-vec2(hx,hy)/1.2,1.));',
    '      float ao=.75+.25*clamp(h/4.,0.,1.);',
    '      col=mix(col, metal(vec3(.70,.52,.28),N,ao,p), cov); }',
    '  }',
    '  col*=.92;',
    '  col=(col*(2.51*col+.03))/(col*(2.43*col+.59)+.14);',
    '  col=pow(clamp(col,0.,1.),vec3(1./2.2));',
    '  col+=(h1(fc+fract(uS))-.5)/255.;',
    '  o=vec4(col,1.);',
    '}'
  ].join('\n');

  /* ------------------------------------------------------------ GL setup */
  function sh(type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function prog(fs) {
    var p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    p.u = {};
    var n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var info = gl.getActiveUniform(p, i); var nm = info.name.replace(/\[0\]$/, ''); p.u[nm] = gl.getUniformLocation(p, info.name); }
    return p;
  }
  function tex(w, h, opts) {
    opts = opts || {};
    var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, opts.data || null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opts.mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    t.w = w; t.h = h; t.mip = !!opts.mip;
    return t;
  }
  function fbo(t) { var f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); f.t = t; return f; }

  var P_MAIN, P_GRAIN, P_BENCH, P_SPLAT;
  try {
    P_MAIN = prog(FS_MAIN); P_GRAIN = prog(FS_GRAIN); P_BENCH = prog(FS_BENCH); P_SPLAT = prog(FS_SPLAT);
  } catch (err) {
    console.error(err);
    stage.querySelector('.wb-fallback').hidden = false;
    return;
  }

  var quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

  function drawRect(p, x, y, w, h) { gl.uniform4f(p.u.uRect, x, y, w, h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
  function fullRect(p) { drawRect(p, -1, -1, 2, 2); }

  // Bake grain + bench.
  var GW = 2048, GH = 1463;
  var T_GA = tex(GW, GH, { mip: true }), T_GB = tex(GW, GH, { mip: true });
  var T_BENCH = tex(1600, 1144, { mip: true });
  gl.disable(gl.BLEND);
  gl.useProgram(P_GRAIN);
  gl.uniform2f(P_GRAIN.u.uSize, GW, GH);
  [T_GA, T_GB].forEach(function (t, i) {
    var f = fbo(t); gl.viewport(0, 0, GW, GH); gl.uniform1i(P_GRAIN.u.uPass, i); fullRect(P_GRAIN);
    gl.deleteFramebuffer(f);
    gl.bindTexture(gl.TEXTURE_2D, t); gl.generateMipmap(gl.TEXTURE_2D);
  });
  gl.useProgram(P_BENCH);
  gl.uniform2f(P_BENCH.u.uSize, 1600, 1144);
  (function () { var f = fbo(T_BENCH); gl.viewport(0, 0, 1600, 1144); fullRect(P_BENCH); gl.deleteFramebuffer(f); gl.bindTexture(gl.TEXTURE_2D, T_BENCH); gl.generateMipmap(gl.TEXTURE_2D); })();

  // Dye + wet buffers (piece space).
  var DW = 1024, DH = 732;
  var T_DYE = tex(DW, DH), T_WET = tex(512, 366);
  var F_DYE = fbo(T_DYE), F_WET = fbo(T_WET);
  function clearDye() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, F_DYE); gl.viewport(0, 0, DW, DH); gl.clearColor(1, 1, 1, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, F_WET); gl.viewport(0, 0, 512, 366); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /* --------------------------------------------------- 2D canvases (piece space) */
  function mkCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  function rrPath(ctx, x0, y0, x1, y1, r) {
    ctx.moveTo(x0 + r, y0); ctx.lineTo(x1 - r, y0); ctx.arcTo(x1, y0, x1, y0 + r, r);
    ctx.lineTo(x1, y1 - r); ctx.arcTo(x1, y1, x1 - r, y1, r);
    ctx.lineTo(x0 + r, y1); ctx.arcTo(x0, y1, x0, y1 - r, r);
    ctx.lineTo(x0, y0 + r); ctx.arcTo(x0, y0, x0 + r, y0, r); ctx.closePath();
  }
  // Points along a rounded rect, every `step` units, with tangent angle.
  function rrPoints(x0, y0, x1, y1, r, step) {
    var segs = [];
    function line(ax, ay, bx, by) { segs.push({ t: 'l', ax: ax, ay: ay, bx: bx, by: by, len: Math.hypot(bx - ax, by - ay) }); }
    function arc(cx, cy, a0) { segs.push({ t: 'a', cx: cx, cy: cy, a0: a0, len: Math.PI / 2 * r }); }
    line(x0 + r, y0, x1 - r, y0); arc(x1 - r, y0 + r, -Math.PI / 2);
    line(x1, y0 + r, x1, y1 - r); arc(x1 - r, y1 - r, 0);
    line(x1 - r, y1, x0 + r, y1); arc(x0 + r, y1 - r, Math.PI / 2);
    line(x0, y1 - r, x0, y0 + r); arc(x0 + r, y0 + r, Math.PI);
    var total = segs.reduce(function (a, s) { return a + s.len; }, 0);
    var n = Math.round(total / step), st = total / n, out = [];
    for (var i = 0; i < n; i++) {
      var d = i * st, k = 0;
      while (d > segs[k].len) { d -= segs[k].len; k++; }
      var s = segs[k];
      if (s.t === 'l') { var f = d / s.len; out.push({ x: s.ax + (s.bx - s.ax) * f, y: s.ay + (s.by - s.ay) * f, a: Math.atan2(s.by - s.ay, s.bx - s.ax) }); }
      else { var an = s.a0 + d / r; out.push({ x: s.cx + Math.cos(an) * r, y: s.cy + Math.sin(an) * r, a: an + Math.PI / 2 }); }
    }
    return out;
  }

  // Decor: R thread height, G thread mask, B grooves (crease line, stitch groove, holes).
  var decor = mkCanvas(PW, PH), dctx = decor.getContext('2d');
  function drawDecor() {
    dctx.fillStyle = '#000'; dctx.fillRect(0, 0, PW, PH);
    dctx.globalCompositeOperation = 'lighten';
    dctx.lineCap = 'round'; dctx.lineJoin = 'round';
    function groove(x0, y0, x1, y1, r, widths) {
      widths.forEach(function (wv) { dctx.beginPath(); rrPath(dctx, x0, y0, x1, y1, r); dctx.lineWidth = wv[0]; dctx.strokeStyle = 'rgb(0,0,' + wv[1] + ')'; dctx.stroke(); });
    }
    function stitches(x0, y0, x1, y1, r) {
      groove(x0, y0, x1, y1, r, [[8, 25], [5.5, 55], [3.5, 80]]);
      var pts = rrPoints(x0, y0, x1, y1, r, 15);
      pts.forEach(function (pt, i) {
        var a = pt.a + 0.42, L = 5.6, j = (Math.sin(i * 12.9898) * 43758.5453) % 1 * 0.6;
        var ax = pt.x - Math.cos(a) * L, ay = pt.y - Math.sin(a) * L, bx = pt.x + Math.cos(a) * L, by = pt.y + Math.sin(a) * L;
        // holes
        dctx.fillStyle = 'rgb(0,0,255)';
        dctx.beginPath(); dctx.arc(ax - Math.cos(a) * 1.2, ay - Math.sin(a) * 1.2, 2.0, 0, 7); dctx.fill();
        dctx.beginPath(); dctx.arc(bx + Math.cos(a) * 1.2, by + Math.sin(a) * 1.2, 2.0, 0, 7); dctx.fill();
        dctx.beginPath(); dctx.moveTo(ax, ay); dctx.lineTo(bx, by);
        dctx.lineWidth = 4.2; dctx.strokeStyle = 'rgb(0,255,0)'; dctx.stroke();
        [[4.2, 70], [3.4, 130], [2.5, 190], [1.5, 235 + j * 20]].forEach(function (wv) {
          dctx.beginPath(); dctx.moveTo(ax, ay); dctx.lineTo(bx, by); dctx.lineWidth = wv[0];
          dctx.strokeStyle = 'rgb(' + Math.round(wv[1]) + ',0,0)'; dctx.stroke();
        });
      });
    }
    var P = PIECE;
    // edge crease line
    groove(P.x0 + 9, P.y0 + 9, P.x1 - 9, P.y1 - 9, P.r - 9, [[4.5, 60], [2.6, 150], [1.4, 210]]);
    stitches(P.x0 + 24, P.y0 + 24, P.x1 - 24, P.y1 - 24, P.r - 24);
    stitches(196, ZY - 25, 1204, ZY + 25, 25);
    dctx.globalCompositeOperation = 'source-over';
  }
  drawDecor();

  var T_DECOR = tex(PW, PH);
  gl.bindTexture(gl.TEXTURE_2D, T_DECOR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, decor);

  // Impressions: R depth, G foil, B cut-edge flag.
  var imp = mkCanvas(PW, PH), ictx = imp.getContext('2d', { willReadFrequently: true });
  var T_IMP = tex(PW, PH);
  function clearImp() { ictx.globalCompositeOperation = 'source-over'; ictx.fillStyle = '#000'; ictx.fillRect(0, 0, PW, PH); uploadImp(0, 0, PW, PH); }
  function uploadImp(x, y, w, h) {
    x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
    w = Math.min(PW - x, Math.ceil(w)); h = Math.min(PH - y, Math.ceil(h));
    if (w <= 0 || h <= 0) return;
    gl.bindTexture(gl.TEXTURE_2D, T_IMP);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, ictx.getImageData(x, y, w, h));
  }

  // Masks: R main piece, G/B/A offcuts. Kept on the CPU for cutting and hit tests.
  var NPX = PW * PH;
  var masks = [new Uint8Array(NPX), new Uint8Array(NPX), new Uint8Array(NPX), new Uint8Array(NPX)];
  var T_MASK = tex(PW, PH, { mip: true });
  function initMasks() {
    var c = mkCanvas(PW, PH), x = c.getContext('2d');
    x.fillStyle = '#fff'; x.beginPath(); rrPath(x, PIECE.x0, PIECE.y0, PIECE.x1, PIECE.y1, PIECE.r); x.fill();
    x.globalCompositeOperation = 'destination-out'; x.beginPath(); rrPath(x, 210, ZY - SLOT, 1190, ZY + SLOT, SLOT); x.fill();
    var d = x.getImageData(0, 0, PW, PH).data;
    for (var i = 0; i < NPX; i++) { masks[0][i] = d[i * 4 + 3]; masks[1][i] = masks[2][i] = masks[3][i] = 0; }
    uploadMask(0, 0, PW, PH);
  }
  function uploadMask(x, y, w, h) {
    x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
    w = Math.min(PW - x, Math.ceil(w)); h = Math.min(PH - y, Math.ceil(h));
    if (w <= 0 || h <= 0) return;
    var buf = new Uint8Array(w * h * 4);
    for (var j = 0; j < h; j++) {
      var row = (y + j) * PW + x, o = j * w * 4;
      for (var i = 0; i < w; i++) {
        var k = row + i;
        buf[o++] = masks[0][k]; buf[o++] = masks[1][k]; buf[o++] = masks[2][k]; buf[o++] = masks[3][k];
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, T_MASK);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  // LG mark for the zip pull (white on black).
  var T_MARK = tex(128, 128);
  var markImg = new Image(), wordImg = new Image();
  var marksReady = 0;
  markImg.onload = wordImg.onload = function () {
    marksReady++;
    if (this === markImg) {
      var c = mkCanvas(128, 128), x = c.getContext('2d');
      x.drawImage(markImg, 8, 8, 112, 112);
      x.globalCompositeOperation = 'source-in'; x.fillStyle = '#fff'; x.fillRect(0, 0, 128, 128);
      x.globalCompositeOperation = 'destination-over'; x.fillStyle = '#000'; x.fillRect(0, 0, 128, 128);
      // soften so the engraving has sloped walls
      var c2 = mkCanvas(128, 128), x2 = c2.getContext('2d');
      softDraw(x2, c, 0, 0, 128, 128, 1.2);
      gl.bindTexture(gl.TEXTURE_2D, T_MARK);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, c2);
      dirty = true;
    }
  };
  markImg.src = '/favicon.svg?v=2';
  wordImg.src = '/images/logo.svg?v=2';

  // Draw `src` softened by about `r` px (filter blur where supported, else a small kernel).
  var hasFilter = typeof mkCanvas(1, 1).getContext('2d').filter === 'string';
  function softDraw(ctx, src, x, y, w, h, r) {
    if (hasFilter) { ctx.filter = 'blur(' + r + 'px)'; ctx.drawImage(src, x, y, w, h); ctx.filter = 'none'; return; }
    var offs = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r * .7, r * .7], [-r * .7, r * .7], [r * .7, -r * .7], [-r * .7, -r * .7]];
    var ga = ctx.globalAlpha, gco = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    offs.forEach(function (o) { ctx.globalAlpha = ga / offs.length; ctx.drawImage(src, x + o[0], y + o[1], w, h); });
    ctx.globalAlpha = ga; ctx.globalCompositeOperation = gco;
  }

  /* -------------------------------------------------------------- state */
  var DYES = { natural: null, cognac: '#70401F', oxblood: '#4A1014', espresso: '#2E1E16', black: '#151313', olive: '#47461E' };
  var BASE = [0.52, 0.30, 0.15];
  function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function dyeTrans(name) {
    if (!DYES[name]) return [0.86, 0.79, 0.69].map(Math.sqrt);
    var h = DYES[name], rgb = [1, 3, 5].map(function (i) { return lin(parseInt(h.substr(i, 2), 16)); });
    return rgb.map(function (v, i) { return Math.sqrt(Math.min(1, v / BASE[i])); });
  }

  var st = {
    tool: 'dye', dye: 'oxblood', mark: 'lg', finish: 'blind', text: '',
    slider: ZA, sliderTarget: null, tab: 0, tabTarget: 0,
    offcuts: [null, null, null], nextOff: 0,
    light: [-0.5, -0.6], lightT: [-0.5, -0.6], lc: [250, 120], lcT: [250, 120],
    pointer: null
  };
  var drops = [], wetUntil = 0, dirty = true, stampAnims = [];

  /* ------------------------------------------------------------ helpers */
  var view = { W: 1, H: 1, s: 1, cx: PW / 2, cy: PH / 2, dpr: 1 };
  function toWorld(e) {
    var r = canvas.getBoundingClientRect();
    var x = (e.clientX - r.left) * view.dpr, y = (e.clientY - r.top) * view.dpr;
    return { x: (x - view.W / 2) / view.s + view.cx, y: (y - view.H / 2) / view.s + view.cy };
  }
  function gap() { return Math.min(58, Math.max(0, st.slider - ZA) * 0.075); }
  function gapAt(x) { var g = gap(); if (g < 0.01 || x <= ZA || x >= st.slider) return 0; var t = (x - ZA) / (st.slider - ZA); return g * Math.pow(Math.sin(Math.PI * t), 0.7); }
  function zipOff(x, y) { var g = gapAt(x); if (g <= 0) return 0; var dy = Math.max(Math.abs(y - ZY) - SLOT - 0.5 * g, 0); return 0.5 * g / (1 + dy * dy / 22500); }
  function mainSrc(p) { var o = zipOff(p.x, p.y); return { x: p.x, y: p.y < ZY ? Math.min(p.y + o, ZY) : Math.max(p.y - o, ZY) }; }
  function maskAt(ch, x, y) { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= PW || y >= PH) return 0; return masks[ch][y * PW + x]; }
  function offSrc(i, p) {
    var o = st.offcuts[i]; var ca = Math.cos(o.a), sa = Math.sin(o.a);
    var dx = p.x - o.px - o.tx, dy = p.y - o.py - o.ty;
    return { x: ca * dx + sa * dy + o.px, y: -sa * dx + ca * dy + o.py };
  }
  // Which piece is under p: returns {ch, src} or null. Offcuts first (they sit on top).
  function pick(p) {
    for (var i = 2; i >= 0; i--) {
      if (!st.offcuts[i]) continue;
      var q = offSrc(i, p);
      if (maskAt(i + 1, q.x, q.y) > 127) return { ch: i + 1, src: q };
    }
    var s = mainSrc(p);
    if (maskAt(0, s.x, s.y) > 127) return { ch: 0, src: s };
    return null;
  }
  function zipHit(p, pad) {
    if (Math.abs(p.x - st.slider) < 16 + pad && Math.abs(p.y - ZY) < 16 + pad) return true;
    var dx = Math.sin(st.tab), dy = Math.cos(st.tab), rx = p.x - st.slider, ry = p.y - (ZY + 4);
    var u = rx * dx + ry * dy, v = rx * dy - ry * dx;
    return u > 0 && u < 70 + pad && Math.abs(v) < 10 + pad;
  }

  /* --------------------------------------------------------------- dye */
  function splat(f, w, h, x, y, r, a, mode, col) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.viewport(0, 0, w, h);
    gl.useProgram(P_SPLAT);
    gl.uniform2f(P_SPLAT.u.uC, x, y); gl.uniform1f(P_SPLAT.u.uR, r); gl.uniform1f(P_SPLAT.u.uA, a);
    gl.uniform1i(P_SPLAT.u.uMode, mode);
    if (col) gl.uniform3f(P_SPLAT.u.uCol, col[0], col[1], col[2]);
    if (mode === 2) { fullRect(P_SPLAT); return; }
    var x0 = (x - r) / PW * 2 - 1, y0 = (y - r) / PH * 2 - 1;
    drawRect(P_SPLAT, x0, y0, 2 * r / PW * 2, 2 * r / PH * 2);
  }
  var dropScale = 1;
  function addDrop(src) { drops.push({ x: src.x, y: src.y, t0: performance.now(), col: dyeTrans(st.dye), r: DYE_R * dropScale }); }
  function stepDye(now) {
    if (!drops.length && now > wetUntil) return false;
    gl.enable(gl.BLEND);
    if (drops.length) {
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      drops.forEach(function (d) {
        var age = Math.min(1, (now - d.t0) / 1100), e = 1 - Math.pow(1 - age, 3);
        splat(F_DYE, DW, DH, d.x, d.y, d.r * (0.3 + 0.75 * e), 0.075 * (1 - age) + 0.015, 0, d.col);
      });
      gl.blendFunc(gl.ONE, gl.ONE);
      drops.forEach(function (d) {
        var age = Math.min(1, (now - d.t0) / 1100);
        splat(F_WET, 512, 366, d.x, d.y, d.r * (0.4 + 0.7 * age), 0.05 * (1 - age), 1);
      });
      drops = drops.filter(function (d) { return now - d.t0 < 1100; });
      wetUntil = now + 4500;
    }
    // drying
    gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT); gl.blendFunc(gl.ONE, gl.ONE);
    splat(F_WET, 512, 366, 0, 0, 1, 1 / 255, 2);
    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
  }

  /* ------------------------------------------------------------- stamp */
  function markCanvas() {
    // Returns {c, w, h}: white mark on transparent, in piece units (+pad).
    var pad = 6, c, x, w, h;
    if (st.mark === 'lg') {
      w = h = 112; c = mkCanvas(w + pad * 2, h + pad * 2); x = c.getContext('2d');
      x.drawImage(markImg, pad, pad, w, h);
    } else if (st.mark === 'word') {
      w = 500; h = Math.round(500 * 72.23 / 565.94); c = mkCanvas(w + pad * 2, h + pad * 2); x = c.getContext('2d');
      x.drawImage(wordImg, pad, pad, w, h);
    } else {
      var txt = (st.text || '').trim() || 'Your brand';
      var fs = 64; var tc = mkCanvas(10, 10).getContext('2d');
      tc.font = fs + 'px "Alfa Slab One", Rockwell, Georgia, serif';
      var chars = Array.from(txt), adv = chars.map(function (ch) { return tc.measureText(ch).width + fs * 0.05; });
      var tw = Math.min(760, adv.reduce(function (a, b) { return a + b; }, 0));
      w = Math.ceil(tw); h = Math.ceil(fs * 1.05);
      c = mkCanvas(w + pad * 2, h + pad * 2); x = c.getContext('2d');
      x.font = tc.font; x.textBaseline = 'middle'; x.fillStyle = '#fff';
      var sc = tw / Math.max(1, adv.reduce(function (a, b) { return a + b; }, 0)), cx = pad;
      chars.forEach(function (ch, i) { x.save(); x.translate(cx, pad + h / 2 + 2); x.scale(sc, 1); x.fillText(ch, 0, 0); x.restore(); cx += adv[i] * sc; });
    }
    x.globalCompositeOperation = 'source-in'; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    return { c: c, w: c.width, h: c.height };
  }
  function doStamp(hit) {
    var m = markCanvas();
    var col = st.finish === 'foil' ? 'rgb(255,255,0)' : 'rgb(255,0,0)';
    var t = mkCanvas(m.w, m.h), tx = t.getContext('2d');
    softDraw(tx, m.c, 0, 0, m.w, m.h, 0.9);
    tx.globalCompositeOperation = 'source-in'; tx.fillStyle = col; tx.fillRect(0, 0, m.w, m.h);
    stampAnims.push({ t: t, x: hit.src.x - m.w / 2, y: hit.src.y - m.h / 2, k: 0 });
  }
  function stepStamps() {
    if (!stampAnims.length) return false;
    stampAnims.forEach(function (a) {
      a.k++;
      ictx.globalCompositeOperation = 'lighten'; ictx.globalAlpha = Math.min(1, a.k / 7);
      ictx.drawImage(a.t, a.x, a.y);
      ictx.globalAlpha = 1; ictx.globalCompositeOperation = 'source-over';
      uploadImp(a.x - 2, a.y - 2, a.t.width + 4, a.t.height + 4);
    });
    stampAnims = stampAnims.filter(function (a) { return a.k < 7; });
    return true;
  }

  /* --------------------------------------------------------------- cut */
  var cutC = mkCanvas(PW, PH), cctx = cutC.getContext('2d', { willReadFrequently: true });
  var cutting = null;
  function inZipBand(x, y) { return x > ZIPBAND.x0 && x < ZIPBAND.x1 && y > ZIPBAND.y0 && y < ZIPBAND.y1; }
  function cutSegment(a, b) {
    var pad = 4, x0 = Math.floor(Math.min(a.x, b.x) - pad), y0 = Math.floor(Math.min(a.y, b.y) - pad);
    var x1 = Math.ceil(Math.max(a.x, b.x) + pad), y1 = Math.ceil(Math.max(a.y, b.y) + pad);
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(PW, x1); y1 = Math.min(PH, y1);
    var w = x1 - x0, h = y1 - y0; if (w <= 0 || h <= 0) return;
    cctx.clearRect(x0, y0, w, h);
    cctx.lineCap = 'round'; cctx.strokeStyle = '#fff'; cctx.lineWidth = 1.7;
    cctx.beginPath(); cctx.moveTo(a.x, a.y); cctx.lineTo(b.x, b.y); cctx.stroke();
    var d = cctx.getImageData(x0, y0, w, h).data, m = masks[0];
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
      var al = d[(j * w + i) * 4 + 3]; if (!al) continue;
      var X = x0 + i, Y = y0 + j; if (inZipBand(X, Y)) continue;
      var k = Y * PW + X; m[k] = Math.round(m[k] * (255 - al) / 255);
    }
    uploadMask(x0, y0, w, h);
    // raw-edge flag around the cut
    ictx.save(); ictx.beginPath(); ictx.rect(0, 0, PW, PH); ictx.rect(ZIPBAND.x0, ZIPBAND.y0, ZIPBAND.x1 - ZIPBAND.x0, ZIPBAND.y1 - ZIPBAND.y0);
    ictx.clip('evenodd');
    ictx.globalCompositeOperation = 'lighten'; ictx.lineCap = 'round'; ictx.strokeStyle = 'rgb(0,0,255)'; ictx.lineWidth = 16;
    ictx.beginPath(); ictx.moveTo(a.x, a.y); ictx.lineTo(b.x, b.y); ictx.stroke();
    ictx.restore();
    uploadImp(x0 - 10, y0 - 10, w + 20, h + 20);
  }
  function finishCut() {
    var m = masks[0], lab = new Int32Array(NPX), q = new Int32Array(NPX), sizes = [0], n = 0;
    for (var s = 0; s < NPX; s++) {
      if (lab[s] || m[s] < 128) continue;
      n++; var head = 0, tail = 0, sz = 0; q[tail++] = s; lab[s] = n;
      while (head < tail) {
        var k = q[head++]; sz++; var x = k % PW;
        if (x > 0 && !lab[k - 1] && m[k - 1] >= 128) { lab[k - 1] = n; q[tail++] = k - 1; }
        if (x < PW - 1 && !lab[k + 1] && m[k + 1] >= 128) { lab[k + 1] = n; q[tail++] = k + 1; }
        if (k >= PW && !lab[k - PW] && m[k - PW] >= 128) { lab[k - PW] = n; q[tail++] = k - PW; }
        if (k < NPX - PW && !lab[k + PW] && m[k + PW] >= 128) { lab[k + PW] = n; q[tail++] = k + PW; }
      }
      sizes.push(sz);
    }
    if (n < 2) return;
    var keep = lab[ZY * PW + 195];
    if (!keep) { var best = 1; for (var b = 2; b <= n; b++) if (sizes[b] > sizes[best]) best = b; keep = best; }
    // assign partial (edge) pixels to a neighbouring label
    for (var r = 0; r < 2; r++) for (var p = PW; p < NPX - PW; p++) {
      if (lab[p] || !m[p]) continue;
      lab[p] = lab[p - 1] || lab[p + 1] || lab[p - PW] || lab[p + PW] || 0;
    }
    var ch = st.nextOff; st.nextOff = (st.nextOff + 1) % 3;
    var om = masks[ch + 1]; om.fill(0);
    var sx = 0, sy = 0, cnt = 0, mx = 0, my = 0, mc = 0;
    for (var i = 0; i < NPX; i++) {
      if (!m[i]) continue;
      if (lab[i] && lab[i] !== keep) {
        om[i] = m[i]; m[i] = 0; if (om[i] > 127) { sx += i % PW; sy += (i / PW) | 0; cnt++; }
      } else if (m[i] > 127 && (i & 7) === 0) { mx += i % PW; my += (i / PW) | 0; mc++; }
    }
    // clear any old cut flags from previous offcut in this channel is not needed; flags live in imp B.
    uploadMask(0, 0, PW, PH);
    if (!cnt) { st.offcuts[ch] = null; return; }
    var cx = sx / cnt, cy = sy / cnt, dx = cx - mx / mc, dy = cy - my / mc, dl = Math.hypot(dx, dy) || 1;
    var push = 26 + Math.min(30, 4000 / Math.sqrt(cnt));
    st.offcuts[ch] = { px: cx, py: cy, tx: 0, ty: 0, a: 0, anim: { t0: performance.now(), tx: dx / dl * push, ty: dy / dl * push + 6, a: (Math.random() - 0.5) * 0.14 } };
    hint('That piece is loose now. Drag it to move it.');
  }
  function stepOffcuts(now) {
    var any = false;
    st.offcuts.forEach(function (o) {
      if (!o || !o.anim) return;
      var t = Math.min(1, (now - o.anim.t0) / 520), e = 1 - Math.pow(1 - t, 3);
      // a small drop at the start: the piece slides, then settles
      o.tx = o.anim.tx * e; o.ty = o.anim.ty * e; o.a = o.anim.a * e;
      if (t >= 1) delete o.anim;
      any = true;
    });
    return any;
  }

  /* ------------------------------------------------------------- input */
  var drag = null;
  function hint(t) { if (hintEl) hintEl.textContent = t; }
  var HINTS = {
    dye: 'Click or drag on the leather to dye it. Each pass goes a little darker.',
    stamp: 'Click on the leather to press the stamp.',
    cut: 'Drag across the leather to cut it. Drag a loose piece to move it.'
  };

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    var p = toWorld(e); st.pointer = p;
    canvas.setPointerCapture(e.pointerId);
    var pad = e.pointerType === 'touch' ? 14 : 4;
    dropScale = e.pointerType === 'touch' && view.s / view.dpr < 0.45 ? 1.5 : 1;
    if (zipHit(p, pad)) { drag = { type: 'zip', last: p.x, dx: p.x - st.slider }; st.sliderTarget = null; stage.classList.add('is-grabbing'); dirty = true; return; }
    var h = pick(p);
    if (st.tool === 'dye') {
      drag = { type: 'dye', last: h ? h.src : null, lastT: performance.now(), pw: p }; if (h) addDrop(h.src);
    } else if (st.tool === 'stamp') {
      if (h) doStamp(h);
    } else if (st.tool === 'cut') {
      if (h && h.ch > 0) { var o = st.offcuts[h.ch - 1]; delete o.anim; drag = { type: 'move', o: o, sx: p.x - o.tx, sy: p.y - o.ty }; stage.classList.add('is-grabbing'); }
      else { var s = mainSrc(p); drag = { type: 'cut', last: s }; }
    }
    dirty = true;
  });
  canvas.addEventListener('pointermove', function (e) {
    var p = toWorld(e); st.pointer = p;
    st.lightT = [-0.5 + Math.max(-0.45, Math.min(0.45, (p.x - PW / 2) / PW)) * 0.5, -0.6 + Math.max(-0.4, Math.min(0.4, (p.y - PH / 2) / PH)) * 0.45];
    st.lcT = [250 + (p.x - 250) * 0.3, 120 + (p.y - 120) * 0.3];
    if (!drag) stage.classList.toggle('is-grab', zipHit(p, 4) || (st.tool === 'cut' && !!(pick(p) || {}).ch));
    if (drag) {
      if (drag.type === 'zip') {
        var nx = Math.max(ZA, Math.min(ZB, p.x - drag.dx)), v = nx - st.slider;
        if (Math.abs(v) > 0.5) st.tabTarget = v > 0 ? 1.25 : -1.25;
        st.slider = nx; updateZipBtn();
      } else if (drag.type === 'dye') {
        var pw0 = drag.pw || p, segN = Math.max(1, Math.ceil(Math.hypot(p.x - pw0.x, p.y - pw0.y) / 10));
        for (var sN = 1; sN <= segN; sN++) dyeAt({ x: pw0.x + (p.x - pw0.x) * sN / segN, y: pw0.y + (p.y - pw0.y) * sN / segN });
        drag.pw = p;
      } else if (drag.type === 'dyeX') {
        var h = pick(p);
        if (h && !drag.last) { drag.last = h.src; addDrop(h.src); drag.lastT = performance.now(); }
        else if (!h) drag.last = null;
        if (h && drag.last) {
          var d = Math.hypot(h.src.x - drag.last.x, h.src.y - drag.last.y);
          if (d > 11) { var nn = Math.min(12, Math.floor(d / 11)); for (var i = 1; i <= nn; i++) addDrop({ x: drag.last.x + (h.src.x - drag.last.x) * i / nn, y: drag.last.y + (h.src.y - drag.last.y) * i / nn }); drag.last = h.src; drag.lastT = performance.now(); }
        }
      } else if (drag.type === 'cut') {
        var s = mainSrc(p);
        if (Math.hypot(s.x - drag.last.x, s.y - drag.last.y) > 2) { cutSegment(drag.last, s); drag.last = s; }
      } else if (drag.type === 'move') {
        drag.o.tx = p.x - drag.sx; drag.o.ty = p.y - drag.sy;
      }
    }
    dirty = true;
  });
  function dyeAt(p) {
    var h = pick(p);
    if (!h && p.x > 200 && p.x < 1200 && Math.abs(p.y - ZY) < SLOT + 4 + gap() / 2) h = { ch: 0, src: { x: p.x, y: p.y } };
    if (!h) { drag.last = null; return; }
    if (!drag.last || Math.hypot(h.src.x - drag.last.x, h.src.y - drag.last.y) > 11) { addDrop(h.src); drag.last = h.src; drag.lastT = performance.now(); }
  }
  function endDrag() {
    if (drag && drag.type === 'cut') finishCut();
    drag = null; stage.classList.remove('is-grabbing'); dirty = true;
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', function () { if (!drag) { st.pointer = null; dirty = true; } });

  function updateZipBtn() { if (zipBtn) zipBtn.textContent = st.slider > ZA + 40 ? 'Close the zip' : 'Open the zip'; }

  /* ----------------------------------------------------------- toolbar */
  function press(sel, el) { document.querySelectorAll(sel).forEach(function (b) { b.setAttribute('aria-pressed', b === el ? 'true' : 'false'); }); }
  function setTool(t) {
    st.tool = t; stage.dataset.tool = t;
    press('[data-tool]', document.querySelector('[data-tool="' + t + '"]'));
    document.querySelectorAll('[data-panel]').forEach(function (p) { p.hidden = p.dataset.panel !== t; });
    hint(HINTS[t]); dirty = true;
  }
  document.querySelectorAll('[data-tool]').forEach(function (b) { b.addEventListener('click', function () { setTool(b.dataset.tool); }); });
  document.querySelectorAll('[data-dye]').forEach(function (b) { b.addEventListener('click', function () { st.dye = b.dataset.dye; press('[data-dye]', b); setTool('dye'); }); });
  document.querySelectorAll('[data-mark]').forEach(function (b) { b.addEventListener('click', function () { st.mark = b.dataset.mark; press('[data-mark]', b); if (st.mark === 'text') { var i = document.querySelector('.wb-text input'); if (i && !i.value) i.focus(); } }); });
  document.querySelectorAll('[data-finish]').forEach(function (b) { b.addEventListener('click', function () { st.finish = b.dataset.finish; press('[data-finish]', b); }); });
  var textIn = document.querySelector('.wb-text input');
  if (textIn) textIn.addEventListener('input', function () {
    st.text = textIn.value.slice(0, 16);
    st.mark = 'text'; press('[data-mark]', document.querySelector('[data-mark="text"]'));
  });
  if (zipBtn) zipBtn.addEventListener('click', function () {
    st.sliderTarget = st.slider > ZA + 40 ? ZA : ZB; st.tabTarget = st.sliderTarget > st.slider ? 1.25 : -1.25; dirty = true;
  });
  var resetBtn = document.querySelector('[data-action="reset"]');
  if (resetBtn) resetBtn.addEventListener('click', reset);
  function reset() {
    initMasks(); clearImp(); clearDye();
    st.offcuts = [null, null, null]; st.nextOff = 0; st.slider = ZA; st.sliderTarget = null; st.tab = st.tabTarget = 0;
    drops = []; stampAnims = []; updateZipBtn(); hint(HINTS[st.tool]); dirty = true;
  }
  if (document.fonts && document.fonts.load) document.fonts.load('64px "Alfa Slab One"');

  /* ------------------------------------------------------------ render */
  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = stage.clientWidth, h = stage.clientHeight;
    if (w * h * dpr * dpr > 3.6e6) dpr = Math.sqrt(3.6e6 / (w * h));
    view.dpr = dpr;
    view.W = canvas.width = overlay.width = Math.max(1, Math.round(w * dpr));
    view.H = canvas.height = overlay.height = Math.max(1, Math.round(h * dpr));
    view.s = Math.min(view.W / (PW * 1.04), view.H / (PH * 1.04));
    dirty = true;
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage); else window.addEventListener('resize', resize);
  resize();

  function bindTex(p, name, t, unit) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(p.u[name], unit); }

  function render() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, view.W, view.H);
    gl.useProgram(P_MAIN);
    var u = P_MAIN.u;
    gl.uniform2f(u.uRes, view.W, view.H); gl.uniform1f(u.uScale, view.s); gl.uniform2f(u.uCenter, view.cx, view.cy);
    var L = [st.light[0], st.light[1], 0.62], ll = Math.hypot(L[0], L[1], L[2]);
    gl.uniform3f(u.uL, L[0] / ll, L[1] / ll, L[2] / ll);
    gl.uniform2f(u.uLC, st.lc[0], st.lc[1]);
    gl.uniform1f(u.uS, st.slider); gl.uniform1f(u.uGap, gap()); gl.uniform1f(u.uTab, st.tab); gl.uniform1f(u.uBump, 1.6);
    var off = new Float32Array(12), piv = new Float32Array(6);
    st.offcuts.forEach(function (o, i) { if (!o) return; off[i * 4] = o.tx; off[i * 4 + 1] = o.ty; off[i * 4 + 2] = o.a; off[i * 4 + 3] = 1; piv[i * 2] = o.px; piv[i * 2 + 1] = o.py; });
    gl.uniform4fv(u.uOff, off); gl.uniform2fv(u.uPiv, piv);
    bindTex(P_MAIN, 'uGA', T_GA, 0); bindTex(P_MAIN, 'uGB', T_GB, 1); bindTex(P_MAIN, 'uMask', T_MASK, 2);
    bindTex(P_MAIN, 'uImp', T_IMP, 3); bindTex(P_MAIN, 'uDecor', T_DECOR, 4); bindTex(P_MAIN, 'uDye', T_DYE, 5);
    bindTex(P_MAIN, 'uWet', T_WET, 6); bindTex(P_MAIN, 'uBench', T_BENCH, 7); bindTex(P_MAIN, 'uMark', T_MARK, 8);
    fullRect(P_MAIN);
    drawOverlay();
  }

  function drawOverlay() {
    octx.clearRect(0, 0, overlay.width, overlay.height);
    var p = st.pointer; if (!p || (drag && drag.type !== 'dye')) return;
    if (zipHit(p, 4)) return;
    var sx = (p.x - view.cx) * view.s + view.W / 2, sy = (p.y - view.cy) * view.s + view.H / 2;
    if (st.tool === 'dye') {
      octx.lineWidth = 1.5 * view.dpr;
      octx.strokeStyle = 'rgba(0,0,0,.35)'; octx.beginPath(); octx.arc(sx, sy, DYE_R * 0.8 * view.s + view.dpr, 0, 7); octx.stroke();
      octx.strokeStyle = 'rgba(255,248,236,.75)'; octx.beginPath(); octx.arc(sx, sy, DYE_R * 0.8 * view.s, 0, 7); octx.stroke();
    } else if (st.tool === 'stamp' && marksReady === 2) {
      var m = ghostCache();
      octx.globalAlpha = 0.5;
      octx.drawImage(m.c, sx - m.w * view.s / 2, sy - m.h * view.s / 2, m.w * view.s, m.h * view.s);
      octx.globalAlpha = 1;
    }
  }
  var ghost = { key: '', m: null };
  function ghostCache() {
    var key = st.mark + '|' + st.text;
    if (ghost.key !== key) {
      var m = markCanvas(), c = mkCanvas(m.w, m.h), x = c.getContext('2d');
      x.drawImage(m.c, 0, 0);
      x.globalCompositeOperation = 'source-in'; x.fillStyle = 'rgba(255,250,240,.9)'; x.fillRect(0, 0, m.w, m.h);
      ghost = { key: key, m: { c: c, w: m.w, h: m.h } };
    }
    return ghost.m;
  }

  var lastT = performance.now();
  function frame(now) {
    var dt = Math.min(50, now - lastT); lastT = now;
    var k = 1 - Math.exp(-dt / 140);
    var moving = false;
    ['light', 'lc'].forEach(function (key) {
      var a = st[key], b = st[key + 'T'];
      for (var i = 0; i < 2; i++) { var d = b[i] - a[i]; if (Math.abs(d) > (key === 'lc' ? 0.5 : 0.002)) { a[i] += d * k; moving = true; } }
    });
    if (drag && drag.type === 'dye' && drag.last && now - drag.lastT > 160) { addDrop(drag.last); drag.lastT = now; }
    if (st.sliderTarget !== null) {
      var d = st.sliderTarget - st.slider;
      st.slider += Math.sign(d) * Math.min(Math.abs(d), dt * 0.9);
      if (Math.abs(d) < 0.5) { st.slider = st.sliderTarget; st.sliderTarget = null; }
      updateZipBtn(); moving = true;
    }
    if (Math.abs(st.tabTarget - st.tab) > 0.002) { st.tab += (st.tabTarget - st.tab) * (1 - Math.exp(-dt / 120)); moving = true; }
    if (stepDye(now)) moving = true;
    if (stepStamps()) moving = true;
    if (stepOffcuts(now)) moving = true;
    if (moving || dirty) { render(); dirty = false; }
    requestAnimationFrame(frame);
  }

  initMasks(); clearImp(); clearDye();
  setTool('dye');
  requestAnimationFrame(frame);

  // For automated checks.
  window.__workbench = { state: st, toWorld: toWorld, view: view, render: render, gl: gl, dbg: function () { return { drops: drops.length, drag: drag && drag.type, tool: st.tool, dye: st.dye }; } };
})();
